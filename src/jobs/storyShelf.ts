import { SeasonKind } from "@prisma/client";
import type { JobContext } from "./runner.js";

const VM_SEASON = { title: "VM", slug: "vm", kind: SeasonKind.SIDE };
const VM_STORY = "vm";

// Non-canon stories, by slug
export const NON_CANON = [
    "the_interviews",
    "zombification",
    "a_bad_day_for_everyone",
    "do_emmetts_dream_of_llamanian_sheep",
    "obama_story",
];

/** Files the `vm` story under a story-only SIDE season "VM" and marks the NON_CANON stories non-canon. Idempotent. */
export async function storyShelf({ tx, log }: Pick<JobContext, "tx" | "log">): Promise<string> {
    let changed = 0;
    const season = await tx.season.upsert({
        where: { title: VM_SEASON.title },
        update: { kind: VM_SEASON.kind },
        create: VM_SEASON,
    });
    log(`season ${season.title} (/${season.slug}, ${season.kind}) is in place`);

    const story = await tx.story.findUnique({ where: { slug: VM_STORY }, select: { id: true, seasonTitle: true } });
    if (!story) {
        log(`no '${VM_STORY}' story in this database; nothing to file`);
    } else if (story.seasonTitle === season.title) {
        log(`story '${VM_STORY}' is already in ${season.title}`);
    } else {
        await tx.story.update({ where: { id: story.id }, data: { seasonTitle: season.title } });
        log(`story '${VM_STORY}' moved from ${story.seasonTitle ?? "no campaign"} to ${season.title}`);
        changed++;
    }

    const found = await tx.story.findMany({ where: { slug: { in: NON_CANON } }, select: { slug: true, canon: true } });
    for (const slug of NON_CANON) {
        const s = found.find((f) => f.slug === slug);
        if (!s) log(`no '${slug}' story in this database; skipped`);
        else if (!s.canon) log(`story '${slug}' is already non-canon`);
        else {
            await tx.story.update({ where: { slug }, data: { canon: false } });
            log(`story '${slug}' marked non-canon`);
            changed++;
        }
    }
    return changed ? `${changed} change${changed === 1 ? "" : "s"}` : "already up to date";
}
