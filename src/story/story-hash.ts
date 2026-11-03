import { createHash } from "node:crypto";

// Kept free of Prisma so prisma/scripts/backfill-story-hashes.ts can share it.

/**
 * Duplicate-import fingerprint: sha256 over each chapter's lines (chapters in
 * chapter_no order, lines in line_no order) as `[type, text]` pairs, using
 * the *stored* text. Speaker/character attribution and chapter titles are
 * left out on purpose — the same manuscript re-imported with different
 * speaker mappings or a retitle is still the same manuscript. Takes the
 * stored form so a backfill over existing rows hashes identically to import.
 */
export function storyContentHash(chapters: { lines: { type: string; text: string }[] }[]): string {
    const shape = chapters.map((chapter) => chapter.lines.map((line) => [line.type, line.text]));
    return createHash("sha256").update(JSON.stringify(shape)).digest("hex");
}
