/**
 * Export the dev DB's character / user presentation data into the committed
 * overlay files that seed-overlay.ts applies (prisma/seed-data/*.json).
 *
 * Run after editing records in the site (avatar, color, blurb, species, user
 * icon / color / bio), then commit the diff so every clone gets the same data:
 *     npm run export:overlay
 *
 * The files are rewritten from the DB: every character with a color, image or
 * blurb (or a non-default species) and every user with a color, icon or bio.
 * Sorted and stably formatted, so `git diff` shows only real changes. Values
 * already produced by other seed sources are included too; that's harmless,
 * since the overlay just re-applies them.
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "seed-data");
const DEFAULT_SPECIES = "unclassified"; // seed-legacy.ts' placeholder taxon

type Entry = Record<string, string>;

function write(file: string, data: Record<string, Entry>) {
    mkdirSync(DATA_DIR, { recursive: true });
    const path = join(DATA_DIR, file);
    const before = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, Entry>) : {};
    const sorted = Object.fromEntries(Object.keys(data).sort().map((k) => [k, data[k]]));
    writeFileSync(path, JSON.stringify(sorted, null, 4) + "\n");
    const keys = new Set([...Object.keys(before), ...Object.keys(sorted)]);
    let added = 0, changed = 0, removed = 0;
    for (const k of keys) {
        if (!(k in before)) added++;
        else if (!(k in sorted)) removed++;
        else if (JSON.stringify(before[k]) !== JSON.stringify(sorted[k])) changed++;
    }
    console.log(`${file}: ${Object.keys(sorted).length} entries (${added} added, ${changed} changed, ${removed} removed)`);
}

async function main() {
    const characters: Record<string, Entry> = {};
    for (const c of await prisma.character.findMany({ include: { species: { select: { slug: true } } } })) {
        const entry: Entry = {};
        if (c.color) entry.color = c.color;
        if (c.image) entry.image = c.image;
        if (c.blurb) entry.blurb = c.blurb;
        if (c.species.slug !== DEFAULT_SPECIES) entry.species = c.species.slug;
        if (Object.keys(entry).length) characters[c.slug] = entry;
    }
    write("characters.json", characters);

    const users: Record<string, Entry> = {};
    for (const u of await prisma.user.findMany()) {
        const entry: Entry = {};
        if (u.color) entry.color = u.color;
        if (u.icon) entry.icon = u.icon;
        if (u.bio) entry.bio = u.bio;
        if (Object.keys(entry).length) users[u.username] = entry;
    }
    write("users.json", users);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
