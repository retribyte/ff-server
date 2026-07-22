import { Router, Request, Response } from "express";
import storyService from "./story.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";

const initializeStoryRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/stories: Return all stories with chapter summaries (public)
    router.get("/stories", async (req: Request, res: Response) => {
        try {
            const stories = await storyService.getAllStories(req.query.search as string | undefined);
            res.status(200).json({ status: "success", data: stories });
        } catch (error) {
            console.error("Error fetching stories:", error);
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
            console.error("Error fetching story:", error);
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
            console.error("Error fetching story lines:", error);
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
