import { SeasonKind } from "@prisma/client";
import { prisma } from "../db.js";
import { slugify } from "../utils/slug.js";


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

type CastMember = {
    id: number;
    name: string;
    slug: string;
    image: string | null;
    color: string | null;
    messageCount: number; // QUOTE + ACTION messages in this campaign
    topEpisodes: number; // episodes it was its player's most active character in
    manual: boolean; // listed because an admin added it (Character.mainIn)
};

/**
 * A campaign's cast: each player's most active character per episode (QUOTE +
 * ACTION messages) plus admin-added ones (mainIn), most messages first, and
 * per episode title the ids of the ones that led it. null for an unknown season.
 */
async function getSeasonCast(titleOrSlug: string) {
    const season = await prisma.season.findFirst({
        where: { OR: [{ title: titleOrSlug }, { slug: titleOrSlug }] },
        select: { title: true },
    });
    if (!season) return null;
    const title = season.title;

    const rows = await prisma.$queryRaw<{ episodeTitle: string; characterId: number; n: bigint; top: boolean }[]>`
        WITH per_ep AS (
            SELECT m."episodeTitle", m."playerId", m."characterId", COUNT(*) AS n
            FROM messages m JOIN episodes e ON e.title = m."episodeTitle"
            WHERE e."seasonTitle" = ${title}
              AND m."characterId" IS NOT NULL
              AND m.type IN ('QUOTE', 'ACTION')
            GROUP BY 1, 2, 3
        ),
        top AS (
            SELECT DISTINCT ON ("episodeTitle", "playerId") "episodeTitle", "characterId"
            FROM per_ep
            ORDER BY "episodeTitle", "playerId", n DESC, "characterId"
        ),
        manual AS (
            SELECT "A" AS "characterId" FROM "_MainCharacters" WHERE "B" = ${title}
        )
        -- every (episode, character) a cast member speaks in, flagged when it led the episode
        SELECT p."episodeTitle", p."characterId", SUM(p.n) AS n,
               EXISTS (SELECT 1 FROM top t WHERE t."episodeTitle" = p."episodeTitle" AND t."characterId" = p."characterId") AS top
        FROM per_ep p
        WHERE p."characterId" IN (SELECT "characterId" FROM top UNION SELECT "characterId" FROM manual)
        GROUP BY 1, 2
    `;
    const manualIds = new Set(
        (await prisma.character.findMany({ where: { mainIn: { some: { title } } }, select: { id: true } })).map((c) => c.id)
    );

    const totals = new Map<number, { messages: number; topEpisodes: number }>();
    const byEpisode: Record<string, { id: number; n: number }[]> = {};
    for (const r of rows) {
        const n = Number(r.n);
        const t = totals.get(r.characterId) ?? { messages: 0, topEpisodes: 0 };
        t.messages += n;
        if (r.top) t.topEpisodes += 1;
        totals.set(r.characterId, t);
        // An episode lists the characters that led it, plus admin-added ones that speak in it
        if (r.top || manualIds.has(r.characterId)) (byEpisode[r.episodeTitle] ??= []).push({ id: r.characterId, n });
    }
    // Admin-added characters with no lines in this campaign still belong to it
    for (const id of manualIds) if (!totals.has(id)) totals.set(id, { messages: 0, topEpisodes: 0 });

    const characters = await prisma.character.findMany({
        where: { id: { in: [...totals.keys()] } },
        select: { id: true, name: true, slug: true, image: true, color: true, colorLight: true },
    });
    const cast: CastMember[] = characters
        .map((c) => ({
            ...c,
            messageCount: totals.get(c.id)!.messages,
            topEpisodes: totals.get(c.id)!.topEpisodes,
            manual: manualIds.has(c.id),
        }))
        .sort((a, b) => b.messageCount - a.messageCount || a.name.localeCompare(b.name));

    return {
        season: title,
        characters: cast,
        byEpisode: Object.fromEntries(
            Object.entries(byEpisode).map(([ep, list]) => [ep, list.sort((a, b) => b.n - a.n || a.id - b.id).map((x) => x.id)])
        ),
    };
}

async function deleteSeason(title: string): Promise<void> {
    await prisma.season.delete({ where: { title } });
}

export default { getAllSeasons, getSeasonByTitle, getSeasonCast, createSeason, updateSeason, deleteSeason };
