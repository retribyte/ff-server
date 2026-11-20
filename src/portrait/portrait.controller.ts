import express, { Router, Request, Response } from "express";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { importJson } from "../utils/import.js";
import { logger } from "../utils/logger.js";
import portraitService from "./portrait.service.js";
import { acceptsGzip, etagMatches, plain, type Assembled } from "./portrait.bundle.js";
import savedService from "./saved.service.js";
import { parsePortrait, PortraitInputError, type PortraitInput } from "./saved.validation.js";
import { CHUNK_MAX_BYTES, UploadError, validModId, validSession } from "./portrait.upload.js";
import { parseCurationPatch, parseModPatch, parseRaces, parseSettings, SettingsError } from "./portrait.validation.js";

const PACK_CACHE = "private, max-age=31536000, immutable"; // the site adds ?v=<build>

const notInstalled = (res: Response) =>
    res.status(404).json({ status: "error", message: "No portrait bundle is installed on this server" });

// Sends an assembled JSON file: gzipped when the client takes it, with an ETag per encoding
async function sendAssembled(req: Request, res: Response, file: Assembled) {
    const gz = acceptsGzip(req.headers["accept-encoding"]);
    const etag = gz ? file.etag.slice(0, -1) + '-gz"' : file.etag;
    res.set({ ETag: etag, "Cache-Control": "private, no-cache", Vary: "Accept-Encoding", "Content-Type": "application/json; charset=utf-8" });
    if (etagMatches(req.headers["if-none-match"], etag)) return res.status(304).end();
    const body = gz ? file.gzip : await plain(file);
    if (gz) res.set("Content-Encoding", "gzip");
    return res.status(200).send(body);
}

const initializePortraitRoutes = (): Router => {
    const router = Router();

    // GET /api/portrait/settings: races, categories, curation and the mod list (members)
    router.get("/portrait/settings", authenticate, async (_req: Request, res: Response) => {
        try {
            return res.status(200).json({ status: "success", data: await portraitService.getSettings() });
        } catch (error) {
            logger.caught("Error fetching portrait settings", error);
            return res.status(500).json({ status: "error", message: "Failed to fetch portrait settings" });
        }
    });

    // GET /api/portrait/bundle/mods.json and items.json: the present, enabled mods' index files (members)
    for (const name of ["mods", "items"] as const) {
        router.get(`/portrait/bundle/${name}.json`, authenticate, async (req: Request, res: Response) => {
            try {
                const bundle = await portraitService.getBundle();
                if (!bundle) return notInstalled(res);
                return await sendAssembled(req, res, bundle[name]);
            } catch (error) {
                logger.caught("Error serving portrait bundle", error);
                return res.status(500).json({ status: "error", message: "Failed to serve the portrait bundle" });
            }
        });
    }

    // GET /api/portrait/bundle/:mod/sprites.pack: one mod's sprites, with Range (members)
    router.get("/portrait/bundle/:mod/sprites.pack", authenticate, async (req: Request, res: Response) => {
        try {
            const file = await portraitService.getPackPath(req.params.mod);
            if (!file) return res.status(404).json({ status: "error", message: "No such sprite pack" });
            // dotfiles: the bundle directory itself may be a dot folder (dev keeps it in ff-site/.portrait-bundle)
            return res.sendFile(file, { dotfiles: "allow", cacheControl: false, headers: { "Cache-Control": PACK_CACHE, "Content-Type": "application/octet-stream" } }, (error) => {
                if (error && !res.headersSent) {
                    logger.caught("Error sending portrait pack", error);
                    res.status(500).json({ status: "error", message: "Failed to send the sprite pack" });
                }
            });
        } catch (error) {
            logger.caught("Error serving portrait pack", error);
            return res.status(500).json({ status: "error", message: "Failed to serve the sprite pack" });
        }
    });

    // PUT /api/admin/portrait/settings: replace all settings (the contents of races.json + curation.json) (admin)
    router.put("/admin/portrait/settings", authenticate, isAdmin, importJson, async (req: Request, res: Response) => {
        try {
            await portraitService.replaceSettings(parseSettings(req.body));
            logger.info("portrait.settings_replaced", {});
            return res.status(200).json({ status: "success", data: await portraitService.getSettings() });
        } catch (error) {
            if (error instanceof SettingsError) return res.status(400).json({ status: "error", message: error.message });
            logger.caught("Error replacing portrait settings", error);
            return res.status(500).json({ status: "error", message: "Failed to save portrait settings" });
        }
    });

    // ----- mod uploads: any member; the mod is live as soon as its last piece arrives

    // PUT /api/portrait/mods/:id/upload?session=<hex>&offset=<n>&total=<n>, body: the next
    // piece of the mod folder file (application/octet-stream). The site extracts the folder
    // from the member's own Starbound files in their browser and sends it in pieces.
    router.put("/portrait/mods/:id/upload", authenticate, express.raw({ type: "application/octet-stream", limit: CHUNK_MAX_BYTES }), async (req: Request, res: Response) => {
        const session = String(req.query.session ?? "");
        const offset = Number(req.query.offset);
        const total = Number(req.query.total);
        try {
            if (!validModId(req.params.id)) throw new UploadError("That is not a mod id");
            if (!validSession(session)) throw new UploadError("session must be a random hex string");
            if (!Buffer.isBuffer(req.body)) throw new UploadError("Send the piece as application/octet-stream");
            const result = await portraitService.receiveUpload({ id: req.user!.id, username: req.user!.username }, req.params.id, session, offset, total, req.body);
            if (!result.configured) return notInstalled(res);
            const mod = result.installed;
            if (mod) logger.info("portrait.mod_uploaded", { mod: mod.id, name: mod.name, bytes: total, sprites: mod.sprites, items: mod.items, species: mod.species });
            return res.status(200).json({
                status: "success",
                data: { received: result.received, done: mod !== null, ...(mod ? { mod: { id: mod.id, name: mod.name, species: mod.species, items: mod.items, sprites: mod.sprites } } : {}) },
            });
        } catch (error) {
            if (validSession(session)) await portraitService.cancelUpload(req.user!.id, session).catch(() => {});
            if (error instanceof UploadError) return res.status(400).json({ status: "error", message: error.message });
            logger.caught("Error receiving a portrait mod upload", error);
            return res.status(500).json({ status: "error", message: "The upload could not be saved" });
        }
    });

    // ----- saved portraits: each member's own (admins may read and delete any)

    const failed = (res: Response, what: string, error: unknown) => {
        if (error instanceof PortraitInputError) return res.status(400).json({ status: "error", message: error.message });
        logger.caught(what, error);
        return res.status(500).json({ status: "error", message: "The portrait could not be saved" });
    };
    const idOf = (req: Request) => (/^\d{1,9}$/.test(req.params.id) ? Number(req.params.id) : null);
    const mayUse = (req: Request, ownerId: number) => req.user!.id === ownerId || req.user!.role === "ADMIN";
    const missing = (res: Response) => res.status(404).json({ status: "error", message: "No such portrait" });

    // GET /api/portraits: my saved portraits, without recipes or images (members)
    router.get("/portraits", authenticate, async (req: Request, res: Response) => {
        try {
            return res.status(200).json({ status: "success", data: await savedService.getPortraitsByOwner(req.user!.id) });
        } catch (error) {
            return failed(res, "Error listing portraits", error);
        }
    });

    // POST /api/portraits {name, race, recipe, image: PNG data URL}: keep a portrait (members)
    router.post("/portraits", authenticate, async (req: Request, res: Response) => {
        try {
            const created = await savedService.createPortrait(req.user!.id, parsePortrait(req.body) as PortraitInput);
            return res.status(201).json({ status: "success", data: created });
        } catch (error) {
            return failed(res, "Error saving portrait", error);
        }
    });

    // GET /api/portraits/:id: one portrait with its recipe (owner or admin; anyone else gets a 404)
    router.get("/portraits/:id", authenticate, async (req: Request, res: Response) => {
        try {
            const id = idOf(req);
            const portrait = id === null ? null : await savedService.getPortraitById(id);
            if (!portrait || !mayUse(req, portrait.ownerId)) return missing(res);
            return res.status(200).json({ status: "success", data: portrait });
        } catch (error) {
            return failed(res, "Error fetching portrait", error);
        }
    });

    // GET /api/portraits/:id/image.png: its PNG (owner or admin)
    router.get("/portraits/:id/image.png", authenticate, async (req: Request, res: Response) => {
        try {
            const id = idOf(req);
            const portrait = id === null ? null : await savedService.getPortraitImage(id);
            if (!portrait || !mayUse(req, portrait.ownerId)) return missing(res);
            // The site adds ?v=<updatedAt>, so a changed portrait is a new URL
            res.set({ "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" });
            return res.status(200).send(Buffer.from(portrait.image));
        } catch (error) {
            return failed(res, "Error fetching portrait image", error);
        }
    });

    // PUT /api/portraits/:id: change any of name, race, recipe, image (owner only: an admin does not edit a member's portrait)
    router.put("/portraits/:id", authenticate, async (req: Request, res: Response) => {
        try {
            const id = idOf(req);
            const portrait = id === null ? null : await savedService.getPortraitById(id);
            if (!portrait || !mayUse(req, portrait.ownerId)) return missing(res);
            if (portrait.ownerId !== req.user!.id) return res.status(403).json({ status: "error", message: "Only its owner can change a portrait" });
            const changes = parsePortrait(req.body, true);
            if (!Object.keys(changes).length) return res.status(400).json({ status: "error", message: "Nothing to change" });
            return res.status(200).json({ status: "success", data: await savedService.updatePortrait(portrait.id, changes) });
        } catch (error) {
            return failed(res, "Error updating portrait", error);
        }
    });

    // DELETE /api/portraits/:id (owner or admin)
    router.delete("/portraits/:id", authenticate, async (req: Request, res: Response) => {
        try {
            const id = idOf(req);
            const portrait = id === null ? null : await savedService.getPortraitById(id);
            if (!portrait || !mayUse(req, portrait.ownerId)) return missing(res);
            await savedService.deletePortrait(portrait.id);
            return res.status(204).end();
        } catch (error) {
            return failed(res, "Error deleting portrait", error);
        }
    });

    // The admin panel's edits. Each answers with the settings as they now stand.
    const edit = (what: string, change: (req: Request) => Promise<boolean | void>) => async (req: Request, res: Response) => {
        try {
            if ((await change(req)) === false) return res.status(404).json({ status: "error", message: "No such mod" });
            logger.info("portrait.settings_changed", { what, mod: req.params.id });
            return res.status(200).json({ status: "success", data: await portraitService.getSettings() });
        } catch (error) {
            if (error instanceof SettingsError) return res.status(400).json({ status: "error", message: error.message });
            logger.caught(`Error changing portrait ${what}`, error);
            return res.status(500).json({ status: "error", message: "Failed to save portrait settings" });
        }
    };

    // PUT /api/admin/portrait/races: { races } replaces the race list, in the order given (admin)
    router.put("/admin/portrait/races", authenticate, isAdmin, edit("races", async (req) => portraitService.replaceRaces(parseRaces(req.body?.races))));

    // PATCH /api/admin/portrait/curation: any of categories, hideItemPattern, hideItems, erase (admin)
    router.patch("/admin/portrait/curation", authenticate, isAdmin, edit("curation", async (req) => portraitService.updateCuration(parseCurationPatch(req.body))));

    // PATCH /api/admin/portrait/mods/:id: switch a mod on or off, rename it, limit who wears its clothing (admin)
    router.patch("/admin/portrait/mods/:id", authenticate, isAdmin, edit("mod", async (req) => portraitService.updateMod(req.params.id, parseModPatch(req.body))));

    // DELETE /api/admin/portrait/mods/:id: delete a mod's folder from the bundle, and its row (admin)
    router.delete("/admin/portrait/mods/:id", authenticate, isAdmin, edit("mod_deleted", async (req) => {
        const gone = await portraitService.deleteMod(req.params.id);
        return gone.folder || gone.row;
    }));

    return router;
};

export default { initializePortraitRoutes };
