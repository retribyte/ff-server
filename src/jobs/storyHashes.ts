import { storyContentHash } from "../story/story-hash.js";
import type { JobContext } from "./runner.js";

/**
 * (Re)computes every story's contentHash (the duplicate-import fingerprint)
 * from its stored lines. A story whose text is identical to an earlier one is
 * left without a hash, since the column is unique. Idempotent.
 */
export async function storyHashes({ tx, log }: Pick<JobContext, "tx" | "log">): Promise<string> {
    const stories = await tx.story.findMany({
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
            log(`! ${story.slug}: text identical to ${holder}, left without a hash`);
            if (story.contentHash !== null) {
                await tx.story.update({ where: { id: story.id }, data: { contentHash: null } });
            }
            continue;
        }
        owner.set(hash, story.slug);
        if (story.contentHash === hash) {
            unchanged++;
            continue;
        }
        // Clear any other row still holding this hash (its text has since changed)
        await tx.story.updateMany({ where: { contentHash: hash, id: { not: story.id } }, data: { contentHash: null } });
        await tx.story.update({ where: { id: story.id }, data: { contentHash: hash } });
        log(`${story.slug}: hash set`);
        updated++;
    }
    return `${updated} set, ${unchanged} already current, ${stories.length} stories`;
}
