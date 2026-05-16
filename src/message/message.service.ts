import { PrismaClient, MessageType } from "@prisma/client";

const prisma = new PrismaClient();

type MessageData = {
    playerId: number;
    characterId?: number;
    timestamp: string;
    type: MessageType;
    text: string;
};

async function getMessagesByEpisode(episodeTitle: string, page = 1, limit = 100, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = { episodeTitle };
    if (search) where.text = { contains: search, mode: "insensitive" };
    const [data, total] = await Promise.all([
        prisma.message.findMany({
            where,
            orderBy: { messageNo: "asc" },
            skip,
            take: limit,
            include: { player: { select: { id: true, username: true, icon: true } }, character: true, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
        }),
        prisma.message.count({ where }),
    ]);
    return { data, total, page, limit };
}

async function getMessageByNo(episodeTitle: string, messageNo: number) {
    return await prisma.message.findUnique({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
    });
}

async function getQuotesByCharacter(characterId: number) {
    return await prisma.message.findMany({
        where: { characterId, type: MessageType.QUOTE },
        orderBy: { timestamp: "asc" },
        include: { episode: true },
    });
}

async function getRandomQuote() {
    const count = await prisma.message.count({ where: { type: MessageType.QUOTE } });
    if (count === 0) return null;
    const skip = Math.floor(Math.random() * count);
    const quotes = await prisma.message.findMany({
        where: { type: MessageType.QUOTE },
        skip,
        take: 1,
        include: { character: true, episode: true },
    });
    return quotes[0] ?? null;
}

async function createMessage(episodeTitle: string, data: MessageData) {
    if (data.type === MessageType.QUOTE && !data.characterId) {
        throw new Error("characterId is required for QUOTE messages");
    }

    const last = await prisma.message.findFirst({
        where: { episodeTitle },
        orderBy: { messageNo: "desc" },
    });
    const messageNo = (last?.messageNo ?? 0) + 1;

    return await prisma.message.create({
        data: {
            episodeTitle,
            messageNo,
            playerId: data.playerId,
            characterId: data.characterId,
            timestamp: new Date(data.timestamp),
            type: data.type,
            text: data.text,
        },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
    });
}

async function updateMessage(episodeTitle: string, messageNo: number, data: Partial<MessageData>) {
    if (data.type === MessageType.QUOTE && !data.characterId) {
        throw new Error("characterId is required for QUOTE messages");
    }

    return await prisma.message.update({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
        data: {
            playerId: data.playerId,
            characterId: data.characterId,
            timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
            type: data.type,
            text: data.text,
        },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
    });
}

async function deleteMessage(episodeTitle: string, messageNo: number): Promise<void> {
    await prisma.message.delete({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
    });
}

export default {
    getMessagesByEpisode,
    getMessageByNo,
    getQuotesByCharacter,
    getRandomQuote,
    createMessage,
    updateMessage,
    deleteMessage,
};
