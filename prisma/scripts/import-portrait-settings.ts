/**
 * Loads the portrait creator's settings from ff-site's two JSON files into the database,
 * replacing what is there (the same function PUT /api/admin/portrait/settings uses).
 *
 *   npm run portrait:import-settings [races.json curation.json]
 *
 * Defaults to src/data/portrait/races.json and curation.json in ff-site (FF_SITE_DIR, else
 * ../ff-site, else ../ff-site-new). curation.json's skipMods switch those mods off; every
 * other mod's switch is turned on. Re-runnable.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/db.js";
import portraitService from "../../src/portrait/portrait.service.js";
import { parseSettings } from "../../src/portrait/portrait.validation.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// Same lookup as seed-legacy.ts: the checkout is ff-site or ff-site-new
function resolveFfSiteDir(): string {
    if (process.env.FF_SITE_DIR) return process.env.FF_SITE_DIR;
    const primary = resolve(HERE, "../../../ff-site");
    return existsSync(primary) ? primary : resolve(HERE, "../../../ff-site-new");
}

async function main() {
    const data = resolve(resolveFfSiteDir(), "src/data/portrait");
    const [racesFile, curationFile] = [process.argv[2] ?? resolve(data, "races.json"), process.argv[3] ?? resolve(data, "curation.json")];
    const races = JSON.parse(readFileSync(racesFile, "utf8"));
    const curation = JSON.parse(readFileSync(curationFile, "utf8"));
    const input = parseSettings({ categories: races.categories, races: races.races, curation });
    await portraitService.replaceSettings(input);
    console.log(`Imported ${input.races.length} races, ${input.categories.length} categories, ${Object.keys(input.curation.skipMods ?? {}).length} skipped mods, ${input.curation.hideItems.length} hidden items from ${racesFile} and ${curationFile}.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
