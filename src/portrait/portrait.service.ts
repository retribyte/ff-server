import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { assembleBundle, bundleDir, ensureBundleDir, folderNames, packPath, removeModFolder, type AssembledBundle } from "./portrait.bundle.js";
import { appendChunk, discardUpload, installUpload, type UploadedMod } from "./portrait.upload.js";
import type { CurationPatch, ModPatch, RaceInput, SettingsInput } from "./portrait.validation.js";

// Portrait creator settings (tables portrait_mods, portrait_races, portrait_settings) and
// access to the sprite bundle on disk. See portrait.bundle.ts for the files.

const text = (v: Prisma.JsonValue | undefined, fallback: string) => (typeof v === "string" ? v : fallback);
const list = (v: Prisma.JsonValue | undefined) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const object = <T>(v: Prisma.JsonValue | undefined): T | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : undefined);

// Mods switched off. Read often (every sprite request), so kept for a few seconds; writes
// through this module clear it at once, and psql or the CLI import show up within the TTL.
const DISABLED_TTL_MS = 5000;
let disabledCache: { at: number; ids: Set<string> } | null = null;

function invalidate(): void {
    disabledCache = null;
}

async function disabledMods(): Promise<Set<string>> {
    if (disabledCache && Date.now() - disabledCache.at < DISABLED_TTL_MS) return disabledCache.ids;
    const rows = await prisma.portraitMod.findMany({ where: { enabled: false }, select: { id: true } });
    disabledCache = { at: Date.now(), ids: new Set(rows.map((r) => r.id)) };
    return disabledCache.ids;
}

/** A race row as the site's RaceDef: empty and null fields left out. */
function raceDef(row: Prisma.PortraitRaceGetPayload<object>): RaceInput {
    return {
        id: row.id,
        ...(row.species ? { species: row.species } : {}),
        ...(row.name ? { name: row.name } : {}),
        ...(row.descriptor ? { descriptor: row.descriptor } : {}),
        ...(row.category ? { category: row.category } : {}),
        ...(row.exclude.length ? { exclude: row.exclude } : {}),
        ...(row.prefer.length ? { prefer: row.prefer } : {}),
        ...(row.hidden ? { hidden: true } : {}),
        ...(row.lock ? { lock: row.lock as RaceInput["lock"] } : {}),
    };
}

/** Everything the creator page needs besides the sprites. */
async function getSettings() {
    const [races, settings, rows] = await Promise.all([
        prisma.portraitRace.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] }),
        prisma.portraitSetting.findMany(),
        prisma.portraitMod.findMany(),
    ]);
    const value = new Map(settings.map((s) => [s.key, s.value]));
    const dir = bundleDir();
    const onDisk = dir ? await folderNames(dir) : new Map<string, string>();
    const known = new Map(rows.map((r) => [r.id, r]));
    const mods = [...new Set([...onDisk.keys(), ...known.keys()])].map((id) => ({
        id,
        // The folder's own name when it is there; the row's is what a missing mod is remembered by
        name: onDisk.get(id) ?? known.get(id)?.name ?? id,
        enabled: known.get(id)?.enabled ?? true,
        present: onDisk.has(id),
        itemsOnlyFor: known.get(id)?.itemsOnlyFor ?? [],
        uploadedBy: known.get(id)?.uploadedBy ?? null,
        uploadedAt: known.get(id)?.uploadedAt ?? null,
    }));
    mods.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const itemsOnlyFor: Record<string, string[]> = {};
    for (const row of rows) if (row.itemsOnlyFor.length) itemsOnlyFor[row.id] = row.itemsOnlyFor;
    return {
        categories: list(value.get("categories")),
        races: races.map(raceDef),
        curation: {
            hideItemPattern: text(value.get("hideItemPattern"), ""),
            hideItems: list(value.get("hideItems")),
            itemsOnlyFor,
            erase: object<Record<string, number[][]>>(value.get("erase")) ?? {},
        },
        mods,
    };
}

async function writeRaces(tx: Prisma.TransactionClient, races: RaceInput[]): Promise<void> {
    await tx.portraitRace.deleteMany();
    await tx.portraitRace.createMany({
        data: races.map((r, position) => ({
            id: r.id,
            species: r.species ?? null,
            name: r.name ?? null,
            descriptor: r.descriptor ?? null,
            category: r.category ?? null,
            exclude: r.exclude ?? [],
            prefer: r.prefer ?? [],
            hidden: r.hidden ?? false,
            lock: r.lock ?? Prisma.DbNull,
            position,
        })),
    });
}

async function writeCuration(tx: Prisma.TransactionClient, patch: CurationPatch): Promise<void> {
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        await tx.portraitSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
}

/** Replaces the race list; the order given is the order shown. */
async function replaceRaces(races: RaceInput[]): Promise<void> {
    await prisma.$transaction((tx) => writeRaces(tx, races));
}

/** Changes the settings given (categories, hideItemPattern, hideItems, erase) and leaves the rest. */
async function updateCuration(patch: CurationPatch): Promise<void> {
    await prisma.$transaction((tx) => writeCuration(tx, patch));
}

/**
 * Switches a mod on or off, renames it or limits who wears its clothing. The mod must be a
 * folder in the bundle or already have a row: false otherwise.
 */
async function updateMod(id: string, patch: ModPatch): Promise<boolean> {
    const dir = bundleDir();
    const onDisk = dir ? await folderNames(dir) : new Map<string, string>();
    const row = await prisma.portraitMod.findUnique({ where: { id } });
    if (!row && !onDisk.has(id)) return false;
    await prisma.portraitMod.upsert({
        where: { id },
        create: { id, name: patch.name ?? onDisk.get(id) ?? id, enabled: patch.enabled ?? true, itemsOnlyFor: patch.itemsOnlyFor ?? [] },
        update: patch,
    });
    invalidate();
    return true;
}

/**
 * Removes a mod for good: its folder in the bundle (sprites and all) and its row. Returns
 * what was there to remove; both false means there was no such mod.
 */
async function deleteMod(id: string): Promise<{ folder: boolean; row: boolean }> {
    const dir = bundleDir();
    const folder = dir ? await removeModFolder(dir, id) : false;
    const row = (await prisma.portraitMod.deleteMany({ where: { id } })).count > 0;
    invalidate();
    return { folder, row };
}

/**
 * Replaces the race list, categories and curation in one transaction (the contents of
 * ff-site's races.json and curation.json). `skipMods` switches those mods off and every
 * other mod's row on; leaving it out keeps every on/off switch as it is. `itemsOnlyFor`
 * is always taken as given.
 */
async function replaceSettings(input: SettingsInput): Promise<void> {
    const { curation } = input;
    const dir = bundleDir();
    const names = dir ? await folderNames(dir) : new Map<string, string>();
    await prisma.$transaction(async (tx) => {
        await writeRaces(tx, input.races);
        await writeCuration(tx, { categories: input.categories, hideItemPattern: curation.hideItemPattern, hideItems: curation.hideItems, erase: curation.erase });

        const skip = curation.skipMods;
        const existing = new Set((await tx.portraitMod.findMany({ select: { id: true } })).map((r) => r.id));
        await tx.portraitMod.updateMany({ data: { itemsOnlyFor: [] } });
        if (skip) await tx.portraitMod.updateMany({ data: { enabled: true } });
        for (const [id, name] of Object.entries(skip ?? {})) {
            if (existing.has(id)) await tx.portraitMod.update({ where: { id }, data: { enabled: false, name } });
            else await tx.portraitMod.create({ data: { id, name, enabled: false } });
            existing.add(id);
        }
        for (const [id, kinds] of Object.entries(curation.itemsOnlyFor)) {
            if (existing.has(id)) await tx.portraitMod.update({ where: { id }, data: { itemsOnlyFor: kinds } });
            else await tx.portraitMod.create({ data: { id, name: names.get(id) ?? id, itemsOnlyFor: kinds } });
            existing.add(id);
        }
    });
    invalidate();
}

/**
 * Takes one piece of a member's mod upload. When the last piece arrives the folder is
 * checked and installed, and the mod is live on the next request: null until then, and
 * null when no bundle directory is configured (`configured` false).
 */
async function receiveUpload(user: { id: number; username: string }, id: string, session: string, offset: number, total: number, chunk: Buffer): Promise<{ configured: boolean; received: number; installed: UploadedMod | null }> {
    const dir = await ensureBundleDir();
    if (!dir) return { configured: false, received: 0, installed: null };
    const received = await appendChunk(dir, user.id, session, offset, total, chunk);
    if (received < total) return { configured: true, received, installed: null };
    const installed = await installUpload(dir, user.id, session, id);
    // The switch an admin set stays as it is: an upload replaces files, it does not turn a mod back on
    await prisma.portraitMod.upsert({
        where: { id },
        create: { id, name: installed.name, uploadedBy: user.username, uploadedAt: new Date() },
        update: { name: installed.name, uploadedBy: user.username, uploadedAt: new Date() },
    });
    invalidate();
    return { configured: true, received, installed };
}

/** Drops a member's unfinished upload. */
async function cancelUpload(userId: number, session: string): Promise<void> {
    const dir = bundleDir();
    if (dir) await discardUpload(dir, userId, session);
}

/** mods.json and items.json of the present, enabled mods; null when no bundle directory is set up. */
async function getBundle(): Promise<AssembledBundle | null> {
    const dir = bundleDir();
    return dir ? assembleBundle(dir, await disabledMods()) : null;
}

/** The file path of a present, enabled mod's sprites.pack; null if there is none. */
async function getPackPath(mod: string): Promise<string | null> {
    const dir = bundleDir();
    return dir ? packPath(dir, mod, await disabledMods()) : null;
}

export default { getSettings, replaceSettings, replaceRaces, updateCuration, updateMod, deleteMod, receiveUpload, cancelUpload, getBundle, getPackPath, invalidate };
