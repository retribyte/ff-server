import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { BUNDLE_VERSION, PACK_NAME } from "./portrait.bundle.js";

// A mod folder sent by a member's browser (the site reads their Starbound files there and
// extracts the folder; see ff-site's src/lib/portrait/extract). It arrives as one file in
// pieces: a short header, mod.json, items.json, then the sprite pack. Nothing is served
// from it until the whole file has arrived and passed the checks here, and then the folder
// is swapped in with a rename, so a mod is never half there.

export const UPLOAD_MAGIC = Buffer.from("FFPM1\n");
/** One piece. The site sends 2 MB; anything a proxy in between would balk at is refused here first. */
export const CHUNK_MAX_BYTES = 4 * 1024 * 1024;
/** The base game's folder is about 14 MB; the largest mod seen so far is 33 MB. */
export const UPLOAD_MAX_BYTES = 128 * 1024 * 1024;
const JSON_MAX_BYTES = 48 * 1024 * 1024;
/** Unfinished uploads older than this are deleted when the next one starts. */
const STALE_MS = 2 * 60 * 60 * 1000;
const UPLOADS_DIR = ".uploads";
const SLOTS = new Set(["head", "chest", "legs", "back"]);

/** The upload breaks a rule; the message is shown to the member. */
export class UploadError extends Error {}

/** Folder names a mod may have: what the extractor makes (a workshop number, `vanilla`, a slug, `<number>-<pak name>`). */
export function validModId(id: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/.test(id) && !/[ .]$/.test(id);
}

export function validSession(session: string): boolean {
    return /^[a-f0-9]{16,64}$/.test(session);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function checkImages(images: unknown, packBytes: number, frameFiles: number, what: string): void {
    if (!isObject(images)) throw new UploadError(`${what}: images must be an object`);
    for (const [name, ref] of Object.entries(images)) {
        const ok =
            name.startsWith("/") &&
            Array.isArray(ref) &&
            ref.length === 4 &&
            isCount(ref[0]) &&
            isCount(ref[1]) &&
            typeof ref[2] === "string" &&
            Number.isInteger(ref[3]) &&
            ref[3] >= -1 &&
            ref[3] < frameFiles &&
            ref[0] + ref[1] <= packBytes;
        if (!ok) throw new UploadError(`${what}: the entry for ${name.slice(0, 120)} does not fit the sprite pack`);
    }
}

export interface UploadedMod {
    id: string;
    name: string;
    modJson: Buffer;
    itemsJson: Buffer;
    /** Where the sprite pack starts in the uploaded file, and how long it is. */
    packStart: number;
    packBytes: number;
    species: number;
    items: number;
    sprites: number;
}

/**
 * Reads the uploaded file's header and two JSON files and checks they describe a mod folder
 * for `id` that the site can read. The sprite pack itself is opaque: the site decodes each
 * PNG in the member's browser with its own reader, and here only its size is checked against
 * the index.
 */
export async function inspectUpload(file: string, id: string): Promise<UploadedMod> {
    const handle = await fs.open(file, "r");
    try {
        const total = (await handle.stat()).size;
        const read = async (at: number, length: number) => {
            if (length < 0 || at + length > total) throw new UploadError("The upload is cut short");
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, at);
            return buffer;
        };
        let at = 0;
        if (!(await read(at, UPLOAD_MAGIC.length)).equals(UPLOAD_MAGIC)) throw new UploadError("That is not a mod folder made by the portrait creator");
        at += UPLOAD_MAGIC.length;
        const part = async (what: string) => {
            const length = (await read(at, 4)).readUInt32BE(0);
            if (length > JSON_MAX_BYTES) throw new UploadError(`${what} is too large`);
            const body = await read(at + 4, length);
            at += 4 + length;
            return body;
        };
        const modJson = await part("mod.json");
        const itemsJson = await part("items.json");
        const packBytes = total - at;

        let mod: unknown, items: unknown;
        try {
            mod = JSON.parse(modJson.toString("utf8"));
            items = JSON.parse(itemsJson.toString("utf8"));
        } catch {
            throw new UploadError("The upload's index files are not JSON");
        }
        if (!isObject(mod) || !isObject(items)) throw new UploadError("The upload's index files are not objects");
        if (mod.version !== BUNDLE_VERSION || items.version !== BUNDLE_VERSION) {
            throw new UploadError("This mod folder was made by a different version of the site. Reload the page and try again.");
        }
        if (mod.id !== id || items.id !== id) throw new UploadError("The upload is for a different mod than the one named");
        if (typeof mod.name !== "string" || !mod.name.trim() || mod.name.length > 300) throw new UploadError("mod.json: name is missing");
        if (typeof mod.build !== "string" || !/^[0-9a-f]{6,40}$/.test(mod.build) || items.build !== mod.build) throw new UploadError("mod.json: build is missing");
        if (typeof mod.order !== "number") throw new UploadError("mod.json: order is missing");
        if (mod.priority !== undefined && typeof mod.priority !== "number") throw new UploadError("mod.json: priority must be a number");
        if (mod.modName !== undefined && typeof mod.modName !== "string") throw new UploadError("mod.json: modName must be text");
        if (mod.after !== undefined && !(Array.isArray(mod.after) && mod.after.every((n) => typeof n === "string"))) throw new UploadError("mod.json: after must be a list of names");
        const frameFiles = mod.frameFiles;
        if (!Array.isArray(frameFiles) || !frameFiles.every((f) => typeof f === "string")) throw new UploadError("mod.json: frameFiles must be a list of paths");
        for (const key of ["species", "speciesPatches", "frames"]) if (!isObject(mod[key])) throw new UploadError(`mod.json: ${key} must be an object`);
        checkImages(mod.images, packBytes, frameFiles.length, "mod.json");
        checkImages(items.images, packBytes, frameFiles.length, "items.json");
        if (!Array.isArray(items.palettes) || !items.palettes.every(Array.isArray)) throw new UploadError("items.json: palettes must be a list of lists");
        if (!Array.isArray(items.items)) throw new UploadError("items.json: items must be a list");
        for (const item of items.items) {
            const ok =
                isObject(item) &&
                typeof item.id === "string" &&
                typeof item.name === "string" &&
                typeof item.slot === "string" &&
                SLOTS.has(item.slot) &&
                isObject(item.frames) &&
                isCount(item.colors) &&
                item.colors < items.palettes.length;
            if (!ok) throw new UploadError("items.json: an item is malformed");
        }
        return {
            id,
            name: mod.name.trim(),
            modJson,
            itemsJson,
            packStart: at,
            packBytes,
            species: Object.keys(mod.species as object).length,
            items: items.items.length,
            sprites: Object.keys(mod.images as object).length + Object.keys(items.images as object).length,
        };
    } finally {
        await handle.close();
    }
}

const uploadsDir = (dir: string) => path.join(dir, UPLOADS_DIR);
const partFile = (dir: string, userId: number, session: string) => path.join(uploadsDir(dir), `${userId}-${session}.part`);

async function sweep(dir: string): Promise<void> {
    const folder = uploadsDir(dir);
    for (const name of await fs.readdir(folder).catch(() => [] as string[])) {
        const full = path.join(folder, name);
        try {
            if (Date.now() - (await fs.stat(full)).mtimeMs > STALE_MS) await fs.rm(full, { recursive: true, force: true });
        } catch {
            // someone else removed it
        }
    }
}

/**
 * Adds one piece to a member's upload. `offset` must be where the last piece ended (0 starts
 * over), so a piece sent twice or out of order is refused rather than written. Returns how
 * much has arrived.
 */
export async function appendChunk(dir: string, userId: number, session: string, offset: number, total: number, chunk: Buffer): Promise<number> {
    if (!isCount(offset) || !isCount(total) || total < UPLOAD_MAGIC.length + 8) throw new UploadError("offset and total must be whole numbers");
    if (total > UPLOAD_MAX_BYTES) throw new UploadError(`A mod folder can be at most ${UPLOAD_MAX_BYTES / 1024 / 1024} MB`);
    if (!chunk.length || chunk.length > CHUNK_MAX_BYTES) throw new UploadError("That piece is empty or too large");
    if (offset + chunk.length > total) throw new UploadError("That piece runs past the end of the upload");
    const file = partFile(dir, userId, session);
    if (offset === 0) {
        await fs.mkdir(uploadsDir(dir), { recursive: true });
        await sweep(dir);
        await fs.writeFile(file, chunk);
        return chunk.length;
    }
    const size = await fs.stat(file).then((s) => s.size, () => -1);
    if (size !== offset) throw new UploadError("The upload lost its place. Start it again.");
    await fs.appendFile(file, chunk);
    return offset + chunk.length;
}

/** Throws away a member's unfinished upload. */
export async function discardUpload(dir: string, userId: number, session: string): Promise<void> {
    await fs.rm(partFile(dir, userId, session), { force: true });
}

/**
 * Checks a finished upload and makes it the mod's folder, replacing the one that was there.
 * The new folder is built beside the bundle's folders and renamed into place.
 */
export async function installUpload(dir: string, userId: number, session: string, id: string): Promise<UploadedMod> {
    const file = partFile(dir, userId, session);
    try {
        const upload = await inspectUpload(file, id);
        const tag = randomBytes(6).toString("hex");
        const fresh = path.join(uploadsDir(dir), `${tag}.new`);
        const old = path.join(uploadsDir(dir), `${tag}.old`);
        await fs.mkdir(fresh);
        try {
            await fs.writeFile(path.join(fresh, "items.json"), upload.itemsJson);
            if (upload.packBytes) await pipeline(createReadStream(file, { start: upload.packStart }), createWriteStream(path.join(fresh, PACK_NAME)));
            else await fs.writeFile(path.join(fresh, PACK_NAME), Buffer.alloc(0));
            // mod.json last: a folder counts as a mod only once it has one
            await fs.writeFile(path.join(fresh, "mod.json"), upload.modJson);
            const target = path.join(dir, id);
            const existed = await fs.rename(target, old).then(() => true, () => false);
            try {
                await fs.rename(fresh, target);
            } catch (error) {
                if (existed) await fs.rename(old, target).catch(() => {});
                throw error;
            }
            if (existed) await fs.rm(old, { recursive: true, force: true });
        } finally {
            await fs.rm(fresh, { recursive: true, force: true });
        }
        return upload;
    } finally {
        await fs.rm(file, { force: true });
    }
}
