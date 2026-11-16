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
export const LANDMARK_CATEGORIES = ["landmark", "station", "black_hole", "cluster", "nebula"];

export const NAME_MAX = 100;
export const DESCRIPTION_MAX = 5000;
/** klyr from Sagittarius A. The disk ends at 43.7; halo objects sit a little outside it. */
export const MAP_RADIUS = 50;
export const BODIES_PER_PLACE = 200;
/** Per member, so the map cannot be filled by one account. */
export const PLACES_PER_USER = 500;

/** What each kind of body may orbit. null = nothing (the star). */
export const PARENT_KINDS: Record<MapBodyKind, (MapBodyKind | null)[]> = {
    STAR: [null],
    PLANET: ["STAR"],
    MOON: ["PLANET"],
    STATION: ["STAR", "PLANET", "MOON"],
};

export interface BodyInput {
    kind: MapBodyKind;
    name: string | null;
    slug: string | null;
    type: string;
    radiusKm: number | null;
    orbit: number | null;
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
export function parseBody(body: unknown, partial = false, kind?: MapBodyKind): Partial<BodyInput> {
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
    if (!partial || o.name !== undefined) {
        out.name = parseName(o.name);
        if (!out.name && !star) throw new GalaxyInputError(`A ${kind!.toLowerCase()} needs a name`);
    }
    if (o.slug !== undefined) out.slug = parseSlug(o.slug);
    if (!partial || o.type !== undefined) {
        if (kind === "STATION" && (o.type === undefined || o.type === null)) out.type = "artificial";
        else out.type = oneOf(o.type, star ? STAR_TYPES : COMPOSITIONS, "type");
    }
    if (!partial || o.radiusKm !== undefined) {
        // Stars and stations may leave their size out
        if (o.radiusKm === null || o.radiusKm === undefined) {
            if (kind === "PLANET" || kind === "MOON") throw new GalaxyInputError(`A ${kind.toLowerCase()} needs a radiusKm`);
            out.radiusKm = null;
        } else out.radiusKm = parsePositive(o.radiusKm, "radiusKm", 1e10);
    }
    if (!partial || o.orbit !== undefined) {
        if (star) {
            if (o.orbit !== null && o.orbit !== undefined) throw new GalaxyInputError("A star has no orbit");
            out.orbit = null;
        } else out.orbit = parsePositive(o.orbit, "orbit", kind === "PLANET" ? 1e5 : 1e9);
    }
    if (!partial || o.color !== undefined) out.color = o.color === undefined ? null : parseColor(o.color);
    if (!partial || o.description !== undefined) out.description = parseDescription(o.description);
    return out;
}

/**
 * The bodies sent with a new system: `[{...star, children: [{...planet, children}]}]`.
 * A system has exactly one star, at the root, and every body orbits a kind it may orbit.
 */
export function parseBodyTree(value: unknown): BodyTreeInput {
    if (!Array.isArray(value) || value.length !== 1) throw new GalaxyInputError("A system needs its star: send bodies as [star], with what orbits it under children");
    let count = 0;
    const walk = (raw: unknown, parentKind: MapBodyKind | null): BodyTreeInput => {
        if (++count > BODIES_PER_PLACE) throw new GalaxyInputError(`A system has at most ${BODIES_PER_PLACE} bodies`);
        const o = asObject(raw, "each body");
        const body = parseBody(o) as BodyInput;
        if (!PARENT_KINDS[body.kind].includes(parentKind)) throw new GalaxyInputError(orbitRule(body.kind));
        const children = o.children === undefined ? [] : o.children;
        if (!Array.isArray(children)) throw new GalaxyInputError("children must be a list of bodies");
        return { ...body, children: children.map((child) => walk(child, body.kind)) };
    };
    return walk(value[0], null);
}

export function orbitRule(kind: MapBodyKind): string {
    if (kind === "STAR") return "A system has one star, and it orbits nothing";
    const parents = PARENT_KINDS[kind].map((k) => `a ${k!.toLowerCase()}`);
    return `A ${kind.toLowerCase()} orbits ${parents.length > 1 ? `${parents.slice(0, -1).join(", ")} or ${parents.at(-1)}` : parents[0]}`;
}
