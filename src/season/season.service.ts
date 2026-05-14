import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function getAllSeasons() {
    return await prisma.season.findMany({
        include: { episodes: true },
    });
}

async function getSeasonByTitle(title: string) {
    return await prisma.season.findUnique({
        where: { title },
        include: { episodes: true },
    });
}

async function createSeason(title: string) {
    return await prisma.season.create({
        data: { title },
        include: { episodes: true },
    });
}

async function updateSeason(title: string, newTitle: string) {
    return await prisma.season.update({
        where: { title },
        data: { title: newTitle },
        include: { episodes: true },
    });
}

async function deleteSeason(title: string): Promise<void> {
    await prisma.season.delete({ where: { title } });
}

export default { getAllSeasons, getSeasonByTitle, createSeason, updateSeason, deleteSeason };
