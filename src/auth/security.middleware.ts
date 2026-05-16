import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import tokenService from "./token.service.js";

export async function authenticate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).json({ status: "error", message: "No authorization header" });
        return;
    }
    const token = authHeader.split(" ")[1];
    const decoded = await tokenService.verifyAccessToken(token);
    if (!decoded) {
        res.status(401).json({ status: "error", message: "Invalid or expired token" });
        return;
    }
    req.user = decoded;
    next();
}

export function isAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.user || req.user.role !== UserRole.ADMIN) {
        res.status(403).json({ status: "error", message: "Forbidden" });
        return;
    }
    next();
}
