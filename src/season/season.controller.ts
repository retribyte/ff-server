import { Router, Request, Response } from "express";
import seasonService from "./season.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { sendSuccess, sendError, sendCaughtError } from "../utils/http.js";

const initializeSeasonRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/seasons: Return all seasons with their episodes (public)
    router.get("/seasons", async (req: Request, res: Response) => {
        try {
            const seasons = await seasonService.getAllSeasons(req.query.search as string | undefined);
            sendSuccess(res, seasons);
        } catch (error) {
            console.error("Error fetching seasons:", error);
            sendError(res, "Failed to fetch seasons", 500);
        }
    });

    // GET /api/seasons/:title: Return a season by title with its episodes (public)
    router.get("/seasons/:title", async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            const season = await seasonService.getSeasonByTitle(title);
            if (!season) {
                return sendError(res, `Season '${title}' not found`, 404);
            }
            sendSuccess(res, season);
        } catch (error) {
            console.error("Error fetching season:", error);
            sendError(res, "Failed to fetch season", 500);
        }
    });

    // POST /api/seasons: Create a new season
    router.post("/seasons", authenticate, async (req: Request, res: Response) => {
        const { title, slug } = req.body;
        if (!title) {
            return sendError(res, "title is required", 400);
        }
        try {
            const season = await seasonService.createSeason(title, slug);
            sendSuccess(res, season, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/seasons/:title: Rename a season
    router.put("/seasons/:title", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { title } = req.params;
        const { title: newTitle, slug } = req.body;
        if (!newTitle) {
            return sendError(res, "title is required", 400);
        }
        try {
            const season = await seasonService.updateSeason(title, newTitle, slug);
            sendSuccess(res, season);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // DELETE /api/seasons/:title: Delete a season by title
    router.delete("/seasons/:title", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            await seasonService.deleteSeason(title);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeSeasonRoutes };
