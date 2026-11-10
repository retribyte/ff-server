import { Prisma, StoryLineType, StoryFormat } from "@prisma/client";
import { prisma } from "../db.js";
import { direction, seasonOrderKeys, type SearchOptions } from "../search/search-options.js";
import { SLUG_PATTERN } from "../utils/slug.js";
import { parseImportMeta } from "./import-meta.js";
import { IMPORT_TX_OPTIONS, ImportConflictError } from "../utils/import.js";
import { storyContentHash } from "./story-hash.js";
import booru from "../utils/booru.js";
import { deleteNpcPersonasIfUnused } from "../speaker/speaker.service.js";
import {
    LINE_INCLUDE,
    hasVoice,
    isUnnamed,
    personasUsedBy,
    storedText,
    toWireLine,
    validateVoice,
    voiceResolver,
    writeLines,
    type LineInput,
    type SegmentInput,
    type VoiceInput,
    type WireLine,
} from "./story-voices.js";


type StoryData = {
    slug: string;
    title: string;
    blurb?: string | null;
    authorIds?: number[]; // empty = uncredited
    publishedDate?: string | null;
    themeColor?: string | null;
    themeColor2?: string | null;
    format?: StoryFormat;
    season?: string | null; // season title or slug; null clears it
    canon?: boolean; // default true
};

// A line as clients send it (see story-voices.ts for the voice fields)
type LineData = LineInput;

const VALID_LINE_TYPES = new Set<string>(Object.values(StoryLineType));
const VALID_FORMATS = new Set<string>(Object.values(StoryFormat));

const AUTHORS_LIST = { orderBy: { username: "asc" as const }, select: { id: true, username: true, icon: true } };
const SEASON_SELECT = { select: { title: true, slug: true, kind: true } };
const CHAPTER_LIST = {
    orderBy: { chapter_no: "asc" as const },
    select: {
        id: true,
        storyId: true,
        chapter_no: true,
        title: true,
        _count: { select: { lines: true } },
    },
};

async function requireStory(slug: string) {
    const story = await prisma.story.findUnique({ where: { slug } });
    if (!story) throw new Error(`Story '${slug}' not found`);
    return story;
}

async function requireChapter(slug: string, chapterNo: number) {
    const story = await requireStory(slug);
    const chapter = await prisma.storyChapter.findUnique({
        where: { storyId_chapter_no: { storyId: story.id, chapter_no: chapterNo } },
    });
    if (!chapter) throw new Error(`Chapter ${chapterNo} of story '${slug}' not found`);
    return chapter;
}

// Line types counted in word counts (not BREAK or IMAGE)
const WORD_LINE_TYPES = ["NARRATION", "DIALOGUE", "ACTION", "TRANSCRIPT", "HEADING"];

/** Words per chapter (whitespace-separated runs in each prose line's text), keyed by chapter id. */
async function wordCountsByChapter(chapterIds: number[]): Promise<Map<number, number>> {
    if (chapterIds.length === 0) return new Map();
    const rows = await prisma.$queryRaw<{ chapterId: number; words: bigint }[]>`
        SELECT sl."chapterId", COUNT(*) AS words
        FROM story_lines sl, regexp_matches(sl.text, '[^[:space:]]+', 'g')
        WHERE sl."chapterId" IN (${Prisma.join(chapterIds)})
          AND sl.type::text IN (${Prisma.join(WORD_LINE_TYPES)})
        GROUP BY sl."chapterId"
    `;
    return new Map(rows.map((r) => [r.chapterId, Number(r.words)]));
}

/** Adds `wordCount` to each story and to each of its chapters. */
async function withWordCounts<T extends { chapters: { id: number }[] }>(stories: T[]) {
    const counts = await wordCountsByChapter(stories.flatMap((s) => s.chapters.map((c) => c.id)));
    return stories.map((story) => {
        const chapters = story.chapters.map((c) => ({ ...c, wordCount: counts.get(c.id) ?? 0 }));
        return { ...story, chapters, wordCount: chapters.reduce((sum, c) => sum + c.wordCount, 0) };
    });
}

/**
 * The characters featured in each story, keyed by story id: every
 * character by number of story lines they speak (a DIALOGUE line's own
 * character, or a character named in a NARRATION line's segments; a line
 * counts once per character), most lines first.
 */
async function castByStory(storyIds: number[]) {
    const cast = new Map<number, { id: number; name: string; slug: string; image: string | null; color: string | null; colorLight: string | null; lines: number }[]>();
    if (storyIds.length === 0) return cast;
    const rows = await prisma.$queryRaw<{ storyId: number; characterId: number; lines: bigint }[]>`
        SELECT c."storyId", sp."characterId", COUNT(*) AS lines
        FROM (
            SELECT ch."storyId", sl.id AS "lineId", sl."characterId"
            FROM story_lines sl JOIN story_chapters ch ON ch.id = sl."chapterId"
            WHERE sl."characterId" IS NOT NULL
            UNION
            SELECT ch."storyId", sl.id, ss."characterId"
            FROM story_segments ss
            JOIN story_lines sl ON sl.id = ss."lineId"
            JOIN story_chapters ch ON ch.id = sl."chapterId"
            WHERE ss."characterId" IS NOT NULL
        ) sp("storyId", "lineId", "characterId")
        JOIN (SELECT id AS "storyId" FROM stories WHERE id IN (${Prisma.join(storyIds)})) c USING ("storyId")
        GROUP BY c."storyId", sp."characterId"
        ORDER BY c."storyId", lines DESC, sp."characterId"
    `;
    const characters = await prisma.character.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.characterId))] } },
        select: { id: true, name: true, slug: true, image: true, color: true, colorLight: true },
    });
    const byId = new Map(characters.map((c) => [c.id, c]));
    for (const r of rows) {
        const c = byId.get(r.characterId);
        if (!c) continue;
        const list = cast.get(r.storyId) ?? [];
        list.push({ ...c, lines: Number(r.lines) });
        cast.set(r.storyId, list);
    }
    return cast;
}

async function getAllStories(search?: string, season?: string) {
    const where: Prisma.StoryWhereInput = {};
    if (search) {
        where.OR = [
            { title: { contains: search, mode: "insensitive" } },
            { blurb: { contains: search, mode: "insensitive" } },
        ];
    }
    if (season) {
        where.season = { OR: [{ title: season }, { slug: season }] };
    }
    const stories = await prisma.story.findMany({
        where,
        orderBy: { title: "asc" },
        include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
    });
    const [withCounts, cast] = await Promise.all([withWordCounts(stories), castByStory(stories.map((s) => s.id))]);
    return withCounts.map((s) => ({ ...s, cast: cast.get(s.id) ?? [] }));
}

async function getStoryBySlug(slug: string) {
    const story = await prisma.story.findUnique({
        where: { slug },
        include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
    });
    return story ? (await withWordCounts([story]))[0] : null;
}

function validateStoryData(data: StoryData, requireAll: boolean) {
    if (requireAll || data.slug !== undefined) {
        if (typeof data.slug !== "string" || !SLUG_PATTERN.test(data.slug)) {
            throw new Error(`slug must match ${SLUG_PATTERN.source}`);
        }
    }
    if (requireAll && (typeof data.title !== "string" || data.title.length === 0)) {
        throw new Error("title is required");
    }
    if (data.format !== undefined && !VALID_FORMATS.has(data.format)) {
        throw new Error(`format must be one of ${[...VALID_FORMATS].join(", ")}`);
    }
    if (data.canon !== undefined && typeof data.canon !== "boolean") {
        throw new Error("canon must be true or false");
    }
}

function authorRefs(ids: unknown): { id: number }[] {
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id))) {
        throw new Error("authorIds must be an array of user ids");
    }
    return ids.map((id) => ({ id }));
}

/** Season title or slug -> title. undefined passes through (no change), null clears. */
async function resolveSeasonTitle(season: string | null | undefined): Promise<string | null | undefined> {
    if (season === undefined || season === null) return season;
    const found = await prisma.season.findFirst({
        where: { OR: [{ title: season }, { slug: season }] },
        select: { title: true },
    });
    if (!found) throw new Error(`Season '${season}' not found`);
    return found.title;
}

async function createStory(data: StoryData) {
    validateStoryData(data, true);
    const seasonTitle = await resolveSeasonTitle(data.season);
    return await prisma.story.create({
        data: {
            slug: data.slug,
            title: data.title,
            blurb: data.blurb ?? null,
            authors: data.authorIds ? { connect: authorRefs(data.authorIds) } : undefined,
            publishedDate: data.publishedDate ? new Date(data.publishedDate) : null,
            themeColor: data.themeColor ?? null,
            themeColor2: data.themeColor2 ?? null,
            format: data.format ?? undefined,
            seasonTitle: seasonTitle ?? null,
            canon: data.canon ?? undefined,
        },
        include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
    });
}

async function updateStory(slug: string, data: Partial<StoryData>) {
    validateStoryData(data as StoryData, false);
    const story = await requireStory(slug);
    const seasonTitle = await resolveSeasonTitle(data.season);
    return await prisma.story.update({
        where: { id: story.id },
        data: {
            slug: data.slug,
            title: data.title,
            blurb: data.blurb,
            authors: data.authorIds !== undefined ? { set: authorRefs(data.authorIds) } : undefined,
            publishedDate: data.publishedDate !== undefined
                ? (data.publishedDate ? new Date(data.publishedDate) : null)
                : undefined,
            themeColor: data.themeColor,
            themeColor2: data.themeColor2,
            format: data.format,
            seasonTitle,
            canon: data.canon,
        },
        include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
    });
}

/** Deletes a story with its chapters and lines, and the NPC personas only it used. */
async function deleteStory(slug: string): Promise<void> {
    const story = await requireStory(slug);
    await prisma.$transaction(async (tx) => {
        const personas = await personasUsedBy(tx, { chapter: { storyId: story.id } });
        await tx.storyLine.deleteMany({ where: { chapter: { storyId: story.id } } });
        await tx.storyChapter.deleteMany({ where: { storyId: story.id } });
        await tx.story.delete({ where: { id: story.id } });
        await deleteNpcPersonasIfUnused(tx, personas);
    });
}

async function createChapter(slug: string, data: { title?: string | null; chapter_no?: number }) {
    const story = await requireStory(slug);
    return await prisma.$transaction(async (tx) => {
        let chapterNo = data.chapter_no;
        if (chapterNo === undefined) {
            const last = await tx.storyChapter.findFirst({
                where: { storyId: story.id },
                orderBy: { chapter_no: "desc" },
            });
            chapterNo = (last?.chapter_no ?? 0) + 1;
        }
        return await tx.storyChapter.create({
            data: { storyId: story.id, chapter_no: chapterNo, title: data.title ?? null },
        });
    });
}

async function updateChapter(slug: string, chapterNo: number, data: { title?: string | null }) {
    const chapter = await requireChapter(slug, chapterNo);
    return await prisma.storyChapter.update({
        where: { id: chapter.id },
        data: { title: data.title },
    });
}

async function deleteChapter(slug: string, chapterNo: number): Promise<void> {
    const chapter = await requireChapter(slug, chapterNo);
    await prisma.$transaction(async (tx) => {
        const personas = await personasUsedBy(tx, { chapterId: chapter.id });
        await tx.storyLine.deleteMany({ where: { chapterId: chapter.id } });
        await tx.storyChapter.delete({ where: { id: chapter.id } });
        await deleteNpcPersonasIfUnused(tx, personas);
    });
}

async function getLinesByChapter(slug: string, chapterNo: number, page = 1, limit = 100, search?: string) {
    const chapter = await requireChapter(slug, chapterNo);
    const skip = (page - 1) * limit;
    const where: any = { chapterId: chapter.id };
    if (search) where.text = { contains: search };
    const [lines, total] = await Promise.all([
        prisma.storyLine.findMany({
            where,
            orderBy: { line_no: "asc" },
            skip,
            take: limit,
            include: LINE_INCLUDE,
        }),
        prisma.storyLine.count({ where }),
    ]);
    const data = lines.map(toWireLine);

    // Characters speaking only inside segments aren't hydrated by the
    // line-level `character` include: fetch them so the reader can resolve
    // names/colors for in-paragraph dialogue spans. (Segment personas come
    // inline on each segment.)
    const lineCharacterIds = new Set(lines.map((l) => l.characterId).filter((id): id is number => id != null));
    const segmentCharacterIds = new Set(
        lines.flatMap((l) => l.segments.map((seg) => seg.characterId)).filter((id): id is number => id != null && !lineCharacterIds.has(id))
    );
    const characters = segmentCharacterIds.size
        ? await prisma.character.findMany({ where: { id: { in: [...segmentCharacterIds] } } })
        : [];

    return { data, total, page, limit, characters };
}

type CharacterQuote = WireLine & {
    storySlug: string;
    storyTitle: string;
    storySeason: string | null; // the story's season title, if it's filed under one
    chapterNo: number;
};

/**
 * Lines where a character speaks: as the line's own voice (a whole DIALOGUE
 * line) or in a segment (an inline quote inside a NARRATION paragraph), under
 * any of its personas.
 */
async function getStoryQuotesByCharacter(characterId: number): Promise<CharacterQuote[]> {
    const lines = await prisma.storyLine.findMany({
        where: { OR: [{ characterId }, { segments: { some: { characterId } } }] },
        include: { ...LINE_INCLUDE, chapter: { select: { chapter_no: true, story: { select: { slug: true, title: true, seasonTitle: true } } } } },
        orderBy: [{ chapter: { story: { id: "asc" } } }, { chapter: { chapter_no: "asc" } }, { line_no: "asc" }],
    });
    return lines.map(({ chapter, ...line }) => ({
        ...toWireLine(line),
        storySlug: chapter.story.slug,
        storyTitle: chapter.story.title,
        storySeason: chapter.story.seasonTitle,
        chapterNo: chapter.chapter_no,
    }));
}

type StoryLineHit = {
    storySlug: string;
    storyTitle: string;
    seasonTitle: string | null;
    chapterNo: number;
    lineNo: number;
    text: string;
};

// Backs the unified /api/search endpoint. Full-text (not substring) match —
// stemmed keyword search via to_tsvector/plainto_tsquery, ranked by ts_rank
// and backed by the GIN expression index from prisma/scripts/create-search-indexes.ts
// (Prisma's @@index can't express an expression index, so this can't live in
// schema.prisma). The 'english' regconfig
// literal here must byte-match the index's expression for Postgres to use it.
// ts_rank ties are otherwise Postgres-arbitrary, which would make OFFSET/
// LIMIT paging duplicate or skip rows across pages — sl.id ASC breaks ties
// deterministically.
async function searchStoryLines(
    query: string,
    page = 1,
    limit = 20,
    options: SearchOptions = {}
): Promise<{ data: StoryLineHit[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const exclude = options.exclude ?? [];
    // A story with no campaign is never excluded (there's no season to pick)
    const where = Prisma.sql`to_tsvector('english', sl.text) @@ plainto_tsquery('english', ${query})
        AND (se.slug IS NULL OR se.slug <> ALL(${exclude}::text[]))`;
    // Stories have no in-world order: campaign, then publication, then shelf order
    const order =
        options.sort === "appearance"
            ? Prisma.sql`${seasonOrderKeys('s."seasonTitle"', options.dir ?? "asc")},
                s."publishedDate" ${direction(options.dir)} NULLS LAST, s.id ${direction(options.dir)},
                sc.chapter_no ${direction(options.dir)}, sl.line_no ${direction(options.dir)}`
            : Prisma.sql`ts_rank(to_tsvector('english', sl.text), plainto_tsquery('english', ${query})) DESC, sl.id ASC`;
    const [data, countResult] = await Promise.all([
        prisma.$queryRaw<StoryLineHit[]>`
            SELECT s.slug AS "storySlug", s.title AS "storyTitle", s."seasonTitle",
                sc.chapter_no AS "chapterNo", sl.line_no AS "lineNo", sl.text
            FROM story_lines sl
            JOIN story_chapters sc ON sc.id = sl."chapterId"
            JOIN stories s ON s.id = sc."storyId"
            LEFT JOIN seasons se ON se.title = s."seasonTitle"
            WHERE ${where}
            ORDER BY ${order}
            LIMIT ${limit} OFFSET ${skip}
        `,
        prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) AS count
            FROM story_lines sl
            JOIN story_chapters sc ON sc.id = sl."chapterId"
            JOIN stories s ON s.id = sc."storyId"
            LEFT JOIN seasons se ON se.title = s."seasonTitle"
            WHERE ${where}
        `,
    ]);
    return { data, total: Number(countResult[0]?.count ?? 0), page, limit };
}

/** True when a segment array is present (not null/undefined) on a line. */
function hasSegments(line: { segments?: SegmentInput[] | null }): line is { segments: SegmentInput[] } {
    return Array.isArray(line.segments);
}

function validateSegments(segments: SegmentInput[], label: string) {
    if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error(`${label}: segments must be a non-empty array`);
    }
    // Segments annotate a paragraph with dialogue spans and/or inline styling;
    // a plain array with no voice and no style should just be sent as text.
    let annotated = false;
    for (const [i, segment] of segments.entries()) {
        const segLabel = `${label}, segment ${i + 1}`;
        if (typeof segment?.text !== "string") {
            throw new Error(`${segLabel} needs a string text`);
        }
        if (segment.npc !== undefined && typeof segment.npc !== "boolean") {
            throw new Error(`${segLabel}: npc must be a boolean`);
        }
        if (segment.npc && (segment.characterId || segment.personaId)) {
            throw new Error(`${segLabel} is an NPC voice, so it can't link a character or persona`);
        }
        validateVoice(segment, segLabel);
        if (hasVoice(segment, segment.npc) || segment.italic || segment.bold) annotated = true;
    }
    if (!annotated) {
        throw new Error(`${label}: segments need at least one dialogue or styled span; send plain text otherwise`);
    }
}

function validateLine(line: LineData, label: string) {
    if (!line || typeof line !== "object") throw new Error(`${label}: must be an object`);
    if (!VALID_LINE_TYPES.has(line.type)) {
        throw new Error(`${label}: invalid type '${line.type}'`);
    }
    if (typeof line.text !== "string") {
        throw new Error(`${label}: text is required`);
    }
    if (line.npcVoice !== undefined && typeof line.npcVoice !== "boolean") {
        throw new Error(`${label}: npcVoice must be a boolean`);
    }
    if (line.npcVoice && (line.type !== StoryLineType.DIALOGUE || line.characterId || line.personaId)) {
        throw new Error(`${label}: npcVoice is for DIALOGUE lines without a linked character or persona`);
    }
    validateVoice(line, label);
    // Dialogue needs a speaking voice: a character, a persona, or an NPC name
    // (or, in a draft, an unnamed NPC voice that the naming step fills)
    if (line.type === StoryLineType.DIALOGUE && !hasVoice(line, line.npcVoice)) {
        throw new Error(`${label}: DIALOGUE lines require characterId, personaId or speaker`);
    }
    // Headings are a short block line — no voice, no segments
    if (line.type === StoryLineType.HEADING && line.text.trim().length === 0) {
        throw new Error(`${label}: HEADING lines require non-empty text`);
    }
    // A picture is a booru post; its text is the alt text (may be empty)
    if (line.type === StoryLineType.IMAGE) {
        if (!Number.isInteger(line.booruId) || (line.booruId as number) <= 0) {
            throw new Error(`${label}: IMAGE lines require booruId (a booru post number)`);
        }
        if (hasVoice(line, line.npcVoice) || hasSegments(line)) {
            throw new Error(`${label}: IMAGE lines take no speaker or segments`);
        }
    } else if (line.booruId !== undefined && line.booruId !== null) {
        throw new Error(`${label}: booruId is only for IMAGE lines`);
    }
    // Segment annotations describe sub-paragraph spans — NARRATION only
    if (hasSegments(line)) {
        if (line.type !== StoryLineType.NARRATION) {
            throw new Error(`${label}: segments are only allowed on NARRATION lines`);
        }
        validateSegments(line.segments, label);
    }
}

/**
 * Bulk-append lines to a chapter (story import). Sequential line_nos are
 * assigned after the chapter's current maximum, inside a transaction so
 * concurrent imports can't collide.
 */
async function createLines(slug: string, chapterNo: number, lines: LineData[]) {
    for (const [index, line] of lines.entries()) {
        validateLine(line, `Line ${index + 1}`);
    }

    const chapter = await requireChapter(slug, chapterNo);
    await resolveImages(lines);
    return await prisma.$transaction(async (tx) => {
        const last = await tx.storyLine.findFirst({
            where: { chapterId: chapter.id },
            orderBy: { line_no: "desc" },
        });
        const firstLineNo = (last?.line_no ?? 0) + 1;
        await writeLines(tx, chapter.id, firstLineNo, lines);
        return { count: lines.length, firstLineNo, lastLineNo: firstLineNo + lines.length - 1 };
    }, IMPORT_TX_OPTIONS);
}

/**
 * Looks up every IMAGE line's booru post and sets its imageUrl (before any
 * transaction: the booru is a network call). Throws on a post that doesn't
 * exist or isn't an image, and BooruUnavailableError when the booru can't be
 * reached, so nothing is written with a broken picture.
 */
async function resolveImages(lines: LineData[]): Promise<void> {
    const images = lines.filter((line) => line.type === StoryLineType.IMAGE);
    const urls = new Map<number, string>();
    for (const id of new Set(images.map((line) => line.booruId as number))) {
        const post = await booru.getBooruPost(id);
        if (!post) throw new Error(`Booru post ${id} doesn't exist`);
        urls.set(id, post.imageUrl);
    }
    for (const line of images) line.imageUrl = urls.get(line.booruId as number) ?? null;
}

// ---- Carrying voices across a revision --------------------------------------
// The converter can't tell NPCs apart (they share the gray ink, `{?}` in a
// manuscript), so a revised draft's NPC quotes arrive unnamed. The quotes whose
// text didn't change take the voice they had: the importer pre-fills its naming
// step through POST .../voices/carry, and a revision PUT applies the same
// carry-over before checking that every voice has a name.

/** Comparison key for carrying a voice across a re-import: letters and digits only. */
function voiceKey(text: string): string {
    return text.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** A voice a fragment had: a character (and persona), or an NPC persona by its name. null: none worth carrying. */
type KnownVoice = { characterId: number; personaId: number | null } | { npc: string } | null;

// Stand-in voices that say "some NPC" rather than who: carrying one over would
// just re-label a quote as "NPC", so they count as unnamed.
const PLACEHOLDER_VOICES = ["npc", "npcs", "?", "unknown", "unnamed", "unnamed npc"];
const isPlaceholder = (name: string | null | undefined) => !!name && PLACEHOLDER_VOICES.includes(name.trim().toLowerCase());

/**
 * Every voiced fragment of a story (whole lines and segments), keyed by its
 * text, in reading order, so a revised draft's unnamed NPC fragments can take
 * the voice their unchanged text already had.
 */
async function knownVoices(tx: Prisma.TransactionClient, storyId: number): Promise<Map<string, KnownVoice[]>> {
    const lines = await tx.storyLine.findMany({
        where: { chapter: { storyId } },
        orderBy: [{ chapter: { chapter_no: "asc" } }, { line_no: "asc" }],
        select: {
            type: true,
            text: true,
            characterId: true,
            personaId: true,
            persona: { select: { name: true } },
            segments: { orderBy: { position: "asc" }, select: { text: true, characterId: true, personaId: true, persona: { select: { name: true } } } },
        },
    });
    // characters standing in for "some NPC" (the legacy generic NPC character)
    const placeholderIds = new Set(
        (
            await tx.character.findMany({
                where: { OR: PLACEHOLDER_VOICES.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) },
                select: { id: true },
            })
        ).map((c) => c.id)
    );
    const voices = new Map<string, KnownVoice[]>();
    const add = (f: { text: string; characterId: number | null; personaId: number | null; persona: { name: string | null } | null }) => {
        if (!f.characterId && !f.personaId) return;
        const key = voiceKey(f.text);
        if (!key) return;
        const list = voices.get(key) ?? [];
        // placeholders are listed too (as no voice), so occurrence numbers line up
        if (f.characterId) list.push(placeholderIds.has(f.characterId) ? null : { characterId: f.characterId, personaId: f.personaId });
        else list.push(isPlaceholder(f.persona?.name) || !f.persona?.name ? null : { npc: f.persona.name });
        voices.set(key, list);
    };
    for (const line of lines) {
        if (line.type === StoryLineType.DIALOGUE) add(line);
        for (const seg of line.segments) add(seg);
    }
    return voices;
}

/**
 * Fills a draft's unnamed NPC fragments from the story's current voices,
 * matching on text by occurrence: the n-th voiced "Fire!" in the draft takes
 * the voice of the n-th voiced "Fire!" in the story as it stands (so an NPC's
 * "Yes." never inherits the character who said "Yes." earlier). A match on a
 * character becomes that character (and persona); a match on an NPC names it.
 * Returns how many fragments it filled.
 */
function carryVoices(chapters: ImportChapter[], voices: Map<string, KnownVoice[]>): number {
    const seen = new Map<string, number>();
    // the old voice at this fragment's occurrence of its text, counting every voiced fragment
    const occurrence = (text: string): KnownVoice => {
        const key = voiceKey(text);
        if (!key) return null;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        return voices.get(key)?.[n] ?? null;
    };
    let filled = 0;
    const fill = (fragment: VoiceInput, known: KnownVoice): boolean => {
        if (!known) return false;
        if ("npc" in known) fragment.speaker = known.npc;
        else {
            fragment.characterId = known.characterId;
            fragment.personaId = known.personaId;
        }
        filled++;
        return true;
    };
    for (const chapter of chapters) {
        for (const line of chapter.lines) {
            if (line.type === StoryLineType.DIALOGUE && hasVoice(line, line.npcVoice)) {
                const known = occurrence(line.text);
                if (isUnnamed(line, line.npcVoice) && fill(line, known) && known && !("npc" in known)) line.npcVoice = false;
            }
            if (!hasSegments(line)) continue;
            for (const seg of line.segments) {
                if (!hasVoice(seg, seg.npc)) continue;
                const known = occurrence(seg.text);
                if (isUnnamed(seg, seg.npc) && fill(seg, known) && known && !("npc" in known)) delete seg.npc;
            }
        }
    }
    return filled;
}

/**
 * For the importer's naming step: a revision draft with its unnamed NPC
 * fragments filled from the story's current voices. Writes nothing.
 */
async function carryStoryVoices(slug: string, body: { chapters: ImportChapter[] }) {
    const { ordered } = prepareChapters(body?.chapters);
    const story = await prisma.story.findUnique({ where: { slug }, select: { id: true } });
    if (!story) return null;
    const filled = carryVoices(ordered, await knownVoices(prisma, story.id));
    return { chapters: ordered, filled };
}

// ---- Re-voicing fragments from the reader -----------------------------------

type VoiceAssignment = {
    chapterNo: number;
    lineNo: number;
    /** 0-based span of a NARRATION line; omitted for a whole DIALOGUE line */
    segment?: number | null;
    /** An NPC by name (found or created) */
    speaker?: string | null;
    /** A character (story authors and admins; logged as a job), optionally as one of its personas */
    characterId?: number | null;
    /** A persona: one of `characterId`'s, or an NPC persona alone */
    personaId?: number | null;
};

