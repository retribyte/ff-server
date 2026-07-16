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
        where.name = { contains: search };
    }
    if (speciesId !== undefined) where.speciesId = speciesId;
    if (ownerId !== undefined) where.creatorId = ownerId;
    if (season) {
        where.messages = { some: { episode: { seasonTitle: season } } };
    }

    return await prisma.character.findMany({ where });
}

async function getCharacterById(id: number) {
    return await prisma.character.findUnique({ where: { id } });
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
async function getCharacterBySlug(slug: string) {
    const character = await prisma.character.findUnique({ where: { slug } });
    if (character) return character;
    const normalized = normalizeSlug(slug);
    return normalized !== slug ? await prisma.character.findUnique({ where: { slug: normalized } }) : null;
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
