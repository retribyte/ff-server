import { Router, Request, Response } from "express";
import eightballService from "./eightball.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { EightBallAnswerType } from "@prisma/client";

const initializeEightballRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/8ball: Shake the 8-ball and return one weighted-random answer (public)
    router.get("/8ball", async (req: Request, res: Response) => {
        try {
            const answer = await eightballService.shake();
            if (!answer) {
                return res.status(404).json({
                    status: "error",
                    message: "The 8-ball is empty. Ask again after someone adds some answers.",
                });
            }
            res.status(200).json({ status: "success", data: answer });
        } catch (error) {
            console.error("Error shaking the 8-ball:", error);
            res.status(500).json({ status: "error", message: "Failed to shake the 8-ball" });
        }
    });

    // GET /api/8ball/answers: Return all answers, ordered by type then id (public)
    router.get("/8ball/answers", async (req: Request, res: Response) => {
        try {
            const answers = await eightballService.getAllAnswers();
            res.status(200).json({ status: "success", data: answers });
        } catch (error) {
            console.error("Error fetching 8-ball answers:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch 8-ball answers" });
        }
    });

    // POST /api/8ball/answers: Add a new answer (any authenticated user)
    router.post("/8ball/answers", authenticate, async (req: Request, res: Response) => {
        const { type, text } = req.body;
        if (!type || !Object.values(EightBallAnswerType).includes(type)) {
            return res.status(400).json({ status: "error", message: "Invalid type: must be one of YES, NO, MAYBE" });
        }
        const trimmedText = typeof text === "string" ? text.trim() : "";
        if (!trimmedText) {
            return res.status(400).json({ status: "error", message: "text is required" });
        }
        try {
            const answer = await eightballService.createAnswer(type as EightBallAnswerType, trimmedText);
            res.status(201).json({ status: "success", data: answer });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/8ball/answers/:id: Remove an answer (admin only)
    router.delete("/8ball/answers/:id", authenticate, isAdmin, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const answer = await eightballService.getAnswerById(id);
            if (!answer) {
                return res.status(404).json({ status: "error", message: `Answer with id '${id}' not found` });
            }
            await eightballService.deleteAnswer(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeEightballRoutes };
