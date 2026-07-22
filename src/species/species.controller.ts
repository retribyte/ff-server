import { Router, Request, Response } from "express";
import speciesService from "./species.service.js";
import { authenticate } from "../auth/security.middleware.js";
import { assertOwnerOrAdmin } from "../auth/ownership.js";
import { sendSuccess, sendError, sendCaughtError } from "../utils/http.js";

const initializeSpeciesRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/species: Return all species, optionally searched by name (public)
    router.get("/species", async (req: Request, res: Response) => {
        try {
            const species = await speciesService.getAllSpecies(req.query.search as string | undefined);
            sendSuccess(res, species);
        } catch (error) {
            console.error("Error fetching species:", error);
            sendError(res, "Failed to fetch species", 500);
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
                return sendError(
                    res,
                    isId ? `Species with id '${param}' not found` : `Species with slug '${param}' not found`,
                    404
                );
            }
            sendSuccess(res, species);
        } catch (error) {
            console.error("Error fetching species:", error);
            sendError(res, "Failed to fetch species", 500);
        }
    });

    // POST /api/species: Create a new species
    router.post("/species", authenticate, async (req: Request, res: Response) => {
        try {
            const species = await speciesService.createSpecies({ ...req.body, creatorId: req.user!.id });
            sendSuccess(res, species, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/species/:id: Update a species by id
    router.put("/species/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const species = await speciesService.getSpeciesById(id);
            if (!species) {
                return sendError(res, `Species with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, species.creatorId)) return;
            const updated = await speciesService.updateSpecies(id, req.body);
            sendSuccess(res, updated);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // DELETE /api/species/:id: Delete a species by id
    router.delete("/species/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const species = await speciesService.getSpeciesById(id);
            if (!species) {
                return sendError(res, `Species with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, species.creatorId)) return;
            await speciesService.deleteSpecies(id);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeSpeciesRoutes };
