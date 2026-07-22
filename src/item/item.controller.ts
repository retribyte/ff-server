import { Router, Request, Response } from "express";
import itemService from "./item.service.js";
import { authenticate } from "../auth/security.middleware.js";
import { assertOwnerOrAdmin } from "../auth/ownership.js";
import { sendSuccess, sendError, sendCaughtError } from "../utils/http.js";

const initializeItemRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/items: Return all items, optionally searched by name (public)
    router.get("/items", async (req: Request, res: Response) => {
        try {
            const items = await itemService.getAllItems(req.query.search as string | undefined);
            sendSuccess(res, items);
        } catch (error) {
            console.error("Error fetching items:", error);
            sendError(res, "Failed to fetch items", 500);
        }
    });

    // GET /api/items/:id: Return an item by id with its creator, or by slug
    // when the param isn't a bare integer (public)
    router.get("/items/:id", async (req: Request, res: Response) => {
        const { id: param } = req.params;
        const isId = /^\d+$/.test(param);
        try {
            const item = isId
                ? await itemService.getItemById(parseInt(param, 10))
                : await itemService.getItemBySlug(param);
            if (!item) {
                return sendError(
                    res,
                    isId ? `Item with id '${param}' not found` : `Item with slug '${param}' not found`,
                    404
                );
            }
            sendSuccess(res, item);
        } catch (error) {
            console.error("Error fetching item:", error);
            sendError(res, "Failed to fetch item", 500);
        }
    });

    // POST /api/items: Create a new item lore entry
    router.post("/items", authenticate, async (req: Request, res: Response) => {
        try {
            const item = await itemService.createItem({ ...req.body, creatorId: req.user!.id });
            sendSuccess(res, item, 201);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // PUT /api/items/:id: Update an item by id
    router.put("/items/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const item = await itemService.getItemById(id);
            if (!item) {
                return sendError(res, `Item with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, item.creatorId)) return;
            const updated = await itemService.updateItem(id, req.body);
            sendSuccess(res, updated);
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    // DELETE /api/items/:id: Delete an item by id
    router.delete("/items/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const item = await itemService.getItemById(id);
            if (!item) {
                return sendError(res, `Item with id '${id}' not found`, 404);
            }
            if (!assertOwnerOrAdmin(req, res, item.creatorId)) return;
            await itemService.deleteItem(id);
            res.status(204).send();
        } catch (error) {
            sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeItemRoutes };
