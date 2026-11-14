import { Router, Request, Response } from "express";
import { authenticate, isAdmin } from "../auth/security.middleware.js";
import { importJson } from "../utils/import.js";
import { logger } from "../utils/logger.js";
import portraitService from "./portrait.service.js";
import { acceptsGzip, etagMatches, gzipped, type Assembled } from "./portrait.bundle.js";
import { parseSettings, SettingsError } from "./portrait.validation.js";

const PACK_CACHE = "private, max-age=31536000, immutable"; // the site adds ?v=<build>

const notInstalled = (res: Response) =>
    res.status(404).json({ status: "error", message: "No portrait bundle is installed on this server" });

// Sends an assembled JSON file: gzipped when the client takes it, with an ETag per encoding
async function sendAssembled(req: Request, res: Response, file: Assembled) {
    const gz = acceptsGzip(req.headers["accept-encoding"]);
    const etag = gz ? file.etag.slice(0, -1) + '-gz"' : file.etag;
    res.set({ ETag: etag, "Cache-Control": "private, no-cache", Vary: "Accept-Encoding", "Content-Type": "application/json; charset=utf-8" });
    if (etagMatches(req.headers["if-none-match"], etag)) return res.status(304).end();
    const body = gz ? await gzipped(file) : file.body;
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

    return router;
};

export default { initializePortraitRoutes };
