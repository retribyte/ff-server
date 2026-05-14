import { Router, Request, Response } from "express";
import userService from "./user.service.js";
import tokenService from "../auth/token.service.js";
import { authenticate } from "../auth/security.middleware.js";

const initializeUserRoutes = (): Router => {
    const router: Router = Router();

    router.post("/register", async (req: Request, res: Response) => {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res
                .status(400)
                .json({ status: "error", message: "Missing required fields" });
        }

        try {
            const user = await userService.createUser(username, email, password);
            const { password: _, ...userWithoutPassword } = user;
            return res
                .status(201)
                .json({ status: "success", data: userWithoutPassword });
        } catch (err: any) {
            return res
                .status(400)
                .json({ status: "error", message: err.message });
        }
    });

    router.post("/login", async (req: Request, res: Response) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return res
                .status(400)
                .json({ status: "error", message: "Missing username or password" });
        }

        try {
            const user = await userService.authenticateUser(username, password);
            if (!user) {
                return res
                    .status(400)
                    .json({ status: "error", message: "Invalid credentials" });
            }
            const token = await tokenService.generateAccessToken(user);
            return res.status(200).json({ status: "success", data: { token } });
        } catch (error) {
            console.error("Login error:", error);
            return res
                .status(500)
                .json({ status: "error", message: "Internal server error" });
        }
    });

    router.get("/user", authenticate, async (req: Request, res: Response) => {
        return res.status(200).json({ status: "success", data: req.user });
    });

    return router;
};

export default { initializeUserRoutes };
