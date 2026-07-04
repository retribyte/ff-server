import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type EpisodeData = {
    title: string;
    seasonTitle: string;
    episode_no: number;
    summary?: string;
    playedDate?: string;
};

async function getAllEpisodes(search?: string) {
    const where = search
        ? { title: { contains: search } }
        : undefined;
    return await prisma.episode.findMany({
        where,
        include: { season: true },
    });
}

async function getEpisodeByTitle(title: string) {
    return await prisma.episode.findUnique({
        where: { title },
        include: { season: true, messages: { orderBy: { messageNo: "asc" }, include: { player: { select: { id: true, username: true, icon: true } }, character: true, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } } } },
    });
}

async function createEpisode(data: EpisodeData) {
    return await prisma.episode.create({
        data: {
            title: data.title,
            seasonTitle: data.seasonTitle,
            episode_no: data.episode_no,
            summary: data.summary,
            playedDate: data.playedDate ? new Date(data.playedDate) : undefined,
        },
        include: { season: true, messages: true },
    });
}

async function updateEpisode(title: string, data: Partial<EpisodeData>) {
    return await prisma.episode.update({
        where: { title },
        data: {
            title: data.title,
            seasonTitle: data.seasonTitle,
            episode_no: data.episode_no,
            summary: data.summary,
            playedDate: data.playedDate ? new Date(data.playedDate) : undefined,
        },
        include: { season: true, messages: true },
    });
}

async function deleteEpisode(title: string): Promise<void> {
    // an episode owns its messages (and they their commentaries) — clear them
    // first or the foreign keys block deletion
    await prisma.$transaction([
        prisma.commentary.deleteMany({ where: { messageEpisodeTitle: title } }),
        prisma.message.deleteMany({ where: { episodeTitle: title } }),
        prisma.episode.delete({ where: { title } }),
    ]);
}

export default { getAllEpisodes, getEpisodeByTitle, createEpisode, updateEpisode, deleteEpisode };
