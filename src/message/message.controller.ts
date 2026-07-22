import { Router, Request, Response } from "express";
import messageService from "./message.service.js";
import characterService from "../character/character.service.js";
import { authenticate } from "../auth/security.middleware.js";
import { assertOwnerOrAdmin } from "../auth/ownership.js";
import { sendSuccess, sendResult, sendError, sendCaughtError } from "../utils/http.js";

// Shared body validation + ownership check for the two bulk persona-stamp
// routes below. Returns the resolved character on success, or writes an
// error response and returns null so the caller can bail out.
async function resolveStampAuthorization(req: Request, res: Response): Promise<{ characterId: number; personaId: number | null } | null> {
    const { characterId, personaId } = req.body ?? {};

    if (typeof characterId !== "number") {
        sendError(res, "characterId is required and must be a number", 400);
        return null;
    }
    if (personaId !== null && typeof personaId !== "number") {
        sendError(res, "personaId is required (a number, or null to clear)", 400);
        return null;
    }

    const character = await characterService.getCharacterById(characterId);
    if (!character) {
        sendError(res, `Character with id '${characterId}' not found`, 404);
        return null;
    }
    if (!assertOwnerOrAdmin(req, res, character.creatorId)) {
        return null;
    }

    return { characterId, personaId: personaId ?? null };
}

const initializeMessageRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/quotes/random: Return a random message of type QUOTE
    router.get("/quotes/random", async (req: Request, res: Response) => {
        try {
            const quote = await messageService.getRandomQuote();
            if (!quote) {
                return sendError(res, "No quotes found", 404);
            }
            sendSuccess(res, quote);
        } catch (error) {
            console.error("Error fetching random quote:", error);
            sendError(res, "Failed to fetch quote", 500);
        }
    });


    // GET /api/episodes/:episodeTitle/messages: Return paginated messages in an episode ordered by messageNo
    router.get("/episodes/:episodeTitle/messages", async (req: Request, res: Response) => {
        const { episodeTitle } = req.params;
        const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
        const search = req.query.search as string | undefined;
        try {
            const result = await messageService.getMessagesByEpisode(episodeTitle, page, limit, search);
            sendResult(res, result);
        } catch (error) {
            console.error("Error fetching messages:", error);
            sendError(res, "Failed to fetch messages", 500);
        }
    });

    // GET /api/episodes/:episodeTitle/messages/:messageNo: Return a single message by episode and sequence number
    router.get("/episodes/:episodeTitle/messages/:messageNo", async (req: Request, res: Response) => {
        const { episodeTitle } = req.params;
        const messageNo = parseInt(req.params.messageNo, 10);
        try {
            const message = await messageService.getMessageByNo(episodeTitle, messageNo);
            if (!message) {
                return sendError(res, `Message ${messageNo} in episode '${episodeTitle}' not found`, 404);
            }
            sendSuccess(res, message);
        } catch (error) {
            console.error("Error fetching message:", error);
            sendError(res, "Failed to fetch message", 500);
        }
    });

    // POST /api/episodes/:episodeTitle/messages: Append message(s) to an episode.
    // Accepts a single message object, or { messages: [...] } for bulk transcript import.
    router.post("/episodes/:episodeTitle/messages", authenticate, async (req: Request, res: Response) => {
        const { episodeTitle } = req.params;
        try {
            if (Array.isArray(req.body?.messages)) {
                const result = await messageService.createMessages(episodeTitle, req.body.messages);
                return sendSuccess(res, result, 201);
            }
            const message = await messageService.createMessage(episodeTitle, req.body);
            sendSuccess(res, message, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/episodes/:episodeTitle/messages/:messageNo: Update a message by episode and sequence number
    router.put("/episodes/:episodeTitle/messages/:messageNo", authenticate, async (req: Request, res: Response) => {
        const { episodeTitle } = req.params;
        const messageNo = parseInt(req.params.messageNo, 10);
        try {
            const message = await messageService.updateMessage(episodeTitle, messageNo, req.body);
            sendSuccess(res, message);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // POST /api/episodes/:episodeTitle/personas/apply: Bulk-stamp personaId
    // on every message of {characterId} within this episode; personaId: null
    // clears back to canonical attribution. Owner-of-character or admin
    // (PLAN-alias.md §4/§8.2).
    router.post("/episodes/:episodeTitle/personas/apply", authenticate, async (req: Request, res: Response) => {
        const { episodeTitle } = req.params;
        try {
            const resolved = await resolveStampAuthorization(req, res);
            if (!resolved) return;
            const count = await messageService.applyPersonaToEpisode(episodeTitle, resolved.characterId, resolved.personaId);
            sendSuccess(res, { count });
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // POST /api/seasons/:seasonTitle/personas/apply: Bulk-stamp personaId on
    // every message of {characterId} across every episode of this season;
    // personaId: null clears back to canonical attribution. Owner-of-character
    // or admin (PLAN-alias.md §4/§8.2).
    router.post("/seasons/:seasonTitle/personas/apply", authenticate, async (req: Request, res: Response) => {
        const { seasonTitle } = req.params;
        try {
            const resolved = await resolveStampAuthorization(req, res);
            if (!resolved) return;
            const count = await messageService.applyPersonaToSeason(seasonTitle, resolved.characterId, resolved.personaId);
            sendSuccess(res, { count });
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeMessageRoutes };
