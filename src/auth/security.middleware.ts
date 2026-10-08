import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import tokenService from "./token.service.js";
import userService, { type SafeUser } from "../user/user.service.js";

/**
 * Verifies the bearer token and loads the current user from the database, so
 * req.user is never a stale token snapshot. Rejects tokens issued before the
 * user's last password change and tokens for accounts that can't log in.
 * Responds and returns null on failure.
 */
async function verifyRequest(req: Request, res: Response): Promise<SafeUser | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).json({ status: "error", message: "No authorization header" });
        return null;
    }
    const token = authHeader.split(" ")[1];
    const decoded = await tokenService.verifyAccessToken(token);
    const user = decoded && typeof decoded.id === "number" ? await userService.getUserById(decoded.id) : null;
    // iat is in whole seconds, so compare at that resolution: a token issued
    // in the same second as the change (the one handed back by it) stays valid
    const revoked = user?.passwordChangedAt
        && (decoded!.iat ?? 0) < Math.floor(user.passwordChangedAt.getTime() / 1000);
    if (!user || user.loginDisabled || revoked) {
        res.status(401).json({ status: "error", message: "Invalid or expired token" });
        return null;
    }
    return user;
}

export async function authenticate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const user = await verifyRequest(req, res);
    if (!user) return;
    // Seeded/reset accounts can read, but must pick their own password before
    // writing anything
    if (user.mustChangePassword && req.method !== "GET") {
        res.status(403).json({ status: "error", message: "Change your password before continuing" });
        return;
    }
    req.user = user;
    next();
}

/** authenticate, minus the pending-password-change gate — for the password change route itself. */
export async function authenticateAllowingPasswordChange(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const user = await verifyRequest(req, res);
    if (!user) return;
    req.user = user;
    next();
}

export function isAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.user || req.user.role !== UserRole.ADMIN) {
        res.status(403).json({ status: "error", message: "Forbidden" });
        return;
    }
    next();
}
