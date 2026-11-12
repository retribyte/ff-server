// Story.importMeta: how a story's last import read its source, so a revision
// only asks about what it hasn't seen: a Google Doc's dialogue style and text
// color -> speaker map, or a Discord export's speaker code -> speaker map
// (Vortox Machina; "?" = an unnamed NPC, named in the importer).

export type ImportMeta = {
    format?: "prose" | "script";
    colors: Record<string, string | null>;
    codes?: Record<string, string>;
};

const SPEAKER_CODE = /^([A-Z][A-Z0-9]{0,2}|\?{1,3}\d?)$/;
const MAX_IMPORT_CODES = 100;

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const MAX_IMPORT_COLORS = 200;

/**
 * The color map (or speaker codes) an import was converted with (see Story.importMeta).
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
    const meta: ImportMeta = format ? { format: format as ImportMeta["format"], colors: out } : { colors: out };
    const { codes } = raw as { codes?: unknown };
    if (codes !== undefined) {
        if (!codes || typeof codes !== "object" || Array.isArray(codes)) fail("codes must be an object");
        const list = Object.entries(codes as Record<string, unknown>);
        if (list.length > MAX_IMPORT_CODES) fail(`at most ${MAX_IMPORT_CODES} speaker codes`);
        meta.codes = {};
        for (const [code, speaker] of list) {
            if (!SPEAKER_CODE.test(code)) fail(`'${code}' is not a speaker code`);
            if (typeof speaker !== "string" || !speaker.trim() || speaker.length > 100) fail(`${code} must map to a speaker name (1-100 characters)`);
            meta.codes[code] = (speaker as string).trim();
        }
    }
    return meta;
}
