/**
 * Curated character colors — idempotent.
 *
 * Every color the dev DB had, pinned by slug (the legacy ones mirror
 * characterColors.json via seed-legacy.ts), plus FF4 PCs the legacy data has
 * no entry for, taken from the ink colors in the story manuscripts (see
 * ff-site's archive-to-markdown/story-docx-to-md.py). Unlike seed-vortox-character-data.ts this
 * overwrites whatever is there, so it runs after it and wins.
 *
 * To add a character, put `slug: "#rrggbb"` in COLORS_BY_SLUG.
 *
 * Run with: npm run seed:character-colors
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COLORS_BY_SLUG: Record<string, string> = {
    // Snapshot of the dev DB's colors, so they survive a reseed
    asier: "#A69C66",
    bail: "#FFF8B5",
    dakari: "#d1734b",
    emmett_tawfeek: "#62DE2C",
    ff_8_ball: "#ce78ff",
    garrick: "#5269FF",
    ibraxas: "#CC7D00",
    iris: "#20A0FF",
    jim: "#4B8BBE",
    kyl300: "#a66ade",
    mateo_krovak: "#50DDFF",
    matthias: "#50DDFF",
    rawley: "#CACA00",
    sanya_dreadflower: "#C82020",
    seth_imkinki: "#FF5050",
    vargas: "#FFFFFF",
    victor_chomsky: "#ff9900",
    wes: "#BB54FF",
    // "Still Waters" ink colors. These are the dark-mode colors (Character.color);
    // the doc ink for Dutch (#0000ff) and Bellow (#134f5c) is too dark on a dark
    // background, so they are lightened here and live as the light-mode values in
    // ff-site src/data/characterColors.json.
    zion_daybreaker: "#3aa5bd",
    morra: "#ff00ff",
    dutch_elkins: "#6666ff",
    bellow_brightlight: "#70a89d",
};

async function main() {
    let set = 0;
    for (const [slug, color] of Object.entries(COLORS_BY_SLUG)) {
        const { count } = await prisma.character.updateMany({ where: { slug }, data: { color } });
        if (count) set++;
        else console.log(`No character with slug '${slug}' — skipping.`);
    }
    console.log(`Colors: set ${set} of ${Object.keys(COLORS_BY_SLUG).length}.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
