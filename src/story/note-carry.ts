// Where a story line's margin notes go when a revision replaces the story's
// text (replaceStoryContent): every line is deleted and written again, so each
// note is moved to the new line that best stands for its old one. Pure, so
// it's unit tested without a database.

/** A line as the placement sees it: where it is and what it says. */
export type PlacedLine = { id: number; chapterNo: number; lineNo: number; text: string };

/** Where a note sat before the revision. */
export type NoteSpot = { chapterNo: number; lineNo: number; text: string };

export type NotePlacement = {
    lineId: number;
    /** false when the note's line text is gone and it was put on the nearest line instead */
    sameText: boolean;
};

const norm = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The new line for a note: the same text in the same chapter (the closest by
 * position, if it repeats), else the same text anywhere in the story, else the
 * line at the note's old position in its chapter (or that chapter's last
 * line), else the story's last line. null only when the story has no lines.
 */
export function placeNote(note: NoteSpot, lines: PlacedLine[]): NotePlacement | null {
    if (lines.length === 0) return null;
    const text = norm(note.text);
    const closest = (candidates: PlacedLine[]) =>
        candidates.reduce((best, l) => (Math.abs(l.lineNo - note.lineNo) < Math.abs(best.lineNo - note.lineNo) ? l : best));

    const sameText = lines.filter((l) => norm(l.text) === text);
    const inChapter = sameText.filter((l) => l.chapterNo === note.chapterNo);
    if (inChapter.length) return { lineId: closest(inChapter).id, sameText: true };
    if (sameText.length) return { lineId: sameText[0].id, sameText: true };

    const chapter = lines.filter((l) => l.chapterNo === note.chapterNo);
    if (chapter.length) {
        const at = chapter.find((l) => l.lineNo === note.lineNo);
        const last = chapter.reduce((a, b) => (b.lineNo > a.lineNo ? b : a));
        return { lineId: (at ?? (note.lineNo > last.lineNo ? last : closest(chapter))).id, sameText: false };
    }
    const lastLine = lines.reduce((a, b) => (b.chapterNo > a.chapterNo || (b.chapterNo === a.chapterNo && b.lineNo > a.lineNo) ? b : a));
    return { lineId: lastLine.id, sameText: false };
}
