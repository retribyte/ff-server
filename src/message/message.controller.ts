import { Router, Request, Response } from "express";
import messageService from "./message.service.js";
import { authenticate } from "../auth/security.middleware.js";

const initializeMessageRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/quotes/random: Return a random message of type QUOTE
    router.get("/quotes/random", async (req: Request, res: Response) => {
        try {
            const quote = await messageService.getRandomQuote();
            if (!quote) {
                return res.status(404).json({ status: "error", message: "No quotes found" });
            }
            res.status(200).json({ status: "success", data: quote });
        } catch (error) {
            console.error("Error fetching random quote:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch quote" });
        }
    });

    // GET /api/characters/:characterId/quotes: Return all QUOTE messages attributed to a character
    router.get("/characters/:characterId/quotes", async (req: Request, res: Response) => {
        const characterId = parseInt(req.params.characterId, 10);
        try {
            const quotes = await messageService.getQuotesByCharacter(characterId);
            res.status(200).json({ status: "success", data: quotes });
        } catch (error) {
            console.error("Error fetching quotes:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch quotes" });
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
            res.status(200).json({ status: "success", ...result });
        } catch (error) {
            console.error("Error fetching messages:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch messages" });
        }
    });

    // GET /api/episodes/:episodeTitle/messages/:messageNo: Return a single message by episode and sequence number
    router.get("/episodes/:episodeTitle/messages/:messageNo", async (req: Request, res: Response) => {
        const { episodeTitle } = req.params;
        const messageNo = parseInt(req.params.messageNo, 10);
        try {
            const message = await messageService.getMessageByNo(episodeTitle, messageNo);
            if (!message) {
                return res.status(404).json({
                    status: "error",
                    message: `Message ${messageNo} in episode '${episodeTitle}' not found`,
                });
            }
            res.status(200).json({ status: "success", data: message });
        } catch (error) {
            console.error("Error fetching message:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch message" });
        }
    });

    // POST /api/episodes/:episodeTitle/messages: Append message(s) to an episode.
    // Accepts a single message object, or { messages: [...] } for bulk transcript import.
    router.post("/episodes/:episodeTitle/messages", authenticate, async (req: Request, res: Response) => {
        const { episodeTitle } = req.params;
        try {
            if (Array.isArray(req.body?.messages)) {
                const result = await messageService.createMessages(episodeTitle, req.body.messages);
                return res.status(201).json({ status: "success", data: result });
            }
            const message = await messageService.createMessage(episodeTitle, req.body);
            res.status(201).json({ status: "success", data: message });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/episodes/:episodeTitle/messages/:messageNo: Update a message by episode and sequence number
    router.put("/episodes/:episodeTitle/messages/:messageNo", authenticate, async (req: Request, res: Response) => {
        const { episodeTitle } = req.params;
        const messageNo = parseInt(req.params.messageNo, 10);
        try {
            const message = await messageService.updateMessage(episodeTitle, messageNo, req.body);
            res.status(200).json({ status: "success", data: message });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeMessageRoutes };
