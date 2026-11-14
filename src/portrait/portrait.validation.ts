// Strict validation of the portrait settings body (the contents of ff-site's races.json and
// curation.json). Throws SettingsError with a message fit to send back as a 400.

export class SettingsError extends Error {}

export interface RaceInput {
    id: string;
    species?: string;
    name?: string;
    descriptor?: string;
    category?: string;
    exclude?: string[];
    prefer?: string[];
    hidden?: boolean;
    lock?: Partial<Record<"hair" | "facialHair" | "facialMask", string>>;
}

export interface SettingsInput {
    categories: string[];
    races: RaceInput[];
    curation: {
        /** workshop id -> name; absent leaves every mod's on/off switch as it is */
        skipMods?: Record<string, string>;
        hideItemPattern: string;
        hideItems: string[];
        itemsOnlyFor: Record<string, string[]>;
        erase: Record<string, [number, number][]>;
    };
}

const LOCKS = ["hair", "facialHair", "facialMask"];
const MAX_TEXT = 500;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, what: string, allowEmpty = false): string {
    if (typeof v !== "string" || (!allowEmpty && !v.trim()) || v.length > MAX_TEXT) throw new SettingsError(`${what} must be a${allowEmpty ? "" : " non-empty"} string of at most ${MAX_TEXT} characters`);
    return v;
}

function strings(v: unknown, what: string): string[] {
    if (!Array.isArray(v)) throw new SettingsError(`${what} must be an array of strings`);
    return v.map((entry, i) => text(entry, `${what}[${i}]`));
}

function object(v: unknown, what: string): Record<string, unknown> {
    if (!isObject(v)) throw new SettingsError(`${what} must be an object`);
    return v;
}

/** Keys beginning with an underscore (`_about` in the JSON files) are comments and are ignored. */
function only(o: Record<string, unknown>, allowed: string[], what: string): void {
    for (const key of Object.keys(o)) if (!key.startsWith("_") && !allowed.includes(key)) throw new SettingsError(`${what} has an unknown field "${key}"`);
}

function race(v: unknown, i: number): RaceInput {
    const where = `races[${i}]`;
    const o = object(v, where);
    only(o, ["id", "species", "name", "descriptor", "category", "exclude", "prefer", "hidden", "lock"], where);
    const out: RaceInput = { id: text(o.id, `${where}.id`) };
    for (const key of ["species", "name", "descriptor", "category"] as const) if (o[key] !== undefined) out[key] = text(o[key], `${where}.${key}`);
    for (const key of ["exclude", "prefer"] as const) if (o[key] !== undefined) out[key] = strings(o[key], `${where}.${key}`);
    if (o.hidden !== undefined) {
        if (typeof o.hidden !== "boolean") throw new SettingsError(`${where}.hidden must be true or false`);
        out.hidden = o.hidden;
    }
    if (o.lock !== undefined) {
        const lock = object(o.lock, `${where}.lock`);
        only(lock, LOCKS, `${where}.lock`);
        out.lock = {};
        for (const key of LOCKS) if (lock[key] !== undefined) out.lock[key as "hair"] = text(lock[key], `${where}.lock.${key}`, true);
    }
    return out;
}

function erase(v: unknown): Record<string, [number, number][]> {
    const out: Record<string, [number, number][]> = {};
    for (const [key, points] of Object.entries(object(v, "curation.erase"))) {
        text(key, "curation.erase key");
        if (!Array.isArray(points) || points.length > 10_000) throw new SettingsError(`curation.erase["${key}"] must be an array of [x, y]`);
        out[key] = points.map((p, i) => {
            if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isInteger(n) && n >= 0 && n < 100_000)) throw new SettingsError(`curation.erase["${key}"][${i}] must be [x, y], two whole numbers`);
            return [p[0], p[1]];
        });
    }
    return out;
}

export function parseSettings(body: unknown): SettingsInput {
    const o = object(body, "body");
    only(o, ["categories", "races", "curation"], "body");
    const categories = strings(o.categories, "categories");
    if (!Array.isArray(o.races)) throw new SettingsError("races must be an array");
    const races = o.races.map(race);
    const ids = new Set<string>();
    for (const r of races) {
        if (ids.has(r.id)) throw new SettingsError(`races has "${r.id}" twice`);
        ids.add(r.id);
    }

    const c = object(o.curation, "curation");
    only(c, ["skipMods", "hideItemPattern", "hideItems", "itemsOnlyFor", "erase"], "curation");
    const hideItemPattern = text(c.hideItemPattern, "curation.hideItemPattern", true);
    try {
        new RegExp(hideItemPattern, "i");
    } catch {
        throw new SettingsError("curation.hideItemPattern is not a valid regular expression");
    }
    const itemsOnlyFor: Record<string, string[]> = {};
    for (const [mod, kinds] of Object.entries(object(c.itemsOnlyFor, "curation.itemsOnlyFor"))) {
        text(mod, "curation.itemsOnlyFor key");
        itemsOnlyFor[mod] = strings(kinds, `curation.itemsOnlyFor["${mod}"]`).map((k) => k.toLowerCase());
    }
    let skipMods: Record<string, string> | undefined;
    if (c.skipMods !== undefined) {
        skipMods = {};
        for (const [mod, name] of Object.entries(object(c.skipMods, "curation.skipMods"))) {
            text(mod, "curation.skipMods key");
            skipMods[mod] = text(name, `curation.skipMods["${mod}"]`);
        }
    }
    return {
        categories,
        races,
        curation: { ...(skipMods ? { skipMods } : {}), hideItemPattern, hideItems: strings(c.hideItems, "curation.hideItems"), itemsOnlyFor, erase: erase(c.erase) },
    };
}
