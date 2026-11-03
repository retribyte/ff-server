// Story conversion for the web importer: a Google Docs .docx in, either an
// analysis (for the color → speaker form) or an import payload out. The
// payload has the shape story-md-to-api.py writes ({story, authors,
// chapters} with speakers as names), so the site's existing story importer
// takes it from there: speaker → character matching, preview, then
// POST /stories/import (or PUT /stories/:slug/import for a revision).

import { collectColors, convert, frontmatter, loadDocument, paragraphText, readParagraphs, DocxError, type ColorMap, type StoryMeta } from "./docx.js";
import { slugify as canonicalSlugify } from "../../utils/slug.js";
import { parseManuscript, ManuscriptError, type ManuscriptPayload } from "./manuscript.js";
import { rstrip } from "./py.js";

export { DocxError, ManuscriptError };

const DRAWINGML = "http://schemas.openxmlformats.org/drawingml/2006/main";

export type DocxAnalysis = {
    /** Every ink color but the default, most-used first, with up to 3 sample runs. */
    colors: { color: string; count: number; samples: string[] }[];
    /** Defaults for the form, from the doc's Title / Subtitle styles (or the file name). */
    defaults: { title: string | null; blurb: string | null; slug: string };
    /** Embedded pictures — stories can't hold images yet, so these won't come across. */
    pictures: number;
};

export type DocxConversion = {
    payload: ManuscriptPayload;
    /** The manuscript the payload was parsed from (what the CLI pipeline would have saved). */
    markdown: string;
    warnings: string[];
};

// Slugs are a cross-site identity (the wiki's rules, src/utils/slug.ts), so
// the web path derives them canonically, not with the CLI port's slugify.
const slugFor = (text: string) => canonicalSlugify(text) || "untitled";

export function analyzeDocx(data: Uint8Array, fileName?: string): DocxAnalysis {
    const body = loadDocument(data);
    const paragraphs = readParagraphs(body);
    const title = paragraphs.find((p) => p.style === "Title");
    const subtitle = paragraphs.find((p) => p.style === "Subtitle");
    const titleText = title ? paragraphText(title) || null : null;
    const stem = fileName ? fileName.replace(/\.docx$/i, "") : null;
    const colors = [...collectColors(paragraphs)].map(([color, info]) => ({ color, ...info }));
    colors.sort((a, b) => b.count - a.count);
    const pictures = body.getElementsByTagNameNS(DRAWINGML, "blip").length;
    return {
        colors,
        defaults: {
            title: titleText,
            blurb: subtitle ? paragraphText(subtitle) || null : null,
            slug: slugFor(titleText ?? stem ?? "untitled"),
        },
        pictures,
    };
}

export type ConvertOptions = Omit<StoryMeta, "colors"> & { colors?: ColorMap };

/** Converts with the given metadata and color map; every color in the doc must be mapped (null = narration). */
export function convertDocx(data: Uint8Array, options: ConvertOptions): DocxConversion {
    if (!options || typeof options !== "object") throw new ManuscriptError("meta is required");
    if (!options.title || typeof options.title !== "string") throw new ManuscriptError("title is required");
    const format = (options.format || "prose").toLowerCase();
    if (format !== "prose" && format !== "script") throw new ManuscriptError("format must be 'prose' or 'script'");
    const paragraphs = readParagraphs(loadDocument(data));
    const colors: ColorMap = {};
    const given = options.colors ?? {};
    const missing: string[] = [];
    for (const color of collectColors(paragraphs).keys()) {
        if (!(color in given)) missing.push(color);
        else {
            const name = given[color];
            if (name !== null && typeof name !== "string") throw new ManuscriptError(`colors["${color}"] must be a name or null`);
            // names become `{Speaker}` / `> Speaker:` markup: keep them to one plain line
            if (name && /[[\]{}\n]/.test(name)) throw new ManuscriptError(`speaker name for ${color} can't contain [ ] { } or a line break`);
            colors[color] = name ? name.trim() : null;
        }
    }
    if (missing.length) throw new ManuscriptError(`every color needs a speaker or narration; unmapped: ${missing.join(", ")}`);
    const meta: StoryMeta = { ...options, slug: options.slug || slugFor(options.title), format, colors };
    for (const key of ["title", "blurb", "authors", "published", "season", "themeColor", "themeColor2"] as const) {
        const value = meta[key];
        // frontmatter is line-based: a value can't span lines or start a comment
        if (value && /[\n\r]|\s#/.test(value)) throw new ManuscriptError(`${key} must be one line without " #"`);
    }
    const { lines, warnings } = convert(paragraphs, meta);
    const markdown = rstrip([...frontmatter(meta), ...lines].join("\n")) + "\n";
    return { payload: parseManuscript(markdown), markdown, warnings };
}
