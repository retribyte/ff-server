import { MapBodyKind, MapPlaceKind, MapRegion } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";
import { isValidSlug, slugify } from "../utils/slug.js";

// Request-body checks for the galaxy map (no database access, so they are unit-tested:
// test/galaxy.test.ts). The key lists mirror ff-site's map data (STAR_TYPES,
// COMPOSITIONS): the site owns their labels, colors and physics, the API only refuses
// keys it does not know.

/** The body breaks a rule; the message is shown to the member. */
export class GalaxyInputError extends Error {}

export const STAR_TYPES = ["red_dwarf", "orange", "sunlike", "white", "blue_giant", "red_giant", "neutron", "black_hole"];
export const COMPOSITIONS = ["rocky", "ocean", "desert", "ice", "gas", "artificial"];
// A black hole is not a landmark: it is a system whose star is of type black_hole
export const LANDMARK_CATEGORIES = ["landmark", "station", "cluster", "nebula"];

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 5000;
/** klyr from Sagittarius A. The disk ends at 43.7; halo objects sit a little outside it. */
export const MAP_RADIUS = 50;
/** Room for the 729 Core Worlds around Sagittarius A. */
export const BODIES_PER_PLACE = 1000;
/** Per member, so the map cannot be filled by one account. */
export const PLACES_PER_USER = 500;
/** The highest "this is planet N" a planet may claim. */
export const ORDINAL_MAX = 99;
/** The highest iteration a station may claim (its designation writes it with two digits: 3016-02). */
export const ITERATION_MAX = 99;
/** How far from the GUY epoch a station's build year may be, either way (some are millions of years old). */
export const BUILT_YEAR_MAX = 1_000_000_000;

/** A barycenter's type: the point two stars orbit, or two planets. */
export const BARYCENTER_TYPES = ["stars", "planets"];

/** A body as far as orbiting goes: its kind, and its type (which matters for a barycenter). */
export interface Orbiter {
    kind: MapBodyKind;
    type: string;
}

/** What each kind may orbit: "BARYCENTER:stars" is the point two stars orbit, null nothing (the system's primary). */
const PARENTS: Record<string, (string | null)[]> = {
    // The primary, a companion of a star, or one of a pair
    STAR: [null, "STAR", "BARYCENTER:stars"],
    "BARYCENTER:stars": [null, "STAR", "BARYCENTER:stars"],
    // A pair of planets takes a planet's slot
    "BARYCENTER:planets": ["STAR", "BARYCENTER:stars"],
    // Round a pair of stars it circles both; round a pair of planets it is one of them
    PLANET: ["STAR", "BARYCENTER:stars", "BARYCENTER:planets"],
    MOON: ["PLANET", "BARYCENTER:planets"],
    STATION: ["STAR", "PLANET", "MOON", "BARYCENTER:stars", "BARYCENTER:planets"],
    // Round a star it is an asteroid belt; round a planet or moon, a ring
    BELT: ["STAR", "PLANET", "MOON", "BARYCENTER:stars", "BARYCENTER:planets"],
};
const key = (b: Orbiter) => (b.kind === "BARYCENTER" ? `BARYCENTER:${b.type}` : b.kind);
const LABELS: Record<string, string> = { "BARYCENTER:stars": "a pair of stars", "BARYCENTER:planets": "a pair of planets" };
const label = (k: string) => LABELS[k] ?? `a ${k.toLowerCase()}`;

/** Whether `body` may orbit `parent` (null: be the system's primary). */
export function canOrbit(body: Orbiter, parent: Orbiter | null): boolean {
    return (PARENTS[key(body)] ?? []).includes(parent ? key(parent) : null);
}

/** Bodies that may be a system's primary, and so go without an orbit. */
export const mayBePrimary = (body: Orbiter) => canOrbit(body, null);

export interface BodyInput {
    kind: MapBodyKind;
    name: string | null;
    slug: string | null;
    type: string;
    radiusKm: number | null;
    orbit: number | null;
    /** Belts: how wide the band is, in the unit of its orbit. */
    width: number | null;
    ordinal: number | null;
    /** Stations: the GUY year it was built. */
    builtYear: number | null;
    /** Stations: which iteration of the station it is. */
    iteration: number | null;
    color: string | null;
    description: string | null;
}

export interface BodyTreeInput extends BodyInput {
    children: BodyTreeInput[];
}

export interface PlaceInput {
    kind: MapPlaceKind;
    name: string | null;
    slug: string | null;
    x: number;
    y: number;
    z: number;
    region: MapRegion | null;
    category: string | null;
    description: string | null;
}

