import { Router, Request, Response } from "express";
import viewService, { VIEW_KINDS } from "./view.service.js";
import { authenticate, isAdmin, optionalUser } from "../auth/security.middleware.js";
import { logger } from "../utils/logger.js";

// Aggregate page-view counters (no per-user records)
const initializeViewRoutes = (): Router => {
    const router = Router();

    // POST /api/views {kind: "episode"|"story", slug}: count one view, as a signed-in
    // member or anonymous depending on the token (public; a bad token counts as anonymous)
    router.post("/views", async (req: Request, res: Response) => {
        const kind = typeof req.body?.kind === "string" ? VIEW_KINDS[req.body.kind] : undefined;
        const slug = req.body?.slug;
        if (!kind || typeof slug !== "string" || !slug || slug.length > 200) {
            return res.status(400).json({ status: "error", message: "kind (episode|story) and slug are required" });
        }
        try {
            const user = await optionalUser(req);
            const counted = await viewService.recordView(kind, slug, user !== null);
            if (!counted) return res.status(404).json({ status: "error", message: "No such episode or story" });
            return res.status(200).json({ status: "success", data: null });
        } catch (error) {
            logger.caught("Error recording view", error);
            return res.status(500).json({ status: "error", message: "Failed to record view" });
        }
    });

    // GET /api/admin/views?days=30&kind=&limit=: views per episode/story, most viewed first (admin)
    router.get("/admin/views", authenticate, isAdmin, async (req: Request, res: Response) => {
        const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 365);
        const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1), 200);
        const kind = typeof req.query.kind === "string" ? VIEW_KINDS[req.query.kind] : undefined;
        try {
            return res.status(200).json({ status: "success", data: await viewService.getViewTotals(days, kind, limit) });
        } catch (error) {
            logger.caught("Error fetching view totals", error);
            return res.status(500).json({ status: "error", message: "Failed to fetch views" });
        }
    });

    return router;
};

export default { initializeViewRoutes };
