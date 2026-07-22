import { Router, Request, Response } from "express";
import commentaryService from "./commentary.service.js";
import { authenticate } from "../auth/security.middleware.js";
import { assertOwnerOrAdmin } from "../auth/ownership.js";
import { sendSuccess, sendError } from "../utils/http.js";

const initializeCommentaryRoutes = (): Router => {
    const router: Router = Router();

    // POST /api/episodes/:episodeTitle/messages/:messageNo/commentaries: Add a commentary to a message
    router.post(
        "/episodes/:episodeTitle/messages/:messageNo/commentaries",
        authenticate,
        async (req: Request, res: Response) => {
            const { episodeTitle } = req.params;
            const messageNo = parseInt(req.params.messageNo, 10);
            if (!req.body?.content || typeof req.body.content !== "string" || !req.body.content.trim()) {
                return sendError(res, "Missing commentary content", 400);
            }

            try {
                const commentary = await commentaryService.createCommentary(
                    episodeTitle,
                    messageNo,
                    req.user!.id,
                    req.body.content.trim()
                );
                if (!commentary) {
                    return sendError(res, `Message ${messageNo} in episode '${episodeTitle}' not found`, 404);
                }
                sendSuccess(res, commentary, 201);
            } catch (error) {
                console.error("Error creating commentary:", error);
                sendError(res, "Failed to create commentary", 500);
            }
        }
    );

    // PUT /api/commentaries/:id: Edit a commentary (author or admin)
    router.put("/commentaries/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        if (!req.body?.content || typeof req.body.content !== "string" || !req.body.content.trim()) {
            return sendError(res, "Missing commentary content", 400);
        }

        try {
            const commentary = await commentaryService.getCommentaryById(id);
            if (!commentary) {
                return sendError(res, `Commentary with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, commentary.creatorId)) return;
            const updated = await commentaryService.updateCommentary(id, req.body.content.trim());
            sendSuccess(res, updated);
        } catch (error) {
            console.error("Error updating commentary:", error);
            sendError(res, "Failed to update commentary", 500);
        }
    });

    // DELETE /api/commentaries/:id: Delete a commentary (author or admin)
    router.delete("/commentaries/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const commentary = await commentaryService.getCommentaryById(id);
            if (!commentary) {
                return sendError(res, `Commentary with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, commentary.creatorId)) return;
            await commentaryService.deleteCommentary(id);
            res.status(204).send();
        } catch (error) {
            console.error("Error deleting commentary:", error);
            sendError(res, "Failed to delete commentary", 500);
        }
    });

    return router;
};

export default { initializeCommentaryRoutes };
