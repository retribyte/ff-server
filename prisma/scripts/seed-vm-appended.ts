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
import { StoryLineType } from "@prisma/client";
import { prisma } from "../../src/db.js";
import { findOrCreateNpcPersona } from "../../src/speaker/speaker.service.js";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "seed-data", "vm-appended-lines.json");

interface VmAppendedLine {
    line_no: number;
    type: StoryLineType;
    text: string;
    character: string | null; // slug
    persona?: string | null; // a persona of `character`, by name
    speaker: string | null; // an NPC persona, by name
    npcVoice: boolean; // an NPC line; one with no speaker is the "Unnamed NPC"
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

    // Voices are personas: a character's by name, or an NPC's (found or created)
    const personaIdFor = async (l: VmAppendedLine): Promise<number | null> => {
        if (l.character) {
            if (!l.persona) return null;
            const p = await prisma.persona.findFirst({ where: { characterId: ids.get(l.character)!, name: l.persona } });
            if (!p) throw new Error(`line ${l.line_no}: ${l.character} has no persona '${l.persona}'`);
            return p.id;
        }
        if (!l.speaker && !l.npcVoice) return null;
        return (await findOrCreateNpcPersona(prisma, l.speaker || "Unnamed NPC")).persona.id;
    };
    const data = [];
    for (const l of lines) {
        data.push({
            chapterId: chapter.id,
            line_no: l.line_no,
            type: l.type,
            text: l.text,
            characterId: l.character ? ids.get(l.character)! : null,
            personaId: await personaIdFor(l),
        });
    }
    await prisma.storyLine.createMany({ data });
    console.log(`Appended VM lines ${first}..${last} (${lines.length}).`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
