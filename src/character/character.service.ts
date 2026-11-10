import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { sanitizeText } from "../utils/sanitize.js";
import { isValidSlug, normalizeSlug, slugify } from "../utils/slug.js";
import { getWikiData } from "../wiki/wiki.service.js";
import { storeAvatarUpload } from "./avatar.service.js";


type CharacterData = {
    name: string;
    blurb?: string;
    image?: string;
    color?: string;
    colorLight?: string | null;
    slug?: string;
    creatorId: number;
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** A light-mode color as stored: a #rrggbb hex, or null ("" clears it too). */
function lightColor(value: unknown): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (typeof value !== "string" || !HEX_COLOR.test(value)) throw new Error("colorLight must be a #rrggbb color");
    return value;
}

type CharacterFilters = {
    search?: string;
    ownerId?: number;
    season?: string;
    // limit/lite: additive, unified-/api/search-only (a narrower select
    // shape + a result cap). Omitted by every existing caller, so their
    // result set is otherwise unchanged.
    limit?: number;
    lite?: boolean;
};

// Titles of the seasons each character speaks in (via messages), keyed by
// character id. The site picks the earliest with its own campaign ordering.
async function seasonsByCharacter(ids: number[]): Promise<Map<number, string[]>> {
    const map = new Map<number, string[]>();
    if (ids.length === 0) return map;
    const rows = await prisma.$queryRaw<{ characterId: number; seasonTitle: string }[]>`
        SELECT DISTINCT m."characterId", e."seasonTitle"
        FROM messages m JOIN episodes e ON e.title = m."episodeTitle"
        WHERE m."characterId" IN (${Prisma.join(ids)})
    `;
    for (const r of rows) map.set(r.characterId, [...(map.get(r.characterId) ?? []), r.seasonTitle]);
    return map;
}

// First appearance in a campaign. episodeNo/messageNo null = story-only;
// season null = a story outside any campaign.
type Appearance = { season: string | null; episodeNo: number | null; messageNo: number | null; reconstructed?: boolean };

// quoteWordCount: non-whitespace runs; in a story paragraph, only the character's own spans
type CharacterStats = { quoteCount: number; quoteWordCount: number; appearances: Appearance[] };

// Quote counts, word counts and first appearances for many characters at once.
// Quotes are QUOTE messages plus story lines the character speaks.
async function statsByCharacter(ids: number[]): Promise<Map<number, CharacterStats>> {
    const map = new Map<number, CharacterStats>(ids.map((id) => [id, { quoteCount: 0, quoteWordCount: 0, appearances: [] }]));
    if (ids.length === 0) return map;
    const idList = Prisma.join(ids);
    const [messageQuotes, firstMessages, storyLines] = await Promise.all([
        prisma.$queryRaw<{ characterId: number; n: bigint; words: bigint }[]>`
            SELECT m."characterId", COUNT(*) AS n,
                   SUM((SELECT COUNT(*) FROM regexp_matches(m.text, '[^[:space:]]+', 'g'))) AS words
            FROM messages m
            WHERE m.type = 'QUOTE' AND m."characterId" IN (${idList})
            GROUP BY m."characterId"
        `,
        // Archived episodes first; a reconstructed one is only a fallback
        prisma.$queryRaw<{ characterId: number; season: string; episodeNo: number; messageNo: number; reconstructed: boolean }[]>`
            SELECT DISTINCT ON (m."characterId", e."seasonTitle")
                m."characterId", e."seasonTitle" AS season, e.episode_no AS "episodeNo", m."messageNo", e.reconstructed
            FROM messages m JOIN episodes e ON e.title = m."episodeTitle"
            WHERE m."characterId" IN (${idList})
            ORDER BY m."characterId", e."seasonTitle", e.reconstructed, e.episode_no, m."messageNo"
        `,
        prisma.$queryRaw<{ characterId: number; lines: bigint; words: bigint; seasons: (string | null)[] }[]>`
            WITH spoken AS (
                SELECT sl.id, sl."characterId" AS cid
                FROM story_lines sl
                WHERE sl."characterId" IN (${idList})
                UNION
                SELECT ss."lineId", ss."characterId"
                FROM story_segments ss
                WHERE ss."characterId" IN (${idList})
            ),
            -- one row per (line, speaker): a segmented line quotes only that
            -- speaker's spans, any other line its whole text
            quoted AS (
                SELECT sp.cid, sl.id, sl."chapterId",
                    CASE WHEN EXISTS (SELECT 1 FROM story_segments ss WHERE ss."lineId" = sl.id) THEN (
                        SELECT COUNT(*)
                        FROM story_segments ss, regexp_matches(ss.text, '[^[:space:]]+', 'g')
                        WHERE ss."lineId" = sl.id AND ss."characterId" = sp.cid
                    ) ELSE (
                        SELECT COUNT(*) FROM regexp_matches(sl.text, '[^[:space:]]+', 'g')
                    ) END AS words
                FROM spoken sp JOIN story_lines sl ON sl.id = sp.id
            )
            SELECT q.cid AS "characterId", COUNT(*) AS lines, SUM(q.words) AS words,
                   array_agg(DISTINCT s."seasonTitle") AS seasons
            FROM quoted q
            JOIN story_chapters sc ON sc.id = q."chapterId"
            JOIN stories s ON s.id = sc."storyId"
            GROUP BY q.cid
        `,
    ]);
    for (const r of messageQuotes) {
        const stats = map.get(r.characterId)!;
        stats.quoteCount += Number(r.n);
        stats.quoteWordCount += Number(r.words);
    }
    for (const r of firstMessages) {
        map.get(r.characterId)!.appearances.push({ season: r.season, episodeNo: r.episodeNo, messageNo: r.messageNo, reconstructed: r.reconstructed });
    }
    for (const r of storyLines) {
        const stats = map.get(r.characterId)!;
        stats.quoteCount += Number(r.lines);
        stats.quoteWordCount += Number(r.words);
        for (const season of r.seasons) {
            if (!stats.appearances.some((a) => a.season === season)) {
                stats.appearances.push({ season, episodeNo: null, messageNo: null });
            }
        }
    }
    return map;
}

async function withSeasons<T extends { id: number }>(
    characters: T[]
): Promise<(T & { seasons: string[] } & CharacterStats)[]> {
    const ids = characters.map((c) => c.id);
    const [seasons, stats] = await Promise.all([seasonsByCharacter(ids), statsByCharacter(ids)]);
    return characters.map((c) => ({ ...c, seasons: seasons.get(c.id) ?? [], ...stats.get(c.id)! }));
}

async function getAllCharacters(filters: CharacterFilters = {}) {
    const { search, ownerId, season, limit, lite } = filters;
    const where: any = {};

    if (search) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { personas: { some: { name: { contains: search, mode: "insensitive" } } } },
        ];
    }
    if (ownerId !== undefined) where.creatorId = ownerId;
    if (season) {
        where.messages = { some: { episode: { seasonTitle: season } } };
    }

    if (lite) {
        return await prisma.character.findMany({ where, select: { id: true, name: true, slug: true, image: true, color: true, colorLight: true }, take: limit });
    }
    return await withSeasons(await prisma.character.findMany({ where, take: limit, include: { mainIn: MAIN_IN } }));
}

// A character's cast campaigns, by title and slug
const MAIN_IN = { select: { title: true, slug: true }, orderBy: { title: "asc" as const } };

// Character detail shape: personas plus the owning user's public identity.
const detailInclude = {
    personas: true,
    creator: { select: { id: true, username: true, icon: true } },
    mainIn: MAIN_IN,
} as const;

// Attaches wiki-sourced fields under a nullable `wiki` key, keyed off the
// character's own canonical slug — never the raw request param, which may
// be a hyphenated or persona alias (see getCharacterBySlug below). Opt-in:
// callers that only need the record to check ownership (the mutation
// routes in character.controller.ts) skip this so a wiki cache miss never
// blocks a write.
async function attachWikiData<T extends { slug: string }>(character: T): Promise<T & { wiki: Record<string, unknown> | null }> {
    const wiki = await getWikiData("characters", character.slug);
    return { ...character, wiki };
}

async function getCharacterById(id: number, options: { withWiki?: boolean } = {}) {
    const character = await prisma.character.findUnique({ where: { id }, include: detailInclude });
    if (!character) return null;
    return options.withWiki ? await attachWikiData(character) : character;
}

// Falls back to a normalized (hyphen -> underscore) lookup so old
// hyphenated bookmarks from before the slug convention settled still resolve.
// Finally falls back to a Persona slug lookup (same raw-then-normalized
// order), returning the persona's character — e.g. "/characters/vec_fungus"
// resolves to Vec. Only named personas have a slug (name-less look-only
// personas have no URL identity), so this naturally only ever matches those.
async function getCharacterBySlug(slug: string, options: { withWiki?: boolean } = {}) {
    const character = await resolveCharacterBySlug(slug);
    if (!character) return null;
    return options.withWiki ? await attachWikiData(character) : character;
}

async function resolveCharacterBySlug(slug: string) {
    const character = await prisma.character.findUnique({ where: { slug }, include: detailInclude });
    if (character) return character;
    const normalized = normalizeSlug(slug);
    if (normalized !== slug) {
        const byNormalized = await prisma.character.findUnique({
            where: { slug: normalized },
            include: detailInclude,
        });
        if (byNormalized) return byNormalized;
    }

    const persona = await prisma.persona.findUnique({
        where: { slug },
        include: { character: { include: detailInclude } },
    });
    if (persona) return persona.character;
    if (normalized !== slug) {
        const personaByNormalized = await prisma.persona.findUnique({
            where: { slug: normalized },
            include: { character: { include: detailInclude } },
        });
        if (personaByNormalized) return personaByNormalized.character;
    }

    return null;
}

async function createCharacter(data: CharacterData) {
    return await prisma.character.create({
        data: {
            name: data.name,
            blurb: data.blurb !== undefined ? sanitizeText(data.blurb) : undefined,
            image: await storeAvatarUpload(data.image),
            color: data.color,
            colorLight: lightColor(data.colorLight),
            slug: data.slug ?? slugify(data.name),
            creatorId: data.creatorId,
        },
    });
}

async function updateCharacter(id: number, data: Partial<CharacterData>) {
    return await prisma.character.update({
        where: { id },
        data: {
            name: data.name,
            blurb: data.blurb !== undefined ? sanitizeText(data.blurb) : undefined,
            image: await storeAvatarUpload(data.image),
            color: data.color,
            colorLight: lightColor(data.colorLight),
            slug: data.slug,
        },
    });
}

/** Replaces a character's cast campaigns (titles or slugs). An unknown one throws; nothing changes. */
async function setMainIn(id: number, seasons: unknown) {
    if (!Array.isArray(seasons) || !seasons.every((s) => typeof s === "string")) {
        throw new Error("seasons must be an array of season titles or slugs");
    }
    const found = await prisma.season.findMany({
        where: { OR: [{ title: { in: seasons } }, { slug: { in: seasons } }] },
        select: { title: true, slug: true },
    });
    const unknown = seasons.filter((s) => !found.some((f) => f.title === s || f.slug === s));
    if (unknown.length) throw new Error(`Unknown season(s): ${unknown.join(", ")}`);
    return await prisma.character.update({
        where: { id },
        data: { mainIn: { set: found.map((f) => ({ title: f.title })) } },
        include: detailInclude,
    });
}

/** The character is attributed somewhere in the archive, so it can't be deleted — maps to 409. */
export class CharacterInArchiveError extends Error {}

