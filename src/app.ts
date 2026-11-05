import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import userController from "./user/user.controller.js";
import characterController from "./character/character.controller.js";
import seasonController from "./season/season.controller.js";
import episodeController from "./episode/episode.controller.js";
import messageController from "./message/message.controller.js";
import storyController from "./story/story.controller.js";
import itemController from "./item/item.controller.js";
import speciesController from "./species/species.controller.js";
import commentaryController from "./commentary/commentary.controller.js";
import eightballController from "./eightball/eightball.controller.js";
import searchController from "./search/search.controller.js";
import speakerController from "./speaker/speaker.controller.js";
import apiSpec from "./openapi.js";
import { jsonExceptImports } from "./utils/import.js";
import { canonicalRedirectUrl, requestHost } from "./utils/canonical-host.js";

class App {
    public app: Application;

    constructor() {
        this.app = express();
        // First: requests by the NFSN default name (or www.) go to the canonical
        // host, behind Cloudflare. Off unless CANONICAL_HOST is set.
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            const host = requestHost(req.get("x-forwarded-host"), req.get("host"));
            const target = canonicalRedirectUrl(process.env.CANONICAL_HOST, host, req.originalUrl);
            if (target) return res.redirect(308, target);
            next();
        });
        this.app.use(cors());
        // Import routes parse their own (larger) bodies — see utils/import.ts
        this.app.use(jsonExceptImports);
        this.routes();
        this.errorHandlers();
    }

    private routes(): void {
        this.app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(apiSpec));
        this.app.use("/api", userController.initializeUserRoutes());
        this.app.use("/api", characterController.initializeCharacterRoutes());
        this.app.use("/api", seasonController.initializeSeasonRoutes());
        this.app.use("/api", episodeController.initializeEpisodeRoutes());
        this.app.use("/api", messageController.initializeMessageRoutes());
        this.app.use("/api", storyController.initializeStoryRoutes());
        this.app.use("/api", itemController.initializeItemRoutes());
        this.app.use("/api", speciesController.initializeSpeciesRoutes());
        this.app.use("/api", commentaryController.initializeCommentaryRoutes());
        this.app.use("/api", eightballController.initializeEightballRoutes());
        this.app.use("/api", searchController.initializeSearchRoutes());
        this.app.use("/api", speakerController.initializeSpeakerRoutes());
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
