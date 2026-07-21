import { PrismaClient, ItemType } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";
import { normalizeSlug, slugify } from "../utils/slug.js";

const prisma = new PrismaClient();

type ItemData = {
    name: string;
    itemType: ItemType;
    description: string;
    image?: string;
    slug?: string;
    creatorId: number;
};

// opts is additive, unified-/api/search-only (a narrower select shape + a
// result cap). Existing callers pass no second argument, so their result
// set is otherwise unchanged.
async function getAllItems(search?: string, opts: { limit?: number; lite?: boolean } = {}) {
    const { limit, lite } = opts;
    const where = search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : undefined;
    return await prisma.item.findMany({
        where,
        ...(lite && { select: { id: true, name: true, slug: true, image: true } }),
        ...(limit !== undefined && { take: limit }),
    });
}

async function getItemById(id: number) {
    return await prisma.item.findUnique({
        where: { id },
        include: { creator: { select: { id: true, username: true } } },
    });
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
async function getItemBySlug(slug: string) {
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
