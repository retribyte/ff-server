import express, { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";

// Whole-story / whole-episode imports go up as ONE request so they can land
// in one transaction (all or nothing). A long story or episode runs to a few
// hundred KB, past express.json()'s 100kb default — so the global parser
// skips these paths, and each import route mounts `importJson` itself,
// *after* authenticate, so only a logged-in member (story import is open to
// members; registration is closed) can make the server buffer a large body. (/api/episodes/import is retired and only answers 410, but stays
// listed so an oversized stray upload gets that 410 instead of a 413.)
export const IMPORT_PATHS = new Set(["/api/stories/import", "/api/stories/convert", "/api/episodes/import"]);
// PUT /api/stories/:slug/import (revision) carries a whole story too
const REVISION_PATH = /^\/api\/stories\/[^/]+\/import$/;
export const importJson = express.json({ limit: "10mb" });

const defaultJson = express.json();

export function jsonExceptImports(req: Request, res: Response, next: NextFunction): void {
    if (IMPORT_PATHS.has(req.path) || REVISION_PATH.test(req.path)) return next();
    defaultJson(req, res, next);
}

// Interactive-transaction budget for an import. A few thousand rows through
// createMany is well under a second, but Prisma's 5s default is too tight a
// margin on a slow production box.
export const IMPORT_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

/** The record being imported already exists (or is a duplicate of one) — maps to 409. */
export class ImportConflictError extends Error {}

/**
 * Status + message for an import failure. Conflicts (our own pre-checks, or a
 * unique-constraint race that slipped past them) are 409 so the client can
 * tell "already in the archive" from "bad file".
 */
export function importErrorResponse(error: any, kind: string): { status: number; message: string } {
    if (error instanceof ImportConflictError) return { status: 409, message: error.message };
    // A picture's booru post couldn't be checked: try again later, nothing was written
    if (error?.name === "BooruUnavailableError") {
        return { status: 502, message: "The booru isn't answering, so the story's pictures couldn't be checked; nothing was imported" };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
            const target = constraintNames(error, "target") ?? "a unique field";
            return { status: 409, message: `Another ${kind} already uses that ${target}` };
        }
        if (error.code === "P2003") {
            return { status: 400, message: `Import references a record that doesn't exist (${constraintNames(error, "field_name") ?? "foreign key"}) — nothing was imported` };
        }
    }
    return { status: 400, message: error?.message ?? `Invalid ${kind} import` };
}

/**
 * The column(s) or constraint a P2002/P2003 error names, for messages. The
 * Rust engine put them in `meta.target` / `meta.field_name`. The driver
 * adapter (src/db.ts) leaves those out and reports the Postgres constraint
 * under `meta.driverAdapterError.cause.constraint` instead, as `{ fields }`
 * or `{ index }`.
 */
function constraintNames(error: Prisma.PrismaClientKnownRequestError, legacyKey: string): string | undefined {
    const legacy = error.meta?.[legacyKey] as string[] | string | undefined;
    if (legacy) return [legacy].flat().join(", ");
    const constraint = (error.meta?.driverAdapterError as any)?.cause?.constraint;
    if (Array.isArray(constraint?.fields)) {
        return constraint.fields.map((field: string) => field.replace(/^"|"$/g, "")).join(", ");
    }
    return typeof constraint?.index === "string" ? constraint.index : undefined;
}
