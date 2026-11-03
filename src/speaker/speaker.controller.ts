import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import speakerService, { SpeakerError, SpeakerScope } from "./speaker.service.js";
import { authenticate, isAdmin } from "../auth/security.middleware.js";

// Admin-only speaker operations (FR-EP-2: changing attribution is an admin
// right). See speaker.service.ts for what each one moves.

function badRequest(res: Response, message: string) {
    res.status(400).json({ status: "error", message });
}

function isPositiveInt(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) > 0;
}

/** Validates an optional `scope` body field; returns undefined (all lines) when absent. */
function parseScope(raw: unknown): SpeakerScope | undefined | Error {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "object") return new Error("scope must be an object");
    const { seasons, messages } = raw as Record<string, unknown>;
    const isStringArray = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === "string"));
    if (!isStringArray(seasons) || !isStringArray(messages)) {
        return new Error("scope.seasons and scope.messages must be arrays of strings");
    }
    return { seasons: seasons as string[] | undefined, messages: messages as string[] | undefined };
}

function sendError(res: Response, error: unknown, what: string) {
    if (error instanceof SpeakerError) {
        return res.status(error.status).json({ status: "error", message: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return res.status(409).json({ status: "error", message: "That name or slug is already taken" });
    }
    console.error(`Error in ${what}:`, error);
    res.status(500).json({ status: "error", message: `Failed to ${what}` });
}

const initializeSpeakerRoutes = (): Router => {
    const router: Router = Router();

    // POST /api/admin/speakers/demote {characterId, scope?, intoPersonaId?}
    router.post("/admin/speakers/demote", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { characterId, intoPersonaId } = req.body ?? {};
        if (!isPositiveInt(characterId)) return badRequest(res, "characterId is required");
        if (intoPersonaId !== undefined && !isPositiveInt(intoPersonaId)) return badRequest(res, "intoPersonaId must be a persona id");
        const scope = parseScope(req.body?.scope);
        if (scope instanceof Error) return badRequest(res, scope.message);
        try {
            const result = await speakerService.demoteToNpc(characterId, { scope, intoPersonaId });
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            sendError(res, error, "demote character");
        }
    });

    // POST /api/admin/speakers/promote {personaId, ownerId?, name?, slug?}
    router.post("/admin/speakers/promote", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { personaId, ownerId, name, slug } = req.body ?? {};
        if (!isPositiveInt(personaId)) return badRequest(res, "personaId is required");
        if (ownerId !== undefined && !isPositiveInt(ownerId)) return badRequest(res, "ownerId must be a user id");
        if ((name !== undefined && typeof name !== "string") || (slug !== undefined && typeof slug !== "string")) {
            return badRequest(res, "name and slug must be strings");
        }
        try {
            const result = await speakerService.promoteNpc(personaId, { ownerId, name, slug });
            res.status(201).json({ status: "success", data: result });
        } catch (error) {
            sendError(res, error, "promote NPC");
        }
    });

    // POST /api/admin/speakers/merge {sourceId, targetId, asPersona?, scope?}
    router.post("/admin/speakers/merge", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { sourceId, targetId, asPersona } = req.body ?? {};
        if (!isPositiveInt(sourceId) || !isPositiveInt(targetId)) return badRequest(res, "sourceId and targetId are required");
        if (asPersona !== undefined && typeof asPersona !== "boolean") return badRequest(res, "asPersona must be a boolean");
        const scope = parseScope(req.body?.scope);
        if (scope instanceof Error) return badRequest(res, scope.message);
        try {
            const result = await speakerService.mergeInto(sourceId, targetId, { asPersona, scope });
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            sendError(res, error, "merge characters");
        }
    });

    // POST /api/admin/speakers/rename {characterId, name?, slug?} (pre-go-live: slugs are permanent once public)
    router.post("/admin/speakers/rename", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { characterId, name, slug } = req.body ?? {};
        if (!isPositiveInt(characterId)) return badRequest(res, "characterId is required");
        if ((name !== undefined && typeof name !== "string") || (slug !== undefined && typeof slug !== "string")) {
            return badRequest(res, "name and slug must be strings");
        }
        try {
            const result = await speakerService.renameCharacter(characterId, { name, slug });
            res.status(200).json({ status: "success", data: result });
        } catch (error) {
            sendError(res, error, "rename character");
        }
    });

    // POST /api/personas {name, image?, color?}: find-or-create an NPC persona (admin)
    router.post("/personas", authenticate, isAdmin, async (req: Request, res: Response) => {
        const { name, image, color } = req.body ?? {};
        if (typeof name !== "string" || !name.trim()) return badRequest(res, "name is required");
        if ((image !== undefined && typeof image !== "string") || (color !== undefined && typeof color !== "string")) {
            return badRequest(res, "image and color must be strings");
        }
        try {
            const { persona, created } = await speakerService.createNpcPersona({ name, image, color });
            res.status(created ? 201 : 200).json({ status: "success", data: persona });
        } catch (error) {
            sendError(res, error, "create NPC persona");
        }
    });

    return router;
};

export default { initializeSpeakerRoutes };
