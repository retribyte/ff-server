import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

// Reads the portrait creator's sprite bundle from PORTRAIT_BUNDLE_DIR: one folder per mod
// (mod.json, items.json, sprites.pack), written by ff-site's scripts/portrait-extract/extract.py.
// The folders on disk are the source of truth: adding or deleting one changes what is served
// on the next request, with no restart. Nothing here knows any mod's name.

const gzipAsync = promisify(gzip);

export const BUNDLE_VERSION = 2;
export const PACK_NAME = "sprites.pack";

export class BundleMissingError extends Error {}

/** The configured bundle directory, or null when unset or not a directory. */
export function bundleDir(): string | null {
    const dir = process.env.PORTRAIT_BUNDLE_DIR;
    return dir && existsSync(dir) ? path.resolve(dir) : null;
}

/** Names of the mod folders in a bundle directory (those holding a mod.json), sorted. */
export async function listModFolders(dir: string): Promise<string[]> {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const found: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
            if ((await fs.stat(path.join(dir, entry.name, "mod.json"))).isFile()) found.push(entry.name);
        } catch {
            // no mod.json: not a mod folder
        }
    }
    return found.sort();
}

/**
 * The path of a mod's pack, or null. `mod` is matched against the real folder listing and
 * is never joined into a path as given, so `..`, slashes and absolute paths cannot match.
 */
export async function packPath(dir: string, mod: string, disabled: ReadonlySet<string>): Promise<string | null> {
    if (disabled.has(mod)) return null;
    let names: string[];
    try {
        names = await fs.readdir(dir);
    } catch {
        return null;
    }
    const folder = names.find((name) => name === mod);
    if (folder === undefined) return null;
    const file = path.join(dir, folder, PACK_NAME);
    try {
        return (await fs.stat(file)).isFile() ? file : null;
    } catch {
        return null;
    }
}

/**
 * Deletes a mod's folder from the bundle. Like packPath, `mod` must be the name of an entry
 * in the directory listing, so nothing outside the bundle can be named. False if it is not there.
 */
export async function removeModFolder(dir: string, mod: string): Promise<boolean> {
    const folder = (await listModFolders(dir)).find((name) => name === mod);
    if (folder === undefined) return false;
    await fs.rm(path.join(dir, folder), { recursive: true });
    return true;
}

interface FolderInfo {
    id: string;
    /** mtime and size of mod.json and items.json, to notice a change. */
    stamp: string;
    order: number;
    name: string;
    mod: Buffer;
    items: Buffer;
}

const folderCache = new Map<string, FolderInfo>();

async function readFolder(dir: string, id: string): Promise<FolderInfo | null> {
    const modFile = path.join(dir, id, "mod.json");
    const itemsFile = path.join(dir, id, "items.json");
    let mod, items;
    try {
        [mod, items] = await Promise.all([fs.stat(modFile), fs.stat(itemsFile)]);
    } catch {
        return null;
    }
    const stamp = `${mod.mtimeMs}:${mod.size}:${items.mtimeMs}:${items.size}`;
    const key = `${dir}\n${id}`;
    const known = folderCache.get(key);
    if (known && known.stamp === stamp) return known;
    try {
        const [modBytes, itemBytes] = await Promise.all([fs.readFile(modFile), fs.readFile(itemsFile)]);
        const info = JSON.parse(modBytes.toString("utf8"));
        const order = typeof info.order === "number" ? info.order : Number.MAX_SAFE_INTEGER;
        const name = typeof info.name === "string" && info.name ? info.name : id;
        const read: FolderInfo = { id, stamp, order, name, mod: modBytes, items: itemBytes };
        folderCache.set(key, read);
        return read;
    } catch {
        return null; // unreadable or not JSON: left out rather than breaking the whole bundle
    }
}

/** Every mod folder's name (from its mod.json), by id; folders that cannot be read are absent. */
export async function folderNames(dir: string): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const id of await listModFolders(dir)) {
        const info = await readFolder(dir, id);
        if (info) names.set(id, info.name);
    }
    return names;
}

export interface Assembled {
    etag: string;
    body: Buffer;
    gzip: Buffer | null;
}

export interface AssembledBundle {
    mods: Assembled;
    items: Assembled;
}

const hash = (buffer: Buffer) => `"${createHash("sha1").update(buffer).digest("hex").slice(0, 20)}"`;

function join(head: string, parts: Buffer[]): Assembled {
    const comma = Buffer.from(",");
    const pieces: Buffer[] = [Buffer.from(head)];
    parts.forEach((part, i) => pieces.push(...(i ? [comma, part] : [part])));
    pieces.push(Buffer.from("]}"));
    const body = Buffer.concat(pieces);
    return { etag: hash(body), body, gzip: null };
}

const assembledCache = new Map<string, { signature: string; value: AssembledBundle }>();

/**
 * mods.json and items.json as the extractor writes them at the top level: every present,
 * enabled folder's file, in load order, in one `{"version":2,"mods":[...]}`. Cached until a
 * folder's files change, a folder appears or goes, or the set of disabled mods changes.
 */
export async function assembleBundle(dir: string, disabled: ReadonlySet<string>): Promise<AssembledBundle> {
    const infos: FolderInfo[] = [];
    const all = await listModFolders(dir);
    // Folders that are gone should not stay in memory
    for (const key of folderCache.keys()) if (key.startsWith(`${dir}\n`) && !all.includes(key.slice(dir.length + 1))) folderCache.delete(key);
    for (const id of all) {
        if (disabled.has(id)) continue;
        const info = await readFolder(dir, id);
        if (info) infos.push(info);
    }
    infos.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
    const signature = infos.map((info) => `${info.id}:${info.stamp}`).join("|");
    const cached = assembledCache.get(dir);
    if (cached && cached.signature === signature) return cached.value;
    const head = `{"version":${BUNDLE_VERSION},"mods":[`;
    const value = { mods: join(head, infos.map((i) => i.mod)), items: join(head, infos.map((i) => i.items)) };
    assembledCache.set(dir, { signature, value });
    return value;
}

/** The gzipped form of an assembled file, made once and kept with it. */
export async function gzipped(file: Assembled): Promise<Buffer> {
    file.gzip ??= await gzipAsync(file.body, { level: 6 });
    return file.gzip;
}

/** Whether an Accept-Encoding header allows gzip. */
export function acceptsGzip(header: string | undefined): boolean {
    if (!header) return false;
    return header.split(",").some((part) => {
        const [coding, ...params] = part.trim().toLowerCase().split(";");
        if (coding.trim() !== "gzip" && coding.trim() !== "*") return false;
        const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
        return !q || Number(q.slice(2)) > 0;
    });
}

/** Whether an If-None-Match header names this ETag. */
export function etagMatches(header: string | undefined, etag: string): boolean {
    if (!header) return false;
    return header.split(",").some((t) => {
        const tag = t.trim().replace(/^W\//, "");
        return tag === "*" || tag === etag;
    });
}
