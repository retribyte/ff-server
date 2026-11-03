// Story markdown manuscript -> import payload. A port of
// ff-site/archive-to-markdown/story-md-to-api.py (its README documents the
// format), kept function-for-function so the two stay reviewable side by side.

import { WS, collapse, len, rstrip, split, splitlines, strip, stripChars } from "./py.js";

export class ManuscriptError extends Error {}

// `npc` (a span) / `npcVoice` (a DIALOGUE line): an NPC voice with no name
// yet, written {?} / "> ?:" in the manuscript. It's named later in the reader.
export type Segment = { text: string; speaker?: string; npc?: true; italic?: true; bold?: true };
export type ManuscriptLine = {
    type: "NARRATION" | "DIALOGUE" | "ACTION" | "TRANSCRIPT" | "BREAK" | "HEADING";
    text: string;
    speaker?: string;
    npcVoice?: true;
    segments?: Segment[];
};

/** The speaker name for an NPC voice with no name yet ({?} / "> ?:"). */
export const UNNAMED_NPC = "?";
type Voice = { speaker?: string; npc?: true };
export type ManuscriptChapter = { chapter_no: number; title: string | null; lines: ManuscriptLine[] };
export type ManuscriptPayload = {
    story: Record<string, string>;
    authors: string[];
    chapters: ManuscriptChapter[];
};

const S = `[${WS}]`; // Python's \s
const NS = `[^${WS}]`; // Python's \S
const SLUG_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const CHAPTER_RE = new RegExp(`^#${S}+Chapter${S}+(\\d+)(?:${S}*:${S}*([^\\n]+?))?${S}*$`, "i");
const DIALOGUE_RE = new RegExp(`^>${S}*([^\\n]+?):${S}+([^\\n]*)$`);
const BREAK_RE = new RegExp(`^(\\*${S}*\\*${S}*\\*+|-{3,}|_{3,})${S}*$`);
// Novel-style inline dialogue: [spoken text]{Speaker} embedded in a narration paragraph
const INLINE_DIALOGUE_RE = /\[([^[\]]+)\]\{([^{}]+)\}/g;
// Inline emphasis: ***bold+italic***, **bold**, *italic*. Markers must hug
// non-space (CommonMark-ish) so stray asterisks stay literal. Longest first.
const EMPHASIS_RE = new RegExp(
    `\\*\\*\\*(?=${NS})([^\\n]+?)(?<=${NS})\\*\\*\\*|\\*\\*(?=${NS})([^\\n]+?)(?<=${NS})\\*\\*|\\*(?=${NS})([^\\n]+?)(?<=${NS})\\*`,
    "g"
);
// In-chapter section heading: "## Title" (distinct from "# Chapter N")
const HEADING_RE = new RegExp(`^##${S}+([^\\n]+?)${S}*$`);
const COMMENT_RE = new RegExp(`${S}#`);
const VALID_FORMATS = new Set(["script", "prose"]);

/** Returns [meta, remaining lines]. */
function parseFrontmatter(lines: string[]): [Record<string, string>, string[]] {
    if (lines.length === 0 || strip(lines[0]) !== "---") {
        throw new ManuscriptError("manuscript must start with a --- frontmatter block");
    }
    const meta: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (strip(line) === "---") return [meta, lines.slice(i + 1)];
        if (!strip(line) || strip(line).startsWith("#")) continue;
        const sep = line.indexOf(":");
        if (sep < 0) throw new ManuscriptError(`bad frontmatter line: ${JSON.stringify(line)}`);
        // a comment starts at whitespace + "#" (YAML), so '#e8b23b' survives
        const value = stripChars(strip(line.slice(sep + 1).split(COMMENT_RE)[0]), "'\"");
        meta[strip(line.slice(0, sep))] = value;
    }
    throw new ManuscriptError("unterminated frontmatter block");
}

/** Turn one blank-line-delimited paragraph into story line(s). */
function flushParagraph(buffer: string[], out: ManuscriptLine[]) {
    const text = strip(buffer.join("\n"));
    if (!text) return;

    if (BREAK_RE.test(text)) {
        out.push({ type: "BREAK", text: "" });
        return;
    }

    // A paragraph of "> Name: ..." quote lines — one DIALOGUE line each;
    // bare "> ..." continuations attach to the previous speaker's line.
    if (text.startsWith(">")) {
        let current: ManuscriptLine | null = null;
        for (const raw of buffer) {
            const stripped = strip(raw);
            if (!stripped.startsWith(">")) continue;
            const body = strip(stripped.slice(1));
            const match = DIALOGUE_RE.exec(stripped);
            if (match) {
                if (current) out.push(current);
                const speaker = strip(match[1]);
                const voice = speaker === UNNAMED_NPC ? { npcVoice: true as const } : { speaker };
                current = { type: "DIALOGUE", ...voice, text: match[2] };
            } else if (current) {
                current.text += " " + body;
            } else {
                throw new ManuscriptError(`dialogue line without a speaker: ${JSON.stringify(stripped)}`);
            }
        }
        if (current) out.push(current);
        return;
    }

    // _action line_ — the whole paragraph wrapped in single underscores
    if (text.startsWith("_") && text.endsWith("_") && len(text) > 2 && !text.startsWith("__")) {
        out.push({ type: "ACTION", text: collapse(text.slice(1, -1)) });
        return;
    }

    // NARRATION — markdown soft-wraps join with a space
    const joined = split(text).join(" ");
    const segments = parseInlineSegments(joined);
    if (segments) {
        // text is the clean concatenation of segment texts (markers stripped)
        out.push({ type: "NARRATION", text: segments.map((s) => s.text).join(""), segments });
    } else {
        out.push({ type: "NARRATION", text: joined });
    }
}

/** Split `text` on *italic* / **bold** / ***both*** markers into segments carrying `base`. */
export function parseEmphasis(text: string, base: Voice): Segment[] {
    const segments: Segment[] = [];
    let pos = 0;
    for (const match of text.matchAll(EMPHASIS_RE)) {
        const start = match.index!;
        if (start > pos) segments.push({ ...base, text: text.slice(pos, start) });
        if (match[1] !== undefined) segments.push({ ...base, text: match[1], italic: true, bold: true });
        else if (match[2] !== undefined) segments.push({ ...base, text: match[2], bold: true });
        else segments.push({ ...base, text: match[3], italic: true });
        pos = start + match[0].length;
    }
    if (pos < text.length) segments.push({ ...base, text: text.slice(pos) });
    return segments;
}

/**
 * Split a narration paragraph into segments at [dialogue]{Speaker} spans and
 * emphasis (emphasis nests inside spans). Whitespace is preserved so segments
 * concatenate back to the prose; null for plain narration.
 */
export function parseInlineSegments(text: string): Segment[] | null {
    const segments: Segment[] = [];
    let hasAnnotation = false;
    let pos = 0;
    const add = (pieces: Segment[]) => {
        segments.push(...pieces);
        if (pieces.some((p) => p.italic || p.bold)) hasAnnotation = true;
    };
    for (const match of text.matchAll(INLINE_DIALOGUE_RE)) {
        const start = match.index!;
        if (start > pos) add(parseEmphasis(text.slice(pos, start), {}));
        const speaker = strip(match[2]);
        segments.push(...parseEmphasis(match[1], speaker === UNNAMED_NPC ? { npc: true } : { speaker }));
        hasAnnotation = true; // a dialogue span is itself an annotation
        pos = start + match[0].length;
    }
    if (pos < text.length) add(parseEmphasis(text.slice(pos), {}));

    if (!hasAnnotation) return null;
    // A whitespace-only segment (a space between two styled runs) carries no
    // visible style: fold it into its neighbour so no segment is blank.
    const merged: Segment[] = [];
    for (const seg of segments) {
        const last = merged[merged.length - 1];
        if (last && !strip(seg.text)) merged[merged.length - 1] = { ...last, text: last.text + seg.text };
        else if (last && !strip(last.text)) merged[merged.length - 1] = { ...seg, text: last.text + seg.text };
        else merged.push(seg);
    }
    return merged;
}

