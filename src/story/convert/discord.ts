// Vortox Machina from Discord: a DiscordChatExporter JSON export of #cyoa-vm
// in, the story's lines out, for the web importer (POST
// /stories/convert/discord). Like the Google Doc converter it writes nothing:
// the importer maps each speaker code to a speaker (remembered on the story,
// Story.importMeta.codes), previews it, and a revision of the "vm" story goes
// through its review of what changed against the shelf. Pure, so it's unit
// tested.
//
// A GM entry is a Discord message of code blocks, with an optional bold
// "**Choice ==>**" heading before each:
//   - a heading becomes an ACTION line ("Choice ⇒")
//   - a code-block paragraph with no dialogue is one NARRATION line
//   - in a paragraph with dialogue, each "CODE: text" line is a DIALOGUE line
//     spoken by that code's voice (E = Emmett, ? = an unnamed NPC, ...), and a
//     plain line continues the dialogue line above it

export const VM_CHANNEL_ID = "824134407496794162"; // #cyoa-vm

/** The GM, by Discord nickname (DiscordChatExporter) or username. */
export const VM_GM_NAMES = new Set(["Zander", "lastingparadox"]);

export type VmLineType = "ACTION" | "NARRATION" | "DIALOGUE";

/** A parsed line; DIALOGUE carries the speaker code it was written with. */
export type VmRow = { type: VmLineType; text: string; code?: string };

/** One message as the converter reads it. */
export type VmMessage = { id: string; author: string; content: string };

// A speaker code: one to three capitals/digits starting with a capital, or an
// unnamed NPC: "?", "??", "???", optionally numbered ("?2", "???3")
const DIALOGUE = /^([A-Z][A-Z0-9]{0,2}|\?{1,3}\d?): (.*)$/;

/** Throws on text the format doesn't allow (stray text outside code blocks, an orphan line). */
export function parseEntry(content: string): VmRow[] {
    const rows: VmRow[] = [];
    const re = /\*\*(.*?)\s*==>\*\*|```\n?([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(content))) {
        if (content.slice(last, m.index).trim()) throw new Error(`stray text: ${content.slice(last, m.index).trim().slice(0, 80)}`);
        last = re.lastIndex;
        if (m[2] === undefined) {
            rows.push({ type: "ACTION", text: m[1] ? `${m[1]} ⇒` : "⇒" });
            continue;
        }
        for (const para of m[2].split(/\n\s*\n/)) {
            const lines = para
                .split("\n")
                .map((l) => l.trimEnd())
                .filter((l) => l.trim());
            if (!lines.length) continue;
            if (!lines.some((l) => DIALOGUE.test(l))) {
                rows.push({ type: "NARRATION", text: lines.join("\n").trim() });
                continue;
            }
            for (const l of lines) {
                const d = l.match(DIALOGUE);
                if (d) rows.push({ type: "DIALOGUE", text: d[2].trim(), code: d[1] });
                else if (rows.at(-1)?.type === "DIALOGUE") rows.at(-1)!.text += "\n" + l.trim();
                else throw new Error(`orphan line in dialogue paragraph: ${l.trim().slice(0, 80)}`);
            }
        }
    }
    if (content.slice(last).trim()) throw new Error(`trailing text: ${content.slice(last).trim().slice(0, 80)}`);
    return rows;
}

const newer = (a: string, b: string) => BigInt(a) > BigInt(b);

/**
 * A DiscordChatExporter JSON export of #cyoa-vm as messages. Throws when it
 * isn't one, or is another channel's.
 */
export function messagesFromExport(data: unknown): VmMessage[] {
    const d = data as { channel?: { id?: unknown }; messages?: unknown };
    if (!d || typeof d !== "object" || !Array.isArray(d.messages)) {
        throw new Error("Not a DiscordChatExporter JSON export (no messages list)");
    }
    if (d.channel?.id !== undefined && String(d.channel.id) !== VM_CHANNEL_ID) {
        throw new Error(`This export is of another channel (${String(d.channel.id)}), not #cyoa-vm`);
    }
    return d.messages.map((m: any, i: number) => {
        if (typeof m?.id !== "string" || typeof m?.content !== "string") throw new Error(`Message ${i + 1} has no id or content`);
        const author = m.author ?? {};
        const name = [author.nickname, author.name].find((n) => typeof n === "string" && VM_GM_NAMES.has(n)) ?? author.nickname ?? author.name ?? "";
        return { id: m.id, author: String(name), content: m.content };
    });
}

export type DiscordConversion = {
    /** the story's lines, oldest entry first; DIALOGUE lines carry their speaker code */
    lines: VmRow[];
    /** GM entries read */
    entries: number;
    /** every speaker code, with how many lines it speaks and its first one */
    codes: { code: string; count: number; example: string }[];
    /** entries that don't read in the format (left out of the lines) */
    warnings: string[];
};

/**
 * Every GM entry in the export (a GM message with code blocks), oldest first,
 * as story lines. An entry that doesn't read is left out with a warning (old
 * ones were posted in earlier formats; the review of a revision shows their
 * lines as removed, to keep).
 */
export function convertDiscord(data: unknown): DiscordConversion {
    const messages = messagesFromExport(data)
        .filter((m) => /^\d+$/.test(m.id) && VM_GM_NAMES.has(m.author) && m.content.includes("```"))
        .sort((a, b) => (newer(a.id, b.id) ? 1 : -1));
    const lines: VmRow[] = [];
    const warnings: string[] = [];
    let entries = 0;
    for (const msg of messages) {
        try {
            const rows = parseEntry(msg.content);
            if (rows.length) entries++;
            lines.push(...rows);
        } catch (error) {
            const when = snowflakeDate(msg.id).toISOString().slice(0, 10);
            warnings.push(`The entry posted ${when} (message ${msg.id}) doesn't read, so it's left out: ${(error as Error).message}`);
        }
    }
    const codes = new Map<string, { count: number; example: string }>();
    for (const r of lines) {
        if (r.code === undefined) continue;
        const seen = codes.get(r.code);
        if (seen) seen.count++;
        else codes.set(r.code, { count: 1, example: r.text.slice(0, 120) });
    }
    return { lines, entries, codes: [...codes].map(([code, c]) => ({ code, ...c })), warnings };
}

/** When a Discord message was sent, from its id (a snowflake). */
export function snowflakeDate(id: string): Date {
    return new Date(Number((BigInt(id) >> 22n) + 1420070400000n));
}
