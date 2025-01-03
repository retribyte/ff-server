import { UserService } from "./user.service";
import { TokenService } from "../auth/token.service";
import { Request, Response, Router } from "express";
import type { User } from "@prisma/client";
import { SecurityMiddleware } from "../auth/security.middleware";
import { RoutesController } from "routes/routes.controller";

export class UserController {
    public router: Router;
    private userService: UserService;
    private tokenService: TokenService;
    private securityMiddleware: SecurityMiddleware;

    constructor(
        tokenService: TokenService,
        securityMiddleware: SecurityMiddleware
    ) {
        this.router = RoutesController.router;
        this.userService = new UserService();
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
                    error: "Missing required fields",
                });
                return;
            }

            let user: any;

            try {
                user = await this.userService.createUser(
                    username,
                    email,
                    password
                );
            } catch (err: any) {
                res.status(400).json({
                    error: "Error occurred creating user: " + err.message,
                });
                return;
            }

            const { password: userPassword, ...userWithoutPassword } = user;
            return res.status(201).json(userWithoutPassword);
        });

        this.router.post("/login", async (req: Request, res: Response) => {
            const { username, password } = req.body;

            if (!username || !password) {
                return res
                    .status(400)
                    .json({ error: "Missing required fields" });
            }

            try {
                const user = await this.userService.authenticateUser({
                    username,
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
            "/user",
            this.securityMiddleware.authenticate,
            async (req: any, res: Response) => {
                const user = req.user as User;
                const { password: userPassword, ...userWithoutPassword } = user;
                return res.status(200).json(userWithoutPassword);
            }
        );

        this.router.patch(
            "/user",
            this.securityMiddleware.authenticate,
            async (req: any, res: Response) => {}
        );
    }
}
