import { Router, Request, Response } from "express";
import seasonService from "./season.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";

const initializeSeasonRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/seasons: Return all seasons with their episodes (public)
    router.get("/seasons", async (req: Request, res: Response) => {
        try {
            const seasons = await seasonService.getAllSeasons(req.query.search as string | undefined);
            res.status(200).json({ status: "success", data: seasons });
        } catch (error) {
            console.error("Error fetching seasons:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch seasons" });
        }
    });

    // GET /api/seasons/:title: Return a season by title with its episodes (public)
    router.get("/seasons/:title", async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            const season = await seasonService.getSeasonByTitle(title);
            if (!season) {
                return res.status(404).json({
                    status: "error",
                    message: `Season '${title}' not found`,
                });
            }
            res.status(200).json({ status: "success", data: season });
        } catch (error) {
            console.error("Error fetching season:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch season" });
        }
    });

    // POST /api/seasons: Create a new season
    router.post("/seasons", authenticate, async (req: Request, res: Response) => {
        const { title } = req.body;
        if (!title) {
            return res.status(400).json({ status: "error", message: "title is required" });
        }
        try {
            const season = await seasonService.createSeason(title);
            res.status(201).json({ status: "success", data: season });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/seasons/:title: Rename a season
    router.put("/seasons/:title", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { title } = req.params;
        const { title: newTitle } = req.body;
        if (!newTitle) {
            return res.status(400).json({ status: "error", message: "title is required" });
        }
        try {
            const season = await seasonService.updateSeason(title, newTitle);
            res.status(200).json({ status: "success", data: season });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/seasons/:title: Delete a season by title
    router.delete("/seasons/:title", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            await seasonService.deleteSeason(title);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeSeasonRoutes };
