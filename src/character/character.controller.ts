import { Router, Request, Response } from "express";
import characterService from "./character.service.js";
import messageService from "../message/message.service.js";
import storyService from "../story/story.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { UserRole } from "@prisma/client";

const initializeCharacterRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/characters: Return all characters, optionally filtered/searched (public)
    router.get("/characters", async (req: Request, res: Response) => {
        try {
            const { search, speciesId, ownerId, season } = req.query;
            const characters = await characterService.getAllCharacters({
                search: search as string | undefined,
                speciesId: speciesId ? parseInt(speciesId as string, 10) : undefined,
                ownerId: ownerId ? parseInt(ownerId as string, 10) : undefined,
                season: season as string | undefined,
            });
            res.status(200).json({ status: "success", data: characters });
        } catch (error) {
            console.error("Error fetching characters:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch characters" });
        }
    });

    // GET /api/characters/:id: Return a character by id, or by slug when the
    // param isn't a bare integer (public)
    router.get("/characters/:id", async (req: Request, res: Response) => {
        const { id: param } = req.params;
        const isId = /^\d+$/.test(param);

        try {
            const character = isId
                ? await characterService.getCharacterById(parseInt(param, 10))
                : await characterService.getCharacterBySlug(param);
            if (!character) {
                return res.status(404).json({
                    status: "error",
                    message: isId
                        ? `Character with id '${param}' not found`
                        : `Character with slug '${param}' not found`,
                });
            }
            res.status(200).json({ status: "success", data: character });
        } catch (error) {
            console.error("Error fetching character:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch character" });
        }
    });

    // GET /api/characters/:id/quotes: Return quotes attributed to a character —
    // transcript QUOTE messages and story-embedded dialogue, from two
    // different sources with no shared sort key (message timestamp vs.
    // story/chapter/line position), so they come back as separate arrays.
    router.get("/characters/:id/quotes", async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const [messages, storyQuotes] = await Promise.all([
                messageService.getQuotesByCharacter(id),
                storyService.getStoryQuotesByCharacter(id),
            ]);
            res.status(200).json({ status: "success", data: { messages, storyQuotes } });
        } catch (error) {
            console.error("Error fetching quotes:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch quotes" });
        }
    });

    // POST /api/characters: Create a new character
    router.post("/characters", authenticate, async (req: Request, res: Response) => {
        try {
            const character = await characterService.createCharacter({ ...req.body, creatorId: req.user!.id });
            res.status(201).json({ status: "success", data: character });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/characters/:id: Update a character by id
    router.put("/characters/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await characterService.getCharacterById(id);
            if (!character) {
                return res.status(404).json({ status: "error", message: `Character with id '${id}' not found` });
            }
            if (character.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const updated = await characterService.updateCharacter(id, req.body);
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/characters/:id: Delete a character by id
    router.delete("/characters/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await characterService.getCharacterById(id);
            if (!character) {
                return res.status(404).json({ status: "error", message: `Character with id '${id}' not found` });
            }
            if (character.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            await characterService.deleteCharacter(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeCharacterRoutes };
