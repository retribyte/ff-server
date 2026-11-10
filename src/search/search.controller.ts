import { Router, Request, Response } from "express";
import searchService, { SEARCH_CATEGORIES, type SearchCategory } from "./search.service.js";
import { parseSearchOptions } from "./search-options.js";
import { logger } from "../utils/logger.js";

const initializeSearchRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/search: Unified keyword search across characters,
    // items, transcript messages, and story lines — grouped by category,
    // not merged into a single ranked list (public). With ?category=
    // (messages|storyLines|commentaries) set, switches to paginated single-category
    // mode for the dedicated search-results page — {data,total,page,limit}
    // instead of the grouped envelope — which also takes ?sort=relevance|appearance,
    // ?dir=asc|desc (appearance only) and ?exclude=<season slugs, comma-separated>.
    // Omitting/invalidating ?category falls through to the grouped behavior.
    router.get("/search", async (req: Request, res: Response) => {
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        if (!q) {
            return res.status(400).json({ status: "error", message: "q is required" });
        }
        const category = req.query.category as string | undefined;
        const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
        try {
            if (category && (SEARCH_CATEGORIES as readonly string[]).includes(category)) {
                const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
                const result = await searchService.searchCategory(
                    category as SearchCategory,
                    q,
                    page,
                    limitParam,
                    parseSearchOptions(req.query)
                );
                return res.status(200).json({ status: "success", ...result });
            }
            const results = await searchService.searchAll(q, limitParam);
            res.status(200).json({ status: "success", data: results });
        } catch (error) {
            logger.caught("Error running search", error);
            res.status(500).json({ status: "error", message: "Search failed" });
        }
    });

    return router;
};

export default { initializeSearchRoutes };
