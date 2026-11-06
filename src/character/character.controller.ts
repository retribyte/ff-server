import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import characterService, { CharacterInArchiveError } from "./character.service.js";
import { getAvatarImage } from "./avatar.service.js";
import messageService from "../message/message.service.js";
import storyService from "../story/story.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
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

// Owner-of-character or admin. NPC personas (no character) have no owner,
// so only admins may edit them.
async function canEditPersona(characterId: number | null, user: Request["user"]): Promise<boolean> {
    if (!user) return false;
    if (user.role === UserRole.ADMIN) return true;
    if (characterId === null) return false;
    const character = await characterService.getCharacterById(characterId);
    return !!character && character.creatorId === user.id;
}

const initializeCharacterRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/avatars/<sha256>.png: An uploaded avatar. Public (avatars render
    // for logged-out readers) and immutable, since the name is the content hash.
    // Uploads arrive through the character and persona edit routes.
    router.get("/avatars/:file", async (req: Request, res: Response) => {
        const sha256 = /^([0-9a-f]{64})\.png$/.exec(req.params.file)?.[1];
        try {
            const png = sha256 ? await getAvatarImage(sha256) : null;
            if (!png) return res.status(404).json({ status: "error", message: "No such avatar" });
            res.set({
                "Content-Type": "image/png",
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
            });
            return res.status(200).send(png);
        } catch (error) {
            console.error("Error fetching avatar:", error);
            return res.status(500).json({ status: "error", message: "Failed to fetch avatar" });
        }
    });

    // GET /api/characters: Return all characters, optionally filtered/searched (public)
    router.get("/characters", async (req: Request, res: Response) => {
        try {
            const { search, ownerId, season } = req.query;
            const characters = await characterService.getAllCharacters({
                search: search as string | undefined,
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
                ? await characterService.getCharacterById(parseInt(param, 10), { withWiki: true })
                : await characterService.getCharacterBySlug(param, { withWiki: true });
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
    // ?search= on the persona name, and ?npc=true|false for only NPC voices
    // (no character) or only character personas. No pagination — used by the transcript
    // importer to match speaker names against every character in one call
    // instead of N+1-ing over /characters/:id/personas. Distinct HTTP methods
    // from the /personas/:id routes below, so there's no route-matching
    // ambiguity regardless of declaration order.
    router.get("/personas", async (req: Request, res: Response) => {
        try {
            const { search, npc } = req.query;
            const personas = await characterService.getAllPersonas(
                search as string | undefined,
                npc === "true" ? true : npc === "false" ? false : undefined
            );
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
            if (!(await canEditPersona(persona.characterId, req.user!))) {
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
            if (!(await canEditPersona(persona.characterId, req.user!))) {
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
            // Admins (the importer) may attribute a character to the player who voices it
            const creatorId =
                req.user!.role === UserRole.ADMIN && Number.isInteger(req.body?.creatorId)
                    ? req.body.creatorId
                    : req.user!.id;
            const character = await characterService.createCharacter({ ...req.body, creatorId });
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
            const status = error instanceof CharacterInArchiveError ? 409 : 400;
            res.status(status).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeCharacterRoutes };
