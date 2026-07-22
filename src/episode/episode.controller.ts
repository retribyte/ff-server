import { Router, Request, Response } from "express";
import episodeService from "./episode.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { sendSuccess, sendError, sendCaughtError } from "../utils/http.js";

const initializeEpisodeRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/episodes: Return all episodes, optionally searched by title (public)
    router.get("/episodes", async (req: Request, res: Response) => {
        try {
            const episodes = await episodeService.getAllEpisodes(req.query.search as string | undefined);
            sendSuccess(res, episodes);
        } catch (error) {
            console.error("Error fetching episodes:", error);
            sendError(res, "Failed to fetch episodes", 500);
        }
    });

    // GET /api/episodes/:title: Return an episode by title with its season and ordered messages (public)
    router.get("/episodes/:title", async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            const episode = await episodeService.getEpisodeByTitle(title);
            if (!episode) {
                return sendError(res, `Episode '${title}' not found`, 404);
            }
            sendSuccess(res, episode);
        } catch (error) {
            console.error("Error fetching episode:", error);
            sendError(res, "Failed to fetch episode", 500);
        }
    });

    // POST /api/episodes: Create a new episode within a season
    router.post("/episodes", authenticate, async (req: Request, res: Response) => {
        try {
            const episode = await episodeService.createEpisode(req.body);
            sendSuccess(res, episode, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/episodes/:title: Update an episode's metadata by title
    router.put("/episodes/:title", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            const episode = await episodeService.updateEpisode(title, req.body);
            sendSuccess(res, episode);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // DELETE /api/episodes/:title: Delete an episode and its messages by title
    router.delete("/episodes/:title", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            await episodeService.deleteEpisode(title);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeEpisodeRoutes };
