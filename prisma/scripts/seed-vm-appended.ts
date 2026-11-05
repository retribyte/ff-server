/**
 * Append the Vortox Machina lines that came from Discord after cyoa.json was
 * frozen (append-vm-from-discord.ts) to the "vm" story seed-legacy created.
 *
 * The lines live in seed-data/vm-appended-lines.json, written from the dev DB
 * by `npm run export:vm-appended`. Characters are slugs as they are *after*
 * seed-npc-personas' renames (squorchy -> squorchy_vurkallus), so seed.ts runs
 * this right after that script. line_no continues straight on from cyoa.json.
 *
 * Idempotent: does nothing if the lines are already there, and fails (writing
 * nothing) if the story ends anywhere other than just before or at the end of
 * the file, or if a slug has no character.
 *
 *   npm run seed:vm-appended
 */
import { PrismaClient, StoryLineType } from "@prisma/client";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();
const FILE = join(dirname(fileURLToPath(import.meta.url)), "seed-data", "vm-appended-lines.json");

interface VmAppendedLine {
    line_no: number;
    type: StoryLineType;
    text: string;
    character: string | null; // slug
    speaker: string | null;
    npcVoice: boolean;
}

async function main() {
    const lines: VmAppendedLine[] = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
    if (lines.length === 0) {
        console.log("No appended VM lines to seed.");
        return;
    }
    const chapter = await prisma.storyChapter.findFirst({ where: { story: { slug: "vm" }, chapter_no: 1 } });
    if (!chapter) {
        console.log('No "vm" story (cyoa.json missing?); skipping appended VM lines.');
        return;
    }
    const first = lines[0].line_no;
    const last = lines[lines.length - 1].line_no;
    const max = (await prisma.storyLine.aggregate({ where: { chapterId: chapter.id }, _max: { line_no: true } }))._max.line_no ?? 0;
    if (max === last) {
        console.log(`VM already has lines ${first}..${last}; nothing to do.`);
        return;
    }
    if (max !== first - 1) {
        throw new Error(`VM ends at line ${max}, but vm-appended-lines.json covers ${first}..${last}`);
    }

    const slugs = [...new Set(lines.map((l) => l.character).filter((s): s is string => s !== null))];
    const ids = new Map(
        (await prisma.character.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })).map((c) => [c.slug, c.id])
    );
    const missing = slugs.filter((s) => !ids.has(s));
    if (missing.length) throw new Error(`vm-appended-lines.json names unknown character(s): ${missing.join(", ")}`);

    await prisma.storyLine.createMany({
        data: lines.map((l) => ({
            chapterId: chapter.id,
            line_no: l.line_no,
            type: l.type,
            text: l.text,
            characterId: l.character ? ids.get(l.character)! : null,
            speaker: l.speaker,
            npcVoice: l.npcVoice,
        })),
    });
    console.log(`Appended VM lines ${first}..${last} (${lines.length}).`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
