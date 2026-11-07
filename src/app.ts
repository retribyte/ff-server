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
import adminController from "./admin/admin.controller.js";
import viewController from "./view/view.controller.js";
import apiSpec from "./openapi.js";
import { jsonExceptImports } from "./utils/import.js";
import { canonicalRedirectUrl, requestHost } from "./utils/canonical-host.js";
import { getVersion } from "./utils/version.js";
import { requestLogger } from "./utils/request-log.js";
import { logger, errorFields } from "./utils/logger.js";

class App {
    public app: Application;

    constructor() {
        this.app = express();
        // First, so every response (redirects included) gets a log line
        this.app.use(requestLogger);
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
        this.app.get("/api/version", (req: Request, res: Response) => {
            res.json({ status: "success", data: getVersion() });
        });
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
        this.app.use("/api", adminController.initializeAdminRoutes());
        this.app.use("/api", viewController.initializeViewRoutes());
    }

    private errorHandlers(): void {
        this.app.use(
            (err: Error, req: Request, res: Response, next: NextFunction) => {
                logger.error("http.unhandled", errorFields(err));
                res.status(500).send("L, 500 server error");
            }
        );

        this.app.use((req: Request, res: Response) => {
            res.status(404).send("Resource not found");
        });
    }

    public listen(port: number, host: string = "0.0.0.0"): void {
        this.app.listen(port, host, () => {
            logger.info("server.listening", { port, host, version: getVersion().version, commit: getVersion().commit, node: process.version });
        });
    }
}

export default App;
