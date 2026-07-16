import { Router, Request, Response } from "express";
import speciesService from "./species.service.js";
import { authenticate } from "../auth/security.middleware.js";
import { UserRole } from "@prisma/client";

const initializeSpeciesRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/species: Return all species, optionally searched by name (public)
    router.get("/species", async (req: Request, res: Response) => {
        try {
            const species = await speciesService.getAllSpecies(req.query.search as string | undefined);
            res.status(200).json({ status: "success", data: species });
        } catch (error) {
            console.error("Error fetching species:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch species" });
        }
    });

    // GET /api/species/:id: Return a species by id with all associated
    // characters, or by slug when the param isn't a bare integer (public)
    router.get("/species/:id", async (req: Request, res: Response) => {
        const { id: param } = req.params;
        const isId = /^\d+$/.test(param);
        try {
            const species = isId
                ? await speciesService.getSpeciesById(parseInt(param, 10))
                : await speciesService.getSpeciesBySlug(param);
            if (!species) {
                return res.status(404).json({
                    status: "error",
                    message: isId
                        ? `Species with id '${param}' not found`
                        : `Species with slug '${param}' not found`,
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
            const species = await speciesService.createSpecies({ ...req.body, creatorId: req.user!.id });
            res.status(201).json({ status: "success", data: species });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/species/:id: Update a species by id
    router.put("/species/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const species = await speciesService.getSpeciesById(id);
            if (!species) {
                return res.status(404).json({ status: "error", message: `Species with id '${id}' not found` });
            }
            if (species.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const updated = await speciesService.updateSpecies(id, req.body);
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/species/:id: Delete a species by id
    router.delete("/species/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const species = await speciesService.getSpeciesById(id);
            if (!species) {
                return res.status(404).json({ status: "error", message: `Species with id '${id}' not found` });
            }
            if (species.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            await speciesService.deleteSpecies(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeSpeciesRoutes };
