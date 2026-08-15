/**
 * Buzzcut (FF4) persona seed — idempotent.
 *
 * Zander's second FF4 PC, played alongside Vec. Spends all of "Goblinators"
 * without a settled name — narrated as "Bee Emmett" (a nod to the unrelated
 * FF2 "Take Two" character of the same name, per Zander's own in-fiction
 * line "I'm not the real Emmett, am I?" / "a clone of someone else"),
 * briefly tries on "X-ander" mid-scene, then settles permanently at raw
 * msg 1043 ("As Seth says, who the fuck cares. It's Buzzcut."). Two
 * separate Character rows exist for the pre-naming stretch ("BE", "X") —
 * both folded into Buzzcut here, the same way seed-vec-personas.ts reclaims
 * Llafay Terrels onto Vec.
 *
 * The character's own *spoken* lines (BE:/X:/Buzzcut: tags) were already
 * parsed correctly by discord-json-to-api.py. What it doesn't catch:
 * Zander's untagged third-person narration of what Bee Emmett/Buzzcut
 * *does* — those fall through to his registered cast default, Vec, since
 * there's no `Name:` marker to override. Unlike Hunt520's Jack Madison/
 * Terry (REVIEW-hunt520-terry-zach-jack.md), this can't be fixed with a
 * corpus-wide text-matching rule in discord-json-to-api.py — Zander plays
 * Vec *in the very same episodes*, so any heuristic broad enough to catch
 * "Buzzcut does X" risks also reattributing genuine Vec lines. Handled here
 * instead as an explicit, hand-confirmed (episodeTitle, messageNo) list —
 * see REVIEW-buzzcut-identity.md (in ff-site/archive-to-markdown) for how
 * each one was checked against the raw transcript, and the two similarly-
 * shaped lines deliberately left off this list because Buzzcut is the
 * grammatical *object*, not the actor: Goblinators #906 ("He gives Bee
 * Emmett the seat.") and Crashlanded #242 ("A box is flipped over Buzzcut,
 * who is in the dark.").
 *
 * Run with: npm run seed:buzzcut-persona
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const UNTAGGED_ACTION_LINES: Record<string, number[]> = {
    "Goblinators": [379, 388, 434, 615, 693, 786, 842, 978, 1019],
    "Sir, This Is A Chilzor's": [105, 254, 307, 347, 393, 460, 488, 494, 542, 563, 658, 680, 833, 845, 859, 884],
    "Crashlanded": [30, 134, 945],
    "Don't Weld Yourself": [15],
};

// The naming reveal itself — everything before this in Goblinators is the
// "hasn't picked a name yet" stretch and gets the Bee Emmett persona;
// this message and everything after stays canonical Buzzcut.
const NAMING_REVEAL_MESSAGE_NO = 1043;

async function main() {
    const buzzcut = await prisma.character.findUnique({ where: { slug: "buzzcut" } });
    if (!buzzcut) {
        console.log("Character 'buzzcut' not found (FF4 not loaded) — skipping.");
        return;
    }

    // Fold the pre-naming identity fragments (BE, X) into Buzzcut.
    for (const slug of ["be", "x"]) {
        const stray = await prisma.character.findUnique({ where: { slug } });
        if (!stray) continue;
        const { count } = await prisma.message.updateMany({
            where: { characterId: stray.id, episodeTitle: "Goblinators" },
            data: { characterId: buzzcut.id },
        });
        if (count) console.log(`Reclaimed ${count} message(s) from '${stray.name}' onto Buzzcut.`);
    }

    // The untagged narration lines, hand-confirmed against the raw export.
    for (const [episodeTitle, messageNos] of Object.entries(UNTAGGED_ACTION_LINES)) {
        const { count } = await prisma.message.updateMany({
            where: { episodeTitle, messageNo: { in: messageNos }, characterId: { not: buzzcut.id } },
            data: { characterId: buzzcut.id },
        });
        if (count) console.log(`Reattributed ${count} untagged action line(s) in "${episodeTitle}" onto Buzzcut.`);
    }

    // Reset to canonical "Buzzcut" first so reruns are self-correcting,
    // then stamp the pre-naming stretch as the "Bee Emmett" persona.
    await prisma.message.updateMany({ where: { characterId: buzzcut.id }, data: { personaId: null } });

    const beeEmmett = await prisma.persona.upsert({
        where: { characterId_name: { characterId: buzzcut.id, name: "Bee Emmett" } },
        update: { slug: "buzzcut_bee_emmett", label: "unnamed clone" },
        create: { characterId: buzzcut.id, name: "Bee Emmett", slug: "buzzcut_bee_emmett", label: "unnamed clone" },
    });

    const { count } = await prisma.message.updateMany({
        where: { characterId: buzzcut.id, episodeTitle: "Goblinators", messageNo: { lt: NAMING_REVEAL_MESSAGE_NO } },
        data: { personaId: beeEmmett.id },
    });
    console.log(`Stamped ${count} Goblinators message(s) as the "Bee Emmett" persona.`);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
