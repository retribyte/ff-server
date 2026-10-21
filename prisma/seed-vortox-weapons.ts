/**
 * Signature weapons from the vortox-bot MongoDB backup — idempotent.
 *
 * vortox-bot's `weapons` collection (vortox-bot/backup/dump/vortox/
 * weapons.bson, 34 docs) is the Discord combat tracker's `!weapon` registry:
 * damage dice, miss rate, damage type, usage count. Those stats are live
 * tabletop mechanics and stay out of scope here (see top-level CLAUDE.md),
 * and every description but one is the bot's placeholder ("A weapon without
 * a curated description."). What *is* lore is which named weapons exist and
 * who carries them, so this seeds those as WEAPON items with descriptions
 * written from how the archive transcripts use them, owned by the wielder's
 * player (so they can edit their own item).
 *
 * Deliberately left out:
 *   - Ravens_blade/gun/flamethrower/gas/missile, Raven_fist, Edmin_fist,
 *     Zion_fist, Dutch_claws: per-NPC/natural attack stat blocks, not items.
 *   - Arcane (Morra's magic) and Breakdancing: attacks, not objects.
 *   - Weapon, Gib: test entries from a second Discord guild.
 *   - Ghost_gun, Feargas, Dreadblade: zero mentions in the archive.
 *   - Crossbow, Flamethrower, Grenade, Rocket, Phaser: generic stat blocks
 *     shared by many wielders (Seth's named crossbow, Opportunity V2, isn't
 *     in the bot data at all).
 *
 * Run with: npm run seed:vortox-weapons
 */
import { PrismaClient, ItemType } from "@prisma/client";
import { sanitizeText } from "../src/utils/sanitize.js";
import { slugify } from "../src/utils/slug.js";

const prisma = new PrismaClient();

// creator is a username (the wielder's player, per the transcripts)
const WEAPONS: { name: string; creator: string; description: string }[] = [
    {
        name: "Pauline",
        creator: "Silas",
        description: "Dutch Elkins's beloved explosive gun. Anything she hits goes flying like a ping-pong ball.",
    },
    {
        name: "Oblivion",
        creator: "Hunt520",
        description: "Zacharias Smith's sword, carried on his back and polished religiously.",
    },
    {
        name: "Elegance",
        creator: "Jonas",
        description: "Bellow Brightlight's bladed weapon, gripped with his bottom two hands.",
    },
    {
        name: "Quadpistols",
        creator: "Jonas",
        description: "Bellow Brightlight's set of four laser pistols, one for each hand.",
    },
    {
        name: "Contessa",
        creator: "Maxwell",
        description: "Edmin Kalvanzas's explosive weapon of choice. PREFERRED WEAPONRY DETERMINED.",
    },
    {
        name: "Forearm Tonfas",
        creator: "Trey",
        description: "Zion Daybreaker's forearm-mounted tonfas.",
    },
    {
        name: "Maggopistol",
        creator: "Trey",
        description: "A biological pistol that hits absurdly hard and misses often.",
    },
    {
        name: "Llafay's Plasma Blaster",
        creator: "Trey",
        description: "Llafay's plasma blaster, taken up and overdriven by Zion Daybreaker in the FF4 finale.",
    },
    {
        name: "Deagle",
        creator: "Sean",
        description: "Seth Im'Kin'ki's .50 Desert Eagle. Collector's edition.",
    },
    {
        name: "Seth's Halberd",
        creator: "Sean",
        description: "The halberd Seth Im'Kin'ki has carried since FF1. It once cracked Odran's helmet.",
    },
    {
        name: "Dreadspear",
        creator: "Brody",
        description: "Morra's spear, which struck the Ravens Leader in the FF4 finale.",
    },
    {
        name: "Plasma Cannon",
        creator: "Trey",
        description: "KYL300's heavy plasma cannon, later recovered by Zion Daybreaker in the FF4 finale.",
    },
    {
        name: "Rusty Pistol",
        creator: "Trey",
        description: "Rustiest pistol in the west.",
    },
];

async function main() {
    let created = 0;
    let skipped = 0;

    for (const weapon of WEAPONS) {
        const slug = slugify(weapon.name);
        if (await prisma.item.findUnique({ where: { slug } })) {
            skipped++;
            continue;
        }
        const creator = await prisma.user.findUnique({ where: { username: weapon.creator } });
        if (!creator) {
            console.log(`No user '${weapon.creator}' for '${weapon.name}' — skipping.`);
            skipped++;
            continue;
        }
        await prisma.item.create({
            data: {
                name: weapon.name,
                itemType: ItemType.WEAPON,
                description: sanitizeText(weapon.description),
                creatorId: creator.id,
                slug,
            },
        });
        created++;
    }

    console.log(`Weapons: created ${created}, skipped ${skipped} (already present or no creator).`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
