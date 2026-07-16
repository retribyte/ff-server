/**
 * One-off backfill: prepare the EXISTING populated database for the
 * slug/rename schema change so `prisma db push` can apply it without losing
 * data on columns that are kept.
 *
 * The live DB still has the OLD schema (a "themeColor" column on characters,
 * "aliases"/"relationships" tables, no "slug" columns anywhere). This script:
 *   1. backs up every column/table the new schema drops (raw SQL — the
 *      regenerated Prisma client no longer has types for them) to
 *      prisma/lore-backup-<ISO-date>.json
 *   2. renames characters."themeColor" -> characters."color" (a straight
 *      `db push` would instead drop themeColor and add an empty color column)
 *   3. adds + backfills a "slug" column on characters/species/seasons/
 *      episodes/items, then marks each NOT NULL
 *
 * Unique-index creation on slug is left to `prisma db push`.
 * Idempotent: safe to run more than once (each step checks whether it has
 * already been applied before doing anything).
 * Run with: npm run backfill:slugs
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { slugify } from "../src/utils/slug.js";

const prisma = new PrismaClient();

const PRISMA_DIR = dirname(fileURLToPath(import.meta.url));

// Slugs are globally unique per table; dedup collisions (distinct names that
// slugify to the same string) by appending _2, _3, ... to later occurrences.
function uniqueSlug(base: string, used: Set<string>): string {
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
        slug = `${base}_${n}`;
        n++;
    }
    used.add(slug);
    return slug;
}

function jsonReplacer(_key: string, value: unknown) {
    return typeof value === "bigint" ? value.toString() : value;
}

// ---------- information_schema helpers ----------

async function columnExists(table: string, column: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = ${table} AND column_name = ${column}
        ) AS exists
    `;
    return rows[0].exists;
}

async function tableExists(table: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables WHERE table_name = ${table}
        ) AS exists
    `;
    return rows[0].exists;
}

async function isColumnNotNull(table: string, column: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ is_nullable: string }[]>`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}
    `;
    return rows[0]?.is_nullable === "NO";
}

// ---------- 1. Backup ----------

async function backupDoomedData(): Promise<void> {
    const hasOldColumns = await columnExists("characters", "themeColor");
    if (!hasOldColumns) {
        console.log("Step 1/3: characters.themeColor not found — backup already ran (or nothing to back up). Skipping.");
        return;
    }

    const characters = await prisma.$queryRaw`
        SELECT id, name, dob, pob, "homePlanet", sex::text AS sex, height, weight,
               "hairColor", "eyeColor", "wikiArticle"
        FROM characters ORDER BY id
    `;
    const aliases = (await tableExists("aliases"))
        ? await prisma.$queryRaw`SELECT * FROM aliases ORDER BY id`
        : [];
    const relationships = (await tableExists("relationships"))
        ? await prisma.$queryRaw`SELECT * FROM relationships ORDER BY id`
        : [];
    const species = await prisma.$queryRaw`
        SELECT id, name, "binomialName", lifespan, diet, habitat, "placeOfOrigin", "wikiArticle"
        FROM species ORDER BY id
    `;
    const items = await prisma.$queryRaw`
        SELECT id, name, "characterId", "wikiArticle" FROM items ORDER BY id
    `;

    const isoDate = new Date().toISOString().slice(0, 10);
    const backupPath = join(PRISMA_DIR, `lore-backup-${isoDate}.json`);
    writeFileSync(
        backupPath,
        JSON.stringify({ characters, aliases, relationships, species, items }, jsonReplacer, 2),
    );

    console.log(`Step 1/3: backed up doomed data to ${backupPath}`);
    console.log(
        `  characters: ${(characters as unknown[]).length}, aliases: ${(aliases as unknown[]).length}, ` +
        `relationships: ${(relationships as unknown[]).length}, species: ${(species as unknown[]).length}, ` +
        `items: ${(items as unknown[]).length}`,
    );
}

// ---------- 2. Rename themeColor -> color ----------

async function renameThemeColorToColor(): Promise<void> {
    const hasThemeColor = await columnExists("characters", "themeColor");
    if (!hasThemeColor) {
        console.log("Step 2/3: characters.themeColor already renamed (or absent). Skipping.");
        return;
    }
    if (await columnExists("characters", "color")) {
        console.warn("Step 2/3: both characters.themeColor and characters.color exist — refusing to rename, check manually.");
        return;
    }
    await prisma.$executeRawUnsafe(`ALTER TABLE characters RENAME COLUMN "themeColor" TO "color";`);
    console.log("Step 2/3: renamed characters.themeColor -> characters.color.");
}

// ---------- 3. Add + backfill slug columns ----------

async function ensureSlugColumn(table: string): Promise<void> {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS slug text;`);
}

async function loadUsedSlugs(table: string): Promise<Set<string>> {
    const rows = await prisma.$queryRawUnsafe<{ slug: string }[]>(
        `SELECT slug FROM ${table} WHERE slug IS NOT NULL`,
    );
    return new Set(rows.map((r) => r.slug));
}

async function setSlugNotNull(table: string): Promise<void> {
    if (await isColumnNotNull(table, "slug")) {
        console.log(`  ${table}.slug already NOT NULL.`);
        return;
    }
    const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM ${table} WHERE slug IS NULL`,
    );
    if (count > 0n) {
        throw new Error(`Refusing to set ${table}.slug NOT NULL — ${count} row(s) still have a null slug.`);
    }
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ALTER COLUMN slug SET NOT NULL;`);
    console.log(`  ${table}.slug set NOT NULL.`);
}

// id/name-shaped tables: characters, species, items
async function backfillIdNameSlugs(table: string): Promise<number> {
    await ensureSlugColumn(table);
    const used = await loadUsedSlugs(table);
    const rows = await prisma.$queryRawUnsafe<{ id: number; name: string }[]>(
        `SELECT id, name FROM ${table} WHERE slug IS NULL ORDER BY id`,
    );
    for (const row of rows) {
        const slug = uniqueSlug(slugify(row.name), used);
        await prisma.$executeRawUnsafe(`UPDATE ${table} SET slug = $1 WHERE id = $2`, slug, row.id);
    }
    console.log(`  ${table}: backfilled ${rows.length} slug(s).`);
    await setSlugNotNull(table);
    return rows.length;
}

async function backfillSeasonSlugs(): Promise<number> {
    const table = "seasons";
    await ensureSlugColumn(table);
    const used = await loadUsedSlugs(table);
    const rows = await prisma.$queryRawUnsafe<{ title: string }[]>(
        `SELECT title FROM ${table} WHERE slug IS NULL ORDER BY title`,
    );
    for (const row of rows) {
        const slug = uniqueSlug(slugify(row.title), used);
        await prisma.$executeRawUnsafe(`UPDATE ${table} SET slug = $1 WHERE title = $2`, slug, row.title);
    }
    console.log(`  ${table}: backfilled ${rows.length} slug(s).`);
    await setSlugNotNull(table);
    return rows.length;
}

async function backfillEpisodeSlugs(): Promise<number> {
    const table = "episodes";
    await ensureSlugColumn(table);
    const used = await loadUsedSlugs(table);
    // "title" is unique on Episode (used as the UPDATE key below); episode_no
    // + seasonTitle is the real primary key but title alone is enough here.
    const rows = await prisma.$queryRawUnsafe<{ title: string; episode_no: number }[]>(
        `SELECT title, episode_no FROM ${table} ORDER BY "seasonTitle", episode_no`,
    );
    for (const row of rows) {
        const slug = uniqueSlug(`${slugify(row.title)}`, used);
        await prisma.$executeRawUnsafe(`UPDATE ${table} SET slug = $1 WHERE title = $2`, slug, row.title);
    }
    console.log(`  ${table}: backfilled ${rows.length} slug(s).`);
    await setSlugNotNull(table);
    return rows.length;
}

async function main() {
    await backupDoomedData();
    await renameThemeColorToColor();

    console.log("Step 3/3: adding + backfilling slug columns...");
    const counts = {
        characters: await backfillIdNameSlugs("characters"),
        species: await backfillIdNameSlugs("species"),
        seasons: await backfillSeasonSlugs(),
        episodes: await backfillEpisodeSlugs(),
        items: await backfillIdNameSlugs("items"),
    };

    console.log("\nBackfill complete.");
    console.log(`  Slugs backfilled — characters: ${counts.characters}, species: ${counts.species}, ` +
        `seasons: ${counts.seasons}, episodes: ${counts.episodes}, items: ${counts.items}`);
    console.log("\nNext step: run `npx prisma db push` to apply the rest of the schema change");
    console.log("(this will drop the removed columns/tables — the JSON backup written above is the safety net).");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
