/**
 * Full seed entrypoint. Wipes all data (reverse dependency order), then runs
 * each of the other seed scripts in turn — deletion lives only here, not in
 * the individual scripts, so they stay safe to reason about independently.
 * The first failing (or missing) script stops the seed with a non-zero exit:
 * every script builds on the ones before it, so carrying on would leave a
 * half-built database that looks complete. Only scripts in OPTIONAL_SCRIPTS
 * may be absent.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const SEED_SCRIPTS = [
    // DB guards first (idempotent), so every script below, the NPC
    // conversion included, runs under the rules prod has
    "create-triggers.ts",
    "seed-legacy.ts",
    "seed-sanya-persona.ts",
    "seed-vortox-character-data.ts",
    "seed-vortox-weapons.ts",
    "seed-character-colors.ts",
    "seed-npc-personas.ts",
    "seed-vm-appended.ts", // after the CSV renames: its slugs are final ones
    "seed-overlay.ts",
    "seed-8ball.ts",
    "seed-galaxy.ts",
    "backfill-story-hashes.ts",
    "create-search-indexes.ts",
];

// Listed ahead of time but not written yet (the space-builder galaxy data)
const OPTIONAL_SCRIPTS = new Set(["seed-galaxy.ts"]);

function runScript(script: string) {
    const scriptPath = path.join(__dirname, script);
    if (!existsSync(scriptPath)) {
        if (!OPTIONAL_SCRIPTS.has(script)) throw new Error(`seed script ${script} not found`);
        console.log(`\n=== Skipping ${script} (optional, not found) ===`);
        return;
    }
    console.log(`\n=== Running ${script} ===`);
    const result = spawnSync("npx", ["tsx", scriptPath], { stdio: "inherit" });
    if (result.status !== 0) {
        throw new Error(`${script} failed (exit ${result.status ?? result.signal}); seed stopped, the database is incomplete`);
    }
}

async function main() {
    await prisma.item.deleteMany();
    await prisma.commentary.deleteMany();
    await prisma.storyLine.deleteMany();
    await prisma.storyChapter.deleteMany();
    await prisma.story.deleteMany();
    await prisma.message.deleteMany();
    // NPC personas have no character, so the character delete below can't cascade to them
    await prisma.persona.deleteMany();
    await prisma.episode.deleteMany();
    await prisma.season.deleteMany();
    await prisma.character.deleteMany();
    await prisma.user.deleteMany();

    for (const script of SEED_SCRIPTS) runScript(script);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
