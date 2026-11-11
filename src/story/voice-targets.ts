// Which story fragments a re-voice request (PATCH /stories/:slug/voices) points
// at, checked against what speaks them now. Changing a quote a character
// already speaks is for admins only and always lands in the admin History,
// whatever it becomes (another character, a persona, or an NPC); the user's
// call, 2026-11-11. Pure, so it's unit tested without a database.

/** One target as a voices request names it: a whole line, or one of its segments. */
export type VoiceTarget = { chapterNo?: unknown; lineNo?: unknown; segment?: unknown };

/** A targeted line as stored: who speaks it, and who speaks each of its segments. */
export type StoredVoices = {
    chapterNo: number;
    lineNo: number;
    characterId: number | null;
    segments: { position: number; characterId: number | null }[];
};

/** The (chapter, line) pairs a request names, skipping malformed ones (the write rejects those). */
export function targetedLines(targets: unknown): { chapterNo: number; lineNo: number }[] {
    if (!Array.isArray(targets)) return [];
    return targets
        .filter((t: VoiceTarget) => Number.isInteger(t?.chapterNo) && Number.isInteger(t?.lineNo))
        .map((t: VoiceTarget) => ({ chapterNo: t.chapterNo as number, lineNo: t.lineNo as number }));
}

/** True when any target is a line or segment a character speaks now. */
export function targetsCharacterVoice(targets: unknown, stored: StoredVoices[]): boolean {
    if (!Array.isArray(targets)) return false;
    const byLine = new Map(stored.map((l) => [`${l.chapterNo}:${l.lineNo}`, l]));
    return targets.some((t: VoiceTarget) => {
        if (!Number.isInteger(t?.chapterNo) || !Number.isInteger(t?.lineNo)) return false;
        const line = byLine.get(`${t.chapterNo}:${t.lineNo}`);
        if (!line) return false;
        if (t.segment === undefined || t.segment === null) return line.characterId !== null;
        return line.segments.some((s) => s.position === t.segment && s.characterId !== null);
    });
}
