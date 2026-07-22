import { Router, Request, Response } from "express";
import storyService from "./story.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { sendSuccess, sendResult, sendError, sendCaughtError } from "../utils/http.js";
import { NotFoundError } from "../utils/errors.js";

const initializeStoryRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/stories: Return all stories with chapter summaries (public)
    router.get("/stories", async (req: Request, res: Response) => {
        try {
            const stories = await storyService.getAllStories(req.query.search as string | undefined);
            sendSuccess(res, stories);
        } catch (error) {
            console.error("Error fetching stories:", error);
            sendError(res, "Failed to fetch stories", 500);
        }
    });

    // GET /api/stories/:slug: Return a story by slug with chapter summaries (public)
    router.get("/stories/:slug", async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const story = await storyService.getStoryBySlug(slug);
            if (!story) {
                return sendError(res, `Story '${slug}' not found`, 404);
            }
            sendSuccess(res, story);
        } catch (error) {
            console.error("Error fetching story:", error);
            sendError(res, "Failed to fetch story", 500);
        }
    });

    // POST /api/stories: Create a new story
    router.post("/stories", authenticate, async (req: Request, res: Response) => {
        try {
            const story = await storyService.createStory(req.body);
            sendSuccess(res, story, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/stories/:slug: Update story metadata (incl. rename/reslug)
    router.put("/stories/:slug", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const story = await storyService.updateStory(slug, req.body);
            sendSuccess(res, story);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // DELETE /api/stories/:slug: Delete a story with its chapters and lines
    router.delete("/stories/:slug", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            await storyService.deleteStory(slug);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // POST /api/stories/:slug/chapters: Add a chapter (auto-numbered when chapter_no omitted)
    router.post("/stories/:slug/chapters", authenticate, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const chapter = await storyService.createChapter(slug, req.body ?? {});
            sendSuccess(res, chapter, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/stories/:slug/chapters/:chapterNo: Retitle a chapter
    router.put("/stories/:slug/chapters/:chapterNo", authenticate, async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        try {
            const chapter = await storyService.updateChapter(slug, chapterNo, req.body);
            sendSuccess(res, chapter);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // DELETE /api/stories/:slug/chapters/:chapterNo: Delete a chapter and its lines
    router.delete("/stories/:slug/chapters/:chapterNo", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        try {
            await storyService.deleteChapter(slug, chapterNo);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, error);
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
            sendResult(res, result);
        } catch (error) {
            if (error instanceof NotFoundError) {
                return sendError(res, error.message, 404);
            }
            console.error("Error fetching story lines:", error);
            sendError(res, "Failed to fetch story lines", 500);
        }
    });

    // POST /api/stories/:slug/chapters/:chapterNo/lines: Bulk-append lines { lines: [...] }
    router.post("/stories/:slug/chapters/:chapterNo/lines", authenticate, async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        if (!Array.isArray(req.body?.lines)) {
            return sendError(res, "body must be { lines: [...] }", 400);
        }
        try {
            const result = await storyService.createLines(slug, chapterNo, req.body.lines);
            sendSuccess(res, result, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/stories/:slug/chapters/:chapterNo/lines/:lineNo: Edit one line
    router.put("/stories/:slug/chapters/:chapterNo/lines/:lineNo", authenticate, async (req: Request, res: Response) => {
        const { slug } = req.params;
        const chapterNo = parseInt(req.params.chapterNo, 10);
        const lineNo = parseInt(req.params.lineNo, 10);
        try {
            const line = await storyService.updateLine(slug, chapterNo, lineNo, req.body);
            sendSuccess(res, line);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeStoryRoutes };
