import { PrismaClient, Class } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";
import { normalizeSlug, slugify } from "../utils/slug.js";

const prisma = new PrismaClient();

type SpeciesData = {
    name: string;
    description: string;
    class: Class;
    slug?: string;
    creatorId: number;
};

// opts is additive, unified-/api/search-only. Existing callers pass no
// second argument, so their query shape/result set is unchanged.
async function getAllSpecies(search?: string, opts: { limit?: number; lite?: boolean } = {}) {
    const { limit, lite } = opts;
    const where = search
        ? { name: { contains: search, ...(lite && { mode: "insensitive" as const }) } }
        : undefined;
    if (lite) {
        return await prisma.species.findMany({
            where,
            select: { id: true, name: true, slug: true },
            ...(limit !== undefined && { take: limit }),
        });
    }
    return await prisma.species.findMany({
        where,
        include: { Character: true },
        ...(limit !== undefined && { take: limit }),
    });
}

async function getSpeciesById(id: number) {
    return await prisma.species.findUnique({
        where: { id },
        include: { Character: true },
    });
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
async function getSpeciesBySlug(slug: string) {
    const species = await prisma.species.findUnique({ where: { slug }, include: { Character: true } });
    if (species) return species;
    const normalized = normalizeSlug(slug);
    return normalized !== slug
        ? await prisma.species.findUnique({ where: { slug: normalized }, include: { Character: true } })
        : null;
}

async function createSpecies(data: SpeciesData) {
    return await prisma.species.create({
        data: {
            name: data.name,
            description: sanitizeText(data.description),
            class: data.class,
            slug: data.slug ?? slugify(data.name),
            creatorId: data.creatorId,
        },
        include: { Character: true },
    });
}

async function updateSpecies(id: number, data: Partial<SpeciesData>) {
    return await prisma.species.update({
        where: { id },
        data: {
            name: data.name,
            description: data.description !== undefined ? sanitizeText(data.description) : undefined,
            class: data.class,
            slug: data.slug,
        },
        include: { Character: true },
    });
}

async function deleteSpecies(id: number): Promise<void> {
    await prisma.species.delete({ where: { id } });
}

export default { getAllSpecies, getSpeciesById, getSpeciesBySlug, createSpecies, updateSpecies, deleteSpecies };
