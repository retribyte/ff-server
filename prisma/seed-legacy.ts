/**
 * Legacy archive import — one-time seed.
 *
 * Loads the real campaign data bundled with the old ff-site React app into Postgres:
 *   - FF2: 22 finished episodes (~22k messages) from src/assets/json/archives/ff2
 *   - Vortox Machina: the CYOA chronicle (~2.5k lines) from src/assets/json/cyoa.json
 *   - Players → Users, speakers → Characters (colors from characterColors.json,
 *     avatars matched against the pixel-art files carried over to the new frontend)
 *
 * DESTRUCTIVE: wipes all existing rows first (same as prisma/seed.ts).
 * Run with: npm run seed:legacy   (ff-site checkout expected at ../ff-site,
 * override with FF_SITE_DIR=/path/to/ff-site)
 */
import { PrismaClient, UserRole, Class, MessageType, StoryLineType, Prisma } from "@prisma/client";
import { hashSync } from "bcryptjs";
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { slugify } from "../src/utils/slug.js";

const prisma = new PrismaClient();

const FF_SITE_DIR = process.env.FF_SITE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../ff-site");
const JSON_DIR = join(FF_SITE_DIR, "src/assets/json");
const AVATAR_DIR = join(FF_SITE_DIR, "src/assets/images/avatars");

// ---------- Legacy JSON shapes ----------

interface LegacyContent {
    type: "quote" | "bot_response" | "command" | "action" | "other" | "embed";
    text?: string;
    embed?: { title?: string; description: string[]; footer?: string };
}

interface LegacyBlock {
    player: string;
    character: string | null;
    date: string;
    content: LegacyContent[];
}

interface LegacyEpisode {
    title: string;
    episode_number: string;
    short_desc: string;
    blocks: LegacyBlock[];
}

interface CyoaLine {
    type: "transcript" | "narration" | "dialogue" | "action";
    text: string;
    character?: string;
}

// ---------- Helpers ----------

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Legacy block dates look like "13-Jul-18 05:14 PM" (hour may be one digit)
function parseBlockDate(raw: string): Date | null {
    const m = raw?.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/);
    if (!m) return null;
    const [, day, mon, yy, hour, min, meridiem] = m;
    const month = MONTHS[mon.toLowerCase()];
    if (month === undefined) return null;
    let h = parseInt(hour) % 12;
    if (meridiem === "PM") h += 12;
    return new Date(2000 + parseInt(yy), month, parseInt(day), h, parseInt(min));
}

// Matches the old site's avatar lookup: "FF 8 Ball" -> "ff8ball.png"
function avatarShorthand(name: string): string {
    return name.toLowerCase().replaceAll(/\s/g, "");
}

// Slugs are globally unique per table; dedup collisions (distinct names that
// slugify to the same string) by appending _2, _3, ... to later occurrences.
function uniqueSlug(base: string, used: Set<string>): string {
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
        slug = `${base}_${n}`;
        n++;
    }
    used.add(slug);
    return slug;
}

const CONTENT_TYPE_MAP: Record<string, MessageType> = {
    quote: MessageType.QUOTE,
    bot_response: MessageType.BOT_RESPONSE,
    command: MessageType.COMMAND,
    action: MessageType.ACTION,
    other: MessageType.OTHER,
    embed: MessageType.EMBED,
};

async function createMessagesChunked(rows: Prisma.MessageCreateManyInput[]): Promise<void> {
    const CHUNK = 2000;
    for (let i = 0; i < rows.length; i += CHUNK) {
        await prisma.message.createMany({ data: rows.slice(i, i + CHUNK) });
    }
}

// ---------- Main ----------

async function main() {
    if (!existsSync(JSON_DIR)) {
        throw new Error(`Legacy ff-site JSON not found at ${JSON_DIR} — set FF_SITE_DIR`);
    }

    const colors = JSON.parse(readFileSync(join(JSON_DIR, "characterColors.json"), "utf8")) as {
        dark: Record<string, string>;
        light: Record<string, string>;
    };
    const avatarFiles = new Set(existsSync(AVATAR_DIR) ? readdirSync(AVATAR_DIR) : []);

    const episodeIndex = JSON.parse(readFileSync(join(JSON_DIR, "ff2.json"), "utf8")) as Array<{
        title: string;
        file_name: string;
        episode_number: string;
        short_desc: string;
    }>;

    const episodes: LegacyEpisode[] = episodeIndex.map((entry) => {
        const file = join(JSON_DIR, "archives/ff2", `${entry.episode_number}-${entry.file_name}.json`);
        const data = JSON.parse(readFileSync(file, "utf8")) as LegacyEpisode;
        return { ...data, short_desc: entry.short_desc };
    });

    const cyoaLines = JSON.parse(readFileSync(join(JSON_DIR, "cyoa.json"), "utf8")) as CyoaLine[];

    // -- Wipe existing data (reverse dependency order) --------------------
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

    // -- Users: every player seen in FF2, plus the Archivist (CYOA author) --
    const playerNames = new Set<string>();
    for (const ep of episodes) {
        for (const block of ep.blocks) playerNames.add(block.player);
    }

    const userIds = new Map<string, number>();
    for (const name of [...playerNames].sort()) {
        const user = await prisma.user.create({
            data: {
                username: name,
                // Dev-only placeholder credentials, matching the demo seed's convention
                password: hashSync(`${avatarShorthand(name)}123`, 10),
                role: name === "Trey" ? UserRole.ADMIN : UserRole.USER,
                icon: avatarFiles.has(`${avatarShorthand(name)}.png`) ? `/avatars/${avatarShorthand(name)}.png` : null,
            },
        });
        userIds.set(name, user.id);
    }
    const archivist = await prisma.user.create({
        data: {
            username: "Archivist",
            password: hashSync("archivist123", 10),
            role: UserRole.USER,
            bio: "System account that authored the imported Vortox Machina chronicle.",
        },
    });

    // -- Placeholder species (characters can be reclassified later via the UI) --
    const unclassified = await prisma.species.create({
        data: {
            name: "Unclassified",
            description:
                "Placeholder taxon for characters imported from the legacy archive. Assign a real species when known.",
            class: Class.HIGHER_SENTIENT,
            creatorId: archivist.id,
            slug: slugify("Unclassified"),
        },
    });

    // -- Characters: FF2 speakers, CYOA speakers, and color-table entries --
    // Owner = the player who voiced them most; CYOA/color-only speakers -> Archivist.
    const blockCounts = new Map<string, Map<string, number>>();
    for (const ep of episodes) {
        for (const block of ep.blocks) {
            if (!block.character) continue;
            const byPlayer = blockCounts.get(block.character) ?? new Map<string, number>();
            byPlayer.set(block.player, (byPlayer.get(block.player) ?? 0) + 1);
            blockCounts.set(block.character, byPlayer);
        }
    }

    const characterNames = new Set<string>([
        ...blockCounts.keys(),
        ...cyoaLines.filter((l) => l.character).map((l) => l.character as string),
        ...Object.keys(colors.dark),
    ]);

    const characterIds = new Map<string, number>();
    const usedCharacterSlugs = new Set<string>();
    for (const name of [...characterNames].sort()) {
        const byPlayer = blockCounts.get(name);
        const mainPlayer = byPlayer ? [...byPlayer.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
        const shorthand = avatarShorthand(name);
        const character = await prisma.character.create({
            data: {
                name,
                speciesId: unclassified.id,
                creatorId: mainPlayer ? userIds.get(mainPlayer)! : archivist.id,
                color: colors.dark[name] ?? null,
                image: avatarFiles.has(`${shorthand}.png`) ? `/avatars/${shorthand}.png` : null,
                slug: uniqueSlug(slugify(name), usedCharacterSlugs),
            },
        });
        characterIds.set(name, character.id);
    }

    // -- Season FF2 + its 22 episodes ---------------------------------------
    await prisma.season.create({ data: { title: "FF2", slug: slugify("FF2") } });

    let ff2MessageCount = 0;
    const usedEpisodeSlugs = new Set<string>();
    for (const ep of episodes) {
        const firstDate = ep.blocks.map((b) => parseBlockDate(b.date)).find((d) => d !== null) ?? null;
        const episode_no = parseInt(ep.episode_number);
        await prisma.episode.create({
            data: {
                title: ep.title,
                seasonTitle: "FF2",
                episode_no,
                summary: ep.short_desc,
                playedDate: firstDate,
                slug: uniqueSlug(`${episode_no}_${slugify(ep.title)}`, usedEpisodeSlugs),
            },
        });

        const rows: Prisma.MessageCreateManyInput[] = [];
        let messageNo = 0;
        for (const block of ep.blocks) {
            const timestamp = parseBlockDate(block.date);
            const characterId = block.character ? (characterIds.get(block.character) ?? null) : null;
            for (const content of block.content) {
                messageNo += 1;
                let type = CONTENT_TYPE_MAP[content.type] ?? MessageType.OTHER;
                // FR-MSG-4: QUOTE requires a character speaker
                if (type === MessageType.QUOTE && characterId === null) type = MessageType.OTHER;
                rows.push({
                    episodeTitle: ep.title,
                    messageNo,
                    playerId: userIds.get(block.player)!,
                    characterId,
                    timestamp,
                    type,
                    // Embeds keep their structure as a JSON payload in the text body
                    text: content.type === "embed" ? JSON.stringify(content.embed) : (content.text ?? ""),
                });
            }
        }
        await createMessagesChunked(rows);
        ff2MessageCount += rows.length;
        console.log(`  FF2 ep ${ep.episode_number}: "${ep.title}" — ${rows.length} messages`);
    }

    // -- Vortox Machina (CYOA) as a Story with a single chapter -------------
    // cyoa.json is flat, so one chapter keeps line 1..N identical to the
    // legacy numbering and old ?line=N deep links stay meaningful.
    const vmStory = await prisma.story.create({
        data: {
            slug: "vm",
            title: "Vortox Machina",
            blurb:
                "A VCOMM broadcast from Emmett, last known Squoatling, lost in space. The choose-your-own-adventure chronicle.",
            authorId: archivist.id,
            themeColor: "#e8b23b",
            themeColor2: "#d3612c",
        },
    });
    const vmChapter = await prisma.storyChapter.create({
        data: { storyId: vmStory.id, chapter_no: 1 },
    });

    const cyoaRows: Prisma.StoryLineCreateManyInput[] = cyoaLines.map((line, index) => {
        const characterId = line.character ? (characterIds.get(line.character) ?? null) : null;
        let type: StoryLineType;
        switch (line.type) {
            case "dialogue":
                type = StoryLineType.DIALOGUE;
                break;
            case "action":
                type = StoryLineType.ACTION;
                break;
            case "transcript":
                type = StoryLineType.TRANSCRIPT;
                break;
            default:
                type = StoryLineType.NARRATION;
        }
        return {
            chapterId: vmChapter.id,
            line_no: index + 1,
            type,
            text: line.text,
            characterId,
            // Uncatalogued voices still render as dialogue via the name fallback
            speaker: line.character && characterId === null ? line.character : null,
        };
    });
    const CHUNK = 2000;
    for (let i = 0; i < cyoaRows.length; i += CHUNK) {
        await prisma.storyLine.createMany({ data: cyoaRows.slice(i, i + CHUNK) });
    }

    console.log("\nLegacy import complete.");
    console.log(`  Users:      ${playerNames.size + 1}`);
    console.log(`  Characters: ${characterNames.size}`);
    console.log(`  Seasons:    1 (FF2)`);
    console.log(`  Episodes:   ${episodes.length}`);
    console.log(`  Messages:   ${ff2MessageCount} (FF2)`);
    console.log(`  Stories:    1 (Vortox Machina, ${cyoaRows.length} lines)`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
