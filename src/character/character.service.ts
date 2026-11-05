import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { sanitizeText } from "../utils/sanitize.js";
import { normalizeSlug, slugify } from "../utils/slug.js";
import { getWikiData } from "../wiki/wiki.service.js";


type CharacterData = {
    name: string;
    blurb?: string;
    image?: string;
    color?: string;
    slug?: string;
    creatorId: number;
};

type CharacterFilters = {
    search?: string;
    ownerId?: number;
    season?: string;
    // limit/lite: additive, unified-/api/search-only (a narrower select
    // shape + a result cap). Omitted by every existing caller, so their
    // result set is otherwise unchanged.
    limit?: number;
    lite?: boolean;
};

async function getAllCharacters(filters: CharacterFilters = {}) {
    const { search, ownerId, season, limit, lite } = filters;
    const where: any = {};

    if (search) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { personas: { some: { name: { contains: search, mode: "insensitive" } } } },
        ];
    }
    if (ownerId !== undefined) where.creatorId = ownerId;
    if (season) {
        where.messages = { some: { episode: { seasonTitle: season } } };
    }

    if (lite) {
        return await prisma.character.findMany({ where, select: { id: true, name: true, slug: true, image: true }, take: limit });
    }
    return await prisma.character.findMany({ where, take: limit });
}

// Attaches wiki-sourced fields under a nullable `wiki` key, keyed off the
// character's own canonical slug — never the raw request param, which may
// be a hyphenated or persona alias (see getCharacterBySlug below). Opt-in:
// callers that only need the record to check ownership (the mutation
// routes in character.controller.ts) skip this so a wiki cache miss never
// blocks a write.
async function attachWikiData<T extends { slug: string }>(character: T): Promise<T & { wiki: Record<string, unknown> | null }> {
    const wiki = await getWikiData("characters", character.slug);
    return { ...character, wiki };
}

