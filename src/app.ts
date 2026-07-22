import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import userController from "./user/user.controller.js";
import characterController from "./character/character.controller.js";
import personaController from "./persona/persona.controller.js";
import speciesController from "./species/species.controller.js";
import seasonController from "./season/season.controller.js";
import episodeController from "./episode/episode.controller.js";
import messageController from "./message/message.controller.js";
import storyController from "./story/story.controller.js";
import itemController from "./item/item.controller.js";
import commentaryController from "./commentary/commentary.controller.js";
import eightballController from "./eightball/eightball.controller.js";
import apiSpec from "./openapi.js";

class App {
    public app: Application;

    constructor() {
        this.app = express();
        this.app.use(cors());
        this.app.use(express.json());
        this.routes();
        this.errorHandlers();
    }

    private routes(): void {
        this.app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(apiSpec));
        this.app.use("/api", userController.initializeUserRoutes());
        this.app.use("/api", characterController.initializeCharacterRoutes());
        this.app.use("/api", personaController.initializePersonaRoutes());
        this.app.use("/api", speciesController.initializeSpeciesRoutes());
        this.app.use("/api", seasonController.initializeSeasonRoutes());
        this.app.use("/api", episodeController.initializeEpisodeRoutes());
        this.app.use("/api", messageController.initializeMessageRoutes());
        this.app.use("/api", storyController.initializeStoryRoutes());
        this.app.use("/api", itemController.initializeItemRoutes());
        this.app.use("/api", commentaryController.initializeCommentaryRoutes());
        this.app.use("/api", eightballController.initializeEightballRoutes());
    }

    private errorHandlers(): void {
        // Last-resort fallback for anything a controller let bubble up.
        // Controllers handle their own errors, so this mainly guards against
        // programmer error: log the stack server-side, return the standard
        // envelope (never the stack itself) per the response-envelope convention.
        this.app.use(
            (err: Error, req: Request, res: Response, next: NextFunction) => {
                console.error(err.stack);
                res.status(500).json({ status: "error", message: "Internal server error" });
            }
        );

        // Unmatched route — also uses the envelope so API clients get JSON.
        this.app.use((req: Request, res: Response) => {
            res.status(404).json({ status: "error", message: "Resource not found" });
        });
    }

    public listen(port: number, host: string = "0.0.0.0"): void {
        this.app.listen(port, host, () => {
            console.log(`Server is running on port ${port}`);
        });
    }
}

export default App;
