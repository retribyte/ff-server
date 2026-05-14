import { Router, Request, Response } from "express";
import speciesService from "./species.service.js";
import { authenticate } from "../auth/security.middleware.js";

const initializeSpeciesRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/species: Return all species with their associated characters
    router.get("/species", async (req: Request, res: Response) => {
        try {
            const species = await speciesService.getAllSpecies();
            res.status(200).json({ status: "success", data: species });
        } catch (error) {
            console.error("Error fetching species:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch species" });
        }
    });

    // GET /api/species/:id: Return a species by id with all associated characters
    router.get("/species/:id", async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const species = await speciesService.getSpeciesById(id);
            if (!species) {
                return res.status(404).json({
                    status: "error",
                    message: `Species with id '${id}' not found`,
                });
            }
            res.status(200).json({ status: "success", data: species });
        } catch (error) {
            console.error("Error fetching species:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch species" });
        }
    });

    // POST /api/species: Create a new species
    router.post("/species", authenticate, async (req: Request, res: Response) => {
        try {
            const species = await speciesService.createSpecies(req.body);
            res.status(201).json({ status: "success", data: species });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/species/:id: Update a species by id
    router.put("/species/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const species = await speciesService.updateSpecies(id, req.body);
            res.status(200).json({ status: "success", data: species });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/species/:id: Delete a species by id
    router.delete("/species/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            await speciesService.deleteSpecies(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeSpeciesRoutes };
