import { Router, Request, Response } from "express";
import commentaryService from "./commentary.service.js";
import { authenticate } from "../auth/security.middleware.js";
import { UserRole } from "@prisma/client";

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
                return res.status(400).json({ status: "error", message: "Missing commentary content" });
            }

            try {
                const commentary = await commentaryService.createCommentary(
                    episodeTitle,
                    messageNo,
                    req.user!.id,
                    req.body.content.trim()
                );
                if (!commentary) {
                    return res.status(404).json({
                        status: "error",
                        message: `Message ${messageNo} in episode '${episodeTitle}' not found`,
                    });
                }
                res.status(201).json({ status: "success", data: commentary });
            } catch (error) {
                console.error("Error creating commentary:", error);
                res.status(500).json({ status: "error", message: "Failed to create commentary" });
            }
        }
    );

    // PUT /api/commentaries/:id: Edit a commentary (author or admin)
    router.put("/commentaries/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        if (!req.body?.content || typeof req.body.content !== "string" || !req.body.content.trim()) {
            return res.status(400).json({ status: "error", message: "Missing commentary content" });
        }

        try {
            const commentary = await commentaryService.getCommentaryById(id);
            if (!commentary) {
                return res.status(404).json({ status: "error", message: `Commentary with id '${id}' not found` });
            }
            if (commentary.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            const updated = await commentaryService.updateCommentary(id, req.body.content.trim());
            res.status(200).json({ status: "success", data: updated });
        } catch (error) {
            console.error("Error updating commentary:", error);
            res.status(500).json({ status: "error", message: "Failed to update commentary" });
        }
    });

    // DELETE /api/commentaries/:id: Delete a commentary (author or admin)
    router.delete("/commentaries/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const commentary = await commentaryService.getCommentaryById(id);
            if (!commentary) {
                return res.status(404).json({ status: "error", message: `Commentary with id '${id}' not found` });
            }
            if (commentary.creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
                return res.status(403).json({ status: "error", message: "Forbidden" });
            }
            await commentaryService.deleteCommentary(id);
            res.status(204).send();
        } catch (error) {
            console.error("Error deleting commentary:", error);
            res.status(500).json({ status: "error", message: "Failed to delete commentary" });
        }
    });

    return router;
};

export default { initializeCommentaryRoutes };
