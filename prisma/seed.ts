/**
 * Full seed entrypoint. Wipes all data (reverse dependency order), then runs
 * each of the other seed scripts in turn — deletion lives only here, not in
 * the individual scripts, so they stay safe to reason about independently.
 * A failing script is logged and skipped rather than aborting the batch.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const SEED_SCRIPTS = ["seed-legacy.ts", "seed-8ball.ts", "seed-galaxy.ts"];

function runScript(script: string) {
    console.log(`\n=== Running ${script} ===`);
    const result = spawnSync("npx", ["tsx", path.join(__dirname, script)], { stdio: "inherit" });
    if (result.status !== 0) {
        console.error(`${script} failed (exit ${result.status}) — skipping.`);
    }
}

async function main() {
    await prisma.item.deleteMany();
    await prisma.commentary.deleteMany();
    await prisma.storyLine.deleteMany();
    await prisma.storyChapter.deleteMany();
    await prisma.story.deleteMany();
    await prisma.message.deleteMany();
    await prisma.episode.deleteMany();
    await prisma.season.deleteMany();
    await prisma.character.deleteMany();
    await prisma.species.deleteMany();
    await prisma.user.deleteMany();

    for (const script of SEED_SCRIPTS) runScript(script);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
