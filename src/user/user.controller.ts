import { Router, Request, Response } from "express";
import userService from "./user.service.js";
import tokenService from "../auth/token.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { UserRole } from "@prisma/client";
import { sendSuccess, sendError, sendCaughtError } from "../utils/http.js";

const initializeUserRoutes = (): Router => {
    const router: Router = Router();

    // POST /api/register: Register a new user account
    router.post("/register", async (req: Request, res: Response) => {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return sendError(res, "Missing required fields", 400);
        }

        try {
            const user = await userService.createUser(username, email, password);
            const { password: _, ...userWithoutPassword } = user;
            return sendSuccess(res, userWithoutPassword, 201);
        } catch (error) {
            // createUser throws ConflictError (409) when the username is taken;
            // a duplicate email surfaces as a Prisma P2002 (also 409).
            return sendCaughtError(res, error);
        }
    });

    // POST /api/login: Authenticate and return a JWT access token
    router.post("/login", async (req: Request, res: Response) => {
        const { username, password } = req.body;
        if (!username || !password) {
            return sendError(res, "Missing username or password", 400);
        }

        try {
            const user = await userService.authenticateUser(username, password);
            if (!user) {
                return sendError(res, "Invalid credentials", 401);
            }
            const token = await tokenService.generateAccessToken(user);
            return sendSuccess(res, { token });
        } catch (error) {
            console.error("Login error:", error);
            return sendError(res, "Internal server error", 500);
        }
    });

    // GET /api/user: Return the currently authenticated user
    router.get("/user", authenticate, async (req: Request, res: Response) => {
        return sendSuccess(res, req.user);
    });

    // PUT /api/user: Update the authenticated user's profile (username, avatar, bio)
    router.put("/user", authenticate, async (req: Request, res: Response) => {
        const { username, icon, bio } = req.body;
        try {
            const updated = await userService.updateUser(req.user!.id, { username, icon, bio });
            return sendSuccess(res, updated);
        } catch (error) {
            // A username collision surfaces as a Prisma P2002 → 409.
            return sendCaughtError(res, error);
        }
    });

    // GET /api/users: List all users (admin only)
    router.get("/users", authenticate, isAdmin, async (req: Request, res: Response) => {
        const users = await userService.getAllUsers();
        return sendSuccess(res, users);
    });

    // GET /api/users/:id: Get a single user by ID
    router.get("/users/:id", authenticate, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return sendError(res, "Invalid user ID", 400);
        }
        const user = await userService.getUserById(id);
        if (!user) {
            return sendError(res, "User not found", 404);
        }
        return sendSuccess(res, user);
    });

    // PUT /api/users/:id/role: Change a user's role (admin only)
    router.put("/users/:id/role", authenticate, isAdmin, async (req: Request, res: Response) => {
        const id = parseInt(req.params.id, 10);
        const { role } = req.body;
        if (!role || !Object.values(UserRole).includes(role)) {
            return sendError(res, "Invalid role", 400);
        }
        try {
            const user = await userService.updateUserRole(id, role as UserRole);
            return sendSuccess(res, user);
        } catch (error) {
            // Updating a nonexistent user surfaces as a Prisma P2025 → 404.
            return sendCaughtError(res, error);
        }
    });

    return router;
};

export default { initializeUserRoutes };
