/**
 * Galaxy map sample seed: idempotent.
 *
 * Loads seed-data/galaxy.json (the sample places the map prototype was built with:
 * a few systems, the old wiki map's landmarks) through the same service the API
 * uses, so the file is held to the API's rules. Does nothing if the map already
 * has places. Positions taken from the old wiki map are approximate. The real map
 * will be seeded from the wiki's planet data near launch.
 * Run with: npm run seed:galaxy (after the archive seed: tags name episodes)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../../src/db.js";
import galaxyService from "../../src/galaxy/galaxy.service.js";

interface Tag {
    season: string;
    no: number;
}
interface SeedBody {
    name: string | null;
    travelogue?: Tag[];
    children?: SeedBody[];
}
interface SeedPlace {
    owner: string;
    name: string | null;
    travelogue?: Tag[];
    bodies?: SeedBody[];
}

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "seed-data", "galaxy.json");

async function main() {
    if (await prisma.mapPlace.count()) {
        console.log("The map already has places; nothing seeded.");
        return;
    }
    const places: SeedPlace[] = JSON.parse(readFileSync(file, "utf8"));
    const fallback = await prisma.user.findFirst({ where: { role: "ADMIN", loginDisabled: false }, orderBy: { id: "asc" } });
    let tagged = 0;
    for (const { owner, ...fields } of places) {
        const user = (await prisma.user.findUnique({ where: { username: owner } })) ?? fallback;
        if (!user) throw new Error(`No user '${owner}' and no admin to own '${fields.name}'`);
        const place = await galaxyService.createPlace(fields, user.id);

        const tag = async (tags: Tag[] | undefined, bodyName?: string | null) => {
            for (const { season, no } of tags ?? []) {
                const episode = await prisma.episode.findUnique({ where: { seasonTitle_episode_no: { seasonTitle: season, episode_no: no } }, select: { slug: true } });
                if (!episode) {
                    console.warn(`  no episode ${season} #${no}; tag on '${bodyName ?? fields.name}' skipped`);
                    continue;
                }
                const bodyId = bodyName === undefined ? undefined : place.bodies.find((body) => body.name === bodyName)!.id;
                await galaxyService.createTravelogueTag(place.id, { episode: episode.slug, bodyId }, user.id);
                tagged++;
            }
        };
        await tag(fields.travelogue);
        const walk = async (bodies: SeedBody[] | undefined) => {
            for (const body of bodies ?? []) {
                await tag(body.travelogue, body.name);
                await walk(body.children);
            }
        };
        await walk(fields.bodies);
    }
    console.log(`Seeded ${places.length} map places and ${tagged} travelogue tags.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
