import { PrismaClient, StoryLineType } from "@prisma/client";

const prisma = new PrismaClient();

type StoryData = {
    slug: string;
    title: string;
    blurb?: string | null;
    authorId?: number | null;
    publishedDate?: string | null;
    themeColor?: string | null;
    themeColor2?: string | null;
};

type LineData = {
    type: StoryLineType;
    text: string;
    characterId?: number | null;
    speaker?: string | null;
};

const SLUG_PATTERN = /^[a-z0-9-]+$/;
const VALID_LINE_TYPES = new Set<string>(Object.values(StoryLineType));

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
            throw new Error("slug must match ^[a-z0-9-]+$");
        }
    }
    if (requireAll && (typeof data.title !== "string" || data.title.length === 0)) {
        throw new Error("title is required");
    }
}

async function createStory(data: StoryData) {
    validateStoryData(data, true);
    return await prisma.story.create({
        data: {
            slug: data.slug,
            title: data.title,
            blurb: data.blurb ?? null,
            authorId: data.authorId ?? null,
            publishedDate: data.publishedDate ? new Date(data.publishedDate) : null,
            themeColor: data.themeColor ?? null,
            themeColor2: data.themeColor2 ?? null,
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
            blurb: data.blurb,
            authorId: data.authorId,
            publishedDate: data.publishedDate !== undefined
                ? (data.publishedDate ? new Date(data.publishedDate) : null)
                : undefined,
            themeColor: data.themeColor,
            themeColor2: data.themeColor2,
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
    return { data, total, page, limit };
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
                text: line.text,
                characterId: line.characterId ?? null,
                speaker: line.speaker ?? null,
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

    const merged = { ...existing, ...data };
    validateLine(merged as LineData, `Line ${lineNo}`);

    return await prisma.storyLine.update({
        where: { id: existing.id },
        data: {
            type: data.type,
            text: data.text,
            characterId: data.characterId,
            speaker: data.speaker,
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
};
