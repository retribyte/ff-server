import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import characterService from "./character.service.js";
import messageService from "../message/message.service.js";
import storyService from "../story/story.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { UserRole } from "@prisma/client";

// Maps a Prisma error to a friendly {status, message} for alias mutations.
// P2002: unique constraint (duplicate alias/slug for the character).
// P2003/P2025: FK restrict on delete (messages still reference the alias) or
// record already gone.
function mapAliasError(error: any): { status: number; message: string } {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
            return { status: 400, message: "An alias with that slug or name already exists for this character" };
        }
        if (error.code === "P2025") {
            return { status: 404, message: "Alias not found" };
        }
        if (error.code === "P2003" || error.code === "P2014") {
            return { status: 400, message: "Cannot delete alias: messages still reference it" };
        }
    }
    return { status: 400, message: error.message ?? "Invalid alias data" };
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

    // GET /api/characters/:id/aliases: List a character's aliases (public)
    router.get("/characters/:id/aliases", async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const aliases = await characterService.getAliasesByCharacter(id);
            res.status(200).json({ status: "success", data: aliases });
        } catch (error) {
            console.error("Error fetching aliases:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch aliases" });
        }
    });

    // POST /api/characters/:id/aliases: Add an alias to a character (owner or admin)
    router.post("/characters/:id/aliases", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        if (!req.body?.alias || typeof req.body.alias !== "string" || !req.body.alias.trim()) {
            return res.status(400).json({ status: "error", message: "Missing alias" });
        }

        try {
            const character = await characterService.getCharacterById(id);
            if (!character) {
                return res.status(404).json({ status: "error", message: `Character with id '${id}' not found` });
            }
            if (character.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const alias = await characterService.createAlias(id, {
                alias: req.body.alias.trim(),
                slug: req.body.slug,
            });
            res.status(201).json({ status: "success", data: alias });
        } catch (error: any) {
            const { status, message } = mapAliasError(error);
            res.status(status).json({ status: "error", message });
        }
    });

    // GET /api/aliases: Full alias index (public), optionally filtered by
    // ?search= on the alias name. No pagination — used by the transcript
    // importer to match speaker names against every character in one call
    // instead of N+1-ing over /characters/:id/aliases. Distinct HTTP methods
    // from the /aliases/:id routes below, so there's no route-matching
    // ambiguity regardless of declaration order.
    router.get("/aliases", async (req: Request, res: Response) => {
        try {
            const aliases = await characterService.getAllAliases(req.query.search as string | undefined);
            res.status(200).json({ status: "success", data: aliases });
        } catch (error) {
            console.error("Error fetching aliases:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch aliases" });
        }
    });

    // PUT /api/aliases/:id: Update an alias (owner-of-character or admin)
    router.put("/aliases/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const alias = await characterService.getAliasById(id);
            if (!alias) {
                return res.status(404).json({ status: "error", message: `Alias with id '${id}' not found` });
            }
            const character = await characterService.getCharacterById(alias.characterId);
            if (!character || (character.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN)) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const updated = await characterService.updateAlias(id, {
                alias: req.body?.alias,
                slug: req.body?.slug,
            });
            res.status(200).json({ status: "success", data: updated });
        } catch (error: any) {
            const { status, message } = mapAliasError(error);
            res.status(status).json({ status: "error", message });
        }
    });

    // DELETE /api/aliases/:id: Delete an alias (owner-of-character or admin)
    router.delete("/aliases/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const alias = await characterService.getAliasById(id);
            if (!alias) {
                return res.status(404).json({ status: "error", message: `Alias with id '${id}' not found` });
            }
            const character = await characterService.getCharacterById(alias.characterId);
            if (!character || (character.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN)) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            await characterService.deleteAlias(id);
            res.status(204).send();
        } catch (error: any) {
            const { status, message } = mapAliasError(error);
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
