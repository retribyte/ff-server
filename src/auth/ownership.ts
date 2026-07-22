import { Request, Response } from "express";
import { UserRole } from "@prisma/client";

/**
 * Creator-or-admin gate. Returns true when the current user owns the record
 * (its creatorId matches) or is an admin. Otherwise writes the standard 403
 * error envelope and returns false — use as an early-return guard:
 *
 *     if (!assertOwnerOrAdmin(req, res, record.creatorId)) return;
 *
 * Assumes `authenticate` has already run and populated req.user.
 */
export function assertOwnerOrAdmin(req: Request, res: Response, creatorId: number): boolean {
    if (creatorId !== req.user!.id && req.user!.role !== UserRole.ADMIN) {
        res.status(403).json({ status: "error", message: "Forbidden" });
        return false;
    }
    return true;
}
