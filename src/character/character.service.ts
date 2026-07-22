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
};

async function getAllCharacters(filters: CharacterFilters = {}) {
    const { search, speciesId, ownerId, season } = filters;
    const where: any = {};

    if (search) {
        where.OR = [
            { name: { contains: search } },
            { personas: { some: { name: { contains: search } } } },
        ];
    }
    if (speciesId !== undefined) where.speciesId = speciesId;
    if (ownerId !== undefined) where.creatorId = ownerId;
    if (season) {
        where.messages = { some: { episode: { seasonTitle: season } } };
    }

    return await prisma.character.findMany({ where });
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

export default {
    getAllCharacters,
    getCharacterById,
    getCharacterBySlug,
    createCharacter,
    updateCharacter,
    deleteCharacter,
};
