import { PrismaClient, ItemType } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";
import { normalizeSlug, slugify } from "../utils/slug.js";
import { getWikiData } from "../wiki/wiki.service.js";

const prisma = new PrismaClient();

type ItemData = {
    name: string;
    itemType: ItemType;
    description: string;
    image?: string;
    slug?: string;
    creatorId: number;
};

async function getAllItems(search?: string) {
    const where = search
        ? { name: { contains: search } }
        : undefined;
    return await prisma.item.findMany({ where });
}

// Attaches wiki-sourced fields under a nullable `wiki` key. Opt-in: callers
// that only need the record to check ownership (the mutation routes in
// item.controller.ts) skip this so a wiki cache miss never blocks a write.
async function attachWikiData<T extends { slug: string }>(item: T): Promise<T & { wiki: Record<string, unknown> | null }> {
    const wiki = await getWikiData("items", item.slug);
    return { ...item, wiki };
}

async function getItemById(id: number, options: { withWiki?: boolean } = {}) {
    const item = await prisma.item.findUnique({
        where: { id },
        include: { creator: { select: { id: true, username: true } } },
    });
    if (!item) return null;
    return options.withWiki ? await attachWikiData(item) : item;
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
async function getItemBySlug(slug: string, options: { withWiki?: boolean } = {}) {
    const item = await resolveItemBySlug(slug);
    if (!item) return null;
    return options.withWiki ? await attachWikiData(item) : item;
}

async function resolveItemBySlug(slug: string) {
    const item = await prisma.item.findUnique({
        where: { slug },
        include: { creator: { select: { id: true, username: true } } },
    });
    if (item) return item;
    const normalized = normalizeSlug(slug);
    return normalized !== slug
        ? await prisma.item.findUnique({
              where: { slug: normalized },
              include: { creator: { select: { id: true, username: true } } },
          })
        : null;
}

async function createItem(data: ItemData) {
    return await prisma.item.create({
        data: {
            name: data.name,
            itemType: data.itemType,
            description: sanitizeText(data.description),
            image: data.image,
            slug: data.slug ?? slugify(data.name),
            creatorId: data.creatorId,
        },
    });
}

async function updateItem(id: number, data: Partial<ItemData>) {
    return await prisma.item.update({
        where: { id },
        data: {
            name: data.name,
            itemType: data.itemType,
            description: data.description !== undefined ? sanitizeText(data.description) : undefined,
            image: data.image,
            slug: data.slug,
        },
    });
}

async function deleteItem(id: number): Promise<void> {
    await prisma.item.delete({ where: { id } });
}

export default { getAllItems, getItemById, getItemBySlug, createItem, updateItem, deleteItem };