type Fields = Record<string, unknown>;

function asObject(body: unknown, what: string): Fields {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw new GalaxyInputError(`Send ${what} as a JSON object`);
    return body as Fields;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
    if (typeof value !== "string" || !allowed.includes(value as T)) throw new GalaxyInputError(`${field} must be one of: ${allowed.join(", ")}`);
    return value as T;
}

/** A trimmed name; null and "" both mean "no name". */
function parseName(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new GalaxyInputError("name must be text");
    const name = value.trim();
    if (name.length > NAME_MAX) throw new GalaxyInputError(`A name has at most ${NAME_MAX} characters`);
    return name || null;
}

/**
 * A star's name (and so a system's, which its star shares) is never one character: it
 * would read as a designation's letter or numeral (Sol-V, Vortox-A).
 */
function checkPrimaryName(name: string | null) {
    if (name && [...name].length < 2) throw new GalaxyInputError("A star or system's name needs at least two characters");
}

/**
 * Whether `name` is written like a designation in the system whose primary is `stem`:
 * Sol-3, Sol-3a, Sol-V, Sol-IX.1, Sol-5.L4, Sol.3016-02, Vortox-B, Vortox-AB. "Sol-Runner" is not.
 */
export function designationLike(name: string, stem: string | null): boolean {
    if (!stem || name.length <= stem.length || name.slice(0, stem.length).toLowerCase() !== stem.toLowerCase()) return false;
    return /^(-(\d|[IVXLCDM]+(?![A-Za-z])|[A-Z]{1,3}(?![A-Za-z]))|\.-?\d)/.test(name.slice(stem.length));
}

/** Refuses a body (other than the system's primary, whose name is the stem) named like a designation: it goes by its designation, unnamed. */
export function checkNotDesignation(name: string | null | undefined, stem: string | null, kind: MapBodyKind) {
    if (!name || !designationLike(name, stem)) return;
    if (kind === "STATION") throw new GalaxyInputError(`'${name}' is written like a designation. A station's designation comes from its builtYear and iteration: give it a name of its own`);
    throw new GalaxyInputError(`'${name}' is written like a designation. Leave the name empty and the ${kind.toLowerCase()} goes by its designation${kind === "PLANET" ? " (set its ordinal for the planet number)" : ""}`);
}

function parseSlug(value: unknown): string | null {
    if (value === null || value === "") return null;
    if (typeof value !== "string" || !isValidSlug(value) || value.length > NAME_MAX) throw new GalaxyInputError("slug must be lowercase letters and digits joined by underscores");
    return value;
}

function parseDescription(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new GalaxyInputError("description must be text");
    if (value.length > DESCRIPTION_MAX) throw new GalaxyInputError(`A description has at most ${DESCRIPTION_MAX} characters`);
    return sanitizeText(value).trim() || null;
}

function parseNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new GalaxyInputError(`${field} must be a number`);
    return value;
}

function parsePositive(value: unknown, field: string, max: number): number {
    const n = parseNumber(value, field);
    if (n <= 0 || n > max) throw new GalaxyInputError(`${field} must be above 0 and at most ${max}`);
    return n;
}

function parseColor(value: unknown): string | null {
    if (value === null || value === "") return null;
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new GalaxyInputError("color must look like #rrggbb");
    return value.toLowerCase();
}

/** The slug a new name gets when none is sent. A name with no letters or digits has none. */
export function slugFor(name: string | null, slug: string | null | undefined): string | null {
    if (slug) return slug;
    return name ? slugify(name) || null : null;
}

/** x, y and z together (z may be left out: the disk's plane). */
function parsePosition(o: Fields): { x: number; y: number; z: number } {
    const x = parseNumber(o.x, "x");
    const y = parseNumber(o.y, "y");
    const z = o.z === undefined ? 0 : parseNumber(o.z, "z");
    if (Math.hypot(x, y, z) > MAP_RADIUS) throw new GalaxyInputError("That position is outside the galaxy");
    return { x, y, z };
}

/**
 * A place's fields, checked. With `partial` (an edit), only the fields sent are
 * checked and returned, `kind` cannot change, and a position needs both x and y.
 */
export function parsePlace(body: unknown, partial = false, kind?: MapPlaceKind): Partial<PlaceInput> {
    const o = asObject(body, "the place");
    const out: Partial<PlaceInput> = {};
    if (partial) {
        if (o.kind !== undefined && o.kind !== kind) throw new GalaxyInputError("A place cannot change its kind");
    } else {
        kind = oneOf(o.kind, Object.values(MapPlaceKind), "kind");
        out.kind = kind;
    }
    if (!partial || o.name !== undefined) {
        out.name = parseName(o.name);
        if (!out.name && kind === "LANDMARK") throw new GalaxyInputError("A landmark needs a name");
        if (kind === "SYSTEM") checkPrimaryName(out.name);
    }
    if (o.slug !== undefined) out.slug = parseSlug(o.slug);
    if (!partial || o.x !== undefined || o.y !== undefined || o.z !== undefined) Object.assign(out, parsePosition(o));
    if (!partial || o.region !== undefined) out.region = o.region === null || o.region === undefined ? null : oneOf(o.region, Object.values(MapRegion), "region");
    if (!partial || o.category !== undefined) {
        if (kind === "LANDMARK") out.category = o.category === null || o.category === undefined ? "landmark" : oneOf(o.category, LANDMARK_CATEGORIES, "category");
        else if (o.category !== null && o.category !== undefined) throw new GalaxyInputError("Only a landmark has a category");
        else out.category = null;
    }
    if (!partial || o.description !== undefined) out.description = parseDescription(o.description);
    return out;
}

/**
 * A body's fields, checked against its kind. With `partial` (an edit) only the fields
 * sent are checked and returned; `kind` and the parent cannot change.
 */
export function parseBody(body: unknown, partial = false, kind?: MapBodyKind, currentType?: string): Partial<BodyInput> {
    const o = asObject(body, "the body");
    const out: Partial<BodyInput> = {};
    if (partial) {
        if (o.kind !== undefined && o.kind !== kind) throw new GalaxyInputError("A body cannot change its kind");
        if (o.parentId !== undefined) throw new GalaxyInputError("A body cannot move to another parent");
    } else {
        kind = oneOf(o.kind, Object.values(MapBodyKind), "kind");
        out.kind = kind;
    }
    const star = kind === "STAR";
    const barycenter = kind === "BARYCENTER";
    if (!partial || o.name !== undefined) {
        out.name = parseName(o.name);
        // A planet or moon without a name goes by its designation (Sol-3, Sol-3a)
        if (!out.name && kind === "STATION") throw new GalaxyInputError("A station needs a name");
        if (star || barycenter) checkPrimaryName(out.name);
    }
    if (o.slug !== undefined) out.slug = parseSlug(o.slug);
    if (!partial || o.type !== undefined) {
        if (barycenter && partial && o.type !== currentType) throw new GalaxyInputError("A barycenter cannot change between stars and planets");
        if (kind === "STATION" && (o.type === undefined || o.type === null)) out.type = "artificial";
        else if (kind === "BELT" && (o.type === undefined || o.type === null)) out.type = "rocky";
        else out.type = oneOf(o.type, star ? STAR_TYPES : barycenter ? BARYCENTER_TYPES : COMPOSITIONS, "type");
    }
    const type = out.type ?? currentType;
    if (!partial || o.radiusKm !== undefined) {
        // Stars and stations may leave their size out; a belt has a width instead, and a barycenter is a point
        if (kind === "BELT" || barycenter) {
            if (o.radiusKm !== null && o.radiusKm !== undefined) throw new GalaxyInputError(barycenter ? "A barycenter has no radiusKm" : "A belt has a width, not a radiusKm");
            out.radiusKm = null;
        } else if (o.radiusKm === null || o.radiusKm === undefined) {
            if (kind === "PLANET" || kind === "MOON") throw new GalaxyInputError(`A ${kind.toLowerCase()} needs a radiusKm`);
            out.radiusKm = null;
        } else out.radiusKm = parsePositive(o.radiusKm, "radiusKm", 1e10);
    }
    if (!partial || o.orbit !== undefined) {
        // A star or a pair of stars has no orbit when it is the system's primary, which only its place in the tree says (checked there)
        if ((star || (barycenter && type === "stars")) && (o.orbit === null || o.orbit === undefined)) out.orbit = null;
        else out.orbit = parsePositive(o.orbit, "orbit", 1e9);
    }
    if (!partial || o.width !== undefined) {
        if (kind !== "BELT") {
            if (o.width !== null && o.width !== undefined) throw new GalaxyInputError("Only a belt has a width");
            out.width = null;
        } else out.width = parsePositive(o.width, "width", 1e9);
    }
    // The band's inner edge stays outside what it circles (checked when both are sent; the site keeps to it on edits)
    if (out.width && out.orbit && out.width >= out.orbit * 2) throw new GalaxyInputError("A belt's width must be less than twice its orbit");
    if (!partial || o.ordinal !== undefined) {
        if (o.ordinal === null || o.ordinal === undefined) out.ordinal = null;
        else if (kind !== "PLANET" && !(barycenter && type === "planets")) throw new GalaxyInputError("Only a planet (or a pair of planets) has an ordinal");
        else if (!Number.isInteger(o.ordinal) || (o.ordinal as number) < 1 || (o.ordinal as number) > ORDINAL_MAX) throw new GalaxyInputError(`ordinal must be a whole number from 1 to ${ORDINAL_MAX}`);
        else out.ordinal = o.ordinal as number;
    }
    if (!partial || o.builtYear !== undefined) {
        if (o.builtYear === null || o.builtYear === undefined) out.builtYear = null;
        else if (kind !== "STATION") throw new GalaxyInputError("Only a station has a builtYear");
        else if (!Number.isInteger(o.builtYear) || Math.abs(o.builtYear as number) > BUILT_YEAR_MAX) throw new GalaxyInputError("builtYear must be a whole GUY year");
        else out.builtYear = o.builtYear as number;
    }
    if (!partial || o.iteration !== undefined) {
        if (o.iteration === null || o.iteration === undefined) out.iteration = null;
        else if (kind !== "STATION") throw new GalaxyInputError("Only a station has an iteration");
        else if (!Number.isInteger(o.iteration) || (o.iteration as number) < 1 || (o.iteration as number) > ITERATION_MAX) throw new GalaxyInputError(`iteration must be a whole number from 1 to ${ITERATION_MAX}`);
        else out.iteration = o.iteration as number;
    }
    if (!partial || o.color !== undefined) out.color = o.color === undefined ? null : parseColor(o.color);
    if (!partial || o.description !== undefined) out.description = parseDescription(o.description);
    return out;
}

/**
 * Checks a body against what it orbits (null: it is the system's primary): the kinds
 * (`canOrbit`), that the primary alone has no orbit, and that one of a pair of planets
 * leaves the planet number to the pair.
 */
export function checkPlacement(body: Orbiter & { orbit: number | null; ordinal?: number | null }, parent: Orbiter | null) {
    if (!canOrbit(body, parent)) throw new GalaxyInputError(orbitRule(body, parent));
    if (!parent && body.orbit !== null) throw new GalaxyInputError("The system's primary has no orbit");
    if (parent && body.orbit === null) throw new GalaxyInputError(`A ${body.kind === "STAR" ? "star" : "pair"} that orbits something needs an orbit`);
    if (body.ordinal && parent && key(parent) === "BARYCENTER:planets") throw new GalaxyInputError("One of a pair of planets has no ordinal: the pair takes the planet number");
}

/**
 * The bodies sent with a new system: `[{...primary, children: [{...planet, children}]}]`.
 * The primary (a star, or the barycenter of a pair of stars) is the root, and every body
 * orbits a kind it may orbit (`canOrbit`).
 */
export function parseBodyTree(value: unknown): BodyTreeInput {
    if (!Array.isArray(value) || value.length !== 1) throw new GalaxyInputError("A system needs its star: send bodies as [star], with what orbits it under children");
    let count = 0;
    let stem: string | null = null;
    const walk = (raw: unknown, parent: Orbiter | null): BodyTreeInput => {
        if (++count > BODIES_PER_PLACE) throw new GalaxyInputError(`A system has at most ${BODIES_PER_PLACE} bodies`);
        const o = asObject(raw, "each body");
        const body = parseBody(o) as BodyInput;
        checkPlacement(body, parent);
        if (!parent) stem = body.name;
        else checkNotDesignation(body.name, stem, body.kind);
        const children = o.children === undefined ? [] : o.children;
        if (!Array.isArray(children)) throw new GalaxyInputError("children must be a list of bodies");
        return { ...body, children: children.map((child) => walk(child, body)) };
    };
    return walk(value[0], null);
}

/** Why `body` may not orbit `parent`. */
export function orbitRule(body: Orbiter, parent: Orbiter | null = null): string {
    if (!parent && !mayBePrimary(body)) return `A system's primary is a star or a pair of stars, not ${label(key(body))}`;
    const parents = (PARENTS[key(body)] ?? []).filter((k): k is string => k !== null).map(label);
    const what = label(key(body));
    return `${what[0].toUpperCase()}${what.slice(1)} orbits ${parents.length > 1 ? `${parents.slice(0, -1).join(", ")} or ${parents.at(-1)}` : parents[0]}`;
}
