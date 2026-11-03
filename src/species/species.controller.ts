import { Router, Request, Response } from "express";
import speciesService from "./species.service.js";

// Read-only species, served from the wiki cache (see species.service.ts).
// The wiki owns species lore; there's no write path here.
const initializeSpeciesRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/species: every cached species, optionally searched by slug or name (public)
    router.get("/species", async (req: Request, res: Response) => {
        try {
            const species = await speciesService.getAllSpecies(req.query.search as string | undefined);
            res.status(200).json({ status: "success", data: species });
        } catch (error) {
            console.error("Error fetching species:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch species" });
        }
    });

    // GET /api/species/:slug: one cached species (public)
    router.get("/species/:slug", async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const species = await speciesService.getSpeciesBySlug(slug);
            if (!species) {
                return res.status(404).json({ status: "error", message: `Species with slug '${slug}' not found` });
            }
            res.status(200).json({ status: "success", data: species });
        } catch (error) {
            console.error("Error fetching species:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch species" });
        }
    });

    return router;
};

export default { initializeSpeciesRoutes };
