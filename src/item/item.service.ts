import { PrismaClient, ItemType } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";
import { slugify } from "../utils/slug.js";

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

async function getItemById(id: number) {
    return await prisma.item.findUnique({
        where: { id },
        include: { creator: { select: { id: true, username: true } } },
    });
}

async function getItemBySlug(slug: string) {
    return await prisma.item.findUnique({
        where: { slug },
        include: { creator: { select: { id: true, username: true } } },
    });
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
