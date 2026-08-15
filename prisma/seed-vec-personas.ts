/**
 * Vec (FF4) persona seed — idempotent.
 *
 * Vec is a parasite that rotates hosts and didn't settle on the name "Vec"
 * until partway through Wrong Answer. Its FF4 dialogue splits into eras:
 *
 *   - "Llafay Terres": the corpse it was already wearing when the mission
 *     began. Llafay never independently existed — every line credited to
 *     that name (all of Welcome, New Recruits; the first stretch of Fun Guy)
 *     is Vec, so this script also reclaims any messages still attributed to
 *     the standalone Llafay Terrels Character record onto Vec.
 *   - "Fungo": Vec's own chosen alias for its long hostless/anonymous-host
 *     stretches (the loose spore form, the KYL/Suchan corpse, the drug
 *     dealer, the reptile corpse, etc).
 *   - "Fursean" / "Marv": the two hosts whose own name it wore for a while
 *     before permanently adopting "Vec".
 *   - null (canonical "Vec"): from the "VEC." / "I LIKE VEC." lines in Wrong
 *     Answer onward — it has named itself by then, no persona needed.
 *
 * Boundaries are specific narration lines confirmed against the actual
 * transcript text (episodeTitle + messageNo, the Message model's own
 * natural key), not just the looser wiki host-table summary.
 * Run with: npm run seed:vec-personas
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PERSONAS = [
    { name: "Llafay Terres", slug: "vec_llafay_terres" },
    { name: "Fungo", slug: "vec_fungo" },
    { name: "Fursean", slug: "vec_fursean" },
    { name: "Marv", slug: "vec_marv" },
    { name: "Sascha", slug: "vec_sascha" },
] as const;

async function main() {
    const vec = await prisma.character.findUnique({ where: { slug: "vec" } });
    if (!vec) {
        console.log("Character 'vec' not found (FF4 not loaded) — skipping.");
        return;
    }

    const personaIds = new Map<string, number>();
    for (const p of PERSONAS) {
        const persona = await prisma.persona.upsert({
            where: { characterId_name: { characterId: vec.id, name: p.name } },
            update: { slug: p.slug },
            create: { characterId: vec.id, name: p.name, slug: p.slug },
        });
        personaIds.set(p.name, persona.id);
    }
    const llafay = personaIds.get("Llafay Terres")!;
    const fungo = personaIds.get("Fungo")!;
    const fursean = personaIds.get("Fursean")!;
    const marv = personaIds.get("Marv")!;
    const sascha = personaIds.get("Sascha")!;

    const llafayCharacter = await prisma.character.findUnique({ where: { slug: "llafay_terrels" } });
    if (llafayCharacter) {
        const { count } = await prisma.message.updateMany({
            where: {
                characterId: llafayCharacter.id,
                episodeTitle: { in: ["Welcome, New Recruits", "Fun Guy"] },
            },
            data: { characterId: vec.id },
        });
        if (count) console.log(`Reclaimed ${count} message(s) from Llafay Terrels onto Vec.`);
    }

    // Reset to canonical "Vec" first so reruns are self-correcting, then
    // layer the era-specific persona stamps on top.
    await prisma.message.updateMany({ where: { characterId: vec.id }, data: { personaId: null } });

    const stamp = (episodeTitle: string, personaId: number, messageNo?: { lt?: number; gte?: number }) =>
        prisma.message.updateMany({
            where: { characterId: vec.id, episodeTitle, ...(messageNo ? { messageNo } : {}) },
            data: { personaId },
        });

    await stamp("Welcome, New Recruits", llafay);
    await stamp("Fun Guy", llafay, { lt: 375 }); // "The window to the engine room fogs up..."
    await stamp("Fun Guy", fungo, { gte: 375 });
    await stamp("Ambush", fungo);
    await stamp("Blackjack", fungo);
    await stamp("Diplomacy", fungo, { lt: 454 });
    await stamp("Diplomacy", fursean, { gte: 454, lt: 834 }); // "Fursean falls apart by the second."
    await stamp("Diplomacy", fungo, { gte: 834 });
    await stamp("Obligatory Shopping Episode", fungo);
    await stamp("Marv Attacks!", fungo);
    await stamp("Don't Be A Shitty Dad", fungo, { lt: 224 });
    await stamp("Don't Be A Shitty Dad", marv, { gte: 224 }); // "Marv stands slowly, feeling his exposed ribs."
    await stamp("Are You Not Entertained?!", marv);
    await stamp("High Roll On D100", fungo, { lt: 968 });
    await stamp("High Roll On D100", sascha, { gte: 968 }); // "Sascha stands up slowly, feeling her neck..."
    await stamp("Wrong Answer", sascha, { lt: 1041 }); // "VEC." / "I LIKE VEC." at 1041-1042 onward stays canonical

    console.log("Vec persona stamps applied.");
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
