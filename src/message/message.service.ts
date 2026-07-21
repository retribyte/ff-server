import { PrismaClient, MessageType } from "@prisma/client";

const prisma = new PrismaClient();

const PERSONA_SELECT = { select: { id: true, name: true, image: true, color: true } };

type MessageData = {
    playerId: number;
    characterId?: number;
    personaId?: number;
    timestamp: string;
    type: MessageType;
    text: string;
};

// A message's personaId, if set, must belong to the same characterId the
// message is (or is being) attributed to. `prefix` lets bulk import include
// the message index in the thrown error, matching the existing QUOTE check.
// The composite FK (Message.personaId+characterId -> Persona.id+characterId,
// see schema.prisma) makes this unrepresentable at the DB level too — this
// stays for a friendly error message instead of a raw Prisma FK violation.
async function assertPersonaMatchesCharacter(
    personaId: number | null | undefined,
    characterId: number | null | undefined,
    prefix = ""
): Promise<void> {
    if (personaId === undefined || personaId === null) return;
    if (!characterId) {
        throw new Error(`${prefix}characterId is required when personaId is set`);
    }
    const persona = await prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) {
        throw new Error(`${prefix}Persona with id '${personaId}' not found`);
    }
    if (persona.characterId !== characterId) {
        throw new Error(`${prefix}Persona with id '${personaId}' does not belong to character '${characterId}'`);
    }
}

async function getMessagesByEpisode(episodeTitle: string, page = 1, limit = 100, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = { episodeTitle };
    if (search) where.text = { contains: search };
    const [data, total] = await Promise.all([
        prisma.message.findMany({
            where,
            orderBy: { messageNo: "asc" },
            skip,
            take: limit,
            include: { player: { select: { id: true, username: true, icon: true } }, character: true, persona: PERSONA_SELECT, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
        }),
        prisma.message.count({ where }),
    ]);
    return { data, total, page, limit };
}

async function getMessageByNo(episodeTitle: string, messageNo: number) {
    return await prisma.message.findUnique({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true, persona: PERSONA_SELECT, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
    });
}

async function getQuotesByCharacter(characterId: number) {
    return await prisma.message.findMany({
        where: { characterId, type: MessageType.QUOTE },
        orderBy: { timestamp: "asc" },
        include: { episode: true, persona: PERSONA_SELECT },
    });
}

type MessageHit = { episodeTitle: string; messageNo: number; text: string };

// Backs the unified /api/search endpoint. Full-text (not substring) match —
// stemmed keyword search via to_tsvector/plainto_tsquery, ranked by ts_rank
// and backed by the GIN expression index from prisma/create-search-indexes.ts
// (Prisma's @@index can't express an expression index, so this can't live in
// schema.prisma). The 'english' regconfig literal here must byte-match the
// index's expression for Postgres to use it — don't parameterize it.
async function searchMessages(query: string, limit: number): Promise<MessageHit[]> {
    return prisma.$queryRaw<MessageHit[]>`
        SELECT "episodeTitle", "messageNo", text
        FROM messages
        WHERE to_tsvector('english', text) @@ plainto_tsquery('english', ${query})
        ORDER BY ts_rank(to_tsvector('english', text), plainto_tsquery('english', ${query})) DESC
        LIMIT ${limit}
    `;
}

async function getRandomQuote() {
    const count = await prisma.message.count({ where: { type: MessageType.QUOTE } });
    if (count === 0) return null;
    const skip = Math.floor(Math.random() * count);
    const quotes = await prisma.message.findMany({
        where: { type: MessageType.QUOTE },
        skip,
        take: 1,
        include: { character: true, episode: true, persona: PERSONA_SELECT },
    });
    return quotes[0] ?? null;
}

const VALID_TYPES = new Set<string>(Object.values(MessageType));

/**
 * Bulk-append messages to an episode (transcript import). Sequential
 * messageNos are assigned after the episode's current maximum, inside a
 * transaction so concurrent imports can't collide.
 */
async function createMessages(episodeTitle: string, messages: MessageData[]) {
    for (const [index, msg] of messages.entries()) {
        if (!VALID_TYPES.has(msg.type)) {
            throw new Error(`Message ${index + 1}: invalid type '${msg.type}'`);
        }
        if (typeof msg.playerId !== "number") {
            throw new Error(`Message ${index + 1}: playerId is required`);
        }
        if (typeof msg.text !== "string") {
            throw new Error(`Message ${index + 1}: text is required`);
        }
        if (msg.type === MessageType.QUOTE && !msg.characterId) {
            throw new Error(`Message ${index + 1}: characterId is required for QUOTE messages`);
        }
        await assertPersonaMatchesCharacter(msg.personaId, msg.characterId, `Message ${index + 1}: `);
    }

    return await prisma.$transaction(async (tx) => {
        const episode = await tx.episode.findUnique({ where: { title: episodeTitle } });
        if (!episode) throw new Error(`Episode '${episodeTitle}' not found`);

        const last = await tx.message.findFirst({
            where: { episodeTitle },
            orderBy: { messageNo: "desc" },
        });
        const firstMessageNo = (last?.messageNo ?? 0) + 1;

        await tx.message.createMany({
            data: messages.map((msg, index) => ({
                episodeTitle,
                messageNo: firstMessageNo + index,
                playerId: msg.playerId,
                characterId: msg.characterId ?? null,
                personaId: msg.personaId ?? null,
                timestamp: msg.timestamp ? new Date(msg.timestamp) : null,
                type: msg.type,
                text: msg.text,
            })),
        });

        return { count: messages.length, firstMessageNo, lastMessageNo: firstMessageNo + messages.length - 1 };
    });
}

async function createMessage(episodeTitle: string, data: MessageData) {
    if (data.type === MessageType.QUOTE && !data.characterId) {
        throw new Error("characterId is required for QUOTE messages");
    }
    await assertPersonaMatchesCharacter(data.personaId, data.characterId);

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
            personaId: data.personaId,
            timestamp: new Date(data.timestamp),
            type: data.type,
            text: data.text,
        },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true, persona: PERSONA_SELECT, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
    });
}

