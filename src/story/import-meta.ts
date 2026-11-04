// Story.importMeta: how a story's last Google Doc import read the doc (its
// dialogue style and text color -> speaker map), so a revision only asks about
// colors it hasn't seen.

export type ImportMeta = { format?: "prose" | "script"; colors: Record<string, string | null> };

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const MAX_IMPORT_COLORS = 200;

/**
 * The Google Doc color map an import was converted with (see Story.importMeta).
 * undefined = none sent; throws on anything malformed.
 */
export function parseImportMeta(raw: unknown): ImportMeta | undefined {
    if (raw === undefined || raw === null) return undefined;
    const fail = (why: string): never => {
        throw new Error(`importMeta: ${why}`);
    };
    if (typeof raw !== "object" || Array.isArray(raw)) fail("must be an object");
    const { format, colors } = raw as { format?: unknown; colors?: unknown };
    if (format !== undefined && format !== "prose" && format !== "script") fail("format must be prose or script");
    if (!colors || typeof colors !== "object" || Array.isArray(colors)) fail("colors must be an object");
    const entries = Object.entries(colors as Record<string, unknown>);
    if (entries.length > MAX_IMPORT_COLORS) fail(`at most ${MAX_IMPORT_COLORS} colors`);
    const out: Record<string, string | null> = {};
    for (const [hex, speaker] of entries) {
        const key = hex.toLowerCase();
        if (!HEX_COLOR.test(key)) fail(`'${hex}' is not a #rrggbb color`);
        if (speaker !== null && (typeof speaker !== "string" || !speaker.trim() || speaker.length > 100)) {
            fail(`${hex} must map to a speaker name (1-100 characters) or null`);
        }
        out[key] = speaker === null ? null : (speaker as string).trim();
    }
    return format ? { format: format as ImportMeta["format"], colors: out } : { colors: out };
}
