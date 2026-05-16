import { Router, Request, Response } from "express";
import userService from "./user.service.js";
import tokenService from "../auth/token.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { UserRole } from "@prisma/client";

const initializeUserRoutes = (): Router => {
    const router: Router = Router();

    // POST /api/register: Register a new user account
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

    // POST /api/login: Authenticate and return a JWT access token
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

    // GET /api/user: Return the currently authenticated user
    router.get("/user", authenticate, async (req: Request, res: Response) => {
        return res.status(200).json({ status: "success", data: req.user });
    });

    // PUT /api/user: Update the authenticated user's profile (username, avatar, bio)
    router.put("/user", authenticate, async (req: Request, res: Response) => {
        const { username, icon, bio } = req.body;
        try {
            const updated = await userService.updateUser(req.user!.id, { username, icon, bio });
            return res.status(200).json({ status: "success", data: updated });
        } catch (err: any) {
            return res.status(400).json({ status: "error", message: err.message });
        }
    });

    // GET /api/users: List all users (admin only)
    router.get("/users", authenticate, isAdmin, async (req: Request, res: Response) => {
        const users = await userService.getAllUsers();
        return res.status(200).json({ status: "success", data: users });
    });

    // GET /api/users/:id: Get a single user by ID
    router.get("/users/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ status: "error", message: "Invalid user ID" });
        }
        const user = await userService.getUserById(id);
        if (!user) {
            return res.status(404).json({ status: "error", message: "User not found" });
        }
        return res.status(200).json({ status: "success", data: user });
    });

    // PUT /api/users/:id/role: Change a user's role (admin only)
    router.put("/users/:id/role", authenticate, isAdmin, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        const { role } = req.body;
        if (!role || !Object.values(UserRole).includes(role)) {
            return res.status(400).json({ status: "error", message: "Invalid role" });
        }
        try {
            const user = await userService.updateUserRole(id, role as UserRole);
            return res.status(200).json({ status: "success", data: user });
        } catch (err: any) {
            return res.status(400).json({ status: "error", message: err.message });
        }
    });

    return router;
};

export default { initializeUserRoutes };
