// Google Docs .docx export -> story markdown manuscript. A port of
// ff-site/archive-to-markdown/story-docx-to-md.py (minus its interactive
// wizard), kept function-for-function so the two stay reviewable side by
// side; its docstring documents how a document is read. Golden-tested against
// that script's output for the 23 Drive stories (test/story-docx.test.ts).

import { unzipSync } from "fflate";
import { DOMParser } from "@xmldom/xmldom";
import { WS, collapse, hasAlnum, head, len, lstrip, repr, rstrip, split, strip } from "./py.js";

export class DocxError extends Error {}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const V_NS = "urn:schemas-microsoft-com:vml";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const O_NS = "urn:schemas-microsoft-com:office:office";

const PAGE_BREAK = "\x0c"; // stand-in for <w:br w:type="page"/> inside run text
const MONO_FONTS = new Set(["courier new", "courier", "consolas", "roboto mono", "source code pro", "jetbrains mono"]);
const S = `[${WS}]`;
const CHAPTER_HEADING = new RegExp(`^chapter${S}+(\\d+)${S}*[:.–—-]?${S}*([^\\n]*)$`, "i");
const BREAK_TEXT = new RegExp(`^(\\*${S}*){3,}$|^(-${S}*){3,}$|^(_${S}*){3,}$`);
const SPEAKER_PREFIX = new RegExp(`^([^:]{1,40}):${S}*([^\\n]+)$`, "u");

/** Uncompressed size we'll inflate for word/document.xml (a zip bomb guard). */
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

// ---------- docx reading ----------

type El = Element;
const isEl = (node: Node): node is El => node.nodeType === 1;
const is = (el: El, ns: string, name: string) => el.namespaceURI === ns && el.localName === name;
const children = (el: El): El[] => Array.from(el.childNodes as unknown as ArrayLike<Node>).filter(isEl);
const find = (el: El, ns: string, name: string): El | null => children(el).find((c) => is(c, ns, name)) ?? null;
const attr = (el: El, ns: string, name: string): string | null => (el.hasAttributeNS(ns, name) ? el.getAttributeNS(ns, name) : null);
/** ElementTree's iter(): the element itself, then every descendant, in document order. */
function* iter(el: El): Generator<El> {
    yield el;
    for (const child of children(el)) yield* iter(child);
}

/** The document <w:body> of a .docx, read without touching anything else in the archive. */
export function loadDocument(data: Uint8Array): El {
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(data, {
            filter: (file) => {
                if (file.name !== "word/document.xml") return false;
                if (file.originalSize > MAX_DOCUMENT_BYTES) throw new DocxError("the document is too large");
                return true;
            },
        });
    } catch (error) {
        if (error instanceof DocxError) throw error;
        throw new DocxError("not a .docx (export the Doc via File ▸ Download ▸ Microsoft Word)");
    }
    const bytes = files["word/document.xml"];
    if (!bytes) throw new DocxError("not a .docx (export the Doc via File ▸ Download ▸ Microsoft Word)");
    const xml = new TextDecoder("utf-8").decode(bytes);
    // A Word document never carries a DTD; refusing one rules out entity tricks
    if (/<!DOCTYPE/i.test(xml)) throw new DocxError("the document contains a DTD, which a .docx never does");
    let doc: Document;
    try {
        doc = new DOMParser({
            onError: (level: string, message: string) => {
                if (level !== "warning") throw new DocxError(`unreadable document.xml: ${message}`);
            },
        }).parseFromString(xml, "text/xml") as unknown as Document;
    } catch (error) {
        throw error instanceof DocxError ? error : new DocxError("unreadable document.xml");
    }
    const body = doc.documentElement ? find(doc.documentElement as unknown as El, W_NS, "body") : null;
    if (!body) throw new DocxError("document.xml has no body");
    return body;
}

