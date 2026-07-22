import { Response } from "express";
import { Prisma } from "@prisma/client";
import { HttpError } from "./errors.js";

// Response-envelope helpers. Status is always an explicit, defaulted argument
// so each route keeps full control of its code (200/201/204-caller/…), and the
// envelope shape ({ status, data } | { status, error }) lives in one place.

/** { status: "success", data } with an explicit status (200 default, 201 on create, …). */
export function sendSuccess(res: Response, data: unknown, status = 200): void {
    res.status(status).json({ status: "success", data });
}

/**
 * For endpoints that spread extra top-level fields alongside `data` — the
 * paginated `{ data, total, page, limit }` and story lines' extra `characters`.
 * Pass the whole result object (it already contains `data`).
 */
export function sendResult(res: Response, result: object, status = 200): void {
    res.status(status).json({ status: "success", ...result });
}

/** { status: "error", message } with an explicit status (400 default). */
export function sendError(res: Response, message: string, status = 400): void {
    res.status(status).json({ status: "error", message });
}

/**
 * Map a thrown error to an error envelope with the most specific status we can:
 *   - HttpError (thrown by services) carries its own status.
 *   - Known Prisma errors keep their detail exposed (as they already were on
 *     mutating routes) but get a fitting status: P2002 unique → 409,
 *     P2025 record-not-found → 404, P2003/P2014 FK constraint → 409.
 *   - Anything else is an unexpected fault: logged, returned as a generic 500
 *     so internal details / stack traces aren't leaked (NFR-SEC).
 */
export function sendCaughtError(res: Response, error: unknown): void {
    if (error instanceof HttpError) {
        return sendError(res, error.message, error.status);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const status =
            error.code === "P2002"
                ? 409
                : error.code === "P2025"
                  ? 404
                  : error.code === "P2003" || error.code === "P2014"
                    ? 409
                    : 400;
        return sendError(res, error.message, status);
    }
    console.error(error);
    sendError(res, "Internal server error", 500);
}
