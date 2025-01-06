import { Router } from "express";
import { UserController } from "../user/user.controller.js";
import { SecurityMiddleware } from "../auth/security.middleware.js";
import { TokenService } from "../auth/token.service.js";

export class RoutesController {
    public static router: Router = Router();
    private tokenService: TokenService;
    private securityMiddleware: SecurityMiddleware;

    constructor(
        tokenService: TokenService,
        securityMiddleware: SecurityMiddleware
    ) {
        this.tokenService = tokenService;
        this.securityMiddleware = securityMiddleware;
        this.initializeRouter();
    }

    private initializeRouter() {
        new UserController(this.tokenService, this.securityMiddleware);
    }
}
