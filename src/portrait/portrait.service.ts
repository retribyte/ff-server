import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { assembleBundle, bundleDir, folderNames, packPath, type AssembledBundle } from "./portrait.bundle.js";
import type { RaceInput, SettingsInput } from "./portrait.validation.js";

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
        name: known.get(id)?.name ?? onDisk.get(id) ?? id,
        enabled: known.get(id)?.enabled ?? true,
        present: onDisk.has(id),
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
        await tx.portraitRace.deleteMany();
        await tx.portraitRace.createMany({
            data: input.races.map((r, position) => ({
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
        const settings: Record<string, Prisma.InputJsonValue> = {
            categories: input.categories,
            hideItemPattern: curation.hideItemPattern,
            hideItems: curation.hideItems,
            erase: curation.erase,
        };
        for (const [key, value] of Object.entries(settings)) {
            await tx.portraitSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
        }

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

export default { getSettings, replaceSettings, getBundle, getPackPath, invalidate };
