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
    /** Style layer id (the game's hair, facialHair, facialMask, or a species file's own ffLayers id) -> its one style ("" = none). */
    lock?: Record<string, string>;
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

/** A style layer id as ff-site's species files name them: letters, digits, _ and -. */
const LAYER_ID = /^[A-Za-z][\w-]{0,63}$/;
const MAX_LOCKS = 32;
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
        const keys = Object.keys(lock);
        if (keys.length > MAX_LOCKS) throw new SettingsError(`${where}.lock may fix at most ${MAX_LOCKS} layers`);
        out.lock = {};
        for (const key of keys) {
            if (!LAYER_ID.test(key)) throw new SettingsError(`${where}.lock has "${key}", which is not a style layer id`);
            out.lock[key] = text(lock[key], `${where}.lock.${key}`, true);
        }
    }
    return out;
}

function erase(v: unknown, what = "curation.erase"): Record<string, [number, number][]> {
    const out: Record<string, [number, number][]> = {};
    for (const [key, points] of Object.entries(object(v, what))) {
        text(key, `${what} key`);
        if (!Array.isArray(points) || points.length > 10_000) throw new SettingsError(`${what}["${key}"] must be an array of [x, y]`);
        out[key] = points.map((p, i) => {
            if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isInteger(n) && n >= 0 && n < 100_000)) throw new SettingsError(`${what}["${key}"][${i}] must be [x, y], two whole numbers`);
            return [p[0], p[1]];
        });
    }
    return out;
}

/** A race list: each entry valid, no id twice. */
export function parseRaces(v: unknown): RaceInput[] {
    if (!Array.isArray(v)) throw new SettingsError("races must be an array");
    const races = v.map(race);
    const ids = new Set<string>();
    for (const r of races) {
        if (ids.has(r.id)) throw new SettingsError(`races has "${r.id}" twice`);
        ids.add(r.id);
    }
    return races;
}

export interface ModPatch {
    name?: string;
    enabled?: boolean;
    itemsOnlyFor?: string[];
}

/** The body of PATCH /admin/portrait/mods/:id: any of name, enabled, itemsOnlyFor. */
export function parseModPatch(body: unknown): ModPatch {
    const o = object(body, "body");
    only(o, ["name", "enabled", "itemsOnlyFor"], "body");
    const out: ModPatch = {};
    if (o.name !== undefined) out.name = text(o.name, "name");
    if (o.enabled !== undefined) {
        if (typeof o.enabled !== "boolean") throw new SettingsError("enabled must be true or false");
        out.enabled = o.enabled;
    }
    if (o.itemsOnlyFor !== undefined) out.itemsOnlyFor = strings(o.itemsOnlyFor, "itemsOnlyFor").map((k) => k.toLowerCase());
    if (!Object.keys(out).length) throw new SettingsError("Nothing to change: send name, enabled or itemsOnlyFor");
    return out;
}

export interface CurationPatch {
    categories?: string[];
    hideItemPattern?: string;
    hideItems?: string[];
    erase?: Record<string, [number, number][]>;
}

function pattern(v: unknown, what: string): string {
    const source = text(v, what, true);
    try {
        new RegExp(source, "i");
    } catch {
        throw new SettingsError(`${what} is not a valid regular expression`);
    }
    return source;
}

/** The body of PATCH /admin/portrait/curation: any of categories, hideItemPattern, hideItems, erase. */
export function parseCurationPatch(body: unknown): CurationPatch {
    const o = object(body, "body");
    only(o, ["categories", "hideItemPattern", "hideItems", "erase"], "body");
    const out: CurationPatch = {};
    if (o.categories !== undefined) out.categories = strings(o.categories, "categories");
    if (o.hideItemPattern !== undefined) out.hideItemPattern = pattern(o.hideItemPattern, "hideItemPattern");
    if (o.hideItems !== undefined) out.hideItems = strings(o.hideItems, "hideItems");
    if (o.erase !== undefined) out.erase = erase(o.erase, "erase");
    if (!Object.keys(out).length) throw new SettingsError("Nothing to change");
    return out;
}

export function parseSettings(body: unknown): SettingsInput {
    const o = object(body, "body");
    only(o, ["categories", "races", "curation"], "body");
    const categories = strings(o.categories, "categories");
    const races = parseRaces(o.races);

    const c = object(o.curation, "curation");
    only(c, ["skipMods", "hideItemPattern", "hideItems", "itemsOnlyFor", "erase"], "curation");
    const hideItemPattern = pattern(c.hideItemPattern, "curation.hideItemPattern");
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
