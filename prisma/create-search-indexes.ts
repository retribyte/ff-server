/**
 * Idempotent creation of the GIN expression indexes backing the unified
 * /api/search endpoint's Message/StoryLine full-text search.
 *
 * Prisma's schema-driven `db push` has no syntax for expression indexes
 * (`USING gin (to_tsvector(...))`) — the only existing GIN index in this
 * schema (StoryLine.segments) works because `segments` is a real jsonb
 * *column*; `to_tsvector(text)` is a computed expression over a String
 * column, which `@@index` simply cannot represent. So these indexes can
 * never live in schema.prisma, and this script is the only thing that
 * creates them. Unlike backfill-slugs.ts / migrate-vm-to-story.ts
 * (one-off, already run against live data — see ff-server/CLAUDE.md), THIS
 * script must stay re-runnable:
 *   - every fresh dev DB needs it (wired into `npm run seed`)
 *   - the existing live/seeded dev DB needs it run once by hand
 *   - `db push` doesn't know these indexes exist and won't recreate them —
 *     re-run this after every future `db push` as standard practice
 *
 * The regconfig is hardcoded 'english' (not looked up dynamically) so the
 * expression is IMMUTABLE/indexable, and matches the literal used in the
 * $queryRaw calls in message.service.ts / story.service.ts byte-for-byte —
 * the WHERE clause's left side must match the index expression exactly for
 * Postgres to use it.
 *
 * Run with: npm run db:search-indexes
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const INDEXES = [
    { name: "messages_text_fts_idx", table: "messages", column: "text" },
    { name: "story_lines_text_fts_idx", table: "story_lines", column: "text" },
] as const;

async function dropIfInvalid(name: string): Promise<void> {
    const rows = await prisma.$queryRaw<{ indisvalid: boolean }[]>`
        SELECT indisvalid FROM pg_index WHERE indexrelid = ${name}::regclass
    `.catch(() => [] as { indisvalid: boolean }[]);
    if (rows[0]?.indisvalid === false) {
        console.log(`Dropping invalid leftover index ${name} (a previous CONCURRENTLY build failed partway)...`);
        await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    }
}

async function main() {
    for (const { name, table, column } of INDEXES) {
        await dropIfInvalid(name);
        console.log(`Ensuring ${name} on ${table}(${column})...`);
        await prisma.$executeRawUnsafe(
            `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON ${table} USING gin (to_tsvector('english', ${column}))`
        );
    }
    console.log("Search indexes OK.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