function parseBody(lines: string[]): ManuscriptChapter[] {
    const chapters: ManuscriptChapter[] = [];
    let current: ManuscriptChapter | null = null;
    let buffer: string[] = [];
    let inFence = false;
    let fenceLines: string[] = [];
    const chapter = () => {
        if (current === null) {
            current = { chapter_no: 1, title: null, lines: [] };
            chapters.push(current);
        }
        return current;
    };

    for (const line of lines) {
        if (inFence) {
            if (strip(line) === "```") {
                inFence = false;
                chapter().lines.push({ type: "TRANSCRIPT", text: strip(fenceLines.join("\n")) });
            } else {
                fenceLines.push(rstrip(line));
            }
            continue;
        }
        if (strip(line).startsWith("```")) {
            if (buffer.length) {
                flushParagraph(buffer, chapter().lines);
                buffer = [];
            }
            const kind = strip(strip(line).slice(3));
            if (kind !== "transcript") {
                throw new ManuscriptError(`unknown fenced block ${JSON.stringify(kind)} (only \`\`\`transcript is supported)`);
            }
            inFence = true;
            fenceLines = [];
            continue;
        }
        const heading = CHAPTER_RE.exec(line);
        if (heading) {
            if (current) {
                flushParagraph(buffer, (current as ManuscriptChapter).lines);
                buffer = [];
            }
            current = { chapter_no: parseInt(heading[1], 10), title: heading[2] || null, lines: [] };
            chapters.push(current);
            continue;
        }
        const section = HEADING_RE.exec(line);
        if (section) {
            flushParagraph(buffer, chapter().lines);
            buffer = [];
            chapter().lines.push({ type: "HEADING", text: strip(section[1]) });
            continue;
        }
        if (!strip(line)) {
            if (buffer.length) {
                flushParagraph(buffer, chapter().lines);
                buffer = [];
            }
        } else {
            buffer.push(line);
        }
    }
    if (inFence) throw new ManuscriptError("unterminated ```transcript block");
    if (buffer.length) flushParagraph(buffer, chapter().lines);

    const seen = new Set<number>();
    for (const ch of chapters) {
        if (seen.has(ch.chapter_no)) throw new ManuscriptError(`duplicate chapter number ${ch.chapter_no}`);
        seen.add(ch.chapter_no);
        if (ch.lines.length === 0) throw new ManuscriptError(`chapter ${ch.chapter_no} has no lines`);
    }
    return [...chapters].sort((a, b) => a.chapter_no - b.chapter_no);
}

/** A story markdown manuscript -> { story, authors, chapters } with speakers as names. */
export function parseManuscript(markdown: string): ManuscriptPayload {
    const [meta, body] = parseFrontmatter(splitlines(markdown));
    for (const key of ["slug", "title"]) {
        if (!meta[key]) throw new ManuscriptError(`frontmatter is missing '${key}'`);
    }
    if (!SLUG_RE.test(meta.slug)) {
        throw new ManuscriptError(`slug '${meta.slug}' must match ^[a-z0-9]+(_[a-z0-9]+)*$`);
    }
    const story: Record<string, string> = { slug: meta.slug, title: meta.title };
    if (meta.blurb) story.blurb = meta.blurb;
    if (meta.published) story.publishedDate = meta.published;
    for (const key of ["themeColor", "themeColor2", "season"]) {
        if (meta[key]) story[key] = meta[key];
    }
    const format = strip(meta.format || "script").toLowerCase();
    if (!VALID_FORMATS.has(format)) {
        throw new ManuscriptError(`format must be one of ['prose', 'script'], got '${meta.format}'`);
    }
    if (format === "prose") story.format = "PROSE";
    const authors = (meta.authors || meta.author || "").split(",").map(strip).filter(Boolean);
    return { story, authors, chapters: parseBody(body) };
}
