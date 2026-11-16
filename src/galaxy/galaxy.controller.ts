import { Router, Request, Response } from "express";
import { Prisma, UserRole } from "@prisma/client";
import galaxyService, { GalaxyConflictError } from "./galaxy.service.js";
import { GalaxyInputError } from "./galaxy.validation.js";
import { authenticate } from "../auth/security.middleware.js";
import { logger } from "../utils/logger.js";

// The galaxy map. Reading is public. Any member adds a place and tags episodes; a
// place and its bodies are edited by the place's creator or an admin.

/** Answers a failed write: 400 for a broken rule, 409 for a taken name, else 500. */
function fail(res: Response, what: string, error: unknown) {
    if (error instanceof GalaxyInputError) return res.status(400).json({ status: "error", message: error.message });
    const unique = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (error instanceof GalaxyConflictError || unique) {
        return res.status(409).json({ status: "error", message: unique ? "That name is already on the map" : (error as Error).message });
    }
    logger.caught(what, error);
    res.status(500).json({ status: "error", message: what });
}

const mayEdit = (req: Request, creatorId: number) => creatorId === req.user!.id || req.user!.role === UserRole.ADMIN;

/** The :id of a row, or null (answered 404) when it is not a number. */
function idParam(req: Request, res: Response, what: string): number | null {
    if (/^\d+$/.test(req.params.id)) return parseInt(req.params.id, 10);
    res.status(404).json({ status: "error", message: `${what} '${req.params.id}' not found` });
    return null;
}

const initializeGalaxyRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/galaxy/places: Every place with its bodies (public)
    router.get("/galaxy/places", async (req: Request, res: Response) => {
        try {
            res.status(200).json({ status: "success", data: await galaxyService.getAllPlaces() });
        } catch (error) {
            fail(res, "Failed to fetch the map", error);
        }
    });

    // GET /api/galaxy/places/:id: One place by id or slug, with bodies and travelogue (public)
    router.get("/galaxy/places/:id", async (req: Request, res: Response) => {
        const { id: param } = req.params;
        try {
            const place = /^\d+$/.test(param) ? await galaxyService.getPlaceById(parseInt(param, 10)) : await galaxyService.getPlaceBySlug(param);
            if (!place) return res.status(404).json({ status: "error", message: `Place '${param}' not found` });
            res.status(200).json({ status: "success", data: place });
        } catch (error) {
            fail(res, "Failed to fetch the place", error);
        }
    });

    // POST /api/galaxy/places: Add a system (with its star) or a landmark (any member)
    router.post("/galaxy/places", authenticate, async (req: Request, res: Response) => {
        try {
            const place = await galaxyService.createPlace(req.body, req.user!.id);
            res.status(201).json({ status: "success", data: place });
        } catch (error) {
            fail(res, "Failed to add the place", error);
        }
    });

    // PATCH /api/galaxy/places/:id: Rename, move or describe a place (creator or admin)
    router.patch("/galaxy/places/:id", authenticate, async (req: Request, res: Response) => {
        const id = idParam(req, res, "Place");
        if (id === null) return;
        try {
            const place = await galaxyService.getPlaceOwner(id);
            if (!place) return res.status(404).json({ status: "error", message: `Place '${id}' not found` });
            if (!mayEdit(req, place.creatorId)) return res.status(403).json({ status: "error", message: "Forbidden" });
            res.status(200).json({ status: "success", data: await galaxyService.updatePlace(id, req.body) });
        } catch (error) {
            fail(res, "Failed to change the place", error);
        }
    });

    // DELETE /api/galaxy/places/:id: Remove a place, its bodies and its tags (creator or admin)
    router.delete("/galaxy/places/:id", authenticate, async (req: Request, res: Response) => {
        const id = idParam(req, res, "Place");
        if (id === null) return;
        try {
            const place = await galaxyService.getPlaceOwner(id);
            if (!place) return res.status(404).json({ status: "error", message: `Place '${id}' not found` });
            if (!mayEdit(req, place.creatorId)) return res.status(403).json({ status: "error", message: "Forbidden" });
            await galaxyService.deletePlace(id);
            logger.info("galaxy.place_deleted", { placeId: id });
            res.status(204).send();
        } catch (error) {
            fail(res, "Failed to remove the place", error);
        }
    });

    // POST /api/galaxy/places/:id/bodies: Add a planet, moon or station to a system (creator or admin)
    router.post("/galaxy/places/:id/bodies", authenticate, async (req: Request, res: Response) => {
        const id = idParam(req, res, "Place");
        if (id === null) return;
        try {
            const place = await galaxyService.getPlaceOwner(id);
            if (!place) return res.status(404).json({ status: "error", message: `Place '${id}' not found` });
            if (!mayEdit(req, place.creatorId)) return res.status(403).json({ status: "error", message: "Forbidden" });
            res.status(201).json({ status: "success", data: await galaxyService.createBody(id, req.body) });
        } catch (error) {
            fail(res, "Failed to add the body", error);
        }
    });

    // PATCH /api/galaxy/bodies/:id: Edit a body (its place's creator or admin)
    router.patch("/galaxy/bodies/:id", authenticate, async (req: Request, res: Response) => {
        const id = idParam(req, res, "Body");
        if (id === null) return;
        try {
            const body = await galaxyService.getBodyOwner(id);
            if (!body) return res.status(404).json({ status: "error", message: `Body '${id}' not found` });
            if (!mayEdit(req, body.creatorId)) return res.status(403).json({ status: "error", message: "Forbidden" });
            res.status(200).json({ status: "success", data: await galaxyService.updateBody(id, req.body) });
        } catch (error) {
            fail(res, "Failed to change the body", error);
        }
    });

    // DELETE /api/galaxy/bodies/:id: Remove a body and what orbits it (its place's creator or admin)
    router.delete("/galaxy/bodies/:id", authenticate, async (req: Request, res: Response) => {
        const id = idParam(req, res, "Body");
        if (id === null) return;
        try {
            const body = await galaxyService.getBodyOwner(id);
            if (!body) return res.status(404).json({ status: "error", message: `Body '${id}' not found` });
            if (!mayEdit(req, body.creatorId)) return res.status(403).json({ status: "error", message: "Forbidden" });
            await galaxyService.deleteBody(id);
            res.status(204).send();
        } catch (error) {
            fail(res, "Failed to remove the body", error);
        }
    });

    // POST /api/galaxy/places/:id/travelogue: Tag an episode on a place or one of its bodies (any member)
    router.post("/galaxy/places/:id/travelogue", authenticate, async (req: Request, res: Response) => {
        const id = idParam(req, res, "Place");
        if (id === null) return;
        try {
            if (!(await galaxyService.getPlaceOwner(id))) return res.status(404).json({ status: "error", message: `Place '${id}' not found` });
            const tag = await galaxyService.createTravelogueTag(id, req.body, req.user!.id);
            if (!tag) return res.status(404).json({ status: "error", message: `Episode '${req.body.episode}' not found` });
            res.status(201).json({ status: "success", data: tag });
        } catch (error) {
            fail(res, "Failed to tag the episode", error);
        }
    });

    // DELETE /api/galaxy/travelogue/:id: Remove a tag (whoever tagged it, the place's creator or admin)
    router.delete("/galaxy/travelogue/:id", authenticate, async (req: Request, res: Response) => {
        const id = idParam(req, res, "Tag");
        if (id === null) return;
        try {
            const tag = await galaxyService.getTravelogueTag(id);
            if (!tag) return res.status(404).json({ status: "error", message: `Tag '${id}' not found` });
            if (!mayEdit(req, tag.creatorId) && !mayEdit(req, tag.placeCreatorId)) return res.status(403).json({ status: "error", message: "Forbidden" });
            await galaxyService.deleteTravelogueTag(id);
            res.status(204).send();
        } catch (error) {
            fail(res, "Failed to remove the tag", error);
        }
    });

    return router;
};

export default { initializeGalaxyRoutes };
