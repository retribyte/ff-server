import { PrismaClient, Class } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";
import { normalizeSlug, slugify } from "../utils/slug.js";
import { getWikiData } from "../wiki/wiki.service.js";

const prisma = new PrismaClient();

type SpeciesData = {
    name: string;
    description: string;
    class: Class;
    slug?: string;
    creatorId: number;
};

// opts is additive, unified-/api/search-only (a narrower select shape + a
// result cap). Existing callers pass no second argument, so their result
// set is otherwise unchanged.
async function getAllSpecies(search?: string, opts: { limit?: number; lite?: boolean } = {}) {
    const { limit, lite } = opts;
    const where = search
        ? { name: { contains: search, mode: "insensitive" as const } }
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

// Attaches wiki-sourced fields under a nullable `wiki` key. Opt-in: callers
// that only need the record to check ownership (the mutation routes in
// species.controller.ts) skip this so a wiki cache miss never blocks a write.
async function attachWikiData<T extends { slug: string }>(species: T): Promise<T & { wiki: Record<string, unknown> | null }> {
    const wiki = await getWikiData("species", species.slug);
    return { ...species, wiki };
}

async function getSpeciesById(id: number, options: { withWiki?: boolean } = {}) {
    const species = await prisma.species.findUnique({
        where: { id },
        include: { Character: true },
    });
    if (!species) return null;
    return options.withWiki ? await attachWikiData(species) : species;
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
async function getSpeciesBySlug(slug: string, options: { withWiki?: boolean } = {}) {
    const species = await resolveSpeciesBySlug(slug);
    if (!species) return null;
    return options.withWiki ? await attachWikiData(species) : species;
}

async function resolveSpeciesBySlug(slug: string) {
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
