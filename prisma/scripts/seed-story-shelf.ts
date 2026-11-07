/**
 * Files the `vm` story under a story-only SIDE season "VM" and sets
 * canon = false on the NON_CANON stories. Idempotent.
 *
 * Run with: npm run seed:story-shelf
 */
import { SeasonKind } from "@prisma/client";
import { prisma } from "../../src/db.js";


const VM_SEASON = { title: "VM", slug: "vm", kind: SeasonKind.SIDE };
const VM_STORY = "vm";

// Non-canon stories, by slug
const NON_CANON = [
    "the_interviews",
    "zombification",
    "a_bad_day_for_everyone",
    "do_emmetts_dream_of_llamanian_sheep",
    "obama_story",
];

async function fileVm() {
    const season = await prisma.season.upsert({
        where: { title: VM_SEASON.title },
        update: { kind: VM_SEASON.kind },
        create: VM_SEASON,
    });
    console.log(`season ${season.title} (/${season.slug}, ${season.kind}) is in place`);

    const story = await prisma.story.findUnique({ where: { slug: VM_STORY }, select: { id: true, seasonTitle: true } });
    if (!story) {
        console.log(`no '${VM_STORY}' story in this database; nothing to file`);
    } else if (story.seasonTitle === season.title) {
        console.log(`story '${VM_STORY}' is already in ${season.title}`);
    } else {
        await prisma.story.update({ where: { id: story.id }, data: { seasonTitle: season.title } });
        console.log(`story '${VM_STORY}' moved from ${story.seasonTitle ?? "no campaign"} to ${season.title}`);
    }
}

async function markNonCanon() {
    const found = await prisma.story.findMany({ where: { slug: { in: NON_CANON } }, select: { slug: true, canon: true } });
    for (const slug of NON_CANON) {
        const story = found.find((s) => s.slug === slug);
        if (!story) console.log(`no '${slug}' story in this database; skipped`);
        else if (!story.canon) console.log(`story '${slug}' is already non-canon`);
        else {
            await prisma.story.update({ where: { slug }, data: { canon: false } });
            console.log(`story '${slug}' marked non-canon`);
        }
    }
}

async function main() {
    await fileVm();
    await markNonCanon();
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
