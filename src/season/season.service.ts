import { PrismaClient } from "@prisma/client";
import { slugify } from "../utils/slug.js";

const prisma = new PrismaClient();

async function getAllSeasons(search?: string) {
    const where = search
        ? { title: { contains: search } }
        : undefined;
    return await prisma.season.findMany({
        where,
        include: { episodes: true },
    });
}

async function getSeasonByTitle(title: string) {
    return await prisma.season.findUnique({
        where: { title },
        include: { episodes: true },
    });
}

async function createSeason(title: string, slug?: string) {
    return await prisma.season.create({
        data: { title, slug: slug ?? slugify(title) },
        include: { episodes: true },
    });
}

async function updateSeason(title: string, newTitle: string, slug?: string) {
    return await prisma.season.update({
        where: { title },
        data: { title: newTitle, slug },
        include: { episodes: true },
    });
}

async function deleteSeason(title: string): Promise<void> {
    await prisma.season.delete({ where: { title } });
}

export default { getAllSeasons, getSeasonByTitle, createSeason, updateSeason, deleteSeason };