/**
 * Re-voices fragments of a story that already have a voice: a segment of a
 * NARRATION line, or a whole line when `segment` is omitted. A fragment can
 * move between NPCs, characters and personas, but narration can't become
 * dialogue (nor the reverse) and text never changes through here. One
 * transaction; any bad assignment rejects them all.
 */
async function assignVoices(slug: string, assignments: VoiceAssignment[]) {
    validateAssignments(assignments);
    if (linksCharacters(assignments)) {
        throw new Error("Linking a character goes through assignVoicesTx (logged as a job)");
    }
    const story = await prisma.story.findUnique({ where: { slug }, select: { id: true } });
    if (!story) return null;
    return await prisma.$transaction((tx) => assignVoicesTx(tx, story.id, assignments));
}

function validateAssignments(assignments: VoiceAssignment[]) {
    if (!Array.isArray(assignments) || assignments.length === 0) {
        throw new Error("assignments must be a non-empty array");
    }
    if (assignments.length > 500) throw new Error("at most 500 assignments per request");
}

/** True when any assignment links a character or a persona by id (logged as a job) */
function linksCharacters(assignments: unknown): boolean {
    return (
        Array.isArray(assignments) &&
        assignments.some((a) => (a?.characterId !== undefined && a?.characterId !== null) || (a?.personaId !== undefined && a?.personaId !== null))
    );
}

const voiceLabel = (v: { character?: { name: string } | null; persona?: { name: string | null } | null }) =>
    v.character ? (v.persona?.name ? `${v.character.name} (as ${v.persona.name})` : v.character.name) : v.persona?.name ? `NPC ${v.persona.name}` : "(no voice)";

/**
 * The work of assignVoices inside a caller's transaction. `log` gets one line
 * per change (for the job history). NPC personas a change leaves with no lines
 * anywhere are deleted. Returns the changed lines as the reader gets them.
 */
async function assignVoicesTx(tx: Prisma.TransactionClient, storyId: number, assignments: VoiceAssignment[], log?: (line: string) => void) {
    validateAssignments(assignments);
    const { resolve } = voiceResolver(tx);
    const released = new Set<number>();
    const kept = new Set<number>();
    const changedLines = new Map<number, { chapterNo: number; lineNo: number }>();
    const voiceInclude = { character: { select: { name: true } }, persona: { select: { name: true } } } as const;
    for (const [i, a] of assignments.entries()) {
        const label = `Assignment ${i + 1}`;
        if (!Number.isInteger(a?.chapterNo) || !Number.isInteger(a?.lineNo)) {
            throw new Error(`${label}: chapterNo and lineNo must be whole numbers`);
        }
        const input: VoiceInput = { characterId: a.characterId ?? null, personaId: a.personaId ?? null, speaker: a.speaker ?? null };
        validateVoice(input, label);
        if (!hasVoice(input)) throw new Error(`${label}: give the fragment a speaker name, a character or a persona`);
        const voice = await resolve(input, false, label);
        if (voice.personaId !== null) kept.add(voice.personaId);

        const line = await tx.storyLine.findFirst({
            where: { line_no: a.lineNo, chapter: { storyId, chapter_no: a.chapterNo } },
            select: { id: true, characterId: true, personaId: true, ...voiceInclude },
        });
        if (!line) throw new Error(`${label}: no line ${a.lineNo} in chapter ${a.chapterNo}`);
        let before: string;
        let after;
        if (a.segment === undefined || a.segment === null) {
            if (!line.characterId && !line.personaId) throw new Error(`${label}: line ${a.lineNo} has no voice to change`);
            before = voiceLabel(line);
            if (line.personaId !== null) released.add(line.personaId);
            after = await tx.storyLine.update({ where: { id: line.id }, data: voice, select: voiceInclude });
            log?.(`ch. ${a.chapterNo}, line ${a.lineNo}: ${before} -> ${voiceLabel(after)}`);
        } else {
            const seg = Number.isInteger(a.segment)
                ? await tx.storySegment.findUnique({
                      where: { lineId_position: { lineId: line.id, position: a.segment } },
                      select: { id: true, characterId: true, personaId: true, ...voiceInclude },
                  })
                : null;
            if (!seg) throw new Error(`${label}: line ${a.lineNo} has no segment ${a.segment}`);
            if (!seg.characterId && !seg.personaId) throw new Error(`${label}: segment ${a.segment} of line ${a.lineNo} is narration, not a voice`);
            before = voiceLabel(seg);
            if (seg.personaId !== null) released.add(seg.personaId);
            after = await tx.storySegment.update({ where: { id: seg.id }, data: voice, select: voiceInclude });
            log?.(`ch. ${a.chapterNo}, line ${a.lineNo}, quote ${a.segment}: ${before} -> ${voiceLabel(after)}`);
        }
        changedLines.set(line.id, { chapterNo: a.chapterNo, lineNo: a.lineNo });
    }
    for (const id of kept) released.delete(id);
    const deleted = await deleteNpcPersonasIfUnused(tx, released);
    if (deleted.length) log?.(`Deleted NPC voice(s) no line uses any more: ${deleted.join(", ")}`);

    const lines = await tx.storyLine.findMany({ where: { id: { in: [...changedLines.keys()] } }, include: LINE_INCLUDE });
    return lines.map((line) => ({ ...changedLines.get(line.id)!, ...toWireLine(line) }));
}

/** An admin, or one of the story's authors (who may replace its text and re-voice its quotes). null: no such story. */
async function isAuthorOrAdmin(slug: string, user: { id: number; role: string }): Promise<boolean | null> {
    const story = await prisma.story.findUnique({ where: { slug }, select: { authors: { select: { id: true } } } });
    if (!story) return null;
    return user.role === "ADMIN" || story.authors.some((a) => a.id === user.id);
}

type ImportChapter = { chapter_no: number; title?: string | null; lines: LineData[] };
type StoryImport = { story: StoryData; chapters: ImportChapter[]; importMeta?: unknown };

/** Validates import chapters; returns them in chapter_no order with the content fingerprint. */
function prepareChapters(chapters: ImportChapter[]): { ordered: ImportChapter[]; contentHash: string } {
    if (!Array.isArray(chapters) || chapters.length === 0) {
        throw new Error("chapters must be a non-empty array");
    }
    const seenChapterNos = new Set<number>();
    for (const [ci, chapter] of chapters.entries()) {
        const label = `Chapter ${chapter?.chapter_no ?? `#${ci + 1}`}`;
        // 0 is allowed: a preface or prologue before "Chapter 1"
        if (!Number.isInteger(chapter?.chapter_no) || chapter.chapter_no < 0) {
            throw new Error(`Chapter #${ci + 1}: chapter_no must be a whole number, 0 or more`);
        }
        if (seenChapterNos.has(chapter.chapter_no)) throw new Error(`${label}: duplicate chapter_no`);
        seenChapterNos.add(chapter.chapter_no);
        if (!Array.isArray(chapter.lines)) throw new Error(`${label}: lines must be an array`);
        for (const [li, line] of chapter.lines.entries()) validateLine(line, `${label}, line ${li + 1}`);
    }

    const ordered = [...chapters].sort((a, b) => a.chapter_no - b.chapter_no);
    const contentHash = storyContentHash(
        ordered.map((chapter) => ({ lines: chapter.lines.map((line) => ({ type: line.type, text: storedText(line) })) }))
    );
    return { ordered, contentHash };
}

/** Creates chapters and their lines for a story, inside the caller's transaction. Returns line count and NPC personas created. */
async function insertChapters(tx: Prisma.TransactionClient, storyId: number, ordered: ImportChapter[]) {
    let lineCount = 0;
    const npcsCreated: string[] = [];
    for (const chapter of ordered) {
        const createdChapter = await tx.storyChapter.create({
            data: { storyId, chapter_no: chapter.chapter_no, title: chapter.title ?? null },
        });
        npcsCreated.push(...(await writeLines(tx, createdChapter.id, 1, chapter.lines, `Chapter ${chapter.chapter_no}, `)));
        lineCount += chapter.lines.length;
    }
    return { lineCount, npcsCreated };
}

/**
 * Atomic whole-story import: the story, every chapter and every line in one
 * transaction — it either lands complete or not at all, so "this story
 * exists" always means "this story imported completely". Rejects (409) a
 * slug or title already in use, or content identical to an existing story's;
 * rejects (400) a voice that is an unnamed NPC.
 */
async function importStory(body: StoryImport) {
    const { story, chapters } = body ?? ({} as StoryImport);
    if (!story || typeof story !== "object") throw new Error("body must be { story, chapters }");
    validateStoryData(story, true);
    const importMeta = parseImportMeta(body.importMeta);
    if (story.authorIds !== undefined) authorRefs(story.authorIds);
    const { ordered, contentHash } = prepareChapters(chapters);
    const seasonTitle = await resolveSeasonTitle(story.season);
    await resolveImages(ordered.flatMap((chapter) => chapter.lines));

    return await prisma.$transaction(async (tx) => {
        const bySlug = await tx.story.findUnique({ where: { slug: story.slug }, select: { slug: true } });
        if (bySlug) throw new ImportConflictError(`A story with slug '${story.slug}' is already in the archive`);
        const byTitle = await tx.story.findFirst({
            where: { title: { equals: story.title, mode: "insensitive" } },
            select: { slug: true, title: true },
        });
        if (byTitle) {
            throw new ImportConflictError(`A story titled '${byTitle.title}' is already in the archive (slug '${byTitle.slug}')`);
        }
        const byContent = await tx.story.findUnique({ where: { contentHash }, select: { slug: true, title: true } });
        if (byContent) {
            throw new ImportConflictError(
                `This manuscript's text is identical to '${byContent.title}' (slug '${byContent.slug}'), already in the archive`
            );
        }

        const created = await tx.story.create({
            data: {
                slug: story.slug,
                title: story.title,
                blurb: story.blurb ?? null,
                authors: story.authorIds ? { connect: authorRefs(story.authorIds) } : undefined,
                publishedDate: story.publishedDate ? new Date(story.publishedDate) : null,
                themeColor: story.themeColor ?? null,
                themeColor2: story.themeColor2 ?? null,
                format: story.format ?? undefined,
                seasonTitle: seasonTitle ?? null,
                canon: story.canon ?? undefined,
                contentHash,
                importMeta: importMeta ?? undefined,
            },
        });

        const { lineCount, npcsCreated } = await insertChapters(tx, created.id, ordered);

        const full = await tx.story.findUniqueOrThrow({
            where: { id: created.id },
            include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
        });
        return { ...full, lineCount, npcsCreated };
    }, IMPORT_TX_OPTIONS);
}

/** Admin edit of one line: type, text, voice, segments (replaced wholesale). Returns the line as the reader gets it. */
async function updateLine(slug: string, chapterNo: number, lineNo: number, data: Partial<LineData>) {
    const chapter = await requireChapter(slug, chapterNo);
    const existing = await prisma.storyLine.findUnique({
        where: { chapterId_line_no: { chapterId: chapter.id, line_no: lineNo } },
        include: { segments: { orderBy: { position: "asc" } } },
    });
    if (!existing) throw new Error(`Line ${lineNo} of chapter ${chapterNo} in story '${slug}' not found`);

    const existingSegments: SegmentInput[] | null = existing.segments.length
        ? existing.segments.map((seg) => ({ text: seg.text, characterId: seg.characterId, personaId: seg.personaId, italic: seg.italic, bold: seg.bold }))
        : null;

    // segments: absent = leave as-is, null = clear, array = replace
    const effectiveSegments = data.segments === undefined ? existingSegments : data.segments;

    // A text-only edit on a segmented line would silently desync text from spans
    if (data.text !== undefined && existingSegments && data.segments === undefined) {
        throw new Error(`Line ${lineNo}: cannot edit text of a segmented line directly — update its segments, or send segments:null to clear them`);
    }

    // A voice edit replaces the line's voice; otherwise it keeps the one it has
    const voiceEdit = data.characterId !== undefined || data.personaId !== undefined || data.speaker !== undefined || data.npcVoice !== undefined;
    const voice: VoiceInput & { npcVoice?: boolean } = voiceEdit
        ? { characterId: data.characterId, personaId: data.personaId, speaker: data.speaker, npcVoice: data.npcVoice }
        : { characterId: existing.characterId, personaId: existing.personaId };

    const merged: LineData = {
        type: data.type ?? existing.type,
        text: effectiveSegments ? storedText({ text: "", segments: effectiveSegments }) : data.text !== undefined ? data.text : existing.text,
        ...voice,
        segments: effectiveSegments,
        booruId: existing.booruId, // a picture's post isn't changed through a line edit
    };
    validateLine(merged, `Line ${lineNo}`);

    return await prisma.$transaction(async (tx) => {
        const { resolve } = voiceResolver(tx);
        const before = await personasUsedBy(tx, { id: existing.id });
        const lineVoice = await resolve(merged, merged.npcVoice, `Line ${lineNo}`);
        await tx.storyLine.update({
            where: { id: existing.id },
            data: { type: merged.type, text: merged.text, ...lineVoice },
        });
        if (data.segments !== undefined) {
            await tx.storySegment.deleteMany({ where: { lineId: existing.id } });
            if (effectiveSegments) {
                const rows = [];
                for (const [position, seg] of effectiveSegments.entries()) {
                    rows.push({
                        lineId: existing.id,
                        position,
                        text: seg.text,
                        ...(await resolve(seg, seg.npc, `Line ${lineNo}, segment ${position + 1}`)),
                        italic: !!seg.italic,
                        bold: !!seg.bold,
                    });
                }
                await tx.storySegment.createMany({ data: rows });
            }
        }
        await deleteNpcPersonasIfUnused(tx, before);
        return toWireLine(await tx.storyLine.findUniqueOrThrow({ where: { id: existing.id }, include: LINE_INCLUDE }));
    });
}

/**
 * Atomic revision: replaces every chapter and line of an existing story with
 * a new draft in one transaction, keeping the story itself (id, slug, title,
 * authors, season, blurb, theme). Rejects (409) text identical to a
 * *different* story; re-sending the story's own text is allowed and just
 * rewrites it. Unnamed NPC fragments take the voice their unchanged text had
 * (carryVoices); any left unnamed reject the revision (400). NPC personas the
 * old text used and the new one doesn't, and nothing else uses, are deleted.
 * Line numbers restart at 1 per chapter, so deep links into the story may
 * shift; nothing else hangs off story lines.
 */
async function replaceStoryContent(slug: string, body: { chapters: ImportChapter[]; importMeta?: unknown }) {
    const { ordered, contentHash } = prepareChapters(body?.chapters);
    // A revision from a Google Doc updates the remembered color map; one from
    // a CLI .json (no importMeta) leaves it as it was
    const importMeta = parseImportMeta(body?.importMeta);
    await resolveImages(ordered.flatMap((chapter) => chapter.lines));
    return await prisma.$transaction(async (tx) => {
        const story = await tx.story.findUnique({ where: { slug }, select: { id: true } });
        if (!story) throw new Error(`Story '${slug}' not found`);
        const byContent = await tx.story.findFirst({
            where: { contentHash, id: { not: story.id } },
            select: { slug: true, title: true },
        });
        if (byContent) {
            throw new ImportConflictError(
                `This draft's text is identical to '${byContent.title}' (slug '${byContent.slug}'), a different story`
            );
        }
        // NPC fragments someone already named keep their names across a revision
        const voicesCarried = carryVoices(ordered, await knownVoices(tx, story.id));
        const before = await personasUsedBy(tx, { chapter: { storyId: story.id } });
        await tx.storyLine.deleteMany({ where: { chapter: { storyId: story.id } } });
        await tx.storyChapter.deleteMany({ where: { storyId: story.id } });
        const { lineCount, npcsCreated } = await insertChapters(tx, story.id, ordered);
        const npcsDeleted = await deleteNpcPersonasIfUnused(tx, before);
        await tx.story.update({ where: { id: story.id }, data: { contentHash, importMeta: importMeta ?? undefined } });
        const full = await tx.story.findUniqueOrThrow({
            where: { id: story.id },
            include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
        });
        return { ...full, lineCount, voicesCarried, npcsCreated, npcsDeleted };
    }, IMPORT_TX_OPTIONS);
}

export default {
    assignVoices,
    assignVoicesTx,
    carryStoryVoices,
    linksCharacters,
    isAuthorOrAdmin,
    getAllStories,
    getStoryBySlug,
    createStory,
    updateStory,
    deleteStory,
    createChapter,
    updateChapter,
    deleteChapter,
    getLinesByChapter,
    createLines,
    importStory,
    replaceStoryContent,
    updateLine,
    getStoryQuotesByCharacter,
    searchStoryLines,
};
