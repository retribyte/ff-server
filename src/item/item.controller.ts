import { Router, Request, Response } from "express";
import itemService from "./item.service.js";
import { authenticate } from "../auth/security.middleware.js";

const initializeItemRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/items: Return all items with their associated character
    router.get("/items", async (req: Request, res: Response) => {
        try {
            const items = await itemService.getAllItems();
            res.status(200).json({ status: "success", data: items });
        } catch (error) {
            console.error("Error fetching items:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch items" });
        }
    });

    // GET /api/items/:id: Return an item by id with its associated character and creator
    router.get("/items/:id", async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const item = await itemService.getItemById(id);
            if (!item) {
                return res.status(404).json({
                    status: "error",
                    message: `Item with id '${id}' not found`,
                });
            }
            res.status(200).json({ status: "success", data: item });
        } catch (error) {
            console.error("Error fetching item:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch item" });
        }
    });

    // POST /api/items: Create a new item lore entry
    router.post("/items", authenticate, async (req: Request, res: Response) => {
        try {
            const item = await itemService.createItem(req.body);
            res.status(201).json({ status: "success", data: item });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/items/:id: Update an item by id
    router.put("/items/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            const item = await itemService.updateItem(id, req.body);
            res.status(200).json({ status: "success", data: item });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/items/:id: Delete an item by id
    router.delete("/items/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        try {
            await itemService.deleteItem(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeItemRoutes };
