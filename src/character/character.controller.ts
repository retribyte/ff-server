import { Router, Request, Response } from "express";
import characterService from "./character.service.js";
import messageService from "../message/message.service.js";
import storyService from "../story/story.service.js";
import { authenticate } from "../auth/security.middleware.js";
import { assertOwnerOrAdmin } from "../auth/ownership.js";
import { sendSuccess, sendError, sendCaughtError } from "../utils/http.js";

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
            sendSuccess(res, characters);
        } catch (error) {
            console.error("Error fetching characters:", error);
            sendError(res, "Failed to fetch characters", 500);
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
                return sendError(
                    res,
                    isId ? `Character with id '${param}' not found` : `Character with slug '${param}' not found`,
                    404
                );
            }
            sendSuccess(res, character);
        } catch (error) {
            console.error("Error fetching character:", error);
            sendError(res, "Failed to fetch character", 500);
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
            sendSuccess(res, { messages, storyQuotes });
        } catch (error) {
            console.error("Error fetching quotes:", error);
            sendError(res, "Failed to fetch quotes", 500);
        }
    });

    // POST /api/characters: Create a new character
    router.post("/characters", authenticate, async (req: Request, res: Response) => {
        try {
            const character = await characterService.createCharacter({ ...req.body, creatorId: req.user!.id });
            sendSuccess(res, character, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/characters/:id: Update a character by id
    router.put("/characters/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await characterService.getCharacterById(id);
            if (!character) {
                return sendError(res, `Character with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
            const updated = await characterService.updateCharacter(id, req.body);
            sendSuccess(res, updated);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // DELETE /api/characters/:id: Delete a character by id
    router.delete("/characters/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await characterService.getCharacterById(id);
            if (!character) {
                return sendError(res, `Character with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
            await characterService.deleteCharacter(id);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeCharacterRoutes };
