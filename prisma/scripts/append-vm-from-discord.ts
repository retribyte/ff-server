/**
 * Append new Vortox Machina entries from the #cyoa-vm Discord channel to the
 * "vm" story's single chapter. Only the GM's (Zander's) code-block entries
 * become lines; player prompts, "@Trey" pings and parenthetical GM notes are
 * skipped (same as the original cyoa.json).
 *
 *   tsx prisma/scripts/append-vm-from-discord.ts [--after <messageId>] [--apply]
 *   tsx prisma/scripts/append-vm-from-discord.ts <export.json> [--apply]
 *
 * By default it asks the local discord-mcp server (DISCORD_MCP_URL, default
 * http://localhost:8085/mcp -- the Docker container, see wiki/CLAUDE.md) for
 * messages after the cursor in data/vm-discord-cursor.json (override with
 * --after). With a DiscordChatExporter JSON path it reads that instead.
 *
 * Dry run unless --apply. Lines are appended after the current last line_no,
 * and --apply advances the cursor to the newest message seen.
 */
import { StoryLineType } from "@prisma/client";
import { prisma } from "../../src/db.js";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const afterIdx = args.indexOf("--after");
const afterArg = afterIdx >= 0 ? args[afterIdx + 1] : undefined;
const file = args.find((a, i) => !a.startsWith("--") && (afterIdx < 0 || i !== afterIdx + 1));

const CHANNEL_ID = "824134407496794162"; // #cyoa-vm
const MCP_URL = process.env.DISCORD_MCP_URL ?? "http://localhost:8085/mcp";
const CURSOR_FILE = join(dirname(fileURLToPath(import.meta.url)), "data/vm-discord-cursor.json");
const GM_NAMES = new Set(["Zander", "lastingparadox"]); // nickname in exports, username from the MCP

interface DiscordMsg { id: string; author: string; content: string }

/** Call one tool on the streamable-HTTP MCP server (fresh session per run). */
async function mcpSession() {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const post = async (body: object) => {
        const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`discord-mcp ${res.status}: ${await res.text()}`);
        const sid = res.headers.get("mcp-session-id");
        if (sid) headers["Mcp-Session-Id"] = sid;
        const text = await res.text();
        const data = text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? text;
        return data.trim() ? JSON.parse(data) : null;
    };
    await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ff-server", version: "1" } } });
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    let n = 1;
    return async (name: string, args: object) => {
        const r = await post({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } });
        if (r.error || r.result?.isError) throw new Error(`discord-mcp ${name}: ${JSON.stringify(r.error ?? r.result)}`);
        const t = r.result.content[0].text as string;
        return t.startsWith('"') ? (JSON.parse(t) as string) : t;
    };
}

/** Parse read_messages' text format: "- (ID: n) **[author]** `ts`: ```content```" (+ optional Reply/Reactions/Attachments lines). */
function parseMcpMessages(text: string): DiscordMsg[] {
    const head = /^- \(ID: (\d+)\) \*\*\[(.*?)\]\*\* `[^`]*`: ```/gm;
    const hits = [...text.matchAll(head)];
    return hits.map((h, i) => {
        const bodyStart = h.index! + h[0].length;
        const chunk = text.slice(bodyStart, i + 1 < hits.length ? hits[i + 1].index! : text.length);
        const end = chunk.lastIndexOf("```");
        if (end < 0) throw new Error(`unterminated message ${h[1]}`);
        return { id: h[1], author: h[2], content: chunk.slice(0, end) };
    });
}

async function fetchNewMessages(after: string): Promise<DiscordMsg[]> {
    const call = await mcpSession();
    const all: DiscordMsg[] = [];
    let cursor = after;
    for (;;) {
        const batch = parseMcpMessages(await call("read_messages", { channelId: CHANNEL_ID, count: "100", after: cursor }));
        if (!batch.length) break;
        all.push(...batch);
        cursor = batch.reduce((m, x) => (BigInt(x.id) > BigInt(m) ? x.id : m), cursor);
        if (batch.length < 100) break;
    }
    return all.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

// Speaker prefix -> character slug. Slugs, not ids: ids differ between the
// dev DB, a fresh seed and prod. main() resolves them before parsing.
const SPEAKERS: Record<string, string | "npc"> = {
    E: "emmett_tawfeek",
    L: "los_yelsi",
    I: "irene",
    W: "wes_romaw",
    FP: "felps",
    F: "felps",
    S: "squorchy_vurkallus",
    "?": "npc",
};
const speakerIds = new Map<string, number>(); // slug -> id, filled by main()

interface Row { type: StoryLineType; text: string; characterId: number | null; npcVoice: boolean }

function parse(content: string): Row[] {
    const rows: Row[] = [];
    // Split into heading / fenced-block pieces in order.
    const re = /\*\*(.*?)\s*==>\*\*|```\n?([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(content))) {
        if (content.slice(last, m.index).trim()) throw new Error(`stray text: ${content.slice(last, m.index)}`);
        last = re.lastIndex;
        if (m[2] === undefined) {
            rows.push({ type: StoryLineType.ACTION, text: m[1] ? `${m[1]} ⇒` : "⇒", characterId: null, npcVoice: false });
            continue;
        }
        for (const para of m[2].split(/\n\s*\n/)) {
            const lines = para.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
            if (!lines.length) continue;
            const isDialogue = (l: string) => /^(FP|[EFILSW?]): /.test(l);
            if (!lines.some(isDialogue)) {
                rows.push({ type: StoryLineType.NARRATION, text: lines.join("\n").trim(), characterId: null, npcVoice: false });
                continue;
            }
            for (const l of lines) {
                if (isDialogue(l)) {
                    const [, who, text] = l.match(/^(FP|[EFILSW?]): (.*)$/)!;
                    const sp = SPEAKERS[who];
                    rows.push({
                        type: StoryLineType.DIALOGUE,
                        text: text.trim(),
                        characterId: sp === "npc" ? null : speakerIds.get(sp)!,
                        npcVoice: sp === "npc",
                    });
                } else if (rows.at(-1)?.type === StoryLineType.DIALOGUE) {
                    rows.at(-1)!.text += "\n" + l.trim();
                } else throw new Error(`orphan line in dialogue paragraph: ${l}`);
            }
        }
    }
    if (content.slice(last).trim()) throw new Error(`trailing text: ${content.slice(last)}`);
    return rows;
}

async function main() {
    let messages: DiscordMsg[];
    if (file) {
        const data = JSON.parse(readFileSync(file, "utf8"));
        messages = data.messages.map((m: any) => ({ id: m.id, author: m.author.nickname, content: m.content }));
    } else {
        const after = afterArg ?? (JSON.parse(readFileSync(CURSOR_FILE, "utf8")) as { lastMessageId: string }).lastMessageId;
        messages = await fetchNewMessages(after);
        console.log(`fetched ${messages.length} messages after ${after}`);
    }
    const slugs = Object.values(SPEAKERS).filter((s) => s !== "npc");
    for (const c of await prisma.character.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })) {
        speakerIds.set(c.slug, c.id);
    }
    const missing = slugs.filter((s) => !speakerIds.has(s));
    if (missing.length) throw new Error(`no character for speaker slug(s): ${[...new Set(missing)].join(", ")}`);
    const rows: Row[] = [];
    for (const msg of messages) {
        if (!GM_NAMES.has(msg.author) || !msg.content.includes("```")) continue;
        rows.push(...parse(msg.content));
    }
    const chapter = await prisma.storyChapter.findFirstOrThrow({
        where: { story: { slug: "vm" } },
        orderBy: { chapter_no: "desc" },
    });
    const max = await prisma.storyLine.aggregate({ where: { chapterId: chapter.id }, _max: { line_no: true } });
    const start = (max._max.line_no ?? 0) + 1;
    const hist: Record<string, number> = {};
    for (const r of rows) hist[r.type] = (hist[r.type] ?? 0) + 1;
    console.log(`${rows.length} new lines, starting at line_no ${start}`, hist);
    if (!apply) {
        rows.slice(0, 6).forEach((r, i) => console.log(start + i, r.type, r.characterId, r.npcVoice, JSON.stringify(r.text.slice(0, 80))));
        console.log("dry run; pass --apply to write");
        return;
    }
    await prisma.storyLine.createMany({
        data: rows.map((r, i) => ({ chapterId: chapter.id, line_no: start + i, ...r, speaker: null })),
    });
    console.log("written; run `npm run export:vm-appended` and commit, so the seed has these lines too");
    if (!file && messages.length) {
        writeFileSync(CURSOR_FILE, JSON.stringify({ lastMessageId: messages.at(-1)!.id }, null, 4) + "\n");
        console.log(`cursor -> ${messages.at(-1)!.id}`);
    }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
