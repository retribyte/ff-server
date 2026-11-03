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
import { PrismaClient } from "@prisma/client";
import { storyContentHash } from "../../src/story/story-hash.js";

const prisma = new PrismaClient();

async function main() {
    const stories = await prisma.story.findMany({
        orderBy: { id: "asc" },
        select: {
            id: true,
            slug: true,
            contentHash: true,
            chapters: {
                orderBy: { chapter_no: "asc" },
                select: { lines: { orderBy: { line_no: "asc" }, select: { type: true, text: true } } },
            },
        },
    });

    const owner = new Map<string, string>(); // hash -> slug that holds it
    let updated = 0;
    let unchanged = 0;
    for (const story of stories) {
        const hash = storyContentHash(story.chapters);
        const holder = owner.get(hash);
        if (holder) {
            console.warn(`! ${story.slug}: text identical to ${holder} — left without a hash`);
            if (story.contentHash !== null) {
                await prisma.story.update({ where: { id: story.id }, data: { contentHash: null } });
            }
            continue;
        }
        owner.set(hash, story.slug);
        if (story.contentHash === hash) {
            unchanged++;
            continue;
        }
        // Clear any other row still holding this hash from an earlier run
        // (its text has since changed) so the unique index doesn't trip
        await prisma.story.updateMany({ where: { contentHash: hash, id: { not: story.id } }, data: { contentHash: null } });
        await prisma.story.update({ where: { id: story.id }, data: { contentHash: hash } });
        updated++;
    }
    console.log(`Story hashes: ${updated} set, ${unchanged} already current, ${stories.length} stories.`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