async function updateMessage(episodeTitle: string, messageNo: number, data: Partial<MessageData>) {
    if (data.type === MessageType.QUOTE && !data.characterId) {
        throw new Error("characterId is required for QUOTE messages");
    }

    if (data.personaId !== undefined && data.personaId !== null) {
        // characterId may not be part of this partial update — fall back to
        // the message's existing characterId so the persona check still sees
        // the character the message is actually attributed to.
        const effectiveCharacterId =
            data.characterId !== undefined
                ? data.characterId
                : (
                      await prisma.message.findUnique({
                          where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
                      })
                  )?.characterId;
        await assertPersonaMatchesCharacter(data.personaId, effectiveCharacterId);
    }

    return await prisma.message.update({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
        data: {
            playerId: data.playerId,
            characterId: data.characterId,
            personaId: data.personaId,
            timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
            type: data.type,
            text: data.text,
        },
        include: { player: { select: { id: true, username: true, icon: true } }, character: true, persona: PERSONA_SELECT, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
    });
}

async function deleteMessage(episodeTitle: string, messageNo: number): Promise<void> {
    await prisma.message.delete({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
    });
}

// --- Bulk persona stamping (write-time "set it once" path, PLAN-alias.md §4) ---
// personaId: null clears every matching message back to canonical
// (character-only) attribution. Both variants revalidate character/persona
// existence and ownership even though the controller already checked them
// for the auth decision, matching the redundant-but-self-contained
// validation style used elsewhere (e.g. Persona create/update).

async function applyPersonaToEpisode(
    episodeTitle: string,
    characterId: number,
    personaId: number | null
): Promise<number> {
    const episode = await prisma.episode.findUnique({ where: { title: episodeTitle } });
    if (!episode) {
        throw new Error(`Episode '${episodeTitle}' not found`);
    }
    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
        throw new Error(`Character with id '${characterId}' not found`);
    }
    await assertPersonaMatchesCharacter(personaId, characterId);

    const { count } = await prisma.message.updateMany({
        where: { episodeTitle, characterId },
        data: { personaId },
    });
    return count;
}

async function applyPersonaToSeason(
    seasonTitle: string,
    characterId: number,
    personaId: number | null
): Promise<number> {
    const season = await prisma.season.findUnique({ where: { title: seasonTitle } });
    if (!season) {
        throw new Error(`Season '${seasonTitle}' not found`);
    }
    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
        throw new Error(`Character with id '${characterId}' not found`);
    }
    await assertPersonaMatchesCharacter(personaId, characterId);

    const { count } = await prisma.message.updateMany({
        where: { characterId, episode: { seasonTitle } },
        data: { personaId },
    });
    return count;
}

export default {
    getMessagesByEpisode,
    getMessageByNo,
    getQuotesByCharacter,
    getRandomQuote,
    searchMessages,
    createMessage,
    createMessages,
    updateMessage,
    deleteMessage,
    applyPersonaToEpisode,
    applyPersonaToSeason,
};
