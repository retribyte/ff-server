/**
 * Legacy archive import — one-time seed.
 *
 * Loads the real campaign data into Postgres:
 *   - Every season under ff-site/archive-to-markdown/api/<season>/*.json —
 *     API-shaped episode payloads produced by md-to-api.py (one JSON file per
 *     episode: {seasonTitle, episode: {title, episode_no, summary, playedDate},
 *     messages: [{player, character, timestamp, type, text}]}).
 *   - Vortox Machina: the CYOA chronicle (~2.5k lines) from ff-site-old's
 *     src/assets/json/cyoa.json
 *   - Players → Users, speakers → Characters (colors from ff-site-old's
 *     characterColors.json, avatars matched against the pixel-art files
 *     carried over to the new frontend)
 *
 * Assumes an empty database — the wipe lives in prisma/seed.ts, which runs
 * this script as one step of the full seed. Run standalone with:
 * npm run seed:legacy   (only safe against an already-empty DB)
 *
 * Two sibling checkouts are read, independently overridable since they're
 * unrelated repos that may not share a naming convention across machines:
 *   FF_SITE_OLD_DIR  — the legacy React app (colors/avatars/cyoa.json).
 *                       Default: ../ff-site-old
 *   FF_SITE_DIR       — the Next.js rebuild (archive-to-markdown/api/*).
 *                       Default: ../ff-site, falling back to ../ff-site-new.
 */
import { PrismaClient, UserRole, Class, MessageType, StoryLineType, Prisma } from "@prisma/client";
import { hashSync } from "bcryptjs";
import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { slugify } from "../src/utils/slug.js";

const prisma = new PrismaClient();

const HERE = dirname(fileURLToPath(import.meta.url));

const FF_SITE_OLD_DIR = process.env.FF_SITE_OLD_DIR ?? resolve(HERE, "../../ff-site-old");
const JSON_DIR = join(FF_SITE_OLD_DIR, "src/assets/json");
const AVATAR_DIR = join(FF_SITE_OLD_DIR, "src/assets/images/avatars");

function resolveFfSiteDir(): string {
    if (process.env.FF_SITE_DIR) return process.env.FF_SITE_DIR;
    const primary = resolve(HERE, "../../ff-site");
    if (existsSync(primary)) return primary;
    return resolve(HERE, "../../ff-site-new");
}
const ARCHIVE_API_DIR = join(resolveFfSiteDir(), "archive-to-markdown/api");

// ---------- API-shaped episode payload (produced by md-to-api.py) ----------

interface ImportMessage {
    player: string;
    character: string | null;
    timestamp: string | null;
    type: string;
    text: string;
}

interface ImportPayload {
    seasonTitle: string;
    episode: {
        title: string;
        episode_no: number;
        summary: string | null;
        playedDate: string | null;
    };
    messages: ImportMessage[];
}

interface CyoaLine {
    type: "transcript" | "narration" | "dialogue" | "action";
    text: string;
    character?: string;
}

// ---------- Helpers ----------

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

const MESSAGE_TYPES = new Set(Object.values(MessageType));

async function createMessagesChunked(rows: Prisma.MessageCreateManyInput[]): Promise<void> {
    const CHUNK = 2000;
    for (let i = 0; i < rows.length; i += CHUNK) {
        await prisma.message.createMany({ data: rows.slice(i, i + CHUNK) });
    }
}

// ---------- Loading every season under archive-to-markdown/api/ ----------

interface LoadedSeason {
    seasonTitle: string;
    slug: string;
    episodes: ImportPayload[];
}

function loadSeasons(): LoadedSeason[] {
    if (!existsSync(ARCHIVE_API_DIR)) {
        throw new Error(`archive-to-markdown/api not found at ${ARCHIVE_API_DIR} — set FF_SITE_DIR`);
    }
    const seasons = new Map<string, LoadedSeason>();
    for (const dirName of readdirSync(ARCHIVE_API_DIR).sort()) {
        const seasonDir = join(ARCHIVE_API_DIR, dirName);
        const files = readdirSync(seasonDir).filter((f) => f.endsWith(".json"));
        for (const file of files) {
            const payload = JSON.parse(readFileSync(join(seasonDir, file), "utf8")) as ImportPayload;
            let season = seasons.get(payload.seasonTitle);
            if (!season) {
                season = { seasonTitle: payload.seasonTitle, slug: slugify(payload.seasonTitle), episodes: [] };
                seasons.set(payload.seasonTitle, season);
            }
            season.episodes.push(payload);
        }
    }
    for (const season of seasons.values()) {
        season.episodes.sort((a, b) => a.episode.episode_no - b.episode.episode_no);
    }
    return [...seasons.values()].sort((a, b) => a.seasonTitle.localeCompare(b.seasonTitle));
}

