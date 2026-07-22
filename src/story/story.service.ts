import { PrismaClient, Prisma, StoryLineType, StoryFormat } from "@prisma/client";
import { SLUG_PATTERN } from "../utils/slug.js";
import { sanitizeText } from "../utils/sanitize.js";

const prisma = new PrismaClient();

type StorySegment = {
    text: string;
    characterId?: number | null;
    speaker?: string | null;
    italic?: boolean;
    bold?: boolean;
};

type StoryData = {
    slug: string;
    title: string;
    blurb?: string | null;
    authorId?: number | null;
    publishedDate?: string | null;
    themeColor?: string | null;
    themeColor2?: string | null;
    format?: StoryFormat;
};

type LineData = {
    type: StoryLineType;
    text: string;
    characterId?: number | null;
    speaker?: string | null;
    segments?: StorySegment[] | null;
};

const VALID_LINE_TYPES = new Set<string>(Object.values(StoryLineType));
const VALID_FORMATS = new Set<string>(Object.values(StoryFormat));

const AUTHOR_SELECT = { select: { id: true, username: true, icon: true } };
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

async function getAllStories(search?: string) {
    const where = search
        ? {
              OR: [
                  { title: { contains: search, mode: "insensitive" as const } },
                  { blurb: { contains: search, mode: "insensitive" as const } },
              ],
          }
        : undefined;
    return await prisma.story.findMany({
        where,
        orderBy: { title: "asc" },
        include: { author: AUTHOR_SELECT, chapters: CHAPTER_LIST },
    });
}

async function getStoryBySlug(slug: string) {
    return await prisma.story.findUnique({
        where: { slug },
        include: { author: AUTHOR_SELECT, chapters: CHAPTER_LIST },
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

async function createStory(data: StoryData) {
    validateStoryData(data, true);
    return await prisma.story.create({
        data: {
            slug: data.slug,
            title: data.title,
            blurb: data.blurb != null ? sanitizeText(data.blurb) : null,
            authorId: data.authorId ?? null,
            publishedDate: data.publishedDate ? new Date(data.publishedDate) : null,
            themeColor: data.themeColor ?? null,
            themeColor2: data.themeColor2 ?? null,
            format: data.format ?? undefined,
        },
        include: { author: AUTHOR_SELECT, chapters: CHAPTER_LIST },
    });
}

async function updateStory(slug: string, data: Partial<StoryData>) {
    validateStoryData(data as StoryData, false);
    const story = await requireStory(slug);
    return await prisma.story.update({
        where: { id: story.id },
        data: {
            slug: data.slug,
            title: data.title,
            blurb: data.blurb != null ? sanitizeText(data.blurb) : data.blurb,
            authorId: data.authorId,
            publishedDate: data.publishedDate !== undefined
                ? (data.publishedDate ? new Date(data.publishedDate) : null)
                : undefined,
            themeColor: data.themeColor,
            themeColor2: data.themeColor2,
            format: data.format,
        },
        include: { author: AUTHOR_SELECT, chapters: CHAPTER_LIST },
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
        if (segment.characterId || segment.speaker || segment.italic || segment.bold) annotated = true;
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
    // Dialogue needs a speaking voice — a linked character or a display name
    if (line.type === StoryLineType.DIALOGUE && !line.characterId && !line.speaker) {
        throw new Error(`${label}: DIALOGUE lines require characterId or speaker`);
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

        await tx.storyLine.createMany({
            data: lines.map((line, index) => ({
                chapterId: chapter.id,
                line_no: firstLineNo + index,
                type: line.type,
                // Segmented lines derive `text` from the spans so the two can't desync
                text: hasSegments(line) ? textFromSegments(line.segments) : line.text,
                characterId: line.characterId ?? null,
                speaker: line.speaker ?? null,
                segments: hasSegments(line) ? (line.segments as object[]) : undefined,
            })),
        });

        return { count: lines.length, firstLineNo, lastLineNo: firstLineNo + lines.length - 1 };
    });
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

export default {
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
    updateLine,
    getStoryQuotesByCharacter,
};
