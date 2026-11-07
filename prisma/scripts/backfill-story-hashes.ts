/**
 * Story content-hash backfill — idempotent, safe to re-run.
 *
 * `Story.contentHash` is the duplicate-import fingerprint that
 * POST /api/stories/import checks (see src/story/story-hash.ts). Stories that
 * predate it — or that seed-legacy.ts / migrate-vm-to-story.ts created
 * directly — have none, so a re-import of one of them under a new slug and
 * title wouldn't be caught. This (re)computes every story's hash from its
 * stored lines, the same way the import does.
 *
 * Two existing stories with identical text can't both hold the (unique)
 * hash: the second is reported and left null, so the run never aborts.
 *
 * Run with: npm run backfill:story-hashes
 */
import { prisma } from "../../src/db.js";
import { storyHashes } from "../../src/jobs/storyHashes.js";

prisma
    .$transaction((tx) => storyHashes({ tx, log: console.log }), { timeout: 60_000 })
    .then((summary) => console.log(`Story hashes: ${summary}.`))
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
