import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import characterService from "./character.service.js";
import messageService from "../message/message.service.js";
import storyService from "../story/story.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { assertOwnerOrAdmin } from "../auth/ownership.js";
import { UserRole } from "@prisma/client";

// Maps a Prisma error to a friendly {status, message} for persona mutations.
// P2002: unique constraint (duplicate name/slug for the character).
// P2003/P2025: FK restrict on delete (messages still reference the persona)
// or record already gone.
function mapPersonaError(error: any): { status: number; message: string } {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
            return { status: 400, message: "A persona with that slug or name already exists for this character" };
        }
        if (error.code === "P2025") {
            return { status: 404, message: "Persona not found" };
        }
        if (error.code === "P2003" || error.code === "P2014") {
            return { status: 400, message: "Cannot delete persona: messages still reference it" };
        }
    }
    return { status: 400, message: error.message ?? "Invalid persona data" };
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

    // GET /api/characters/:id/personas: List a character's personas (public)
    router.get("/characters/:id/personas", async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const personas = await characterService.getPersonasByCharacter(id);
            res.status(200).json({ status: "success", data: personas });
        } catch (error) {
            console.error("Error fetching personas:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch personas" });
        }
    });

    // POST /api/characters/:id/personas: Add a persona to a character (owner or admin)
    router.post("/characters/:id/personas", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await characterService.getCharacterById(id);
            if (!character) {
                return res.status(404).json({ status: "error", message: `Character with id '${id}' not found` });
            }
            if (character.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const persona = await characterService.createPersona(id, {
                name: typeof req.body?.name === "string" ? req.body.name.trim() : undefined,
                label: req.body?.label,
                slug: req.body?.slug,
                image: req.body?.image,
                color: req.body?.color,
            });
            res.status(201).json({ status: "success", data: persona });
        } catch (error: any) {
            const { status, message } = mapPersonaError(error);
            res.status(status).json({ status: "error", message });
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
            res.status(200).json({ status: "success", data: personas });
        } catch (error) {
            console.error("Error fetching personas:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch personas" });
        }
    });

    // PUT /api/personas/:id: Update a persona (owner-of-character or admin)
    router.put("/personas/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const persona = await characterService.getPersonaById(id);
            if (!persona) {
                return res.status(404).json({ status: "error", message: `Persona with id '${id}' not found` });
            }
            const character = await characterService.getCharacterById(persona.characterId);
            if (!character || (character.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN)) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const updated = await characterService.updatePersona(id, {
                name: req.body?.name,
                label: req.body?.label,
                slug: req.body?.slug,
                image: req.body?.image,
                color: req.body?.color,
            });
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            const { status, message } = mapPersonaError(error);
            res.status(status).json({ status: "error", message });
        }
    });

    // DELETE /api/personas/:id: Delete a persona (owner-of-character or admin)
    router.delete("/personas/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const persona = await characterService.getPersonaById(id);
            if (!persona) {
                return res.status(404).json({ status: "error", message: `Persona with id '${id}' not found` });
            }
            const character = await characterService.getCharacterById(persona.characterId);
            if (!character || (character.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN)) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            await characterService.deletePersona(id);
            res.status(204).send();
        } catch (error: any) {
            const { status, message } = mapPersonaError(error);
            res.status(status).json({ status: "error", message });
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
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
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
            if (!assertOwnerOrAdmin(req, res, character.creatorId)) return;
            await characterService.deleteCharacter(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeCharacterRoutes };
