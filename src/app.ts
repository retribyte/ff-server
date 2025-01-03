import { PrismaClient } from "@prisma/client";
import express, { Application, NextFunction, Request, Response } from "express";

import { SecurityMiddleware } from "./auth/security.middleware";
import { TokenService } from "./auth/token.service";

import { RoutesController } from "routes/routes.controller";

class App {
    public app: Application;
    private prisma: PrismaClient;

    private tokenService: TokenService;
    private securityMiddleware: SecurityMiddleware;

    private routesController: RoutesController;

    constructor() {
        this.app = express();
        this.prisma = new PrismaClient();

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

    public listen(port: number): void {
        this.app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    }
}

export default App;
