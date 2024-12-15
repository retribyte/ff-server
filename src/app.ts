import express, { Application, Request, Response, NextFunction } from "express";
import { hashSync, compare } from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

import { TokenService } from "./auth/token.service";
import { SecurityMiddleware } from "./auth/security.middleware";

import { UserService } from "./user/user.service";
import { UserController } from "./user/user.controller";

class App {
    public app: Application;
    private prisma: PrismaClient;

    private tokenService: TokenService;
    private securityMiddleware: SecurityMiddleware;

    private userService: UserService;
    private userController: UserController;

    constructor() {
        this.app = express();
        this.prisma = new PrismaClient();
        this.config();
        this.routes();
        this.errorHandlers();
    }

    private config(): void {
        this.tokenService = new TokenService(jwt);
        this.securityMiddleware = new SecurityMiddleware(this.tokenService);

        this.userService = new UserService();
        this.userController = new UserController(this.userService, this.tokenService, this.securityMiddleware);

        this.app.use(express.json());
        // this.app.use(express.static(__dirname + "/public"));
    }

    private routes(): void {
        // Routes go here, mmkay?
        this.app.use(this.userController.router);
    }

    private errorHandlers(): void {
        this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
            console.error(err.stack);
            res.status(500).send("L, 500 server error");
        });

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