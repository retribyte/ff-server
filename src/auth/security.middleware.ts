import { NextFunction, Response } from "express";
import { TokenService } from "./token.service";

export class SecurityMiddleware {
    private tokenService: TokenService;

    constructor(tokenService: TokenService) {
        this.tokenService = tokenService;
        this.authenticate = this.authenticate.bind(this); // written by copilot
    }

    async authenticate(
        req: any,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            res.status(401).json({ error: "No authorization header" });
            return;
        }

        const token = authHeader && authHeader.split(" ")[1];
        const isVerified = await this.tokenService.checkToken(token);
        console.log(isVerified ? "Token verified" : "Token not verified");

        if (isVerified) {
            req.user = isVerified.user;
            next();
        } else {
            res.status(401).json({ error: "Invalid token" });
            return;
        }
    }
}
