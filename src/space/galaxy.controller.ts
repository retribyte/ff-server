import { Router, Request, Response } from "express";
import galaxyService from "./galaxy.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { UserRole } from "@prisma/client";

const initializeGalaxyRoutes = (): Router => {
    const router: Router = Router();

    // ---------- Galaxy ----------

    // GET /api/galaxies: List all galaxies (public)
    router.get("/galaxies", async (req: Request, res: Response) => {
        try {
            const galaxies = await galaxyService.getAllGalaxies();
            res.status(200).json({ status: "success", data: galaxies });
        } catch (error) {
            console.error("Error fetching galaxies:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch galaxies" });
        }
    });

    // GET /api/galaxies/:slug: Galaxy + slim systems (id, name, position, creatorId,
    // star temperatureK/color) + landmarks (public)
    router.get("/galaxies/:slug", async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const galaxy = await galaxyService.getGalaxyBySlug(slug);
            if (!galaxy) {
                return res.status(404).json({ status: "error", message: `Galaxy '${slug}' not found` });
            }
            res.status(200).json({ status: "success", data: galaxy });
        } catch (error) {
            console.error("Error fetching galaxy:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch galaxy" });
        }
    });

    // POST /api/galaxies: Create a galaxy (admin only)
    router.post("/galaxies", authenticate, isAdmin, async (req: Request, res: Response) => {
        try {
            const galaxy = await galaxyService.createGalaxy(req.body);
            res.status(201).json({ status: "success", data: galaxy });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/galaxies/:slug: Update galaxy metadata (admin only)
    router.put("/galaxies/:slug", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const galaxy = await galaxyService.updateGalaxy(slug, req.body);
            res.status(200).json({ status: "success", data: galaxy });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/galaxies/:slug: Delete a galaxy (admin only)
    router.delete("/galaxies/:slug", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            await galaxyService.deleteGalaxy(slug);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // ---------- StarSystem ----------

    // GET /api/systems/:id: Full system with nested body tree (star → planets → moons) + creator (public)
    router.get("/systems/:id", async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const system = await galaxyService.getSystemById(id);
            if (!system) {
                return res.status(404).json({ status: "error", message: `System with id '${id}' not found` });
            }
            res.status(200).json({ status: "success", data: system });
        } catch (error) {
            console.error("Error fetching system:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch system" });
        }
    });

    // POST /api/galaxies/:slug/systems: Create a system shell (authenticated; creatorId from token)
    router.post("/galaxies/:slug/systems", authenticate, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const system = await galaxyService.createSystem(slug, req.body ?? {}, req.user!.id);
            res.status(201).json({ status: "success", data: system });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/systems/:id: Partial metadata update (name, description, wikiArticle, xPos, yPos) — creator or admin
    router.put("/systems/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const system = await galaxyService.getSystemRaw(id);
            if (!system) {
                return res.status(404).json({ status: "error", message: `System with id '${id}' not found` });
            }
            if (system.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const updated = await galaxyService.updateSystemMeta(id, req.body);
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/systems/:id/bodies: Transactional whole-tree replace (star/planets/moons) — creator or admin
    router.put("/systems/:id/bodies", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const system = await galaxyService.getSystemRaw(id);
            if (!system) {
                return res.status(404).json({ status: "error", message: `System with id '${id}' not found` });
            }
            if (system.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const updated = await galaxyService.replaceBodies(id, req.body?.star);
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/systems/:id: Delete a system, cascading its bodies — creator or admin
    router.delete("/systems/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const system = await galaxyService.getSystemRaw(id);
            if (!system) {
                return res.status(404).json({ status: "error", message: `System with id '${id}' not found` });
            }
            if (system.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            await galaxyService.deleteSystem(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // ---------- Landmark ----------

    // POST /api/galaxies/:slug/landmarks: Create a landmark (authenticated; creatorId from token)
    router.post("/galaxies/:slug/landmarks", authenticate, async (req: Request, res: Response) => {
        const { slug } = req.params;
        try {
            const landmark = await galaxyService.createLandmark(slug, req.body ?? {}, req.user!.id);
            res.status(201).json({ status: "success", data: landmark });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/landmarks/:id: Update a landmark — creator or admin
    router.put("/landmarks/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const landmark = await galaxyService.getLandmarkRaw(id);
            if (!landmark) {
                return res.status(404).json({ status: "error", message: `Landmark with id '${id}' not found` });
            }
            if (landmark.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const updated = await galaxyService.updateLandmark(id, req.body);
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/landmarks/:id: Delete a landmark — creator or admin
    router.delete("/landmarks/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const landmark = await galaxyService.getLandmarkRaw(id);
            if (!landmark) {
                return res.status(404).json({ status: "error", message: `Landmark with id '${id}' not found` });
            }
            if (landmark.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            await galaxyService.deleteLandmark(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeGalaxyRoutes };
