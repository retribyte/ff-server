/**
 * Export the Vortox Machina lines appended from Discord (append-vm-from-discord.ts)
 * into the committed seed file seed-legacy.ts replays:
 * prisma/scripts/seed-data/vm-appended-lines.json.
 *
 * Run after appending lines to the dev DB, then commit the diff:
 *     npm run export:vm-appended
 *
 * Exports every "vm" line after the end of cyoa.json (the frozen legacy part
 * that seed-legacy reads from ff-site-old), with characters as slugs, since
 * ids differ between databases. Fails if a line has data the seed can't
 * replay (segments, pictures), or if the line numbers have a gap.
 */
import { prisma } from "../../src/db.js";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FF_SITE_OLD_DIR = process.env.FF_SITE_OLD_DIR ?? resolve(HERE, "../../../ff-site-old");
const CYOA_FILE = join(FF_SITE_OLD_DIR, "src/assets/json/cyoa.json");
const OUT_FILE = join(HERE, "seed-data", "vm-appended-lines.json");

async function main() {
    const cyoaLength = (JSON.parse(readFileSync(CYOA_FILE, "utf8")) as unknown[]).length;
    const lines = await prisma.storyLine.findMany({
        where: { chapter: { story: { slug: "vm" }, chapter_no: 1 }, line_no: { gt: cyoaLength } },
        orderBy: { line_no: "asc" },
        include: { character: { select: { slug: true } } },
    });
    lines.forEach((line, i) => {
        if (line.line_no !== cyoaLength + 1 + i) throw new Error(`gap before vm line ${line.line_no}`);
        if (line.segments !== null || line.booruId !== null || line.imageUrl !== null) {
            throw new Error(`vm line ${line.line_no} has segments or a picture; the seed file can't carry those`);
        }
    });
    const out = lines.map((line) => ({
        line_no: line.line_no,
        type: line.type,
        text: line.text,
        character: line.character?.slug ?? null,
        speaker: line.speaker,
        npcVoice: line.npcVoice,
    }));
    // One line per entry: readable diffs when more lines are appended
    writeFileSync(OUT_FILE, "[\n" + out.map((o) => "    " + JSON.stringify(o)).join(",\n") + "\n]\n");
    console.log(`Wrote ${out.length} lines (${cyoaLength + 1}..${cyoaLength + out.length}) to ${OUT_FILE}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
