import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import characterService from "./character.service.js";
import messageService from "../message/message.service.js";
import storyService from "../story/story.service.js";
import { authenticate } from "../auth/security.middleware.js";
import { assertOwnerOrAdmin } from "../auth/ownership.js";
import { sendSuccess, sendError, sendCaughtError } from "../utils/http.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";

// Re-wraps persona-mutation Prisma errors as typed HttpErrors carrying
// friendly, domain-specific messages, so sendCaughtError emits them with a
// fitting code; anything else (typed service errors, unexpected faults) passes
// straight through.
//   P2002: duplicate name/slug for the character -> 409.
//   P2003/P2014: FK restrict on delete, messages still reference it -> 409.
//   P2025: record already gone -> 404.
function personaError(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
            return new ConflictError("A persona with that slug or name already exists for this character");
        }
        if (error.code === "P2025") {
            return new NotFoundError("Persona not found");
        }
        if (error.code === "P2003" || error.code === "P2014") {
            return new ConflictError("Cannot delete persona: messages still reference it");
        }
    }
    return error;
}

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

    // GET /api/characters/:id/personas: List a character's personas (public)
    router.get("/characters/:id/personas", async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const personas = await characterService.getPersonasByCharacter(id);
            sendSuccess(res, personas);
        } catch (error) {
            console.error("Error fetching personas:", error);
            sendError(res, "Failed to fetch personas", 500);
        }
    });

    // POST /api/characters/:id/personas: Add a persona to a character (owner or admin)
    router.post("/characters/:id/personas", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await characterService.getCharacterById(id);
            if (!character) {
                return sendError(res, `Character with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
            const persona = await characterService.createPersona(id, {
                name: typeof req.body?.name === "string" ? req.body.name.trim() : undefined,
                label: req.body?.label,
                slug: req.body?.slug,
                image: req.body?.image,
                color: req.body?.color,
            });
            sendSuccess(res, persona, 201);
        } catch (error) {
            sendCaughtError(res, personaError(error));
        }
    });

    // GET /api/personas: Full persona index (public), optionally filtered by
    // ?search= on the persona name. No pagination — used by the transcript
    // importer to match speaker names against every character in one call
    // instead of N+1-ing over /characters/:id/personas. Distinct HTTP methods
    // from the /personas/:id routes below, so there's no route-matching
    // ambiguity regardless of declaration order.
    router.get("/personas", async (req: Request, res: Response) => {
        try {
            const personas = await characterService.getAllPersonas(req.query.search as string | undefined);
            sendSuccess(res, personas);
        } catch (error) {
            console.error("Error fetching personas:", error);
            sendError(res, "Failed to fetch personas", 500);
        }
    });

    // PUT /api/personas/:id: Update a persona (owner-of-character or admin)
    router.put("/personas/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const persona = await characterService.getPersonaById(id);
            if (!persona) {
                return sendError(res, `Persona with id '${id}' not found`, 404);
            }
            const character = await characterService.getCharacterById(persona.characterId);
            if (!character) {
                return sendError(res, "Forbidden", 403);
            }
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
            const updated = await characterService.updatePersona(id, {
                name: req.body?.name,
                label: req.body?.label,
                slug: req.body?.slug,
                image: req.body?.image,
                color: req.body?.color,
            });
            sendSuccess(res, updated);
        } catch (error) {
            sendCaughtError(res, personaError(error));
        }
    });

    // DELETE /api/personas/:id: Delete a persona (owner-of-character or admin)
    router.delete("/personas/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const persona = await characterService.getPersonaById(id);
            if (!persona) {
                return sendError(res, `Persona with id '${id}' not found`, 404);
            }
            const character = await characterService.getCharacterById(persona.characterId);
            if (!character) {
                return sendError(res, "Forbidden", 403);
            }
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
            await characterService.deletePersona(id);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, personaError(error));
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
