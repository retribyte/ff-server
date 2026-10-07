/**
 * Sanya Dreadflower (FF2) persona seed — idempotent.
 *
 * Brody introduces Sanya in "Ups and Downs" as an unnamed floran bounty
 * hunter who stalks and kills Ibraxas, his previous character. The
 * transcript tags her as `Mysterious Figure` while she's still in the
 * shadows, then `Floran Assassin`, until she names herself ("My name isss
 * SSSanya.") and is tagged `Sanya` from then on. The legacy import turns
 * each of those tags into its own Character row, so her first appearance
 * is split off from Sanya across two standalone characters that never
 * appear anywhere else.
 *
 * Folds both back into Sanya, keeping the pre-reveal name as a persona so
 * the transcript still reads as it did before the reveal — the same
 * approach seed-buzzcut-persona.ts takes for "Bee Emmett".
 *
 * Run with: npm run seed:sanya-persona
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EPISODE_TITLE = "Ups and Downs";

// Pre-reveal Character slug -> persona name it becomes on Sanya.
const PRE_REVEAL = [
    { slug: "mysterious_figure", persona: "Mysterious Figure", personaSlug: "sanya_mysterious_figure" },
    { slug: "floran_assassin", persona: "Floran Assassin", personaSlug: "sanya_floran_assassin" },
] as const;

async function main() {
    const sanya = await prisma.character.findUnique({ where: { slug: "sanya_dreadflower" } });
    if (!sanya) {
        console.log("Character 'sanya_dreadflower' not found (FF2 not loaded) — skipping.");
        return;
    }

    for (const { slug, persona, personaSlug } of PRE_REVEAL) {
        const p = await prisma.persona.upsert({
            where: { characterId_name: { characterId: sanya.id, name: persona } },
            update: { slug: personaSlug, label: "before naming herself" },
            create: { characterId: sanya.id, name: persona, slug: personaSlug, label: "before naming herself" },
        });

        const stray = await prisma.character.findUnique({ where: { slug } });
        if (!stray) continue;
        const { count } = await prisma.message.updateMany({
            where: { characterId: stray.id, episodeTitle: EPISODE_TITLE },
            data: { characterId: sanya.id, personaId: p.id },
        });
        if (count) console.log(`Reclaimed ${count} message(s) from '${stray.name}' onto Sanya as "${persona}".`);

        // The stray row only ever existed for this episode; drop it once nothing references it.
        const remaining =
            (await prisma.message.count({ where: { characterId: stray.id } })) +
            (await prisma.storyLine.count({ where: { characterId: stray.id } }));
        if (remaining === 0) {
            await prisma.character.delete({ where: { id: stray.id } });
            console.log(`Removed now-empty character '${stray.name}'.`);
        }
    }
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
