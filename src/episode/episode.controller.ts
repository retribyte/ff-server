import { Router, Request, Response } from "express";
import episodeService from "./episode.service.js";
import { authenticate } from "../auth/security.middleware.js";

const initializeEpisodeRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/episodes: Return all episodes with their season and messages
    router.get("/episodes", async (req: Request, res: Response) => {
        try {
            const episodes = await episodeService.getAllEpisodes();
            res.status(200).json({ status: "success", data: episodes });
        } catch (error) {
            console.error("Error fetching episodes:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch episodes" });
        }
    });

    // GET /api/episodes/:title: Return an episode by title with its season and ordered messages
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
            console.error("Error fetching episode:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch episode" });
        }
    });

    // POST /api/episodes: Create a new episode within a season
    router.post("/episodes", authenticate, async (req: Request, res: Response) => {
        try {
            const episode = await episodeService.createEpisode(req.body);
            res.status(201).json({ status: "success", data: episode });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/episodes/:title: Update an episode's metadata by title
    router.put("/episodes/:title", authenticate, async (req: Request, res: Response) => {
        const { title } = req.params;
        try {
            const episode = await episodeService.updateEpisode(title, req.body);
            res.status(200).json({ status: "success", data: episode });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/episodes/:title: Delete an episode and its messages by title
    router.delete("/episodes/:title", authenticate, async (req: Request, res: Response) => {
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
