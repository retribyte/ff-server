import { Router, Request, Response } from "express";
import eightballService from "./eightball.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { EightBallAnswerType } from "@prisma/client";
import { sendSuccess, sendError, sendCaughtError } from "../utils/http.js";

const initializeEightballRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/8ball: Shake the 8-ball and return one weighted-random answer (public)
    router.get("/8ball", async (req: Request, res: Response) => {
        try {
            const answer = await eightballService.shake();
            if (!answer) {
                return sendError(res, "The 8-ball is empty. Ask again after someone adds some answers.", 404);
            }
            sendSuccess(res, answer);
        } catch (error) {
            console.error("Error shaking the 8-ball:", error);
            sendError(res, "Failed to shake the 8-ball", 500);
        }
    });

    // GET /api/8ball/answers: Return all answers, ordered by type then id (public)
    router.get("/8ball/answers", async (req: Request, res: Response) => {
        try {
            const answers = await eightballService.getAllAnswers();
            sendSuccess(res, answers);
        } catch (error) {
            console.error("Error fetching 8-ball answers:", error);
            sendError(res, "Failed to fetch 8-ball answers", 500);
        }
    });

    // POST /api/8ball/answers: Add a new answer (any authenticated user)
    router.post("/8ball/answers", authenticate, async (req: Request, res: Response) => {
        const { type, text } = req.body;
        if (!type || !Object.values(EightBallAnswerType).includes(type)) {
            return sendError(res, "Invalid type: must be one of YES, NO, MAYBE", 400);
        }
        const trimmedText = typeof text === "string" ? text.trim() : "";
        if (!trimmedText) {
            return sendError(res, "text is required", 400);
        }
        try {
            const answer = await eightballService.createAnswer(type as EightBallAnswerType, trimmedText);
            sendSuccess(res, answer, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // DELETE /api/8ball/answers/:id: Remove an answer (admin only)
    router.delete("/8ball/answers/:id", authenticate, isAdmin, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const answer = await eightballService.getAnswerById(id);
            if (!answer) {
                return sendError(res, `Answer with id '${id}' not found`, 404);
            }
            await eightballService.deleteAnswer(id);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeEightballRoutes };
