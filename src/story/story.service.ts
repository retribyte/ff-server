import { PrismaClient, Prisma, StoryLineType, StoryFormat } from "@prisma/client";
import { SLUG_PATTERN } from "../utils/slug.js";
import { IMPORT_TX_OPTIONS, ImportConflictError } from "../utils/import.js";
import { storyContentHash } from "./story-hash.js";

const prisma = new PrismaClient();

type StorySegment = {
    text: string;
    characterId?: number | null;
    speaker?: string | null;
    // An NPC voice: `speaker` is its name, absent while unnamed (still dialogue)
    npc?: boolean;
    italic?: boolean;
    bold?: boolean;
};

const NPC_NAME_MAX = 80;

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
};

type LineData = {
    type: StoryLineType;
    text: string;
    characterId?: number | null;
    speaker?: string | null;
    npcVoice?: boolean; // DIALOGUE only: an NPC voice, named by `speaker` or unnamed
    segments?: StorySegment[] | null;
};

const VALID_LINE_TYPES = new Set<string>(Object.values(StoryLineType));
const VALID_FORMATS = new Set<string>(Object.values(StoryFormat));

const AUTHORS_LIST = { orderBy: { username: "asc" as const }, select: { id: true, username: true, icon: true } };
const SEASON_SELECT = { select: { title: true, slug: true } };
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
    return await prisma.story.findMany({
        where,
        orderBy: { title: "asc" },
        include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
    });
}

async function getStoryBySlug(slug: string) {
    return await prisma.story.findUnique({
        where: { slug },
        include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
    });
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
        },
        include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
    });
}

async function deleteStory(slug: string): Promise<void> {
    const story = await requireStory(slug);
    await prisma.$transaction([
        prisma.storyLine.deleteMany({ where: { chapter: { storyId: story.id } } }),
        prisma.storyChapter.deleteMany({ where: { storyId: story.id } }),
        prisma.story.delete({ where: { id: story.id } }),
    ]);
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
    await prisma.$transaction([
        prisma.storyLine.deleteMany({ where: { chapterId: chapter.id } }),
        prisma.storyChapter.delete({ where: { id: chapter.id } }),
    ]);
}

async function getLinesByChapter(slug: string, chapterNo: number, page = 1, limit = 100, search?: string) {
    const chapter = await requireChapter(slug, chapterNo);
    const skip = (page - 1) * limit;
    const where: any = { chapterId: chapter.id };
    if (search) where.text = { contains: search };
    const [data, total] = await Promise.all([
        prisma.storyLine.findMany({
            where,
            orderBy: { line_no: "asc" },
            skip,
            take: limit,
            include: { character: true },
        }),
        prisma.storyLine.count({ where }),
    ]);

    // Characters referenced only inside segment JSON aren't hydrated by the
    // line-level `character` include — fetch them so the reader can resolve
    // names/colors for in-paragraph dialogue spans.
    const lineCharacterIds = new Set(
        data.map((l) => l.characterId).filter((id): id is number => id != null),
    );
    const segmentCharacterIds = new Set<number>();
    for (const line of data) {
        const segments = line.segments as StorySegment[] | null;
        if (!Array.isArray(segments)) continue;
        for (const seg of segments) {
            if (typeof seg.characterId === "number" && !lineCharacterIds.has(seg.characterId)) {
                segmentCharacterIds.add(seg.characterId);
            }
        }
    }
    const characters = segmentCharacterIds.size
        ? await prisma.character.findMany({ where: { id: { in: [...segmentCharacterIds] } } })
        : [];

    return { data, total, page, limit, characters };
}

type CharacterQuote = {
    id: number;
    chapterId: number;
    line_no: number;
    type: StoryLineType;
    text: string;
    characterId: number | null;
    speaker: string | null;
    segments: StorySegment[] | null;
    storySlug: string;
    storyTitle: string;
    chapterNo: number;
};

/**
 * Lines where a character speaks — either as the line's own `characterId`
 * (a whole DIALOGUE line) or as a segment's `characterId` (an inline quote
 * inside a NARRATION paragraph). The segment match relies on the `segments`
 * GIN(jsonb_path_ops) index via containment (`@>`); Prisma's JSON filter API
 * can't express "object key match inside an array" on PostgreSQL, so this
 * goes through $queryRaw.
 */
async function getStoryQuotesByCharacter(characterId: number): Promise<CharacterQuote[]> {
    const containment = JSON.stringify([{ characterId }]);
    return prisma.$queryRaw<CharacterQuote[]>`
        SELECT
            sl.id, sl."chapterId", sl.line_no, sl.type, sl.text,
            sl."characterId", sl.speaker, sl.segments,
            s.slug AS "storySlug", s.title AS "storyTitle", sc.chapter_no AS "chapterNo"
        FROM story_lines sl
        JOIN story_chapters sc ON sc.id = sl."chapterId"
        JOIN stories s ON s.id = sc."storyId"
        WHERE sl."characterId" = ${characterId}
           OR sl.segments @> ${containment}::jsonb
        ORDER BY s.id, sc.chapter_no, sl.line_no
    `;
}

type StoryLineHit = { storySlug: string; chapterNo: number; lineNo: number; text: string };

// Backs the unified /api/search endpoint. Full-text (not substring) match —
// stemmed keyword search via to_tsvector/plainto_tsquery, ranked by ts_rank
// and backed by the GIN expression index from prisma/scripts/create-search-indexes.ts
// (Prisma's @@index can't express an expression index, so this can't live in
// schema.prisma, unlike the segments GIN index above). The 'english' regconfig
// literal here must byte-match the index's expression for Postgres to use it.
// ts_rank ties are otherwise Postgres-arbitrary, which would make OFFSET/
// LIMIT paging duplicate or skip rows across pages — sl.id ASC breaks ties
// deterministically.
async function searchStoryLines(
    query: string,
    page = 1,
    limit = 20
): Promise<{ data: StoryLineHit[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const [data, countResult] = await Promise.all([
        prisma.$queryRaw<StoryLineHit[]>`
            SELECT s.slug AS "storySlug", sc.chapter_no AS "chapterNo", sl.line_no AS "lineNo", sl.text
            FROM story_lines sl
            JOIN story_chapters sc ON sc.id = sl."chapterId"
            JOIN stories s ON s.id = sc."storyId"
            WHERE to_tsvector('english', sl.text) @@ plainto_tsquery('english', ${query})
            ORDER BY ts_rank(to_tsvector('english', sl.text), plainto_tsquery('english', ${query})) DESC, sl.id ASC
            LIMIT ${limit} OFFSET ${skip}
        `,
        prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*) AS count
            FROM story_lines sl
            WHERE to_tsvector('english', sl.text) @@ plainto_tsquery('english', ${query})
        `,
    ]);
    return { data, total: Number(countResult[0]?.count ?? 0), page, limit };
}

/** True when a segment array is present (not null/undefined) on a line. */
function hasSegments(line: { segments?: StorySegment[] | null }): line is { segments: StorySegment[] } {
    return Array.isArray(line.segments);
}

/** The verbatim concatenation of segment texts — the canonical `text` for a segmented line. */
function textFromSegments(segments: StorySegment[]): string {
    return segments.map((s) => s.text).join("");
}

function validateSegments(segments: StorySegment[], label: string) {
    if (!Array.isArray(segments) || segments.length === 0) {
        throw new Error(`${label}: segments must be a non-empty array`);
    }
    // Segments annotate a paragraph with dialogue spans and/or inline styling;
    // a plain array with no voice and no style should just be sent as text.
    let annotated = false;
    for (const [i, segment] of segments.entries()) {
        if (typeof segment.text !== "string") {
            throw new Error(`${label}: segment ${i + 1} needs a string text`);
        }
        if (segment.npc !== undefined && typeof segment.npc !== "boolean") {
            throw new Error(`${label}: segment ${i + 1} npc must be a boolean`);
        }
        if (segment.npc && segment.characterId) {
            throw new Error(`${label}: segment ${i + 1} is an NPC voice, so it can't link a character`);
        }
        if (segment.characterId || segment.speaker || segment.npc || segment.italic || segment.bold) annotated = true;
    }
    if (!annotated) {
        throw new Error(`${label}: segments need at least one dialogue or styled span; send plain text otherwise`);
    }
}

function validateLine(line: LineData, label: string) {
    if (!VALID_LINE_TYPES.has(line.type)) {
        throw new Error(`${label}: invalid type '${line.type}'`);
    }
    if (typeof line.text !== "string") {
        throw new Error(`${label}: text is required`);
    }
    if (line.npcVoice !== undefined && typeof line.npcVoice !== "boolean") {
        throw new Error(`${label}: npcVoice must be a boolean`);
    }
    if (line.npcVoice && (line.type !== StoryLineType.DIALOGUE || line.characterId)) {
        throw new Error(`${label}: npcVoice is for DIALOGUE lines without a linked character`);
    }
    // Dialogue needs a speaking voice — a linked character, a display name, or
    // an NPC voice (which may be unnamed until someone names it in the reader)
    if (line.type === StoryLineType.DIALOGUE && !line.characterId && !line.speaker && !line.npcVoice) {
        throw new Error(`${label}: DIALOGUE lines require characterId, speaker or npcVoice`);
    }
    // Headings are a short block line — no voice, no segments
    if (line.type === StoryLineType.HEADING && line.text.trim().length === 0) {
        throw new Error(`${label}: HEADING lines require non-empty text`);
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
    return await prisma.$transaction(async (tx) => {
        const last = await tx.storyLine.findFirst({
            where: { chapterId: chapter.id },
            orderBy: { line_no: "desc" },
        });
        const firstLineNo = (last?.line_no ?? 0) + 1;
        await insertLines(tx, chapter.id, firstLineNo, lines);
        return { count: lines.length, firstLineNo, lastLineNo: firstLineNo + lines.length - 1 };
    });
}

/** The `text` a line is stored with: segmented lines derive it from the spans so the two can't desync. */
function storedText(line: LineData): string {
    return hasSegments(line) ? textFromSegments(line.segments) : line.text;
}

/** Writes already-validated lines into a chapter with sequential line_nos, inside the caller's transaction. */
async function insertLines(tx: Prisma.TransactionClient, chapterId: number, firstLineNo: number, lines: LineData[]) {
    await tx.storyLine.createMany({
        data: lines.map((line, index) => ({
            chapterId,
            line_no: firstLineNo + index,
            type: line.type,
            text: storedText(line),
            characterId: line.characterId ?? null,
            speaker: line.speaker ?? null,
            npcVoice: line.npcVoice ?? false,
            segments: hasSegments(line) ? (line.segments as object[]) : undefined,
        })),
    });
}

// ---- NPC voices -------------------------------------------------------------
// An NPC voice (gray text in a Google Doc, `{?}` in a manuscript) can't be
// mapped to one speaker by color, so it imports unnamed and is named later,
// fragment by fragment, by a story author or an admin reading the story.

/** Comparison key for carrying a voice across a re-import: letters and digits only. */
function voiceKey(text: string): string {
    return text.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

type KnownVoice = { characterId: number | null; speaker: string | null };

/**
 * Every voiced fragment of a story (DIALOGUE lines and segment spans), keyed
 * by its text, in reading order — so a revised draft's unnamed NPC fragments
 * can take the voice their unchanged text already had.
 */
async function knownVoices(tx: Prisma.TransactionClient, storyId: number): Promise<Map<string, KnownVoice[]>> {
    const lines = await tx.storyLine.findMany({
        where: { chapter: { storyId } },
        orderBy: [{ chapter: { chapter_no: "asc" } }, { line_no: "asc" }],
        select: { type: true, text: true, characterId: true, speaker: true, npcVoice: true, segments: true },
    });
    const voices = new Map<string, KnownVoice[]>();
    // unnamed NPC fragments are listed too (as no voice), so occurrence numbers line up
    const add = (text: string, characterId: number | null | undefined, speaker: string | null | undefined, npc?: boolean) => {
        if (!characterId && !speaker && !npc) return;
        const key = voiceKey(text);
        if (!key) return;
        const list = voices.get(key) ?? [];
        list.push({ characterId: characterId ?? null, speaker: characterId ? null : (speaker ?? null) });
        voices.set(key, list);
    };
    for (const line of lines) {
        if (line.type === StoryLineType.DIALOGUE) add(line.text, line.characterId, line.speaker, line.npcVoice);
        const segments = line.segments as StorySegment[] | null;
        if (Array.isArray(segments)) for (const seg of segments) add(seg.text, seg.characterId, seg.speaker, seg.npc);
    }
    return voices;
}

/**
 * Fills a revised draft's unnamed NPC fragments from the story's current
 * voices, matching on text by occurrence: the n-th voiced "Fire!" in the draft
 * takes the voice of the n-th voiced "Fire!" in the story as it stands (so an
 * NPC's "Yes." never inherits the character who said "Yes." earlier). A match
 * on a linked character becomes that character; a match on a name stays an
 * NPC voice with that name. Returns how many fragments it filled.
 */
function carryVoices(chapters: ImportChapter[], voices: Map<string, KnownVoice[]>): number {
    const seen = new Map<string, number>();
    // the old voice at this fragment's occurrence of its text, counting every voiced fragment
    const occurrence = (text: string): KnownVoice | null => {
        const key = voiceKey(text);
        if (!key) return null;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        return voices.get(key)?.[n] ?? null;
    };
    const voiced = (characterId: number | null | undefined, speaker: string | null | undefined, npc: boolean | undefined) =>
        !!characterId || !!speaker || !!npc;
    let filled = 0;
    for (const chapter of chapters) {
        for (const line of chapter.lines) {
            if (line.type === StoryLineType.DIALOGUE && voiced(line.characterId, line.speaker, line.npcVoice)) {
                const known = occurrence(line.text);
                if (line.npcVoice && !line.speaker && (known?.characterId || known?.speaker)) {
                    if (known.characterId) {
                        line.characterId = known.characterId;
                        line.npcVoice = false;
                    } else line.speaker = known.speaker;
                    filled++;
                }
            }
            if (!hasSegments(line)) continue;
            for (const seg of line.segments) {
                if (!voiced(seg.characterId, seg.speaker, seg.npc)) continue;
                const known = occurrence(seg.text);
                if (!seg.npc || seg.speaker || !(known?.characterId || known?.speaker)) continue;
                if (known!.characterId) {
                    seg.characterId = known!.characterId;
                    delete seg.npc;
                } else seg.speaker = known!.speaker;
                filled++;
            }
        }
    }
    return filled;
}

type VoiceAssignment = { chapterNo: number; lineNo: number; segment?: number | null; speaker: string | null };

/**
 * Names (or un-names, with a null/blank speaker) NPC voice fragments: a
 * segment of a NARRATION line, or a whole npcVoice DIALOGUE line when
 * `segment` is omitted. Only NPC-flagged fragments can be named this way, so
 * the story's text and its character attributions can't change through here.
 * One transaction; any bad assignment rejects them all.
 */
async function assignVoices(slug: string, assignments: VoiceAssignment[]) {
    if (!Array.isArray(assignments) || assignments.length === 0) {
        throw new Error("assignments must be a non-empty array");
    }
    if (assignments.length > 500) throw new Error("at most 500 assignments per request");
    const story = await prisma.story.findUnique({ where: { slug }, select: { id: true } });
    if (!story) return null;

    return await prisma.$transaction(async (tx) => {
        const updated: { chapterNo: number; lineNo: number; speaker: string | null; segments: StorySegment[] | null }[] = [];
        // several assignments may target one line (two fragments in a paragraph)
        const pending = new Map<number, { line: { id: number; type: StoryLineType; npcVoice: boolean; speaker: string | null; segments: StorySegment[] | null }; chapterNo: number; lineNo: number }>();
        for (const [i, a] of assignments.entries()) {
            const label = `Assignment ${i + 1}`;
            if (!Number.isInteger(a?.chapterNo) || !Number.isInteger(a?.lineNo)) {
                throw new Error(`${label}: chapterNo and lineNo must be whole numbers`);
            }
            if (a.speaker !== null && typeof a.speaker !== "string") throw new Error(`${label}: speaker must be a string or null`);
            const speaker = a.speaker?.trim() || null;
            if (speaker && speaker.length > NPC_NAME_MAX) throw new Error(`${label}: names are at most ${NPC_NAME_MAX} characters`);

            let entry = [...pending.values()].find((p) => p.chapterNo === a.chapterNo && p.lineNo === a.lineNo);
            if (!entry) {
                const line = await tx.storyLine.findFirst({
                    where: { line_no: a.lineNo, chapter: { storyId: story.id, chapter_no: a.chapterNo } },
                    select: { id: true, type: true, npcVoice: true, speaker: true, segments: true },
                });
                if (!line) throw new Error(`${label}: no line ${a.lineNo} in chapter ${a.chapterNo}`);
                entry = {
                    line: { ...line, segments: Array.isArray(line.segments) ? (structuredClone(line.segments) as StorySegment[]) : null },
                    chapterNo: a.chapterNo,
                    lineNo: a.lineNo,
                };
                pending.set(line.id, entry);
            }
            const { line } = entry;
            if (a.segment === undefined || a.segment === null) {
                if (!line.npcVoice) throw new Error(`${label}: line ${a.lineNo} isn't an NPC voice`);
                line.speaker = speaker;
            } else {
                const seg = Number.isInteger(a.segment) ? line.segments?.[a.segment] : undefined;
                if (!seg?.npc) throw new Error(`${label}: segment ${a.segment} of line ${a.lineNo} isn't an NPC voice`);
                if (speaker) seg.speaker = speaker;
                else delete seg.speaker;
            }
        }
        for (const [id, { line, chapterNo, lineNo }] of pending) {
            await tx.storyLine.update({
                where: { id },
                data: line.segments ? { segments: line.segments as object[] } : { speaker: line.speaker },
            });
            updated.push({ chapterNo, lineNo, speaker: line.speaker, segments: line.segments });
        }
        return updated;
    });
}

/** Story authors may name their story's NPC voices; admins may name any. */
async function canNameVoices(slug: string, user: { id: number; role: string }): Promise<boolean | null> {
    const story = await prisma.story.findUnique({ where: { slug }, select: { authors: { select: { id: true } } } });
    if (!story) return null;
    return user.role === "ADMIN" || story.authors.some((a) => a.id === user.id);
}

type ImportChapter = { chapter_no: number; title?: string | null; lines: LineData[] };
type StoryImport = { story: StoryData; chapters: ImportChapter[] };

/**
 * Atomic whole-story import: the story, every chapter and every line in one
 * transaction — it either lands complete or not at all, so "this story
 * exists" always means "this story imported completely". Rejects (409) a
 * slug or title already in use, or content identical to an existing story's.
 */
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

/** Creates chapters and their lines for a story, inside the caller's transaction. */
async function insertChapters(tx: Prisma.TransactionClient, storyId: number, ordered: ImportChapter[]): Promise<number> {
    let lineCount = 0;
    for (const chapter of ordered) {
        const createdChapter = await tx.storyChapter.create({
            data: { storyId, chapter_no: chapter.chapter_no, title: chapter.title ?? null },
        });
        await insertLines(tx, createdChapter.id, 1, chapter.lines);
        lineCount += chapter.lines.length;
    }
    return lineCount;
}

async function importStory(body: StoryImport) {
    const { story, chapters } = body ?? ({} as StoryImport);
    if (!story || typeof story !== "object") throw new Error("body must be { story, chapters }");
    validateStoryData(story, true);
    if (story.authorIds !== undefined) authorRefs(story.authorIds);
    const { ordered, contentHash } = prepareChapters(chapters);
    const seasonTitle = await resolveSeasonTitle(story.season);

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
                contentHash,
            },
        });

        const lineCount = await insertChapters(tx, created.id, ordered);

        const full = await tx.story.findUniqueOrThrow({
            where: { id: created.id },
            include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
        });
        return { ...full, lineCount };
    }, IMPORT_TX_OPTIONS);
}

async function updateLine(slug: string, chapterNo: number, lineNo: number, data: Partial<LineData>) {
    const chapter = await requireChapter(slug, chapterNo);
    const existing = await prisma.storyLine.findUnique({
        where: { chapterId_line_no: { chapterId: chapter.id, line_no: lineNo } },
    });
    if (!existing) throw new Error(`Line ${lineNo} of chapter ${chapterNo} in story '${slug}' not found`);

    const existingSegments = (existing.segments as StorySegment[] | null) ?? null;

    // segments: absent = leave as-is, null = clear, array = replace
    const effectiveSegments: StorySegment[] | null =
        data.segments === undefined ? existingSegments : data.segments;

    // A text-only edit on a segmented line would silently desync text from spans
    if (data.text !== undefined && existingSegments && data.segments === undefined) {
        throw new Error(`Line ${lineNo}: cannot edit text of a segmented line directly — update its segments, or send segments:null to clear them`);
    }

    // Segmented lines derive text from the spans; otherwise take the edit or keep existing
    const effectiveText = effectiveSegments
        ? textFromSegments(effectiveSegments)
        : (data.text !== undefined ? data.text : existing.text);

    const merged = {
        type: data.type ?? existing.type,
        text: effectiveText,
        characterId: data.characterId !== undefined ? data.characterId : existing.characterId,
        speaker: data.speaker !== undefined ? data.speaker : existing.speaker,
        segments: effectiveSegments,
    };
    validateLine(merged as LineData, `Line ${lineNo}`);

    return await prisma.storyLine.update({
        where: { id: existing.id },
        data: {
            type: data.type,
            text: effectiveText,
            characterId: data.characterId,
            speaker: data.speaker,
            segments:
                data.segments === undefined
                    ? undefined
                    : data.segments === null
                      ? Prisma.DbNull
                      : (data.segments as object[]),
        },
        include: { character: true },
    });
}

/**
 * Atomic revision: replaces every chapter and line of an existing story with
 * a new draft in one transaction, keeping the story itself (id, slug, title,
 * authors, season, blurb, theme). Rejects (409) text identical to a
 * *different* story; re-sending the story's own text is allowed and just
 * rewrites it. Line numbers restart at 1 per chapter, so deep links into the
 * story may shift; nothing else hangs off story lines.
 */
async function replaceStoryContent(slug: string, body: { chapters: ImportChapter[] }) {
    const { ordered, contentHash } = prepareChapters(body?.chapters);
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
        await tx.storyLine.deleteMany({ where: { chapter: { storyId: story.id } } });
        await tx.storyChapter.deleteMany({ where: { storyId: story.id } });
        const lineCount = await insertChapters(tx, story.id, ordered);
        await tx.story.update({ where: { id: story.id }, data: { contentHash } });
        const full = await tx.story.findUniqueOrThrow({
            where: { id: story.id },
            include: { authors: AUTHORS_LIST, season: SEASON_SELECT, chapters: CHAPTER_LIST },
        });
        return { ...full, lineCount, voicesCarried };
    }, IMPORT_TX_OPTIONS);
}

export default {
    assignVoices,
    canNameVoices,
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
