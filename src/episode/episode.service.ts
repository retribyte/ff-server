import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { slugify } from "../utils/slug.js";
import { IMPORT_TX_OPTIONS, ImportConflictError } from "../utils/import.js";
import { validateMessages, insertMessages, type MessageData } from "../message/message.service.js";


type EpisodeData = {
    title: string;
    seasonTitle: string;
    episode_no: number;
    summary?: string;
    playedDate?: string;
    slug?: string;
    reconstructed?: boolean;
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
        include: { season: true, messages: { orderBy: { messageNo: "asc" }, include: { player: { select: { id: true, username: true, icon: true, color: true } }, character: true, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } } } },
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
            slug: data.slug ?? `${slugify(data.title)}`,
            reconstructed: data.reconstructed ?? false,
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
            slug: data.slug,
            reconstructed: data.reconstructed,
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

export type EpisodeImport = {
    seasonTitle: string;
    episode: Omit<EpisodeData, "seasonTitle">;
    messages: MessageData[];
};

/**
 * Atomic whole-episode import: the season (created if missing), the episode
 * and every message in one transaction, so it lands complete or not at all.
 * Rejects (409) a title or slug already in use, or an episode number the
 * season already has.
 */
async function importEpisode(body: EpisodeImport) {
    await validateEpisodeImport(body);
    return await prisma.$transaction((tx) => importEpisodeTx(tx, body), IMPORT_TX_OPTIONS);
}

/** Shape checks for an EpisodeImport; `checkPersonas` as in validateMessages. */
export async function validateEpisodeImport(body: EpisodeImport, { checkPersonas = true } = {}): Promise<void> {
    const { seasonTitle, episode, messages } = body ?? ({} as EpisodeImport);
    if (typeof seasonTitle !== "string" || !seasonTitle) throw new Error("seasonTitle is required");
    if (!episode || typeof episode.title !== "string" || !episode.title) throw new Error("episode.title is required");
    if (!Number.isInteger(episode.episode_no)) throw new Error("episode.episode_no must be an integer");
    if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages must be a non-empty array");
    await validateMessages(messages, { checkPersonas });
}

/** importEpisode's writes, inside the caller's transaction (body already validated). */
export async function importEpisodeTx(tx: Prisma.TransactionClient, body: EpisodeImport) {
    const { seasonTitle, episode, messages } = body;
    const slug = episode.slug ?? slugify(episode.title);

    const byTitle = await tx.episode.findUnique({ where: { title: episode.title }, select: { title: true } });
    if (byTitle) throw new ImportConflictError(`An episode titled '${episode.title}' is already in the archive`);
    const bySlug = await tx.episode.findUnique({ where: { slug }, select: { title: true } });
    if (bySlug) throw new ImportConflictError(`Episode '${bySlug.title}' already uses the slug '${slug}'`);
    const byNumber = await tx.episode.findUnique({
        where: { seasonTitle_episode_no: { seasonTitle, episode_no: episode.episode_no } },
        select: { title: true },
    });
    if (byNumber) {
        throw new ImportConflictError(`${seasonTitle} already has an episode #${episode.episode_no} ('${byNumber.title}')`);
    }

    const season = await tx.season.findUnique({ where: { title: seasonTitle }, select: { title: true } });
    if (!season) await tx.season.create({ data: { title: seasonTitle, slug: slugify(seasonTitle) } });

    const created = await tx.episode.create({
        data: {
            title: episode.title,
            seasonTitle,
            episode_no: episode.episode_no,
            summary: episode.summary,
            playedDate: episode.playedDate ? new Date(episode.playedDate) : undefined,
            slug,
            reconstructed: episode.reconstructed ?? false,
        },
        include: { season: true },
    });
    await insertMessages(tx, episode.title, 1, messages);
    return { ...created, messageCount: messages.length, seasonCreated: !season };
}

export default { getAllEpisodes, getEpisodeByTitle, createEpisode, updateEpisode, deleteEpisode, importEpisode };