async function deleteCharacter(id: number): Promise<void> {
    // Archive immutability: a character woven into the archive can't vanish
    // and strip attribution from its lines. Message.character,
    // StoryLine.character and StorySegment.character are onDelete: Restrict
    // (P2003 on delete).
    try {
        await prisma.character.delete({ where: { id } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
            throw new CharacterInArchiveError("This character speaks in the archive, so it can't be deleted");
        }
        throw error;
    }
}

// --- Personas ----------------------------------------------------------

type PersonaData = {
    name?: string;
    label?: string;
    slug?: string;
    image?: string;
    color?: string;
};

// Archive episode a character speaks in, as a link target
type EpisodeRef = { title: string; slug: string; episodeNo: number; messageNo: number; reconstructed: boolean };

type CampaignAppearance = {
    season: string;
    slug: string;
    kind: string;
    /** Episodes the character speaks in, of the campaign's `seasonEpisodes` */
    episodes: number;
    seasonEpisodes: number;
    messages: number;
    /** Archived episodes first, as in statsByCharacter; reconstructed only as a fallback */
    first: EpisodeRef;
    last: EpisodeRef;
};

type CoStar = {
    id: number;
    name: string;
    slug: string;
    image: string | null;
    color: string | null;
    colorLight: string | null;
    /** Episodes both speak in */
    episodes: number;
    /** Stories both speak in (a line or a segmented span) */
    stories: number;
};

const COSTAR_LIMIT = 6;

// The character page's appearance record: per-campaign transcript stats and
// the characters it shares the most episodes and stories with.
async function getAppearances(characterId: number): Promise<{ campaigns: CampaignAppearance[]; costars: CoStar[] }> {
    const [campaigns, costarRows] = await Promise.all([
        prisma.$queryRaw<CampaignAppearance[]>`
            WITH mine AS (
                SELECT m."episodeTitle", m."messageNo", e."seasonTitle", e.episode_no, e.reconstructed, e.slug
                FROM messages m JOIN episodes e ON e.title = m."episodeTitle"
                WHERE m."characterId" = ${characterId}
            ),
            per AS (
                SELECT "seasonTitle",
                    COUNT(DISTINCT "episodeTitle")::int AS episodes,
                    COUNT(*)::int AS messages,
                    (array_agg(json_build_object('title', "episodeTitle", 'slug', slug, 'episodeNo', episode_no,
                        'messageNo', "messageNo", 'reconstructed', reconstructed)
                        ORDER BY reconstructed, episode_no, "messageNo"))[1] AS first,
                    (array_agg(json_build_object('title', "episodeTitle", 'slug', slug, 'episodeNo', episode_no,
                        'messageNo', "messageNo", 'reconstructed', reconstructed)
                        ORDER BY reconstructed DESC, episode_no DESC, "messageNo" DESC))[1] AS last
                FROM mine GROUP BY "seasonTitle"
            )
            SELECT p."seasonTitle" AS season, s.slug, s.kind::text AS kind, p.episodes, p.messages, p.first, p.last,
                (SELECT COUNT(*)::int FROM episodes e WHERE e."seasonTitle" = p."seasonTitle") AS "seasonEpisodes"
            FROM per p JOIN seasons s ON s.title = p."seasonTitle"
        `,
        prisma.$queryRaw<{ id: number; episodes: number; stories: number }[]>`
            WITH my_eps AS (
                SELECT DISTINCT "episodeTitle" FROM messages WHERE "characterId" = ${characterId}
            ),
            ep_shared AS (
                SELECT m."characterId" AS id, COUNT(DISTINCT m."episodeTitle")::int AS n
                FROM messages m JOIN my_eps USING ("episodeTitle")
                WHERE m."characterId" IS NOT NULL AND m."characterId" <> ${characterId}
                GROUP BY 1
            ),
            -- (story, speaker) pairs: whole lines plus segmented spans
            speakers AS (
                SELECT DISTINCT sc."storyId", x.cid
                FROM story_lines sl
                JOIN story_chapters sc ON sc.id = sl."chapterId"
                CROSS JOIN LATERAL (
                    SELECT sl."characterId" AS cid WHERE sl."characterId" IS NOT NULL
                    UNION
                    SELECT ss."characterId" FROM story_segments ss
                    WHERE ss."lineId" = sl.id AND ss."characterId" IS NOT NULL
                ) x
            ),
            story_shared AS (
                SELECT o.cid AS id, COUNT(*)::int AS n
                FROM speakers me JOIN speakers o ON o."storyId" = me."storyId" AND o.cid <> me.cid
                WHERE me.cid = ${characterId}
                GROUP BY 1
            )
            SELECT COALESCE(e.id, s.id) AS id, COALESCE(e.n, 0) AS episodes, COALESCE(s.n, 0) AS stories
            FROM ep_shared e FULL JOIN story_shared s ON s.id = e.id
            ORDER BY COALESCE(e.n, 0) + COALESCE(s.n, 0) DESC, COALESCE(e.id, s.id)
            LIMIT ${COSTAR_LIMIT}
        `,
    ]);

    const characters = await prisma.character.findMany({
        where: { id: { in: costarRows.map((r) => r.id) } },
        select: { id: true, name: true, slug: true, image: true, color: true, colorLight: true },
    });
    const byId = new Map(characters.map((c) => [c.id, c]));
    const costars = costarRows.flatMap((r) => {
        const c = byId.get(r.id);
        return c ? [{ ...c, episodes: r.episodes, stories: r.stories }] : [];
    });
    return { campaigns, costars };
}

async function getPersonasByCharacter(characterId: number) {
    return await prisma.persona.findMany({ where: { characterId }, orderBy: { id: "asc" } });
}

// Full index of every persona, for callers (e.g. the transcript importer)
// that need to match speaker names against all characters in one call
// instead of N+1-ing over getPersonasByCharacter. No pagination — persona
// counts stay small. NPC personas (characterId null) are included; `npc`
// narrows to just them (true) or just character personas (false).
async function getAllPersonas(search?: string, npc?: boolean) {
    const where: Prisma.PersonaWhereInput = {};
    if (search) where.name = { contains: search };
    if (npc !== undefined) where.characterId = npc ? null : { not: null };
    if (npc) {
        // The admin NPC-voices list shows how much each one speaks.
        const personas = await prisma.persona.findMany({
            where,
            orderBy: { name: "asc" },
            include: { _count: { select: { messages: true } } },
        });
        return personas.map(({ _count, ...p }) => ({ ...p, messageCount: _count.messages }));
    }
    return await prisma.persona.findMany({ where, orderBy: { id: "asc" } });
}

async function getPersonaById(id: number) {
    return await prisma.persona.findUnique({ where: { id } });
}

// Slug defaults to `<character_slug>_<name_slug>` and, once set, never
// changes on its own — renaming the character or the persona never cascades.
// Name-less personas (look-only eras) get no slug: no URL identity.
async function createPersona(characterId: number, data: PersonaData) {
    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
        throw new Error(`Character with id '${characterId}' not found`);
    }
    if (!data.name && !data.image && !data.color) {
        throw new Error("A persona must set at least one of name, image, or color");
    }
    if (!data.name && !data.label) {
        throw new Error("label is required when name is not set");
    }
    if (data.slug !== undefined && !isValidSlug(data.slug)) {
        throw new Error("slug must be lowercase letters, digits and single underscores");
    }

    return await prisma.persona.create({
        data: {
            name: data.name,
            label: data.label,
            image: await storeAvatarUpload(data.image),
            color: data.color,
            slug: data.name ? data.slug ?? `${slugify(character.name)}_${slugify(data.name)}` : undefined,
            characterId,
        },
    });
}

async function updatePersona(id: number, data: Partial<PersonaData>) {
    const existing = await prisma.persona.findUnique({ where: { id } });
    if (!existing) {
        throw new Error(`Persona with id '${id}' not found`);
    }
    if (existing.characterId === null) {
        // NPC voice: always named, never a slug or page.
        if (data.slug) throw new Error("NPC personas have no slug");
        if (data.name !== undefined && !data.name?.trim()) throw new Error("NPC personas need a name");
    }
    if (data.slug !== undefined && data.slug !== null && !isValidSlug(data.slug)) {
        throw new Error("slug must be lowercase letters, digits and single underscores");
    }

    const nextName = data.name !== undefined ? data.name : existing.name;
    const nextImage = data.image !== undefined ? data.image : existing.image;
    const nextColor = data.color !== undefined ? data.color : existing.color;
    const nextLabel = data.label !== undefined ? data.label : existing.label;
    if (!nextName && !nextImage && !nextColor) {
        throw new Error("A persona must set at least one of name, image, or color");
    }
    if (!nextName && !nextLabel) {
        throw new Error("label is required when name is not set");
    }

    return await prisma.persona.update({
        where: { id },
        data: {
            name: data.name,
            label: data.label,
            image: await storeAvatarUpload(data.image),
            color: data.color,
            slug: data.slug,
        },
    });
}

async function deletePersona(id: number): Promise<void> {
    // Messages, story lines and story segments referencing this persona block
    // deletion (FK restrict): a persona used in the archive shouldn't silently
    // vanish out from under it.
    await prisma.persona.delete({ where: { id } });
}

export default {
    getAllCharacters,
    withSeasons,
    getCharacterById,
    getCharacterBySlug,
    createCharacter,
    updateCharacter,
    setMainIn,
    deleteCharacter,
    getAppearances,
    getPersonasByCharacter,
    getAllPersonas,
    getPersonaById,
    createPersona,
    updatePersona,
    deletePersona,
};
