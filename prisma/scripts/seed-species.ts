/**
 * Species seed — idempotent.
 *
 * seed-legacy.ts files every character under the "Unclassified" placeholder.
 * This creates the real species for every character with an avatar, so
 * seed-overlay.ts (which runs after it) can assign them from the `species`
 * slug lists in seed-data/characters.json (hybrids list several) — the
 * overlay looks species up by slug and never creates one.
 *
 * Pulled once (2026-10) from the wiki's `characters` and `species` Buckets
 * (wiki.vortox.space), falling back to the FF2 character sheets (the
 * "Final Frontier Base" spreadsheet, wiki/sources/stories/FF2/, and the sheets
 * posted in ff-site/archive-to-markdown/md/ff2/ff2.md) for characters with no
 * wiki page. Names and slugs match the wiki's; class comes from the species
 * bucket. Species with no wiki page yet (Shade Walker, Argonian, Matrin,
 * Tiefling, Poyo) are filed as LOWER_SENTIENT, like every other playable
 * species on the wiki.
 *
 * Descriptions are left empty: the wiki has no description field, and the
 * site shows the wiki's species data next to each record anyway.
 *
 * To add a species, add it to SPECIES, then add its slug to the
 * character's `"species"` list in seed-data/characters.json.
 *
 * Run with: npm run seed:species
 */
import { Class, PrismaClient } from "@prisma/client";
import { slugify } from "../../src/utils/slug.js";

const prisma = new PrismaClient();

const SPECIES: { name: string; class: Class }[] = [
    { name: "Angelus", class: Class.LOWER_SENTIENT },
    { name: "Anole", class: Class.LOWER_SENTIENT },
    { name: "Argonian", class: Class.LOWER_SENTIENT }, // no wiki page
    { name: "Avian", class: Class.LOWER_SENTIENT },
    { name: "Demonus", class: Class.LOWER_SENTIENT },
    { name: "Elf", class: Class.LOWER_SENTIENT },
    { name: "Entomae", class: Class.LOWER_SENTIENT },
    { name: "Floran", class: Class.LOWER_SENTIENT },
    { name: "Hexgot", class: Class.LOWER_SENTIENT },
    { name: "Human", class: Class.LOWER_SENTIENT },
    { name: "Matrin", class: Class.LOWER_SENTIENT }, // no wiki page
    { name: "Novakid", class: Class.LOWER_SENTIENT },
    { name: "Poltergeist", class: Class.LOWER_SENTIENT },
    { name: "Poyo", class: Class.LOWER_SENTIENT }, // no wiki page
    { name: "Shade Walker", class: Class.LOWER_SENTIENT }, // no wiki page
    { name: "Squoatling", class: Class.LOWER_SENTIENT },
    { name: "Tiefling", class: Class.LOWER_SENTIENT }, // no wiki page
    { name: "Verinian", class: Class.LOWER_SENTIENT },
];

async function main() {
    const archivist = await prisma.user.findUnique({ where: { username: "Archivist" } });
    if (!archivist) throw new Error("No Archivist account — run seed-legacy.ts first.");

    let created = 0;
    for (const { name, class: speciesClass } of SPECIES) {
        const slug = slugify(name);
        const existing = await prisma.species.findUnique({ where: { slug } });
        if (existing) continue;
        await prisma.species.create({
            data: { name, slug, class: speciesClass, description: "", creatorId: archivist.id },
        });
        created++;
    }
    console.log(`Species: created ${created}, ${SPECIES.length - created} already present.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