async function getCharacterById(id: number, options: { withWiki?: boolean } = {}) {
    const character = await prisma.character.findUnique({ where: { id }, include: { personas: true } });
    if (!character) return null;
    return options.withWiki ? await attachWikiData(character) : character;
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
// Finally falls back to a Persona slug lookup (same raw-then-normalized
// order), returning the persona's character — e.g. "/characters/vec_fungus"
// resolves to Vec. Only named personas have a slug (name-less look-only
// personas have no URL identity), so this naturally only ever matches those.
async function getCharacterBySlug(slug: string, options: { withWiki?: boolean } = {}) {
    const character = await resolveCharacterBySlug(slug);
    if (!character) return null;
    return options.withWiki ? await attachWikiData(character) : character;
}

async function resolveCharacterBySlug(slug: string) {
    const character = await prisma.character.findUnique({ where: { slug }, include: { personas: true } });
    if (character) return character;
    const normalized = normalizeSlug(slug);
    if (normalized !== slug) {
        const byNormalized = await prisma.character.findUnique({
            where: { slug: normalized },
            include: { personas: true },
        });
        if (byNormalized) return byNormalized;
    }

    const persona = await prisma.persona.findUnique({
        where: { slug },
        include: { character: { include: { personas: true } } },
    });
    if (persona) return persona.character;
    if (normalized !== slug) {
        const personaByNormalized = await prisma.persona.findUnique({
            where: { slug: normalized },
            include: { character: { include: { personas: true } } },
        });
        if (personaByNormalized) return personaByNormalized.character;
    }

    return null;
}

async function createCharacter(data: CharacterData) {
    return await prisma.character.create({
        data: {
            name: data.name,
            blurb: data.blurb !== undefined ? sanitizeText(data.blurb) : undefined,
            image: data.image,
            color: data.color,
            slug: data.slug ?? slugify(data.name),
            creatorId: data.creatorId,
        },
    });
}

async function updateCharacter(id: number, data: Partial<CharacterData>) {
    return await prisma.character.update({
        where: { id },
        data: {
            name: data.name,
            blurb: data.blurb !== undefined ? sanitizeText(data.blurb) : undefined,
            image: data.image,
            color: data.color,
            slug: data.slug,
        },
    });
}

/** The character is attributed somewhere in the archive, so it can't be deleted — maps to 409. */
export class CharacterInArchiveError extends Error {}

async function deleteCharacter(id: number): Promise<void> {
    // Archive immutability: a character woven into the archive can't vanish
    // and strip attribution from its lines. Message.character and
    // StoryLine.character are onDelete: Restrict (P2003 on delete), but
    // in-paragraph prose speakers live in StoryLine.segments JSON with no FK,
    // so check those here.
    const containment = JSON.stringify([{ characterId: id }]);
    const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM story_lines WHERE segments @> ${containment}::jsonb
    `;
    if (count > 0n) {
        throw new CharacterInArchiveError("This character speaks in the archive, so it can't be deleted");
    }
    try {
        await prisma.character.delete({ where: { id } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
            throw new CharacterInArchiveError("This character speaks in the archive, so it can't be deleted");
        }
        throw error;
    }
}

// --- Personas ----------------------------------------------------------

type PersonaData = {
    name?: string;
    label?: string;
    slug?: string;
    image?: string;
    color?: string;
};

async function getPersonasByCharacter(characterId: number) {
    return await prisma.persona.findMany({ where: { characterId }, orderBy: { id: "asc" } });
}

// Full index of every persona, for callers (e.g. the transcript importer)
// that need to match speaker names against all characters in one call
// instead of N+1-ing over getPersonasByCharacter. No pagination — persona
// counts stay small. NPC personas (characterId null) are included; `npc`
// narrows to just them (true) or just character personas (false).
async function getAllPersonas(search?: string, npc?: boolean) {
    const where: Prisma.PersonaWhereInput = {};
    if (search) where.name = { contains: search };
    if (npc !== undefined) where.characterId = npc ? null : { not: null };
    if (npc) {
        // The admin NPC-voices list shows how much each one speaks.
        const personas = await prisma.persona.findMany({
            where,
            orderBy: { name: "asc" },
            include: { _count: { select: { messages: true } } },
        });
        return personas.map(({ _count, ...p }) => ({ ...p, messageCount: _count.messages }));
    }
    return await prisma.persona.findMany({ where, orderBy: { id: "asc" } });
}

async function getPersonaById(id: number) {
    return await prisma.persona.findUnique({ where: { id } });
}

// Slug defaults to `<character_slug>_<name_slug>` and, once set, never
// changes on its own — renaming the character or the persona never cascades.
// Name-less personas (look-only eras) get no slug: no URL identity.
async function createPersona(characterId: number, data: PersonaData) {
    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
        throw new Error(`Character with id '${characterId}' not found`);
    }
    if (!data.name && !data.image && !data.color) {
        throw new Error("A persona must set at least one of name, image, or color");
    }
    if (!data.name && !data.label) {
        throw new Error("label is required when name is not set");
    }

    return await prisma.persona.create({
        data: {
            name: data.name,
            label: data.label,
            image: data.image,
            color: data.color,
            slug: data.name ? data.slug ?? `${slugify(character.name)}_${slugify(data.name)}` : undefined,
            characterId,
        },
    });
}

async function updatePersona(id: number, data: Partial<PersonaData>) {
    const existing = await prisma.persona.findUnique({ where: { id } });
    if (!existing) {
        throw new Error(`Persona with id '${id}' not found`);
    }
    if (existing.characterId === null) {
        // NPC voice: always named, never a slug or page.
        if (data.slug) throw new Error("NPC personas have no slug");
        if (data.name !== undefined && !data.name?.trim()) throw new Error("NPC personas need a name");
    }

    const nextName = data.name !== undefined ? data.name : existing.name;
    const nextImage = data.image !== undefined ? data.image : existing.image;
    const nextColor = data.color !== undefined ? data.color : existing.color;
    const nextLabel = data.label !== undefined ? data.label : existing.label;
    if (!nextName && !nextImage && !nextColor) {
        throw new Error("A persona must set at least one of name, image, or color");
    }
    if (!nextName && !nextLabel) {
        throw new Error("label is required when name is not set");
    }

    return await prisma.persona.update({
        where: { id },
        data: {
            name: data.name,
            label: data.label,
            image: data.image,
            color: data.color,
            slug: data.slug,
        },
    });
}

async function deletePersona(id: number): Promise<void> {
    // Messages referencing this persona block deletion (FK restrict) — a
    // persona used in the archive shouldn't silently vanish out from under it.
    await prisma.persona.delete({ where: { id } });
}

export default {
    getAllCharacters,
    getCharacterById,
    getCharacterBySlug,
    createCharacter,
    updateCharacter,
    deleteCharacter,
    getPersonasByCharacter,
    getAllPersonas,
    getPersonaById,
    createPersona,
    updatePersona,
    deletePersona,
};
