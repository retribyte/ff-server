// A counter that moves whenever the archive's text changes: transcripts, story
// lines, or who speaks them. In-memory caches of values derived from that text
// (src/utils/word-counts.ts) remember the generation they were computed at and
// recompute once it moves. src/db.ts bumps it after every write to the models
// below, and again when a transaction that made such a write finishes. No
// imports here, so db.ts can use it without a cycle.

/** Models whose writes can change archive text or its speakers. Parents are
 * included because deleting one cascades to its lines in the database, which
 * Prisma never reports as a write to the child model. */
export const ARCHIVE_MODELS = new Set([
    "Message",
    "StoryLine",
    "StorySegment",
    "Story",
    "StoryChapter",
    "Episode",
    "Season",
    "Character",
]);

export const WRITE_OPERATIONS = new Set([
    "create",
    "createMany",
    "createManyAndReturn",
    "update",
    "updateMany",
    "updateManyAndReturn",
    "upsert",
    "delete",
    "deleteMany",
]);

let generation = 0;

export function archiveGeneration(): number {
    return generation;
}

export function bumpArchiveGeneration(): void {
    generation += 1;
}
