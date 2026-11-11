// Word counts, cached in memory. Counting words means a regex over the text of
// every quote or story line, about 225 ms of GET /characters and 140 ms of
// GET /stories when done per request, and the text rarely changes. So each
// count is computed for every character or chapter at once, kept until the
// archive generation moves (any write to the archive's text or its speakers,
// see src/utils/archive-generation.ts), and shared by every request meanwhile.
// The TTL covers writes this process never sees: psql or a CLI script against
// the same database.

import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { archiveGeneration } from "./archive-generation.js";

const TTL_MS = 5 * 60 * 1000;

/** Memoize an all-rows computation until the archive generation moves or the TTL passes. */
function cachedUntilArchiveChanges<T>(compute: () => Promise<T>): () => Promise<T> {
    let entry: { generation: number; at: number; value: Promise<T> } | null = null;
    return () => {
        const generation = archiveGeneration();
        if (entry && entry.generation === generation && Date.now() - entry.at < TTL_MS) return entry.value;
        // Taken before the queries start, so a write that lands while they run
        // moves the generation past this entry and the next caller recomputes
        const fresh = { generation, at: Date.now(), value: compute() };
        entry = fresh;
        fresh.value.catch(() => {
            if (entry === fresh) entry = null;
        });
        return fresh.value;
    };
}

/**
 * Words each character speaks: in QUOTE messages, and in the story lines and
 * story segments voiced by them (a segmented line counts only that speaker's
 * spans, any other line its whole text). Keyed by character id; characters
 * with no quotes are absent.
 */
export const quoteWordsByCharacter = cachedUntilArchiveChanges(async () => {
    const [messages, storyLines] = await Promise.all([
        prisma.$queryRaw<{ characterId: number; words: bigint }[]>`
            SELECT m."characterId",
                   SUM((SELECT COUNT(*) FROM regexp_matches(m.text, '[^[:space:]]+', 'g'))) AS words
            FROM messages m
            WHERE m.type = 'QUOTE' AND m."characterId" IS NOT NULL
            GROUP BY m."characterId"
        `,
        prisma.$queryRaw<{ characterId: number; words: bigint }[]>`
            WITH spoken AS (
                SELECT sl.id, sl."characterId" AS cid
                FROM story_lines sl
                WHERE sl."characterId" IS NOT NULL
                UNION
                SELECT ss."lineId", ss."characterId"
                FROM story_segments ss
                WHERE ss."characterId" IS NOT NULL
            )
            SELECT sp.cid AS "characterId", SUM(
                CASE WHEN EXISTS (SELECT 1 FROM story_segments ss WHERE ss."lineId" = sl.id) THEN (
                    SELECT COUNT(*)
                    FROM story_segments ss, regexp_matches(ss.text, '[^[:space:]]+', 'g')
                    WHERE ss."lineId" = sl.id AND ss."characterId" = sp.cid
                ) ELSE (
                    SELECT COUNT(*) FROM regexp_matches(sl.text, '[^[:space:]]+', 'g')
                ) END
            ) AS words
            FROM spoken sp JOIN story_lines sl ON sl.id = sp.id
            GROUP BY sp.cid
        `,
    ]);
    const words = new Map<number, number>();
    for (const row of [...messages, ...storyLines]) {
        words.set(row.characterId, (words.get(row.characterId) ?? 0) + Number(row.words));
    }
    return words;
});

// Line types counted in word counts (not BREAK or IMAGE)
const WORD_LINE_TYPES = ["NARRATION", "DIALOGUE", "ACTION", "TRANSCRIPT", "HEADING"];

/** Words per chapter (whitespace-separated runs in each prose line's text), keyed by chapter id. */
export const wordsByChapter = cachedUntilArchiveChanges(async () => {
    const rows = await prisma.$queryRaw<{ chapterId: number; words: bigint }[]>`
        SELECT sl."chapterId", COUNT(*) AS words
        FROM story_lines sl, regexp_matches(sl.text, '[^[:space:]]+', 'g')
        WHERE sl.type::text IN (${Prisma.join(WORD_LINE_TYPES)})
        GROUP BY sl."chapterId"
    `;
    return new Map(rows.map((r) => [r.chapterId, Number(r.words)]));
});
