import { UserService } from "./user.service";
import { TokenService } from "../auth/token.service";
import { Request, Response, Router } from "express";
import type { User } from "@prisma/client";
import { SecurityMiddleware } from "../auth/security.middleware";

export class UserController {
    public router: Router = Router();
    private userService: UserService;
    private tokenService: TokenService;
    private securityMiddleware: SecurityMiddleware;

    constructor(
        userService: UserService,
        tokenService: TokenService,
        securityMiddleware: SecurityMiddleware
    ) {
        this.userService = userService;
        this.tokenService = tokenService;
        this.securityMiddleware = securityMiddleware;
        this.initializeRouter();
    }

    private initializeRouter() {
        this.router.post("/register", async (req: Request, res: Response) => {
            const { username, email, password } = req.body;
            console.log(req.body);

            if (!username || !email || !password) {
                res.status(400).json({
                    error: "Missing required fields"
                });
                return;
            }

            let user: any;

            try {
                user = await this.userService.createUser(username, email, password);
            } catch (err: any) {
                res.status(400).json({
                    error: "Error occured creating user: " + err.message
                });
                return;
            }

            return res.status(201).json(user);
        });

        this.router.post("/login", async (req: any, res: any) => {
            const { email, password } = req.body;

            if (
                !email ||
                !password ||
                typeof email !== "string" ||
                typeof password !== "string"
            ) {
                return res
                    .status(400)
                    .json({ error: "Missing required fields" });
            }

            try {
                const user = await this.userService.authenticateUser({
                    email,
                    password,
                });
                const token = await this.tokenService.generateToken(user);
                return res.status(200).json({ token });
            } catch (err: any) {
                return res
                    .status(400)
                    .json({ error: "Get owned: " + err.message });
            }
        });

        this.router.get(
            "/profile",
            this.securityMiddleware.authenticate,
            async (req: any, res: any) => {
                const user = req.user;
                return res.status(200).json(user);
            }
        );
    }
}