// ---------- Main ----------

async function main() {
    const seasons = loadSeasons();
    if (seasons.length === 0) {
        throw new Error(`No season data found under ${ARCHIVE_API_DIR}`);
    }

    const colors = existsSync(join(JSON_DIR, "characterColors.json"))
        ? (JSON.parse(readFileSync(join(JSON_DIR, "characterColors.json"), "utf8")) as {
              dark: Record<string, string>;
              light: Record<string, string>;
          })
        : { dark: {}, light: {} };
    const avatarFiles = new Set(existsSync(AVATAR_DIR) ? readdirSync(AVATAR_DIR) : []);

    const cyoaFile = join(JSON_DIR, "cyoa.json");
    const cyoaLines: CyoaLine[] = existsSync(cyoaFile) ? JSON.parse(readFileSync(cyoaFile, "utf8")) : [];

    const allMessages = seasons.flatMap((s) => s.episodes.flatMap((ep) => ep.messages));

    // -- Users: every player seen across all seasons, plus the Archivist (CYOA author) --
    const playerNames = new Set<string>(allMessages.map((m) => m.player));

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

    // -- Characters: every speaker across all seasons, CYOA speakers, and color-table entries --
    // Owner = the player who voiced them most; CYOA/color-only speakers -> Archivist.
    const blockCounts = new Map<string, Map<string, number>>();
    for (const m of allMessages) {
        if (!m.character) continue;
        const byPlayer = blockCounts.get(m.character) ?? new Map<string, number>();
        byPlayer.set(m.player, (byPlayer.get(m.player) ?? 0) + 1);
        blockCounts.set(m.character, byPlayer);
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

    // -- Seasons + episodes -------------------------------------------------
    let totalMessageCount = 0;
    const usedEpisodeSlugs = new Set<string>();
    for (const season of seasons) {
        await prisma.season.create({ data: { title: season.seasonTitle, slug: season.slug } });

        for (const payload of season.episodes) {
            await prisma.episode.create({
                data: {
                    title: payload.episode.title,
                    seasonTitle: season.seasonTitle,
                    episode_no: payload.episode.episode_no,
                    summary: payload.episode.summary ?? undefined,
                    playedDate: payload.episode.playedDate ? new Date(payload.episode.playedDate) : undefined,
                    slug: uniqueSlug(slugify(payload.episode.title), usedEpisodeSlugs),
                },
            });

            const rows: Prisma.MessageCreateManyInput[] = payload.messages.map((msg, index) => {
                const characterId = msg.character ? (characterIds.get(msg.character) ?? null) : null;
                let type = MESSAGE_TYPES.has(msg.type as MessageType) ? (msg.type as MessageType) : MessageType.OTHER;
                // FR-MSG-4: QUOTE requires a character speaker (md-to-api.py
                // already applies this at conversion time; kept here as a
                // cheap defense against payloads from other producers).
                if (type === MessageType.QUOTE && characterId === null) type = MessageType.OTHER;
                return {
                    episodeTitle: payload.episode.title,
                    messageNo: index + 1,
                    playerId: userIds.get(msg.player)!,
                    characterId,
                    timestamp: msg.timestamp ? new Date(msg.timestamp) : null,
                    type,
                    text: msg.text,
                };
            });
            await createMessagesChunked(rows);
            totalMessageCount += rows.length;
            console.log(`  ${season.seasonTitle} ep ${payload.episode.episode_no}: "${payload.episode.title}" — ${rows.length} messages`);
        }
    }

    // -- Vortox Machina (CYOA) as a Story with a single chapter -------------
    // cyoa.json is flat, so one chapter keeps line 1..N identical to the
    // legacy numbering and old ?line=N deep links stay meaningful.
    let cyoaRowCount = 0;
    if (cyoaLines.length > 0) {
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
        cyoaRowCount = cyoaRows.length;
    }

    console.log("\nLegacy import complete.");
    console.log(`  Users:      ${playerNames.size + 1}`);
    console.log(`  Characters: ${characterNames.size}`);
    console.log(`  Seasons:    ${seasons.length} (${seasons.map((s) => s.seasonTitle).join(", ")})`);
    console.log(`  Episodes:   ${seasons.reduce((n, s) => n + s.episodes.length, 0)}`);
    console.log(`  Messages:   ${totalMessageCount}`);
    if (cyoaRowCount > 0) console.log(`  Stories:    1 (Vortox Machina, ${cyoaRowCount} lines)`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
