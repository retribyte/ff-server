/**
 * Speaker resolution for the Vortox Machina story, whose legacy cyoa.json
 * tags unidentified voices with throwaway names ("?", "?2", "???3", ...) and
 * can't tell "I:" speakers apart (Isaac / Irene / Iris / the ship's computer).
 *
 * Those aren't real characters, so instead of minting Character rows:
 *   - `data/vm-speaker-overrides.json` names specific lines (by 1-based
 *     line_no): `characters` maps a Character name to its lines, `speakers`
 *     maps a plain-text display name (no Character row) to its lines.
 *   - any other "?"-style speaker becomes an unnamed NPC voice
 *     (`npcVoice`, no speaker), which the story's authors or an admin can
 *     name later in the reader. An overrides entry still wins.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

interface Overrides {
    characters: Record<string, number[]>;
    speakers: Record<string, number[]>;
}

export type VmSpeaker = { character: string } | { speaker: string } | { npc: true };

const overrides = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "data/vm-speaker-overrides.json"), "utf8")
) as Overrides;

const byLine = new Map<number, VmSpeaker>();
for (const [character, lines] of Object.entries(overrides.characters)) {
    for (const lineNo of lines) byLine.set(lineNo, { character });
}
for (const [speaker, lines] of Object.entries(overrides.speakers)) {
    for (const lineNo of lines) byLine.set(lineNo, { speaker });
}

/** A placeholder speaker name from the legacy data: "?", "??", "?2", "???3". */
export const isUnknownSpeaker = (name: string) => /^\?+\d*$/.test(name);

/** Override for a dialogue line, or an unnamed NPC voice for an unlisted unknown one; null = use the legacy name as-is. */
export function resolveVmSpeaker(lineNo: number, legacyName: string): VmSpeaker | null {
    const override = byLine.get(lineNo);
    if (override) return override;
    return isUnknownSpeaker(legacyName) ? { npc: true } : null;
}
