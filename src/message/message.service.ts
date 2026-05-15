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
            orderBy: { message_no: "asc" },
            skip,
            take: limit,
            include: { player: { select: { id: true, username: true, icon: true } }, character: true },
        }),
        prisma.message.count({ where }),
    ]);
    return { data, total, page, limit };
}

async function getMessageByNo(episodeTitle: string, message_no: number) {
    return await prisma.message.findUnique({
        where: { episodeTitle_message_no: { episodeTitle, message_no } },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true },
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
        orderBy: { message_no: "desc" },
    });
    const message_no = (last?.message_no ?? 0) + 1;

    return await prisma.message.create({
        data: {
            episodeTitle,
            message_no,
            playerId: data.playerId,
            characterId: data.characterId,
            timestamp: new Date(data.timestamp),
            type: data.type,
            text: data.text,
        },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true },
    });
}

async function updateMessage(episodeTitle: string, message_no: number, data: Partial<MessageData>) {
    if (data.type === MessageType.QUOTE && !data.characterId) {
        throw new Error("characterId is required for QUOTE messages");
    }

    return await prisma.message.update({
        where: { episodeTitle_message_no: { episodeTitle, message_no } },
        data: {
            playerId: data.playerId,
            characterId: data.characterId,
            timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
            type: data.type,
            text: data.text,
        },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true },
    });
}

async function deleteMessage(episodeTitle: string, message_no: number): Promise<void> {
    await prisma.message.delete({
        where: { episodeTitle_message_no: { episodeTitle, message_no } },
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