/** Uncompressed bytes we'll inflate for one picture, and for all of them together. */
const MAX_PICTURE_BYTES = 15 * 1024 * 1024;
const MAX_PICTURES_BYTES = 40 * 1024 * 1024;
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Picture bytes by relationship id, for the given ids (word/media/* via word/_rels/document.xml.rels). */
export function loadPictures(data: Uint8Array, rids: Set<string>): Map<string, Uint8Array> {
    const rels = unzipSync(data, { filter: (file) => file.name === "word/_rels/document.xml.rels" && file.originalSize < 1024 * 1024 });
    const relsXml = rels["word/_rels/document.xml.rels"];
    if (!relsXml || rids.size === 0) return new Map();
    const text = new TextDecoder("utf-8").decode(relsXml);
    if (/<!DOCTYPE/i.test(text)) throw new DocxError("the document's relationships contain a DTD");
    const doc = new DOMParser().parseFromString(text, "text/xml") as unknown as Document;
    const targets = new Map<string, string>(); // rid -> zip path
    for (const rel of Array.from(doc.getElementsByTagNameNS(REL_NS, "Relationship") as unknown as ArrayLike<El>)) {
        const id = rel.getAttribute("Id");
        const target = rel.getAttribute("Target");
        if (!id || !target || !rids.has(id) || rel.getAttribute("TargetMode") === "External") continue;
        const path = target.startsWith("/") ? target.slice(1) : `word/${target}`;
        if (/^word\/media\/[^/]+$/.test(path)) targets.set(id, path);
    }
    const wanted = new Set(targets.values());
    let total = 0;
    const files = unzipSync(data, {
        filter: (file) => {
            if (!wanted.has(file.name)) return false;
            total += file.originalSize;
            if (file.originalSize > MAX_PICTURE_BYTES || total > MAX_PICTURES_BYTES) {
                throw new DocxError("the document's pictures are too large");
            }
            return true;
        },
    });
    const out = new Map<string, Uint8Array>();
    for (const [id, path] of targets) if (files[path]) out.set(id, files[path]);
    return out;
}

/** A picture's type from its leading bytes, or null for one a browser can't show (EMF, WMF...). */
export function pictureType(bytes: Uint8Array): string | null {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (ascii(0, 4) === "GIF8") return "image/gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    return null;
}

function normalizeColor(value: string | null): string | null {
    if (!value || value.toLowerCase() === "auto") return null;
    const hex = value.toLowerCase().replace(/^#+/, "");
    return hex.length === 6 ? `#${hex}` : null;
}

/** [text, color, italic, mono, bold] for one <w:r>. */
export type Run = [string, string | null, boolean, boolean, boolean];

function runProperties(run: El): Run {
    const parts: string[] = [];
    for (const node of iter(run)) {
        if (is(node, W_NS, "t")) parts.push(node.textContent ?? "");
        else if (is(node, W_NS, "tab")) parts.push("\t");
        else if (is(node, W_NS, "br")) {
            // Shift+Enter (textWrapping, or untyped) starts a new paragraph;
            // a page break is a section boundary (see readParagraphs)
            parts.push(attr(node, W_NS, "type") === "page" ? PAGE_BREAK : "\n");
        }
    }
    const text = parts.join("");
    const rpr = find(run, W_NS, "rPr");
    let color: string | null = null;
    let italic = false;
    let mono = false;
    let bold = false;
    if (rpr) {
        const colorEl = find(rpr, W_NS, "color");
        if (colorEl) color = normalizeColor(attr(colorEl, W_NS, "val"));
        const italicEl = find(rpr, W_NS, "i");
        italic = italicEl !== null && !["0", "false"].includes(attr(italicEl, W_NS, "val") ?? "");
        const boldEl = find(rpr, W_NS, "b");
        bold = boldEl !== null && !["0", "false"].includes(attr(boldEl, W_NS, "val") ?? "");
        const fonts = find(rpr, W_NS, "rFonts");
        if (fonts) {
            const face = (attr(fonts, W_NS, "ascii") || attr(fonts, W_NS, "hAnsi") || "").toLowerCase();
            mono = MONO_FONTS.has(face);
        }
    }
    return [text, color, italic, mono, bold];
}

// Inline containers that hold a paragraph's runs (link text, tracked
// insertions, smart tags, content controls, simple fields).
const INLINE_WRAPPERS = new Set(["hyperlink", "ins", "smartTag", "sdt", "sdtContent", "fldSimple", "customXml"]);

/** A paragraph's runs in order with whether each sits in a link (never runs of a nested paragraph). */
function paragraphRuns(p: El): [El, boolean][] {
    const runs: [El, boolean][] = [];
    const walk = (el: El, inLink: boolean) => {
        for (const child of children(el)) {
            if (is(child, W_NS, "r")) runs.push([child, inLink]);
            else if (child.namespaceURI === W_NS && INLINE_WRAPPERS.has(child.localName!)) {
                walk(child, inLink || child.localName === "hyperlink");
            }
        }
    };
    walk(p, false);
    return runs;
}

/** An embedded picture: its relationship id (-> word/media/...) and alt text. */
export type Picture = { rid: string; alt: string };
export type Paragraph = { style: string | null; hr: boolean; page_break: boolean; runs: Run[]; pictures: Picture[] };

/** The pictures a run draws (Insert ▸ Image), in order, with any alt text set in the Doc. */
function runPictures(run: El): Picture[] {
    const pictures: Picture[] = [];
    for (const frame of iter(run)) {
        if (!(is(frame, WP_NS, "inline") || is(frame, WP_NS, "anchor"))) continue;
        const docPr = find(frame, WP_NS, "docPr");
        const alt = docPr ? collapse(docPr.getAttribute("descr") || docPr.getAttribute("title") || "") : "";
        for (const blip of iter(frame)) {
            const rid = is(blip, A_NS, "blip") ? attr(blip, R_NS, "embed") : null;
            if (rid) pictures.push({ rid, alt: strip(alt) });
        }
    }
    return pictures;
}

/** Flatten the document into paragraphs; soft and page breaks split them. */
export function readParagraphs(body: El): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    for (const p of iter(body)) {
        if (!is(p, W_NS, "p")) continue;
        const ppr = find(p, W_NS, "pPr");
        let style: string | null = null;
        let hr = false;
        if (ppr) {
            const styleEl = find(ppr, W_NS, "pStyle");
            if (styleEl) style = attr(styleEl, W_NS, "val");
            // one form of horizontal rule: an empty paragraph with a border
            hr = find(ppr, W_NS, "pBdr") !== null;
        }
        // Google Docs' Insert ▸ Horizontal line exports as a VML rect flagged o:hr="t"
        hr = hr || [...iter(p)].some((el) => is(el, V_NS, "rect") && attr(el, O_NS, "hr") === "t");
        const pieces: Paragraph[] = [{ style, hr, page_break: false, runs: [], pictures: [] }];
        for (const [run, inLink] of paragraphRuns(p)) {
            const [text, ...props] = runProperties(run);
            if (inLink) props[0] = null; // link blue is link styling, not a speaker's ink
            for (const chunk of text.split(/(\n|\x0c)/)) {
                if (chunk === "\n" || chunk === PAGE_BREAK) {
                    pieces.push({ style, hr: false, page_break: chunk === PAGE_BREAK, runs: [], pictures: [] });
                } else if (chunk) {
                    pieces[pieces.length - 1].runs.push([chunk, ...(props as [string | null, boolean, boolean, boolean])]);
                }
            }
            pieces[pieces.length - 1].pictures.push(...runPictures(run));
        }
        if (pieces.length > 1) for (const piece of pieces) piece.hr = false;
        paragraphs.push(...pieces);
    }
    return paragraphs;
}

export function paragraphText(paragraph: Paragraph): string {
    return strip(paragraph.runs.map((run) => run[0]).join(""));
}

// ---------- meta ----------

// No slugify here: the CLI's slugify is the canonical rule (src/utils/slug.ts),
// which index.ts uses directly.

export type ColorInfo = { count: number; samples: string[] };

/** Every non-default ink, in first-seen order, with a few sample runs. */
export function collectColors(paragraphs: Paragraph[]): Map<string, ColorInfo> {
    const seen = new Map<string, ColorInfo>();
    for (const paragraph of paragraphs) {
        if (paragraph.style === "Title" || paragraph.style === "Subtitle") continue;
        for (const [text, color] of paragraph.runs) {
            if (color === null || !strip(text)) continue;
            if (!seen.has(color)) seen.set(color, { count: 0, samples: [] });
            const entry = seen.get(color)!;
            entry.count += 1;
            const sample = strip(text);
            if (entry.samples.length < 3 && !entry.samples.includes(sample)) entry.samples.push(head(sample, 70));
        }
    }
    return seen;
}

// ---------- conversion ----------

/** Color -> character name; null/"" (narration ink) or an unmapped color is narration. */
export type ColorMap = Record<string, string | null>;
export type StoryMeta = {
    slug: string;
    title?: string | null;
    blurb?: string | null;
    authors?: string | null;
    published?: string | null;
    season?: string | null;
    themeColor?: string | null;
    themeColor2?: string | null;
    format?: string | null;
    canon?: boolean | null; // false writes `canon: no`
    colors: ColorMap;
    /** Emit each picture as `![alt](docx:N)` (N counts from 1 in document order). Off for the CLI's output. */
    images?: boolean;
};

function speakerFor(color: string | null, colorMap: ColorMap): string | null {
    if (color === null) return null;
    return colorMap[color] || null;
}

function segmentParagraph(paragraph: Paragraph, colorMap: ColorMap): [string | null, string][] {
    const segments: [string | null, string][] = [];
    for (const [text, color] of paragraph.runs) {
        const speaker = speakerFor(color, colorMap);
        const last = segments[segments.length - 1];
        if (last && last[0] === speaker) last[1] += text;
        else segments.push([speaker, text]);
    }
    return segments.filter(([, text]) => strip(text)).map(([speaker, text]) => [speaker, collapse(text)]);
}

/** [speaker, italic, bold, core, hadLeadingWs, hadTrailingWs] */
export type Atom = [string | null, boolean, boolean, string, boolean, boolean];

function segmentParagraphProse(paragraph: Paragraph, colorMap: ColorMap): Atom[] {
    const merged: [string | null, boolean, boolean, string][] = [];
    for (const [text, color, italic, , bold] of paragraph.runs) {
        const last = merged[merged.length - 1];
        if (last && !strip(text)) {
            // whitespace carries no visible style or voice: fold it into the previous run
            last[3] += text;
            continue;
        }
        const speaker = speakerFor(color, colorMap);
        if (last && last[0] === speaker && last[1] === italic && last[2] === bold) last[3] += text;
        else merged.push([speaker, italic, bold, text]);
    }
    const atoms: Atom[] = [];
    for (const [speaker, italic, bold, raw] of merged) {
        const core = collapse(raw);
        if (!core) {
            if (atoms.length) atoms[atoms.length - 1][5] = true; // a seam on the previous atom
            continue;
        }
        atoms.push([speaker, italic, bold, core, raw !== lstrip(raw), raw !== rstrip(raw)]);
    }
    return atoms;
}

const OPEN_QUOTES = "“\"‘";
const CLOSE_QUOTES = "”\"’";

/** [opening quotes, inner, closing]; closing carries a comma right before the closing quote. */
function splitQuotes(core: string): [string, string, string] {
    let start = 0;
    let end = core.length;
    while (start < end && OPEN_QUOTES.includes(core[start])) start++;
    while (end > start && CLOSE_QUOTES.includes(core[end - 1])) end--;
    let opened = core.slice(0, start);
    let closed = core.slice(end);
    if (opened.includes("‘") !== closed.includes("’")) {
        // an unpaired single quote is an apostrophe
        if (opened.includes("‘")) start = 0;
        if (closed.includes("’")) end = core.length;
        opened = core.slice(0, start);
        closed = core.slice(end);
    }
    let inner = core.slice(start, end);
    if (closed && inner.endsWith(",")) {
        inner = inner.slice(0, -1);
        closed = "," + closed;
    }
    return [opened, inner, closed];
}

function emphasize(core: string, italic: boolean, bold: boolean): string {
    const marker = italic && bold ? "***" : bold ? "**" : italic ? "*" : "";
    if (!marker || !hasAlnum(core)) return core;
    const [opened, inner, closed] = splitQuotes(core);
    return `${opened}${marker}${inner}${marker}${closed}`;
}

/** House style: quote marks (and a closing comma) outside voiced spans; a voiced run with no letters is narration. */
export function normalizeAtoms(input: Atom[]): Atom[] {
    const atoms: Atom[] = input.map((a) => [hasAlnum(a[3]) ? a[0] : null, a[1], a[2], a[3], a[4], a[5]]);
    const out: Atom[] = [];
    let i = 0;
    while (i < atoms.length) {
        const speaker = atoms[i][0];
        let j = i;
        while (j < atoms.length && atoms[j][0] === speaker) j++;
        const group = atoms.slice(i, j).map((a) => [...a] as Atom);
        if (speaker !== null) {
            let first = group[0];
            let last = group[group.length - 1];
            const [opened] = splitQuotes(first[3]);
            if (opened) {
                out.push([null, false, false, opened, first[4], false]);
                group[0] = first = [first[0], first[1], first[2], first[3].slice(opened.length), false, first[5]];
                if (group.length === 1) last = first;
            }
            let [, , closed] = splitQuotes(last[3]);
            // a comma that ends the span right before a closing quote outside it
            const next = j < atoms.length ? atoms[j] : null;
            if (!closed && last[3].endsWith(",") && next && !last[5] && !next[4] && CLOSE_QUOTES.includes(next[3].slice(0, 1))) {
                closed = ",";
            }
            let tail: Atom | null = null;
            if (closed && closed.length < last[3].length) {
                group[group.length - 1] = [last[0], last[1], last[2], last[3].slice(0, last[3].length - closed.length), last[4], false];
                tail = [null, false, false, closed, false, last[5]];
            }
            out.push(...group);
            if (tail) out.push(tail);
        } else {
            out.push(...group);
        }
        i = j;
    }
    return out.filter((a) => a[3]);
}

/** One NARRATION paragraph: same-speaker atoms group into a [spoken]{Speaker} span. */
export function renderProseParagraph(atoms: Atom[]): string {
    const seam = (prev: Atom, next: Atom) => (prev[5] || next[4] ? " " : "");
    const parts: string[] = [];
    let i = 0;
    while (i < atoms.length) {
        const speaker = atoms[i][0];
        let j = i;
        while (j < atoms.length && atoms[j][0] === speaker) j++;
        const group = atoms.slice(i, j);
        if (i > 0) parts.push(seam(atoms[i - 1], atoms[i]));
        const inner = group.map((atom, k) => (k > 0 ? seam(group[k - 1], atom) : "") + emphasize(atom[3], atom[1], atom[2])).join("");
        parts.push(speaker !== null ? `[${inner}]{${speaker}}` : inner);
        i = j;
    }
    return parts.join("");
}

function stripSpeakerPrefix(text: string, speaker: string): string {
    const match = SPEAKER_PREFIX.exec(text);
    if (match && strip(match[1]).toLowerCase() === speaker.toLowerCase()) return match[2];
    return text;
}

/** Comparable form of a title line: case, emphasis and punctuation dropped. */
function titleKey(text: string): string {
    // NFKD + casefold; ß is the casefold case toLowerCase() misses
    return text.normalize("NFKD").toLowerCase().replace(/ß/g, "ss").replace(/[^0-9a-z]+/g, "");
}

/** Indices of paragraphs that open a new scene (see the Python docstring). */
function sceneGaps(paragraphs: Paragraph[]): Set<number> {
    const gaps: [number, number, boolean][] = [];
    let run = 0;
    let lastText: number | null = null;
    let page = false;
    paragraphs.forEach((paragraph, index) => {
        if (paragraph.page_break) page = true;
        if (paragraphText(paragraph) || (paragraph.hr && paragraph.runs.length === 0)) {
            if (lastText !== null) gaps.push([index, run, page]);
            lastText = index;
            run = 0;
            page = false;
        } else {
            run += 1;
        }
    });
    const mode = (runs: number[]) => {
        const counts = new Map<number, number>();
        for (const r of runs) counts.set(Math.min(r, 1), (counts.get(Math.min(r, 1)) ?? 0) + 1);
        let best: number | null = null;
        for (const [k, c] of counts) {
            if (best === null || c > counts.get(best)! || (c === counts.get(best)! && k < best)) best = k;
        }
        return best ?? 0;
    };
    const overall = mode(gaps.map((g) => g[1]));
    const breaks = new Set<number>();
    gaps.forEach(([index, r, pageBreak], k) => {
        const nearby = [...gaps.slice(Math.max(k - 3, 0), k), ...gaps.slice(k + 1, k + 4)].map((g) => g[1]);
        if (pageBreak || r > Math.max(overall, mode(nearby))) breaks.add(index);
    });
    return breaks;
}

/** Paragraphs -> markdown body lines (without frontmatter), plus warnings. */
export function convert(paragraphs: Paragraph[], meta: StoryMeta): { lines: string[]; warnings: string[] } {
    const colorMap = meta.colors;
    const isProse = strip(meta.format || "script").toLowerCase() === "prose";
    const out: string[] = [];

    const title = titleKey(meta.title || "");
    const firstIndex = paragraphs.findIndex((p) => paragraphText(p) && p.style !== "Title" && p.style !== "Subtitle");
    const skip = new Set<number>(
        firstIndex >= 0 && title && titleKey(paragraphText(paragraphs[firstIndex])) === title ? [firstIndex] : []
    );
    const level = (p: Paragraph) => ((p.style || "").startsWith("Heading") && paragraphText(p) ? (p.style || "").slice(7) : null);
    const kept = paragraphs.filter((_p, i) => !skip.has(i));
    const promoteH2 = !kept.some((p) => level(p) === "1") && kept.some((p) => level(p) === "2");

    const breaks = sceneGaps(paragraphs);

    let bodyChars = 0;
    let monoChars = 0;
    for (const p of paragraphs) {
        if (p.style === "Title" || p.style === "Subtitle") continue;
        for (const [text, , , mono] of p.runs) {
            bodyChars += len(strip(text));
            if (mono) monoChars += len(strip(text));
        }
    }
    const monoIsBody = bodyChars > 0 && monoChars * 2 > bodyChars;
    let chapterCount = 0;
    let lastNumber = 0;
    let transcript: string[] = [];
    const warnings: string[] = [];
    if (monoIsBody) warnings.push("most of the text is monospace — treated as the body font, not TRANSCRIPT blocks");

    const flushTranscript = () => {
        if (transcript.length) {
            out.push("```transcript", transcript.join("\n\n"), "```", "");
            transcript = [];
        }
    };
    const sceneBreak = () => {
        flushTranscript(); // a pending transcript block ends here, before the check
        const previous = [...out].reverse().find((line) => line) ?? null;
        if (previous === null || previous.startsWith("#") || previous === "***") return;
        out.push("***", "");
    };
    const allMono = (p: Paragraph) => p.runs.length > 0 && p.runs.every((r) => r[3]);

    let pictureNo = 0;
    const emitPictures = (paragraph: Paragraph) => {
        if (!meta.images || paragraph.pictures.length === 0) return;
        flushTranscript();
        for (const picture of paragraph.pictures) {
            pictureNo += 1;
            // alt text sits inside ![...]: keep it to one line without brackets
            out.push(`![${collapse(picture.alt.replace(/[[\]]/g, ""))}](docx:${pictureNo})`, "");
        }
    };

    paragraphs.forEach((paragraph, index) => {
        emitParagraph(paragraph, index);
        emitPictures(paragraph);
    });

    function emitParagraph(paragraph: Paragraph, index: number) {
        const style = paragraph.style || "";
        const text = paragraphText(paragraph);
        if (style === "Title" || style === "Subtitle" || skip.has(index)) return;

        const isHeading = style.startsWith("Heading") && /^\d+$/.test(style.slice(7)) && Boolean(text);
        const isMono = !monoIsBody && allMono(paragraph);
        // spacing inside a transcript block is its own layout, not a scene gap
        if (breaks.has(index) && !isHeading && !(transcript.length && isMono && !paragraph.page_break)) sceneBreak();

        if (isHeading) {
            const headingLevel = style.slice(7);
            if (isProse && headingLevel !== "1" && !(headingLevel === "2" && promoteH2)) {
                flushTranscript();
                out.push(`## ${text}`, "");
                return;
            }
            flushTranscript();
            chapterCount += 1;
            const match = CHAPTER_HEADING.exec(text);
            if (chapterCount === 1 && out.some((line) => line && !line.startsWith("#"))) {
                // text before the first chapter heading: number that preface 0
                // (or one below the first heading) instead of colliding with it
                const firstNo = match ? parseInt(match[1], 10) : 1;
                out.unshift(`# Chapter ${Math.max(firstNo - 1, 0)}`, "");
                lastNumber = Math.max(firstNo - 1, 0);
                warnings.push(`text before the first chapter heading became Chapter ${lastNumber} — give it a title`);
            }
            let number: number;
            let chapterTitle: string;
            if (match && parseInt(match[1], 10) > lastNumber) {
                number = parseInt(match[1], 10);
                chapterTitle = strip(match[2]);
            } else {
                number = lastNumber + 1;
                chapterTitle = text;
                if (match) warnings.push(`heading ${repr(text)} does not increase — renumbered to ${number}`);
            }
            lastNumber = number;
            out.push(`# Chapter ${number}${chapterTitle ? `: ${chapterTitle}` : ""}`, "");
            return;
        }

        if (paragraph.hr && !text) return sceneBreak();
        if (!text) return;
        if (BREAK_TEXT.test(text)) return sceneBreak();

        if (!monoIsBody && allMono(paragraph)) {
            transcript.push(text);
            return;
        }
        flushTranscript();

        const whollyItalic = paragraph.runs.every((r) => r[2]);

        if (isProse) {
            if ([..."[]{}*"].some((ch) => text.includes(ch))) {
                warnings.push(`prose paragraph contains literal []{}* that may collide with span/emphasis syntax: ${repr(head(text, 40))}`);
            }
            const markdown = renderProseParagraph(normalizeAtoms(segmentParagraphProse(paragraph, colorMap)));
            if ("#>`".includes(markdown.slice(0, 1))) {
                warnings.push(`paragraph starts with a markdown marker: ${repr(head(markdown, 40))}`);
            }
            out.push(markdown, "");
            return;
        }

        const segments = segmentParagraph(paragraph, colorMap);
        const narrationOnly = segments.every(([speaker]) => speaker === null);
        if (narrationOnly && whollyItalic) {
            out.push(`_${split(text).join(" ")}_`, "");
            return;
        }
        for (const [speaker, segmentText] of segments) {
            if (speaker === null) {
                if ("#>_`*".includes(segmentText[0])) {
                    warnings.push(`narration starts with a markdown marker: ${repr(head(segmentText, 40))}`);
                }
                out.push(segmentText);
            } else {
                out.push(`> ${speaker}: ${stripSpeakerPrefix(segmentText, speaker)}`);
            }
            out.push("");
        }
    }

    flushTranscript();
    // no BREAK at the end of the story or right before a heading
    const cleaned = out.filter((line, k) => {
        if (line !== "***") return true;
        const following = out.slice(k + 1).find((l) => l);
        return following !== undefined && !following.startsWith("#");
    });
    return { lines: cleaned, warnings };
}

export function frontmatter(meta: StoryMeta): string[] {
    const lines = ["---"];
    for (const key of ["slug", "title", "blurb", "authors", "published", "season", "themeColor", "themeColor2", "format"] as const) {
        const value = meta[key];
        if (value) lines.push(`${key}: ${value}`);
    }
    if (meta.canon === false) lines.push("canon: no");
    lines.push("---", "");
    return lines;
}

/** A whole .docx -> the markdown manuscript story-docx-to-md.py would write. */
export function docxToManuscript(data: Uint8Array, meta: StoryMeta): { markdown: string; warnings: string[] } {
    const { lines, warnings } = convert(readParagraphs(loadDocument(data)), meta);
    return { markdown: rstrip([...frontmatter(meta), ...lines].join("\n")) + "\n", warnings };
}
