import { prisma } from "../db.js";
import { sanitizeText } from "../utils/sanitize.js";


const CREATOR_SELECT = { select: { id: true, username: true, icon: true } };

async function getCommentaryById(id: number) {
    return await prisma.commentary.findUnique({
        where: { id },
        include: { creator: CREATOR_SELECT },
    });
}

async function createCommentary(episodeTitle: string, messageNo: number, creatorId: number, content: string) {
    const message = await prisma.message.findUnique({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
    });
    if (!message) return null;

    return await prisma.commentary.create({
        data: {
            messageEpisodeTitle: episodeTitle,
            messageNo,
            creatorId,
            content: sanitizeText(content),
        },
        include: { creator: CREATOR_SELECT },
    });
}

async function updateCommentary(id: number, content: string) {
    return await prisma.commentary.update({
        where: { id },
        data: { content: sanitizeText(content) },
        include: { creator: CREATOR_SELECT },
    });
}

// The line a note sits on, with enough of its episode to link and label it
const NOTE_MESSAGE_INCLUDE = {
    message: {
        select: {
            messageNo: true,
            type: true,
            text: true,
            character: { select: { id: true, name: true, slug: true } },
            persona: { select: { name: true } },
            player: { select: { username: true } },
            episode: { select: { title: true, slug: true, episode_no: true, seasonTitle: true, reconstructed: true } },
        },
    },
} as const;

// Every note a user wrote, newest first (ids are the only order notes keep).
// `user` is an id or a username, as GET /users/:id takes; null if no such user.
async function getCommentariesByCreator(user: number | string) {
    const found = await prisma.user.findUnique({
        where: typeof user === "number" ? { id: user } : { username: user },
        select: { id: true },
    });
    if (!found) return null;
    return await prisma.commentary.findMany({
        where: { creatorId: found.id },
        orderBy: { id: "desc" },
        include: { creator: CREATOR_SELECT, ...NOTE_MESSAGE_INCLUDE },
    });
}

async function deleteCommentary(id: number): Promise<void> {
    await prisma.commentary.delete({ where: { id } });
}

export default {
    getCommentaryById,
    createCommentary,
    updateCommentary,
    deleteCommentary,
    getCommentariesByCreator,
    NOTE_MESSAGE_INCLUDE,
};
