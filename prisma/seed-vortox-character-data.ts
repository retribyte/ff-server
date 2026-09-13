/**
 * Character blurb + color backfill from the vortox-bot MongoDB backup —
 * idempotent.
 *
 * seed-legacy.ts never populates Character.blurb (its source data — message
 * blocks, characterColors.json, cyoa.json — has no blurb field at all), so
 * it's null for every legacy-seeded character, and only sets color from
 * characterColors.json, which is missing entries for some PCs entirely.
 * vortox-bot's `characters` collection (the Discord combat tracker's
 * `!character` records, see vortox-bot/backup/dump/vortox/characters.bson)
 * has `description` and `meta.color` fields that fill some of those gaps.
 *
 * Blurbs: `description` is mostly the bot's placeholder ("A character
 * without a curated description.") but for the main PCs holds real
 * hand-written flavor text. Pulls just the non-placeholder ones in.
 *
 * Colors: `meta.color` defaults to `#FFA500` (the bot's fallback) for
 * everyone who never customized it — not real data, excluded. Of the 5
 * characters with a genuinely custom color, only Vec and Dutch Elkins have
 * no color in the DB at all (characterColors.json has no entry for either).
 * The other 3 (Garrick, Emmett Tawfeek, Seth Im'Kin'ki) already have a
 * curated color from the legacy site and are deliberately left alone here:
 * Emmett's and Seth's vortox-bot colors turned out to be exact matches for
 * the site's own *light*-theme variant (not new information — the site's
 * dark-theme value is what's in play), and Garrick's is a third,
 * independent value with no clear reason to prefer it over the curated one.
 *
 * Name mapping notes:
 *   - Emmett/Seth/Chomsky/Sanya use the same short->full name identity as
 *     seed-legacy.ts's LEGACY_NAME_ALIASES (Emmett Tawfeek, Seth Im'Kin'ki,
 *     Victor Chomsky, Sanya Dreadflower) — same person, just vortox-bot never
 *     picked up the full-name convention.
 *   - "Iris" and "Mateo" (vortox-bot's short names) actually target
 *     "Iris Bellatoria" and "Mateo Krovak" — the bare "Iris"/"Mateo" rows in
 *     the DB were zero/near-zero-message orphans, the same
 *     characterColors.json short-name-vs-full-name split that
 *     LEGACY_NAME_ALIASES in seed-legacy.ts already fixes for Emmett/Seth/
 *     Chomsky/Sanya — now also fixed there for these two.
 *   - "Zion" targets "Zion Daybreaker" over "Virtual Zion" — best guess, not
 *     confirmed against transcripts.
 *   - vortox-bot's "Burner" ("A psychotic, talkative duck.") has no matching
 *     Character row at all (zero messages in the archive, so seed-legacy.ts
 *     never created one) — deliberately left out rather than creating a new
 *     orphan Character just to hold a blurb.
 *
 * Run with: npm run seed:vortox-character-data
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BLURBS_BY_SLUG: Record<string, string> = {
    garrick: "A kleptomanic poltergeist.",
    emmett_tawfeek: "The galaxy's scapesquoat.",
    dr_jorpa: "Emmett's nice doctor.",
    vec: "A fungus who really doesn't want to be among us.",
    zion_daybreaker: "A robotic angel with a chip on his shoulder.",
    victor_chomsky: "A pink-haired arsonist with righteous intentions.",
    iris_bellatoria: "The hybrid queen of the light elves.",
    wes: "A lizard racer with celebrity fame.",
    sascha: "The pragmatic tactician of the Ravens.",
    dutch_elkins: "A country bumpkin bouncing baby bandit.",
    mateo_krovak: "A steel shapeshifter.",
    olag: "A slimy suspicious mechanic.",
    sanya_dreadflower: "An edgy plant person with a demigod on her head.",
    jess: "An ottori stowaway.",
    ravens_leader: "The spiteful leader of the Ravens.",
    seth_imkinki: "A forever lustful, insane elf.",
    dakari: "A ninja hedgehog pokemon.",
    marv: "The street-smart dynamo of the Ravens.",
    odran: "The prim-and-proper mediator of the Ravens.",
};

// Only the two characters with no color anywhere in the legacy data — see
// the file-header comment for why Garrick/Emmett/Seth aren't here.
const COLORS_BY_SLUG: Record<string, string> = {
    vec: "#6A2087",
    dutch_elkins: "#1B006A",
};

async function backfillField(
    fieldsBySlug: Record<string, string>,
    field: "blurb" | "color",
): Promise<{ set: number; skippedExisting: number; missing: number }> {
    let set = 0;
    let skippedExisting = 0;
    let missing = 0;

    for (const [slug, value] of Object.entries(fieldsBySlug)) {
        const character = await prisma.character.findUnique({ where: { slug } });
        if (!character) {
            console.log(`No character with slug '${slug}' — skipping.`);
            missing++;
            continue;
        }
        const existing = character[field];
        if (existing && existing !== value) {
            console.log(`'${character.name}' already has a different ${field} — leaving it alone: "${existing}"`);
            skippedExisting++;
            continue;
        }
        await prisma.character.update({ where: { id: character.id }, data: { [field]: value } });
        set++;
    }

    return { set, skippedExisting, missing };
}

async function main() {
    const blurbResult = await backfillField(BLURBS_BY_SLUG, "blurb");
    console.log(
        `Blurbs: set ${blurbResult.set}, skipped ${blurbResult.skippedExisting} already-curated, ${blurbResult.missing} slug(s) not found.`,
    );

    const colorResult = await backfillField(COLORS_BY_SLUG, "color");
    console.log(
        `Colors: set ${colorResult.set}, skipped ${colorResult.skippedExisting} already-curated, ${colorResult.missing} slug(s) not found.`,
    );
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
