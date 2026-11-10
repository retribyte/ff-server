import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { direction, seasonOrderKeys, type SearchOptions } from "../search/search-options.js";
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

type CommentaryHit = {
    id: number;
    content: string;
    author: string;
    episodeTitle: string;
    episodeNo: number;
    episodeSlug: string | null;
    seasonTitle: string;
    messageNo: number;
};

// Full-text search over note text (tags stripped; notes are few, so no
// expression index), with the same sort/exclude options as the other categories
async function searchCommentaries(
    query: string,
    page = 1,
    limit = 20,
    options: SearchOptions = {}
): Promise<{ data: CommentaryHit[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const exclude = options.exclude ?? [];
    const doc = Prisma.sql`to_tsvector('english', regexp_replace(c.content, '<[^>]*>', ' ', 'g'))`;
    const where = Prisma.sql`${doc} @@ plainto_tsquery('english', ${query}) AND s.slug <> ALL(${exclude}::text[])`;
    const order =
        options.sort === "appearance"
            ? Prisma.sql`${seasonOrderKeys('e."seasonTitle"', options.dir ?? "asc")}, e.episode_no ${direction(options.dir)}, c."messageNo" ${direction(options.dir)}, c.id ${direction(options.dir)}`
            : Prisma.sql`ts_rank(${doc}, plainto_tsquery('english', ${query})) DESC, c.id DESC`;
    const from = Prisma.sql`FROM commentaries c
        JOIN episodes e ON e.title = c."messageEpisodeTitle"
        JOIN seasons s ON s.title = e."seasonTitle"
        JOIN "User" u ON u.id = c."creatorId"`;
    const [data, countResult] = await Promise.all([
        prisma.$queryRaw<CommentaryHit[]>`
            SELECT c.id, c.content, u.username AS author, c."messageEpisodeTitle" AS "episodeTitle",
                e.episode_no AS "episodeNo", e.slug AS "episodeSlug", e."seasonTitle", c."messageNo"
            ${from}
            WHERE ${where}
            ORDER BY ${order}
            LIMIT ${limit} OFFSET ${skip}
        `,
        prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count ${from} WHERE ${where}`,
    ]);
    return { data, total: Number(countResult[0]?.count ?? 0), page, limit };
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
    searchCommentaries,
    NOTE_MESSAGE_INCLUDE,
};
