import { Router, Request, Response } from "express";
import episodeService from "./episode.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { logger } from "../utils/logger.js";

const initializeEpisodeRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/episodes: Return all episodes, optionally searched by title (public)
    router.get("/episodes", async (req: Request, res: Response) => {
        try {
            const episodes = await episodeService.getAllEpisodes(req.query.search as string | undefined);
            res.status(200).json({ status: "success", data: episodes });
        } catch (error) {
            logger.caught("Error fetching episodes", error);
            res.status(500).json({ status: "error", message: "Failed to fetch episodes" });
        }
    });

    // GET /api/episodes/:title: Return an episode by title with its season and ordered messages (public)
    router.get("/episodes/:title", async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            const episode = await episodeService.getEpisodeByTitle(title);
            if (!episode) {
                return res.status(404).json({
                    status: "error",
                    message: `Episode '${title}' not found`,
                });
            }
            res.status(200).json({ status: "success", data: episode });
        } catch (error) {
            logger.caught("Error fetching episode", error);
            res.status(500).json({ status: "error", message: "Failed to fetch episode" });
        }
    });

    // POST /api/episodes: Create a new episode within a season
    router.post("/episodes", authenticate, isAdmin, async (req: Request, res: Response) => {
        try {
            const episode = await episodeService.createEpisode(req.body);
            res.status(201).json({ status: "success", data: episode });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // POST /api/episodes/import: RETIRED, 410 Gone. Admins import and update
    // episodes with POST /api/admin/episode-import (the site's /admin page),
    // which takes md-to-api.py's JSON as is.
    router.post("/episodes/import", (_req: Request, res: Response) => {
        res.status(410).json({
            status: "error",
            message: "Episode import is retired — the transcript archive is seeded. Use the /admin page's episode import.",
        });
    });

    // PUT /api/episodes/:title: Update an episode's metadata by title
    router.put("/episodes/:title", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            const episode = await episodeService.updateEpisode(title, req.body);
            res.status(200).json({ status: "success", data: episode });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/episodes/:title: Delete an episode and its messages by title
    router.delete("/episodes/:title", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            await episodeService.deleteEpisode(title);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeEpisodeRoutes };
