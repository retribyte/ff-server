import { PrismaClient } from "@prisma/client";
import { sanitizeText } from "../utils/sanitize.js";

const prisma = new PrismaClient();

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

async function deleteCommentary(id: number): Promise<void> {
    await prisma.commentary.delete({ where: { id } });
}

export default {
    getCommentaryById,
    createCommentary,
    updateCommentary,
    deleteCommentary,
};
