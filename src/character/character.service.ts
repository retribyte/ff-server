import { PrismaClient } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";
import { normalizeSlug, slugify } from "../utils/slug.js";

const prisma = new PrismaClient();

type CharacterData = {
    name: string;
    speciesId: number;
    blurb?: string;
    image?: string;
    color?: string;
    slug?: string;
    creatorId: number;
};

type CharacterFilters = {
    search?: string;
    speciesId?: number;
    ownerId?: number;
    season?: string;
    // limit/lite: additive, unified-/api/search-only (a narrower select
    // shape + a result cap). Omitted by every existing caller, so their
    // result set is otherwise unchanged.
    limit?: number;
    lite?: boolean;
};

async function getAllCharacters(filters: CharacterFilters = {}) {
    const { search, speciesId, ownerId, season, limit, lite } = filters;
    const where: any = {};

    if (search) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { personas: { some: { name: { contains: search, mode: "insensitive" } } } },
        ];
    }
    if (speciesId !== undefined) where.speciesId = speciesId;
    if (ownerId !== undefined) where.creatorId = ownerId;
    if (season) {
        where.messages = { some: { episode: { seasonTitle: season } } };
    }

    return await prisma.character.findMany({
        where,
        ...(lite && { select: { id: true, name: true, slug: true, image: true } }),
        ...(limit !== undefined && { take: limit }),
    });
}

async function getCharacterById(id: number) {
    return await prisma.character.findUnique({ where: { id }, include: { personas: true } });
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
// Finally falls back to a Persona slug lookup (same raw-then-normalized
// order), returning the persona's character — e.g. "/characters/vec_fungus"
// resolves to Vec. Only named personas have a slug (name-less look-only
// personas have no URL identity), so this naturally only ever matches those.
async function getCharacterBySlug(slug: string) {
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
            speciesId: data.speciesId,
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
            speciesId: data.speciesId,
            blurb: data.blurb !== undefined ? sanitizeText(data.blurb) : undefined,
            image: data.image,
            color: data.color,
            slug: data.slug,
        },
    });
}

async function deleteCharacter(id: number): Promise<void> {
    // Messages intentionally still block deletion: a character woven into
    // the archive shouldn't silently vanish.
    await prisma.character.delete({ where: { id } });
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
// counts stay small.
async function getAllPersonas(search?: string) {
    const where = search ? { name: { contains: search } } : undefined;
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
