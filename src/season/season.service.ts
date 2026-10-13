import { PrismaClient, SeasonKind } from "@prisma/client";
import { slugify } from "../utils/slug.js";

const prisma = new PrismaClient();

// Stories are summaries only — chapters/lines come from /api/stories/:slug.
const SEASON_INCLUDE = {
    episodes: true,
    stories: {
        orderBy: { title: "asc" as const },
        select: { slug: true, title: true, blurb: true, themeColor: true, themeColor2: true },
    },
};

async function getAllSeasons(search?: string) {
    const where = search
        ? { title: { contains: search } }
        : undefined;
    return await prisma.season.findMany({
        where,
        include: SEASON_INCLUDE,
        orderBy: { slug: "asc" },
    });
}

async function getSeasonByTitle(title: string) {
    return await prisma.season.findUnique({
        where: { title },
        include: SEASON_INCLUDE,
    });
}

async function createSeason(title: string, slug?: string, kind?: SeasonKind) {
    return await prisma.season.create({
        data: { title, slug: slug ?? slugify(title), kind },
        include: SEASON_INCLUDE,
    });
}

async function updateSeason(title: string, newTitle: string, slug?: string, kind?: SeasonKind) {
    return await prisma.season.update({
        where: { title },
        data: { title: newTitle, slug, kind },
        include: SEASON_INCLUDE,
    });
}

async function deleteSeason(title: string): Promise<void> {
    await prisma.season.delete({ where: { title } });
}

export default { getAllSeasons, getSeasonByTitle, createSeason, updateSeason, deleteSeason };
