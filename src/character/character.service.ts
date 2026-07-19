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
            { aliases: { some: { alias: { contains: search } } } },
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
    return await prisma.character.findUnique({ where: { id }, include: { aliases: true } });
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
// Finally falls back to an Alias slug lookup (same raw-then-normalized
// order), returning the alias's character — e.g. "/characters/vec_fungus"
// resolves to Vec.
async function getCharacterBySlug(slug: string) {
    const character = await prisma.character.findUnique({ where: { slug }, include: { aliases: true } });
    if (character) return character;
    const normalized = normalizeSlug(slug);
    if (normalized !== slug) {
        const byNormalized = await prisma.character.findUnique({
            where: { slug: normalized },
            include: { aliases: true },
        });
        if (byNormalized) return byNormalized;
    }

    const alias = await prisma.alias.findUnique({
        where: { slug },
        include: { character: { include: { aliases: true } } },
    });
    if (alias) return alias.character;
    if (normalized !== slug) {
        const aliasByNormalized = await prisma.alias.findUnique({
            where: { slug: normalized },
            include: { character: { include: { aliases: true } } },
        });
        if (aliasByNormalized) return aliasByNormalized.character;
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

// --- Aliases ---------------------------------------------------------

type AliasData = {
    alias: string;
    slug?: string;
};

async function getAliasesByCharacter(characterId: number) {
    return await prisma.alias.findMany({ where: { characterId }, orderBy: { id: "asc" } });
}

// Full index of every alias, for callers (e.g. the transcript importer) that
// need to match speaker names against all characters in one call instead of
// N+1-ing over getAliasesByCharacter. No pagination — alias counts stay small.
async function getAllAliases(search?: string) {
    const where = search ? { alias: { contains: search } } : undefined;
    return await prisma.alias.findMany({ where, orderBy: { id: "asc" } });
}

async function getAliasById(id: number) {
    return await prisma.alias.findUnique({ where: { id } });
}

// Slug defaults to `<character_slug>_<alias_slug>` and, once set, never
// changes on its own — renaming the character or the alias never cascades.
async function createAlias(characterId: number, data: AliasData) {
    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
        throw new Error(`Character with id '${characterId}' not found`);
    }

    return await prisma.alias.create({
        data: {
            alias: data.alias,
            slug: data.slug ?? `${slugify(character.name)}_${slugify(data.alias)}`,
            characterId,
        },
    });
}

async function updateAlias(id: number, data: Partial<AliasData>) {
    return await prisma.alias.update({
        where: { id },
        data: {
            alias: data.alias,
            slug: data.slug,
        },
    });
}

async function deleteAlias(id: number): Promise<void> {
    // Messages referencing this alias block deletion (FK restrict) — an
    // alias used in the archive shouldn't silently vanish out from under it.
    await prisma.alias.delete({ where: { id } });
}

export default {
    getAllCharacters,
    getCharacterById,
    getCharacterBySlug,
    createCharacter,
    updateCharacter,
    deleteCharacter,
    getAliasesByCharacter,
    getAllAliases,
    getAliasById,
    createAlias,
    updateAlias,
    deleteAlias,
};
