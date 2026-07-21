import { Router, Request, Response } from "express";
import searchService from "./search.service.js";

const initializeSearchRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/search: Unified keyword search across characters, species,
    // items, transcript messages, and story lines — grouped by category,
    // not merged into a single ranked list (public)
    router.get("/search", async (req: Request, res: Response) => {
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        if (!q) {
            return res.status(400).json({ status: "error", message: "q is required" });
        }
        const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
        try {
            const results = await searchService.searchAll(q, limitParam);
            res.status(200).json({ status: "success", data: results });
        } catch (error) {
            console.error("Error running search:", error);
            res.status(500).json({ status: "error", message: "Search failed" });
        }
    });

    return router;
};

export default { initializeSearchRoutes };
