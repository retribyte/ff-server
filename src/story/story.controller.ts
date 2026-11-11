import { Router, Request, Response } from "express";
import storyService from "./story.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { importJson, importErrorResponse } from "../utils/import.js";
import { analyzeDocx, convertDocx, DocxError, ManuscriptError } from "./convert/index.js";
import { logger } from "../utils/logger.js";
import { runJob, JobBusyError } from "../jobs/runner.js";
import { STORY_VOICE_NAME_JOB } from "../admin/archiveFixes.js";

const initializeStoryRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/stories: Return all stories with chapter summaries (public)
    router.get("/stories", async (req: Request, res: Response) => {
        try {
            const stories = await storyService.getAllStories(req.query.search as string | undefined, req.query.season as string | undefined);
            res.status(200).json({ status: "success", data: stories });
        } catch (error) {
            logger.caught("Error fetching stories", error);
            res.status(500).json({ status: "error", message: "Failed to fetch stories" });
        }
    });

    // GET /api/stories/:slug: Return a story by slug with chapter summaries (public)
    router.get("/stories/:slug", async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const story = await storyService.getStoryBySlug(slug);
            if (!story) {
                return res.status(404).json({ status: "error", message: `Story '${slug}' not found` });
            }
            res.status(200).json({ status: "success", data: story });
        } catch (error) {
            logger.caught("Error fetching story", error);
            res.status(500).json({ status: "error", message: "Failed to fetch story" });
        }
    });

    // POST /api/stories: Create a new story
    router.post("/stories", authenticate, isAdmin, async (req: Request, res: Response) => {
        try {
            const story = await storyService.createStory(req.body);
            res.status(201).json({ status: "success", data: story });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // POST /api/stories/import: Atomic whole-story import { story, chapters: [{ chapter_no, title?, lines }] }.
    // All or nothing; 409 when the slug/title is taken or the text duplicates an existing story.
    // Any member may import; a member is always among the story's authors (added if missing).
    router.post("/stories/import", authenticate, importJson, async (req: Request, res: Response) => {
        try {
            const user = req.user as { id: number; role: string };
            const body = req.body ?? {};
            if (user.role !== "ADMIN" && body.story && typeof body.story === "object") {
                const ids = Array.isArray(body.story.authorIds) ? body.story.authorIds : [];
                if (!ids.includes(user.id)) body.story.authorIds = [...ids, user.id];
            }
            const story = await storyService.importStory(body);
            res.status(201).json({ status: "success", data: story });
        } catch (error: any) {
            const { status, message } = importErrorResponse(error, "story");
            res.status(status).json({ status: "error", message });
        }
    });

    // POST /api/stories/convert: Google Docs .docx -> story. Body { docx: base64, fileName?, meta? }.
    // Without meta: an analysis (colors with samples, title/blurb defaults, picture count) for the
    // color -> speaker form. With meta {title, format, colors: {hex: name|null}, ...}: the import
    // payload {story, authors, chapters} (speakers as names) plus the manuscript and warnings.
    // Writes nothing. Any member (it's the first step of an import).
    router.post("/stories/convert", authenticate, importJson, async (req: Request, res: Response) => {
        const { docx, fileName, meta } = req.body ?? {};
        if (typeof docx !== "string" || !docx) {
            return res.status(400).json({ status: "error", message: "body must be { docx: <base64 .docx>, meta? }" });
        }
        try {
            const data = new Uint8Array(Buffer.from(docx, "base64"));
            const result = meta ? convertDocx(data, meta) : analyzeDocx(data, typeof fileName === "string" ? fileName : undefined);
            res.status(200).json({ status: "success", data: result });
        } catch (error: any) {
            if (error instanceof DocxError || error instanceof ManuscriptError) {
                return res.status(400).json({ status: "error", message: error.message });
            }
            logger.caught("Story conversion failed", error);
            res.status(500).json({ status: "error", message: "Conversion failed" });
        }
    });

    // PUT /api/stories/:slug/import: Atomic revision { chapters: [...] } — replaces
    // every chapter and line, keeping the story's metadata. 404 unknown slug,
    // 409 when the text duplicates a different story. The story's authors or an admin.
    router.put("/stories/:slug/import", authenticate, importJson, async (req: Request, res: Response) => {
        try {
            const allowed = await storyService.isAuthorOrAdmin(req.params.slug, req.user as { id: number; role: string });
            if (allowed === null) return res.status(404).json({ status: "error", message: `Story '${req.params.slug}' not found` });
            if (!allowed) {
                return res.status(403).json({ status: "error", message: "Only this story's authors or an admin can replace its text" });
            }
            const story = await storyService.replaceStoryContent(req.params.slug, req.body);
            res.status(200).json({ status: "success", data: story });
        } catch (error: any) {
            if (/^Story '.*' not found$/.test(error?.message ?? "")) {
                return res.status(404).json({ status: "error", message: error.message });
            }
            const { status, message } = importErrorResponse(error, "story");
            res.status(status).json({ status: "error", message });
        }
    });

    // PATCH /api/stories/:slug/published-date: set or clear the story's real-world
    // publication date. Body { publishedDate: "YYYY-MM-DD" | null }. The one
    // metadata write open to a story's authors (besides admins); everything else
    // on PUT /stories/:slug stays admin. Returns { slug, publishedDate }.
    router.patch("/stories/:slug/published-date", authenticate, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const allowed = await storyService.isAuthorOrAdmin(slug, req.user as { id: number; role: string });
            if (allowed === null) return res.status(404).json({ status: "error", message: `Story '${slug}' not found` });
            if (!allowed) {
                return res.status(403).json({ status: "error", message: "Only this story's authors or an admin can change its published date" });
            }
            const updated = await storyService.setPublishedDate(slug, req.body?.publishedDate);
            if (updated === null) return res.status(404).json({ status: "error", message: `Story '${slug}' not found` });
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PATCH /api/stories/:slug/voices: re-voice quotes as you read.
    // Body { assignments: [{ chapterNo, lineNo, segment?, speaker? | characterId?, personaId? }] }:
    // segment (0-based) picks a span of a NARRATION line; omit it for a whole
    // line. speaker names an NPC (found or created); characterId (optionally
    // with one of its personaIds) or an NPC personaId picks a voice by id, which
    // runs as a 'story-voice-name' job in the admin History. Only fragments that
    // already have a voice can change, so text and narration can't. NPC personas
    // left with no lines are deleted. Story authors or admins; returns the
    // updated lines.
    router.patch("/stories/:slug/voices", authenticate, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const allowed = await storyService.isAuthorOrAdmin(slug, req.user as { id: number; role: string });
            if (allowed === null) return res.status(404).json({ status: "error", message: `Story '${slug}' not found` });
            if (!allowed) {
                return res.status(403).json({ status: "error", message: "Only this story's authors or an admin can change its voices" });
            }
            // Linking a real character changes attribution, so it's recorded in
            // the admin History like the other data fixes (story authors and
            // admins, the user's call 2026-11-09)
            if (storyService.linksCharacters(req.body?.assignments)) {
                const story = await storyService.getStoryBySlug(slug);
                if (!story) return res.status(404).json({ status: "error", message: `Story '${slug}' not found` });
                let updated: unknown = [];
                const run = await runJob(STORY_VOICE_NAME_JOB, (req.user as { id: number }).id, false, async ({ tx, log }) => {
                    updated = await storyService.assignVoicesTx(tx, story.id, req.body.assignments, log);
                    return `${story.title}: re-voiced ${(req.body.assignments as unknown[]).length} quote(s) by character or persona`;
                });
                if (run.status === "FAILED") return res.status(400).json({ status: "error", message: run.summary ?? "Linking failed" });
                return res.status(200).json({ status: "success", data: updated });
            }
            const updated = await storyService.assignVoices(slug, req.body?.assignments);
            if (updated === null) return res.status(404).json({ status: "error", message: `Story '${slug}' not found` });
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            if (error instanceof JobBusyError) return res.status(409).json({ status: "error", message: error.message });
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // POST /api/stories/:slug/voices/carry: a revision draft { chapters } with its
    // unnamed NPC quotes filled from the voices the story's unchanged text has
    // now, for the importer to pre-fill its naming step. Writes nothing. The
    // story's authors or an admin (the same people who may revise it).
    router.post("/stories/:slug/voices/carry", authenticate, importJson, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const allowed = await storyService.isAuthorOrAdmin(slug, req.user as { id: number; role: string });
            if (allowed === null) return res.status(404).json({ status: "error", message: `Story '${slug}' not found` });
            if (!allowed) {
                return res.status(403).json({ status: "error", message: "Only this story's authors or an admin can revise it" });
            }
            const result = await storyService.carryStoryVoices(slug, req.body);
            if (result === null) return res.status(404).json({ status: "error", message: `Story '${slug}' not found` });
            res.status(200).json({ status: "success", data: result });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/stories/:slug: Update story metadata (incl. rename/reslug)
    router.put("/stories/:slug", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const story = await storyService.updateStory(slug, req.body);
            res.status(200).json({ status: "success", data: story });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/stories/:slug: Delete a story with its chapters and lines
    router.delete("/stories/:slug", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            await storyService.deleteStory(slug);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // POST /api/stories/:slug/chapters: Add a chapter (auto-numbered when chapter_no omitted)
    router.post("/stories/:slug/chapters", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const chapter = await storyService.createChapter(slug, req.body ?? {});
            res.status(201).json({ status: "success", data: chapter });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/stories/:slug/chapters/:chapterNo: Retitle a chapter
    router.put("/stories/:slug/chapters/:chapterNo", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        try {
            const chapter = await storyService.updateChapter(slug, chapterNo, req.body);
            res.status(200).json({ status: "success", data: chapter });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/stories/:slug/chapters/:chapterNo: Delete a chapter and its lines
    router.delete("/stories/:slug/chapters/:chapterNo", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        try {
            await storyService.deleteChapter(slug, chapterNo);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // GET /api/stories/:slug/chapters/:chapterNo/lines: Paginated lines ordered by line_no
    router.get("/stories/:slug/chapters/:chapterNo/lines", async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
        const search = req.query.search as string | undefined;
        try {
            const result = await storyService.getLinesByChapter(slug, chapterNo, page, limit, search);
            res.status(200).json({ status: "success", ...result });
        } catch (error: any) {
            if (/not found/.test(error.message ?? "")) {
                return res.status(404).json({ status: "error", message: error.message });
            }
            logger.caught("Error fetching story lines", error);
            res.status(500).json({ status: "error", message: "Failed to fetch story lines" });
        }
    });

    // POST /api/stories/:slug/chapters/:chapterNo/lines: Bulk-append lines { lines: [...] }
    router.post("/stories/:slug/chapters/:chapterNo/lines", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        if (!Array.isArray(req.body?.lines)) {
            return res.status(400).json({ status: "error", message: "body must be { lines: [...] }" });
        }
        try {
            const result = await storyService.createLines(slug, chapterNo, req.body.lines);
            res.status(201).json({ status: "success", data: result });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/stories/:slug/chapters/:chapterNo/lines/:lineNo: Edit one line
    router.put("/stories/:slug/chapters/:chapterNo/lines/:lineNo", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        const lineNo = parseInt(req.params.lineNo, 10);
        try {
            const line = await storyService.updateLine(slug, chapterNo, lineNo, req.body);
            res.status(200).json({ status: "success", data: line });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeStoryRoutes };
