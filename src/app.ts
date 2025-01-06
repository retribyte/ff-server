import { PrismaClient } from "@prisma/client";
import express, { Application, NextFunction, Request, Response } from "express";

import { SecurityMiddleware } from "./auth/security.middleware.js";
import { TokenService } from "./auth/token.service.js";

import { RoutesController } from "./routes/routes.controller.js";

class App {
    public app: Application;
    public static prisma: PrismaClient;

    private tokenService: TokenService;
    private securityMiddleware: SecurityMiddleware;

    private routesController: RoutesController;

    constructor() {
        this.app = express();
        App.prisma = new PrismaClient();

        // Keep constructed objects in the constructor, not in a separate method
        this.tokenService = new TokenService();
        this.securityMiddleware = new SecurityMiddleware(this.tokenService);

        this.routesController = new RoutesController(
            this.tokenService,
            this.securityMiddleware
        );

        this.app.use(express.json());
        // this.app.use(express.static(__dirname + "/public"));

        this.routes();
        this.errorHandlers();
    }

    private routes(): void {
        // Routes go here, mmkay?
        this.app.use(RoutesController.router);
    }

    private errorHandlers(): void {
        this.app.use(
            (err: Error, req: Request, res: Response, next: NextFunction) => {
                console.error(err.stack);
                res.status(500).send("L, 500 server error");
            }
        );

        this.app.use((req: Request, res: Response, next: NextFunction) => {
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
