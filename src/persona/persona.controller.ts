import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import personaService from "./persona.service.js";
import characterService from "../character/character.service.js";
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

const initializePersonaRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/characters/:id/personas: List a character's personas (public)
    router.get("/characters/:id/personas", async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const personas = await personaService.getPersonasByCharacter(id);
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
            const persona = await personaService.createPersona(id, {
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
            const personas = await personaService.getAllPersonas(req.query.search as string | undefined);
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
            const persona = await personaService.getPersonaById(id);
            if (!persona) {
                return sendError(res, `Persona with id '${id}' not found`, 404);
            }
            const character = await characterService.getCharacterById(persona.characterId);
            if (!character) {
                return sendError(res, "Forbidden", 403);
            }
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
            const updated = await personaService.updatePersona(id, {
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
            const persona = await personaService.getPersonaById(id);
            if (!persona) {
                return sendError(res, `Persona with id '${id}' not found`, 404);
            }
            const character = await characterService.getCharacterById(persona.characterId);
            if (!character) {
                return sendError(res, "Forbidden", 403);
            }
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
            await personaService.deletePersona(id);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, personaError(error));
        }
    });

    return router;
};

export default { initializePersonaRoutes };
