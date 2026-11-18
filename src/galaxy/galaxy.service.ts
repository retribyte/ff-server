import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { normalizeSlug } from "../utils/slug.js";
import { MAP_BUCKETS } from "../wiki/wiki.client.js";
import {
    BODIES_PER_PLACE,
    GalaxyInputError,
    PARENT_KINDS,
    PLACES_PER_USER,
    checkNotDesignation,
    orbitRule,
    parseBody,
    parseBodyTree,
    parsePlace,
    slugFor,
    type BodyInput,
    type BodyTreeInput,
    type PlaceInput,
} from "./galaxy.validation.js";

// The galaxy map (tables map_places, map_bodies, map_travelogue). A place is a system
// or a landmark; a system holds its star and what orbits it. Ownership is the place's:
// the controller checks creator-or-admin against `creatorId` before calling a write.

/** The name or slug is taken (409). */
export class GalaxyConflictError extends Error {}

type Tx = Prisma.TransactionClient;

const CREATOR_SELECT = { select: { id: true, username: true, icon: true } };
const BODY_ORDER = [{ parentId: { sort: "asc" as const, nulls: "first" as const } }, { orbit: "asc" as const }, { id: "asc" as const }];
const PLACE_INCLUDE = { creator: CREATOR_SELECT, bodies: { orderBy: BODY_ORDER } };

async function assertPlaceSlugFree(tx: Tx, slug: string | null | undefined, exceptId?: number) {
    if (!slug) return;
    const taken = await tx.mapPlace.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (taken && taken.id !== exceptId) throw new GalaxyConflictError(`'${taken.name}' is already on the map as '${slug}'`);
}

async function assertBodySlugFree(tx: Tx, slug: string | null | undefined, exceptId?: number) {
    if (!slug) return;
    const taken = await tx.mapBody.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (taken && taken.id !== exceptId) throw new GalaxyConflictError(`'${taken.name}' is already on the map as '${slug}'`);
}

type PlaceRow = Prisma.MapPlaceGetPayload<{ include: typeof PLACE_INCLUDE }>;

/**
 * Gives each place and body its `wiki`: the wiki's row for the same slug (page_name,
 * image, intro, faction and the rest of its infobox), or null. Read from the wiki cache
 * only, which `npm run refresh:wiki-cache` fills: the map never waits on the wiki.
 */
async function withWiki(places: PlaceRow[]) {
    const slugs = places.flatMap((place) => [place.slug, ...place.bodies.map((body) => body.slug)]).filter((slug): slug is string => !!slug);
    const rows = slugs.length ? await prisma.wikiCache.findMany({ where: { bucket: { in: [...MAP_BUCKETS] }, slug: { in: slugs }, data: { not: Prisma.DbNull } } }) : [];
    const bySlug = new Map(rows.map((row) => [row.slug, row.data as Record<string, unknown>]));
    const wikiOf = (slug: string | null) => (slug ? (bySlug.get(slug) ?? null) : null);
    return places.map((place) => ({ ...place, wiki: wikiOf(place.slug), bodies: place.bodies.map((body) => ({ ...body, wiki: wikiOf(body.slug) })) }));
}

/** Every place with its bodies (flat, each with its parentId), travelogue and wiki rows: what the map draws and searches. */
async function getAllPlaces() {
    const places = await withWiki(await prisma.mapPlace.findMany({ include: PLACE_INCLUDE, orderBy: { id: "asc" } }));
    const tags = await traveloguesOf(places.map((place) => place.id));
    return places.map((place) => ({ ...place, travelogue: tags.get(place.id) ?? [] }));
}

/** The tags of these places by place id, each with the episode it names (null if that episode is gone), in episode order. */
async function traveloguesOf(placeIds: number[]) {
    const tags = await prisma.travelogueTag.findMany({ where: { placeId: { in: placeIds } }, orderBy: { id: "asc" } });
    const episodes = await prisma.episode.findMany({
        where: { slug: { in: [...new Set(tags.map((tag) => tag.episodeSlug))] } },
        select: { slug: true, title: true, episode_no: true, seasonTitle: true, season: { select: { slug: true } } },
    });
    const bySlug = new Map(episodes.map(({ season, ...episode }) => [episode.slug, { ...episode, seasonSlug: season.slug }]));
    const rows = tags
        .map((tag) => ({ id: tag.id, placeId: tag.placeId, bodyId: tag.bodyId, creatorId: tag.creatorId, episodeSlug: tag.episodeSlug, episode: bySlug.get(tag.episodeSlug) ?? null }))
        .sort((a, b) => (a.episode?.seasonTitle ?? "").localeCompare(b.episode?.seasonTitle ?? "") || (a.episode?.episode_no ?? 0) - (b.episode?.episode_no ?? 0));
    const byPlace = new Map<number, Omit<(typeof rows)[number], "placeId">[]>();
    for (const { placeId, ...row } of rows) byPlace.set(placeId, [...(byPlace.get(placeId) ?? []), row]);
    return byPlace;
}

const travelogueOf = async (placeId: number) => (await traveloguesOf([placeId])).get(placeId) ?? [];

async function withTravelogue(place: PlaceRow | null) {
    return place ? { ...(await withWiki([place]))[0], travelogue: await travelogueOf(place.id) } : null;
}

async function getPlaceById(id: number) {
    return await withTravelogue(await prisma.mapPlace.findUnique({ where: { id }, include: PLACE_INCLUDE }));
}

async function getPlaceBySlug(slug: string) {
    const place = await prisma.mapPlace.findUnique({ where: { slug }, include: PLACE_INCLUDE });
    if (place || normalizeSlug(slug) === slug) return await withTravelogue(place);
    return await withTravelogue(await prisma.mapPlace.findUnique({ where: { slug: normalizeSlug(slug) }, include: PLACE_INCLUDE }));
}

/** The name of a system's star: what its designations start with (null while it has none). */
async function stemOf(tx: Tx, placeId: number) {
    return (await tx.mapBody.findFirst({ where: { placeId, kind: "STAR" }, orderBy: { id: "asc" }, select: { name: true } }))?.name ?? null;
}

/** Just enough of a place to check who owns it. */
async function getPlaceOwner(id: number) {
    return await prisma.mapPlace.findUnique({ where: { id }, select: { id: true, kind: true, creatorId: true } });
}

/** A body with its place's kind and owner. */
async function getBodyOwner(id: number) {
    const body = await prisma.mapBody.findUnique({ where: { id }, select: { id: true, kind: true, placeId: true, place: { select: { creatorId: true } } } });
    return body ? { id: body.id, kind: body.kind, placeId: body.placeId, creatorId: body.place.creatorId } : null;
}

async function createBodyTree(tx: Tx, placeId: number, parentId: number | null, node: BodyTreeInput) {
    const { children, ...fields } = node;
    const slug = slugFor(fields.name, fields.slug);
    await assertBodySlugFree(tx, slug);
    const body = await tx.mapBody.create({ data: { ...fields, slug, placeId, parentId } });
    for (const child of children) await createBodyTree(tx, placeId, body.id, child);
}

/**
 * A new place, with its bodies when it is a system (`bodies: [star]`, the rest under
 * `children`), in one transaction: a system never exists without its star.
 */
async function createPlace(body: unknown, creatorId: number) {
    const fields = parsePlace(body) as PlaceInput;
    const bodies = (body as { bodies?: unknown }).bodies;
    let star: BodyTreeInput | null = null;
    if (fields.kind === "SYSTEM") star = parseBodyTree(bodies);
    else if (bodies !== undefined && !(Array.isArray(bodies) && bodies.length === 0)) throw new GalaxyInputError("A landmark has no bodies");

    const id = await prisma.$transaction(async (tx) => {
        if ((await tx.mapPlace.count({ where: { creatorId } })) >= PLACES_PER_USER) throw new GalaxyInputError(`One member can add at most ${PLACES_PER_USER} places`);
        const slug = slugFor(fields.name, fields.slug);
        await assertPlaceSlugFree(tx, slug);
        const place = await tx.mapPlace.create({ data: { ...fields, slug, creatorId } });
        if (star) await createBodyTree(tx, place.id, null, star);
        return place.id;
    });
    return (await getPlaceById(id))!;
}

/**
 * Edits a place. A stored slug never changes by itself; a place that had no name gets
 * its slug when it gets one, and its unnamed star takes the same name.
 */
async function updatePlace(id: number, body: unknown) {
    await prisma.$transaction(async (tx) => {
        const place = await tx.mapPlace.findUniqueOrThrow({ where: { id } });
        const fields = parsePlace(body, true, place.kind);
        if (fields.slug === undefined && !place.slug && fields.name) fields.slug = slugFor(fields.name, null);
        if (fields.slug !== undefined) await assertPlaceSlugFree(tx, fields.slug, id);
        await tx.mapPlace.update({ where: { id }, data: fields });
        if (!place.name && fields.name) {
            const star = await tx.mapBody.findFirst({ where: { placeId: id, kind: "STAR", name: null } });
            if (star) {
                const slug = slugFor(fields.name, null);
                await assertBodySlugFree(tx, slug, star.id);
                await tx.mapBody.update({ where: { id: star.id }, data: { name: fields.name, slug } });
            }
        }
    });
    return (await getPlaceById(id))!;
}

async function deletePlace(id: number): Promise<void> {
    await prisma.mapPlace.delete({ where: { id } });
}

/** Adds one body to a system, under `parentId`. */
async function createBody(placeId: number, body: unknown) {
    const fields = parseBody(body) as BodyInput;
    const parentId = (body as { parentId?: unknown }).parentId ?? null;
    if (parentId !== null && !Number.isInteger(parentId)) throw new GalaxyInputError("parentId must be a body's id");
    return await prisma.$transaction(async (tx) => {
        const place = await tx.mapPlace.findUniqueOrThrow({ where: { id: placeId }, select: { kind: true } });
        if (place.kind !== "SYSTEM") throw new GalaxyInputError("Only a system has bodies");
        if ((await tx.mapBody.count({ where: { placeId } })) >= BODIES_PER_PLACE) throw new GalaxyInputError(`A system has at most ${BODIES_PER_PLACE} bodies`);
        // The star is made with its system, so nothing added later may be parentless
        const parent = parentId === null ? null : await tx.mapBody.findFirst({ where: { id: parentId as number, placeId }, select: { kind: true } });
        if (parentId !== null && !parent) throw new GalaxyInputError("parentId is not a body of this system");
        if (!parent || !PARENT_KINDS[fields.kind].includes(parent.kind)) throw new GalaxyInputError(orbitRule(fields.kind));
        checkNotDesignation(fields.name, await stemOf(tx, placeId), fields.kind);
        const slug = slugFor(fields.name, fields.slug);
        await assertBodySlugFree(tx, slug);
        return await tx.mapBody.create({ data: { ...fields, slug, placeId, parentId: parentId as number } });
    });
}

/** Edits a body. Its slug follows the rule in updatePlace. */
async function updateBody(id: number, body: unknown) {
    return await prisma.$transaction(async (tx) => {
        const current = await tx.mapBody.findUniqueOrThrow({ where: { id } });
        const fields = parseBody(body, true, current.kind);
        if (fields.name) checkNotDesignation(fields.name, await stemOf(tx, current.placeId), current.kind);
        if (fields.slug === undefined && !current.slug && fields.name) fields.slug = slugFor(fields.name, null);
        if (fields.slug !== undefined) await assertBodySlugFree(tx, fields.slug, id);
        return await tx.mapBody.update({ where: { id }, data: fields });
    });
}

/** Deletes a body and everything that orbits it. A system keeps its star. */
async function deleteBody(id: number): Promise<void> {
    const body = await prisma.mapBody.findUniqueOrThrow({ where: { id }, select: { kind: true } });
    if (body.kind === "STAR") throw new GalaxyInputError("A system keeps its star: delete the system instead");
    await prisma.mapBody.delete({ where: { id } });
}

/** Tags an episode (by slug) on a place, or on one of its bodies. Null if there is no such episode. */
async function createTravelogueTag(placeId: number, body: unknown, creatorId: number) {
    const o = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    if (typeof o.episode !== "string" || !o.episode) throw new GalaxyInputError("Send episode: the episode's slug");
    const bodyId = o.bodyId ?? null;
    if (bodyId !== null && !Number.isInteger(bodyId)) throw new GalaxyInputError("bodyId must be a body's id");
    const episode =
        (await prisma.episode.findUnique({ where: { slug: o.episode }, select: { slug: true } })) ??
        (await prisma.episode.findUnique({ where: { slug: normalizeSlug(o.episode) }, select: { slug: true } }));
    if (!episode) return null;
    if (bodyId !== null && !(await prisma.mapBody.findFirst({ where: { id: bodyId as number, placeId }, select: { id: true } }))) {
        throw new GalaxyInputError("bodyId is not a body of this place");
    }
    const where = { placeId, bodyId: bodyId as number | null, episodeSlug: episode.slug };
    if (await prisma.travelogueTag.findFirst({ where, select: { id: true } })) throw new GalaxyConflictError("That episode is already tagged here");
    const tag = await prisma.travelogueTag.create({ data: { ...where, creatorId } });
    return (await travelogueOf(placeId)).find((row) => row.id === tag.id)!;
}

/** A tag with its place's owner: the tagger, that owner or an admin may remove it. */
async function getTravelogueTag(id: number) {
    const tag = await prisma.travelogueTag.findUnique({ where: { id }, select: { id: true, creatorId: true, place: { select: { creatorId: true } } } });
    return tag ? { id: tag.id, creatorId: tag.creatorId, placeCreatorId: tag.place.creatorId } : null;
}

async function deleteTravelogueTag(id: number): Promise<void> {
    await prisma.travelogueTag.delete({ where: { id } });
}

export default {
    getAllPlaces,
    getPlaceById,
    getPlaceBySlug,
    getPlaceOwner,
    getBodyOwner,
    createPlace,
    updatePlace,
    deletePlace,
    createBody,
    updateBody,
    deleteBody,
    createTravelogueTag,
    getTravelogueTag,
    deleteTravelogueTag,
};
