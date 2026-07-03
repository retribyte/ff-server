import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import userController from "./user/user.controller.js";
import characterController from "./character/character.controller.js";
import speciesController from "./species/species.controller.js";
import seasonController from "./season/season.controller.js";
import episodeController from "./episode/episode.controller.js";
import messageController from "./message/message.controller.js";
import itemController from "./item/item.controller.js";
import commentaryController from "./commentary/commentary.controller.js";
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
        this.app.use("/api", speciesController.initializeSpeciesRoutes());
        this.app.use("/api", seasonController.initializeSeasonRoutes());
        this.app.use("/api", episodeController.initializeEpisodeRoutes());
        this.app.use("/api", messageController.initializeMessageRoutes());
        this.app.use("/api", itemController.initializeItemRoutes());
        this.app.use("/api", commentaryController.initializeCommentaryRoutes());
    }

    private errorHandlers(): void {
        this.app.use(
            (err: Error, req: Request, res: Response, next: NextFunction) => {
                console.error(err.stack);
                res.status(500).send("L, 500 server error");
            }
        );

        this.app.use((req: Request, res: Response) => {
            res.status(404).send("Resource not found");
        });
    }

    public listen(port: number, host: string = "0.0.0.0"): void {
        this.app.listen(port, host, () => {
            console.log(`Server is running on port ${port}`);
        });
    }
}

export default App;
