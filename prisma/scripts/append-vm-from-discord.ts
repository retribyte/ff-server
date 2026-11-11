/**
 * Append new Vortox Machina entries from the #cyoa-vm Discord channel to the
 * "vm" story, the same import as the /admin page's (src/jobs/vmImport.ts:
 * same parser, same remembered "last message" and speaker codes, logged in
 * the admin History). The site takes a DiscordChatExporter JSON export; this
 * can also read the channel through the local discord-mcp server.
 *
 *   tsx prisma/scripts/append-vm-from-discord.ts [<export.json>] [--apply]
 *
 * Without a file it asks discord-mcp (DISCORD_MCP_URL, default
 * http://localhost:8085/mcp -- the Docker container, see wiki/CLAUDE.md) for
 * the messages after the last import. Dry run unless --apply. A speaker code
 * it doesn't know yet stops it: map it once on the /admin page.
 */
import { readFileSync } from "fs";
import { prisma } from "../../src/db.js";
import { runJob } from "../../src/jobs/runner.js";
import { VM_IMPORT_JOB, loadState, previewVmImport, runVmImport } from "../../src/jobs/vmImport.js";
import { VM_CHANNEL_ID, messagesFromExport, type VmMessage } from "../../src/jobs/vm-parse.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));

const MCP_URL = process.env.DISCORD_MCP_URL ?? "http://localhost:8085/mcp";

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
function parseMcpMessages(text: string): VmMessage[] {
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

async function fetchNewMessages(after: string): Promise<VmMessage[]> {
    const call = await mcpSession();
    const all: VmMessage[] = [];
    let cursor = after;
    for (;;) {
        const batch = parseMcpMessages(await call("read_messages", { channelId: VM_CHANNEL_ID, count: "100", after: cursor }));
        if (!batch.length) break;
        all.push(...batch);
        cursor = batch.reduce((m, x) => (BigInt(x.id) > BigInt(m) ? x.id : m), cursor);
        if (batch.length < 100) break;
    }
    return all;
}

async function main() {
    const messages = file
        ? messagesFromExport(JSON.parse(readFileSync(file, "utf8")))
        : await fetchNewMessages((await loadState()).lastMessageId);
    const preview = await previewVmImport(messages, undefined);
    console.log(`${preview.entries} new GM entries, ${preview.lineCount} lines, after message ${preview.lastMessageId} (${preview.lastMessageAt})`);
    for (const c of preview.codes) console.log(`  ${c.code}: ${c.voice ?? "UNKNOWN"} (${c.count} lines, e.g. ${JSON.stringify(c.example)})`);
    if (preview.unknown.length) {
        throw new Error(`unknown speaker code(s) ${preview.unknown.join(", ")}: map them on the /admin page's Vortox Machina import, then rerun`);
    }
    const run = await runJob(VM_IMPORT_JOB, null, !apply, (ctx) => runVmImport(messages, undefined, ctx));
    console.log(run.log);
    console.log(`${run.status}: ${run.summary}`);
    if (run.status === "FAILED") process.exitCode = 1;
}
main()
    .catch((e) => {
        console.error(e instanceof Error ? e.message : e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
