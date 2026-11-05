import { MessageType, Prisma } from "@prisma/client";
import { prisma } from "../db.js";


const PERSONA_SELECT = { select: { id: true, name: true, image: true, color: true } };

export type MessageData = {
    playerId: number;
    characterId?: number | null;
    personaId?: number | null;
    timestamp: string;
    type: MessageType;
    text: string;
};

// A message's personaId, if set, must belong to the same characterId the
// message is (or is being) attributed to, where an NPC persona (characterId
// null) only goes on a line with no character: "null == null". `prefix` lets
// bulk import include the message index in the thrown error, matching the
// QUOTE check. The messages_persona_match trigger
// (prisma/scripts/create-triggers.ts) enforces the same rule in the DB; this
// stays for a friendly error instead of a raw trigger exception.
async function assertPersonaMatchesCharacter(
    personaId: number | null | undefined,
    characterId: number | null | undefined,
    prefix = ""
): Promise<void> {
    if (personaId === undefined || personaId === null) return;
    const persona = await prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) {
        throw new Error(`${prefix}Persona with id '${personaId}' not found`);
    }
    if ((persona.characterId ?? null) !== (characterId ?? null)) {
        throw new Error(
            persona.characterId === null
                ? `${prefix}Persona with id '${personaId}' is an NPC voice, so the message can't also have a character`
                : `${prefix}Persona with id '${personaId}' does not belong to character '${characterId ?? "none"}'`
        );
    }
}

// FR-MSG-4: a QUOTE needs a voice, either a character or an NPC persona.
function assertQuoteHasVoice(type: MessageType | undefined, characterId: number | null | undefined, personaId: number | null | undefined, prefix = ""): void {
    if (type === MessageType.QUOTE && !characterId && !personaId) {
        throw new Error(`${prefix}characterId or personaId is required for QUOTE messages`);
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
            include: { player: { select: { id: true, username: true, icon: true, color: true } }, character: true, persona: PERSONA_SELECT, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
        }),
        prisma.message.count({ where }),
    ]);
    return { data, total, page, limit };
}

async function getMessageByNo(episodeTitle: string, messageNo: number) {
    return await prisma.message.findUnique({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
        include: { player: { select: { id: true, username: true, icon: true, color: true } }, character: true, persona: PERSONA_SELECT, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
    });
}

async function getQuotesByCharacter(characterId: number) {
    return await prisma.message.findMany({
        where: { characterId, type: MessageType.QUOTE },
        orderBy: { timestamp: "asc" },
        include: { episode: true, persona: PERSONA_SELECT },
    });
}

type MessageHit = {
    episodeTitle: string;
    episodeNo: number;
    messageNo: number;
    text: string;
    type: MessageType;
};

// Backs the unified /api/search endpoint. Full-text (not substring) match —
// stemmed keyword search via to_tsvector/plainto_tsquery, ranked by ts_rank
// and backed by the GIN expression index from prisma/scripts/create-search-indexes.ts
// (Prisma's @@index can't express an expression index, so this can't live in
// schema.prisma). The 'english' regconfig literal here must byte-match the
// index's expression for Postgres to use it — don't parameterize it.
// ts_rank ties are otherwise Postgres-arbitrary, which would make OFFSET/
// LIMIT paging duplicate or skip rows across pages — "messageNo" ASC breaks
// ties deterministically.
async function searchMessages(
    query: string,
    page = 1,
    limit = 20
): Promise<{ data: MessageHit[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const [data, countResult] = await Promise.all([
        prisma.$queryRaw<MessageHit[]>`
            SELECT "episodeTitle",
                (SELECT "episode_no" FROM episodes WHERE title = messages."episodeTitle") AS "episodeNo",
                "messageNo", text, type
            FROM messages
            WHERE to_tsvector('english', text) @@ plainto_tsquery('english', ${query})
            ORDER BY ts_rank(to_tsvector('english', text), plainto_tsquery('english', ${query})) DESC, "episodeNo" ASC, "messageNo" ASC
            LIMIT ${limit} OFFSET ${skip}
        `,
        prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) AS count
            FROM messages
            WHERE to_tsvector('english', text) @@ plainto_tsquery('english', ${query})
        `,
    ]);
    return { data, total: Number(countResult[0]?.count ?? 0), page, limit };
}

// Character quotes only: NPC lines (no characterId) are left out.
async function getRandomQuote() {
    const where = { type: MessageType.QUOTE, characterId: { not: null } };
    const count = await prisma.message.count({ where });
    if (count === 0) return null;
    const skip = Math.floor(Math.random() * count);
    const quotes = await prisma.message.findMany({
        where,
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
    await validateMessages(messages);

    return await prisma.$transaction(async (tx) => {
        const episode = await tx.episode.findUnique({ where: { title: episodeTitle } });
        if (!episode) throw new Error(`Episode '${episodeTitle}' not found`);

        const last = await tx.message.findFirst({
            where: { episodeTitle },
            orderBy: { messageNo: "desc" },
        });
        const firstMessageNo = (last?.messageNo ?? 0) + 1;
        await insertMessages(tx, episodeTitle, firstMessageNo, messages);
        return { count: messages.length, firstMessageNo, lastMessageNo: firstMessageNo + messages.length - 1 };
    });
}

/** Rejects a bulk message batch before anything is written (shared by append and atomic episode import). */
export async function validateMessages(messages: MessageData[]): Promise<void> {
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
        assertQuoteHasVoice(msg.type, msg.characterId, msg.personaId, `Message ${index + 1}: `);
        await assertPersonaMatchesCharacter(msg.personaId, msg.characterId, `Message ${index + 1}: `);
    }
}

/** Writes already-validated messages with sequential messageNos, inside the caller's transaction. */
export async function insertMessages(
    tx: Prisma.TransactionClient,
    episodeTitle: string,
    firstMessageNo: number,
    messages: MessageData[]
): Promise<void> {
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
}

async function createMessage(episodeTitle: string, data: MessageData) {
    assertQuoteHasVoice(data.type, data.characterId, data.personaId);
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
        include: { player: { select: { id: true, username: true, icon: true, color: true } }, character: true, persona: PERSONA_SELECT, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
    });
}

async function updateMessage(episodeTitle: string, messageNo: number, data: Partial<MessageData>) {
    // A partial update is checked against the message as it will be: the
    // patch laid over the stored row, so e.g. `{characterId: null}` alone
    // can't leave a QUOTE without a voice.
    const existing = await prisma.message.findUnique({
        where: { episodeTitle_messageNo: { episodeTitle, messageNo } },
    });
    if (!existing) {
        throw new Error(`Message ${messageNo} of episode '${episodeTitle}' not found`);
    }
    const effective = {
        type: data.type ?? existing.type,
        characterId: data.characterId !== undefined ? data.characterId : existing.characterId,
        personaId: data.personaId !== undefined ? data.personaId : existing.personaId,
    };
    assertQuoteHasVoice(effective.type, effective.characterId, effective.personaId);
    if (data.characterId !== undefined || data.personaId !== undefined) {
        await assertPersonaMatchesCharacter(effective.personaId, effective.characterId);
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
        include: { player: { select: { id: true, username: true, icon: true, color: true } }, character: true, persona: PERSONA_SELECT, commentaries: { include: { creator: { select: { id: true, username: true, icon: true } } } } },
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
