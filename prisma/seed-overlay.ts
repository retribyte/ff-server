/**
 * Character / user overlay seed — idempotent.
 *
 * The committed home for presentation data that has no other source: colors,
 * avatars, blurbs and species for characters (seed-data/characters.json, keyed
 * by slug) and color / icon / bio for users (seed-data/users.json, keyed by
 * username). Runs last in the seed chain, so it wins over every earlier source.
 *
 * Only the fields listed for an entry are written. A slug or username that
 * isn't in the DB is reported and skipped (an import hasn't created it yet).
 *
 * Edit these files by hand, or refresh them from the running dev DB with
 * `npm run export:overlay` after changing records in the site's editor.
 * Run with: npm run seed:overlay
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "seed-data");

function load<T>(file: string): Record<string, T> {
    const path = join(DATA_DIR, file);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, T>) : {};
}

interface CharacterOverlay {
    color?: string;
    image?: string;
    blurb?: string;
    species?: string; // species slug
}

interface UserOverlay {
    color?: string;
    icon?: string;
    bio?: string;
}

async function main() {
    const speciesIds = new Map((await prisma.species.findMany({ select: { id: true, slug: true } })).map((s) => [s.slug, s.id]));

    let applied = 0;
    const missing: string[] = [];
    for (const [slug, entry] of Object.entries(load<CharacterOverlay>("characters.json"))) {
        const { species, color, image, blurb } = entry;
        const speciesId = species === undefined ? undefined : speciesIds.get(species);
        if (species !== undefined && speciesId === undefined) {
            console.log(`Character '${slug}': species '${species}' not found — leaving species alone.`);
        }
        const { count } = await prisma.character.updateMany({ where: { slug }, data: { color, image, blurb, speciesId } });
        if (count) applied++;
        else missing.push(slug);
    }
    console.log(`Overlay: ${applied} character(s) updated${missing.length ? `, ${missing.length} not in DB: ${missing.join(", ")}` : ""}.`);

    let usersApplied = 0;
    const missingUsers: string[] = [];
    for (const [username, entry] of Object.entries(load<UserOverlay>("users.json"))) {
        const { count } = await prisma.user.updateMany({ where: { username }, data: entry });
        if (count) usersApplied++;
        else missingUsers.push(username);
    }
    console.log(`Overlay: ${usersApplied} user(s) updated${missingUsers.length ? `, not in DB: ${missingUsers.join(", ")}` : ""}.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
