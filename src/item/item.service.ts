import { PrismaClient, ItemType } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";

const prisma = new PrismaClient();

type ItemData = {
    name: string;
    itemType: ItemType;
    description: string;
    image?: string;
    creatorId: number;
    characterId?: number;
};

async function getAllItems(search?: string) {
    const where = search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : undefined;
    return await prisma.item.findMany({
        where,
        include: { character: true },
    });
}

async function getItemById(id: number) {
    return await prisma.item.findUnique({
        where: { id },
        include: { character: true, creator: { select: { id: true, username: true } } },
    });
}

async function createItem(data: ItemData) {
    return await prisma.item.create({
        data: {
            name: data.name,
            itemType: data.itemType,
            description: sanitizeText(data.description),
            image: data.image,
            creatorId: data.creatorId,
            characterId: data.characterId,
        },
        include: { character: true },
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
            characterId: data.characterId,
        },
        include: { character: true },
    });
}

async function deleteItem(id: number): Promise<void> {
    await prisma.item.delete({ where: { id } });
}

export default { getAllItems, getItemById, createItem, updateItem, deleteItem };
