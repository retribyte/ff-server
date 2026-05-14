import { Router, Request, Response } from "express";
import characterService from "./character.service.js";
import { authenticate } from "../auth/security.middleware.js";

const initializeCharacterRoutes = (): Router => {
    const router: Router = Router();

    // GET /api/characters: Return all characters with aliases and relationships
    router.get("/characters", authenticate, async (req: Request, res: Response) => {
        try {
            const characters = await characterService.getAllCharacters();
            res.status(200).json({ status: "success", data: characters });
        } catch (error) {
            console.error("Error fetching characters:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch characters" });
        }
    });

    // GET /api/characters/:id: Return a character by id
    router.get("/characters/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await characterService.getCharacterById(id);
            if (!character) {
                return res.status(404).json({
                    status: "error",
                    message: `Character with id '${id}' not found`,
                });
            }
            res.status(200).json({ status: "success", data: character });
        } catch (error) {
            console.error("Error fetching character:", error);
            res.status(500).json({ status: "error", message: "Failed to fetch character" });
        }
    });

    // POST /api/characters: Create a new character
    router.post("/characters", authenticate, async (req: Request, res: Response) => {
        try {
            const character = await characterService.createCharacter(req.body);
            res.status(201).json({ status: "success", data: character });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // PUT /api/characters/:id: Update a character by id
    router.put("/characters/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            const character = await characterService.updateCharacter(id, req.body);
            res.status(200).json({ status: "success", data: character });
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    // DELETE /api/characters/:id: Delete a character by id
    router.delete("/characters/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);

        try {
            await characterService.deleteCharacter(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(400).json({ status: "error", message: error.message });
        }
    });

    return router;
};

export default { initializeCharacterRoutes };
