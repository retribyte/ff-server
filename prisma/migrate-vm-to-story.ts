/**
 * One-off migration: move Vortox Machina out of the season/episode/message
 * hierarchy and into the Story/StoryChapter/StoryLine models.
 *
 * The live dev DB carries user-authored content, so `npm run seed:legacy`
 * (which wipes everything) is not an option — this script surgically:
 *   1. deletes the old "Vortox Machina" season, its episode, messages, and
 *      any commentaries on them (accepted loss, per the migration decision)
 *   2. rebuilds the chronicle from the legacy cyoa.json as a Story with a
 *      single chapter, so line numbering matches the old ?line=N deep links
 *
 * Idempotent-ish: aborts if the "vm" story already exists.
 * Run with: npm run migrate:vm   (ff-site checkout expected at ../ff-site,
 * override with FF_SITE_DIR=/path/to/ff-site)
 */
import { PrismaClient, StoryLineType, Prisma } from "@prisma/client";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();

const FF_SITE_DIR = process.env.FF_SITE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../ff-site");
const CYOA_JSON = join(FF_SITE_DIR, "src/assets/json/cyoa.json");

const VM_TITLE = "Vortox Machina";
const VM_SLUG = "vm";

interface CyoaLine {
    type: "transcript" | "narration" | "dialogue" | "action";
    text: string;
    character?: string;
}

const TYPE_MAP: Record<CyoaLine["type"], StoryLineType> = {
    narration: StoryLineType.NARRATION,
    dialogue: StoryLineType.DIALOGUE,
    action: StoryLineType.ACTION,
    transcript: StoryLineType.TRANSCRIPT,
};

async function main() {
    if (!existsSync(CYOA_JSON)) {
        throw new Error(`Legacy cyoa.json not found at ${CYOA_JSON} — set FF_SITE_DIR`);
    }
    const cyoaLines = JSON.parse(readFileSync(CYOA_JSON, "utf8")) as CyoaLine[];

    if (await prisma.story.findUnique({ where: { slug: VM_SLUG } })) {
        throw new Error(`Story '${VM_SLUG}' already exists — nothing to migrate.`);
    }

    const archivist = await prisma.user.findUnique({ where: { username: "Archivist" } });
    if (!archivist) throw new Error("Archivist user not found — is this the legacy-seeded DB?");

    // Character name -> id, preferring the Archivist-owned (legacy-seeded) row
    // when several creators share a name.
    const characterIds = new Map<string, number>();
    for (const character of await prisma.character.findMany({ orderBy: { id: "asc" } })) {
        const existing = characterIds.get(character.name);
        if (existing !== undefined) {
            console.warn(`  duplicate character name '${character.name}' (ids ${existing}, ${character.id})`);
            if (character.creatorId !== archivist.id) continue;
        }
        characterIds.set(character.name, character.id);
    }

    // -- Remove the old season/episode/messages ----------------------------
    const oldSeason = await prisma.season.findUnique({ where: { title: VM_TITLE } });
    if (oldSeason) {
        const [commentaries, messages] = await prisma.$transaction([
            prisma.commentary.deleteMany({ where: { messageEpisodeTitle: VM_TITLE } }),
            prisma.message.deleteMany({ where: { episode: { seasonTitle: VM_TITLE } } }),
            prisma.episode.deleteMany({ where: { seasonTitle: VM_TITLE } }),
            prisma.season.delete({ where: { title: VM_TITLE } }),
        ]);
        console.log(`Removed old season: ${messages.count} messages, ${commentaries.count} commentaries.`);
    } else {
        console.warn("Old 'Vortox Machina' season not found — skipping deletion.");
    }

    // -- Rebuild as a Story (same mapping as seed-legacy.ts) ----------------
    const story = await prisma.story.create({
        data: {
            slug: VM_SLUG,
            title: VM_TITLE,
            blurb:
                "A VCOMM broadcast from Emmett, last known Squoatling, lost in space. The choose-your-own-adventure chronicle.",
            authorId: archivist.id,
            themeColor: "#e8b23b",
            themeColor2: "#d3612c",
        },
    });
    const chapter = await prisma.storyChapter.create({ data: { storyId: story.id, chapter_no: 1 } });

    const rows: Prisma.StoryLineCreateManyInput[] = cyoaLines.map((line, index) => {
        const characterId = line.character ? (characterIds.get(line.character) ?? null) : null;
        return {
            chapterId: chapter.id,
            line_no: index + 1,
            type: TYPE_MAP[line.type] ?? StoryLineType.NARRATION,
            text: line.text,
            characterId,
            speaker: line.character && characterId === null ? line.character : null,
        };
    });
    const CHUNK = 2000;
    for (let i = 0; i < rows.length; i += CHUNK) {
        await prisma.storyLine.createMany({ data: rows.slice(i, i + CHUNK) });
    }

    const histogram = new Map<string, number>();
    for (const row of rows) histogram.set(row.type as string, (histogram.get(row.type as string) ?? 0) + 1);
    console.log(`\nCreated story '${VM_SLUG}' (${rows.length} lines):`);
    for (const [type, count] of [...histogram.entries()].sort()) {
        console.log(`  ${type.padEnd(10)} ${count}`);
    }
    const unresolved = rows.filter((r) => r.speaker !== null).length;
    if (unresolved > 0) console.warn(`  ${unresolved} dialogue lines fell back to speaker names (no Character row).`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
