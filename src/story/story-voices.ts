// Story voices: who speaks a story line or an in-paragraph segment. The same
// rule as a transcript message: a character alone, a character shown as one
// of its personas, or an NPC persona alone (characterId null). The
// story_lines/story_segments persona-match triggers enforce the pair; this
// module turns what clients send into those ids, writes lines with their
// segments, and shapes them for the reader.
//
// What clients send (the importer's payload, the line endpoints): on a line
// or a segment, any one of
//   - characterId, optionally with personaId (one of that character's personas)
//   - personaId alone: an NPC persona (or a character's persona, whose
//     character is then implied)
//   - speaker: a name, the NPC persona of that name (found or created; NPC
//     personas are global and unique by case-insensitive name)
// `npcVoice: true` (line) / `npc: true` (segment) with no name is an unnamed
// NPC voice: the converter emits it for gray text / `{?}`, and the importer's
// naming step must fill it. A draft may carry one; the archive never stores one.

import { Prisma, StoryLineType } from "@prisma/client";
import { findOrCreateNpcPersona } from "../speaker/speaker.service.js";

type Tx = Prisma.TransactionClient;

export const NPC_NAME_MAX = 80;

export type VoiceInput = {
    characterId?: number | null;
    personaId?: number | null;
    speaker?: string | null;
};

export type SegmentInput = VoiceInput & {
    text: string;
    npc?: boolean;
    italic?: boolean;
    bold?: boolean;
};

export type LineInput = VoiceInput & {
    type: StoryLineType;
    text: string;
    npcVoice?: boolean;
    segments?: SegmentInput[] | null;
    booruId?: number | null; // IMAGE only: the booru post holding the picture
    imageUrl?: string | null; // set by resolveImages, never by the client
};

export type Voice = { characterId: number | null; personaId: number | null };

const named = (speaker: string | null | undefined) => typeof speaker === "string" && speaker.trim().length > 0;

/** A fragment someone speaks, named or not (dialogue rather than narration). */
export function hasVoice(v: VoiceInput, npcFlag?: boolean): boolean {
    return !!v.characterId || !!v.personaId || named(v.speaker) || !!npcFlag;
}

/** An NPC voice nobody has named yet. */
export function isUnnamed(v: VoiceInput, npcFlag?: boolean): boolean {
    return !!npcFlag && !v.characterId && !v.personaId && !named(v.speaker);
}

/** Shape checks on one fragment's voice fields (the ids are checked when resolved). */
export function validateVoice(v: VoiceInput, label: string): void {
    for (const key of ["characterId", "personaId"] as const) {
        const id = v[key];
        if (id !== undefined && id !== null && !Number.isInteger(id)) throw new Error(`${label}: ${key} must be an id`);
    }
    if (v.speaker !== undefined && v.speaker !== null) {
        if (typeof v.speaker !== "string") throw new Error(`${label}: speaker must be a name`);
        if (v.speaker.trim().length > NPC_NAME_MAX) throw new Error(`${label}: names are at most ${NPC_NAME_MAX} characters`);
        if (/[\n\r]/.test(v.speaker)) throw new Error(`${label}: a name is one line`);
    }
    if (named(v.speaker) && (v.characterId || v.personaId)) {
        throw new Error(`${label}: a voice is a character (and persona), a persona, or an NPC name, not several`);
    }
}

/**
 * Resolves voices to ids inside a transaction, caching lookups, and creating
 * NPC personas for new names. Throws on an unnamed NPC voice, an unknown id, or
 * a persona that isn't the character's.
 */
export function voiceResolver(tx: Tx) {
    const characters = new Map<number, boolean>();
    const personas = new Map<number, { characterId: number | null } | null>();
    const npcs = new Map<string, number>();
    const created: string[] = [];

    async function resolve(v: VoiceInput, npcFlag: boolean | undefined, label: string): Promise<Voice> {
        if (isUnnamed(v, npcFlag)) throw new Error(`${label}: an NPC voice needs a name (or a character)`);
        let characterId = v.characterId ?? null;
        const personaId = v.personaId ?? null;
        if (personaId !== null) {
            if (!personas.has(personaId)) {
                personas.set(personaId, await tx.persona.findUnique({ where: { id: personaId }, select: { characterId: true } }));
            }
            const persona = personas.get(personaId);
            if (!persona) throw new Error(`${label}: persona with id '${personaId}' not found`);
            if (characterId === null) characterId = persona.characterId;
            else if (persona.characterId !== characterId) {
                throw new Error(`${label}: persona ${personaId} doesn't belong to character ${characterId}`);
            }
        }
        if (characterId !== null) {
            if (!characters.has(characterId)) {
                characters.set(characterId, !!(await tx.character.findUnique({ where: { id: characterId }, select: { id: true } })));
            }
            if (!characters.get(characterId)) throw new Error(`${label}: character with id '${characterId}' not found`);
            return { characterId, personaId };
        }
        if (personaId !== null) return { characterId: null, personaId };
        if (named(v.speaker)) {
            const key = v.speaker!.trim().toLowerCase();
            if (!npcs.has(key)) {
                const { persona, created: isNew } = await findOrCreateNpcPersona(tx, v.speaker!);
                npcs.set(key, persona.id);
                if (isNew) created.push(persona.name!);
            }
            return { characterId: null, personaId: npcs.get(key)! };
        }
        return { characterId: null, personaId: null };
    }

    return { resolve, created };
}

/** The `text` a line is stored with: segmented lines derive it from the spans so the two can't desync. */
export function storedText(line: { text: string; segments?: SegmentInput[] | null }): string {
    return Array.isArray(line.segments) ? line.segments.map((s) => s.text).join("") : line.text;
}

/**
 * Writes already-validated lines (and their segments) into a chapter with
 * sequential line_nos, inside the caller's transaction. Returns the NPC
 * personas it created.
 */
export async function writeLines(tx: Tx, chapterId: number, firstLineNo: number, lines: LineInput[], labelPrefix = ""): Promise<string[]> {
    const { resolve, created } = voiceResolver(tx);
    const rows: Prisma.StoryLineCreateManyInput[] = [];
    const segmentsByLineNo = new Map<number, Omit<Prisma.StorySegmentCreateManyInput, "lineId">[]>();
    for (const [index, line] of lines.entries()) {
        const lineNo = firstLineNo + index;
        const label = `${labelPrefix}Line ${index + 1}`;
        const voice = line.type === StoryLineType.IMAGE ? { characterId: null, personaId: null } : await resolve(line, line.npcVoice, label);
        rows.push({
            chapterId,
            line_no: lineNo,
            type: line.type,
            text: storedText(line),
            ...voice,
            booruId: line.type === StoryLineType.IMAGE ? line.booruId : null,
            imageUrl: line.type === StoryLineType.IMAGE ? line.imageUrl : null,
        });
        if (Array.isArray(line.segments)) {
            const segments = [];
            for (const [position, seg] of line.segments.entries()) {
                segments.push({
                    position,
                    text: seg.text,
                    ...(await resolve(seg, seg.npc, `${label}, segment ${position + 1}`)),
                    italic: !!seg.italic,
                    bold: !!seg.bold,
                });
            }
            segmentsByLineNo.set(lineNo, segments);
        }
    }
    if (!rows.length) return created;
    const inserted = await tx.storyLine.createManyAndReturn({ data: rows, select: { id: true, line_no: true } });
    const idByLineNo = new Map(inserted.map((r) => [r.line_no, r.id]));
    const segmentRows = [...segmentsByLineNo].flatMap(([lineNo, segments]) =>
        segments.map((seg) => ({ ...seg, lineId: idByLineNo.get(lineNo)! }))
    );
    if (segmentRows.length) await tx.storySegment.createMany({ data: segmentRows });
    return created;
}

/** Every persona voicing a line or segment matched by `where` (to clean up NPCs a delete leaves unused). */
export async function personasUsedBy(tx: Tx, where: Prisma.StoryLineWhereInput): Promise<number[]> {
    const [lines, segments] = await Promise.all([
        tx.storyLine.findMany({ where: { ...where, personaId: { not: null } }, select: { personaId: true }, distinct: ["personaId"] }),
        tx.storySegment.findMany({ where: { line: where, personaId: { not: null } }, select: { personaId: true }, distinct: ["personaId"] }),
    ]);
    return [...lines, ...segments].map((r) => r.personaId!);
}

// ---- Reading ----------------------------------------------------------------

export const PERSONA_SELECT = { id: true, name: true, image: true, color: true, characterId: true, slug: true } as const;

/** Prisma include for a story line with everything the reader shows. */
export const LINE_INCLUDE = {
    character: true,
    persona: { select: PERSONA_SELECT },
    segments: { orderBy: { position: "asc" as const }, include: { persona: { select: PERSONA_SELECT } } },
} satisfies Prisma.StoryLineInclude;

type LineWithVoices = Prisma.StoryLineGetPayload<{ include: typeof LINE_INCLUDE }>;
type SegmentWithVoice = LineWithVoices["segments"][number];

/**
 * A segment as the API serves it. `persona` comes inline (name/image/color
 * for the reader). `speaker` + `npc` are the pre-persona fields, derived for
 * one release so a site deployed before this API keeps rendering NPC quotes.
 */
function toWireSegment(seg: SegmentWithVoice) {
    const npc = seg.persona && seg.persona.characterId === null ? seg.persona : null;
    return {
        text: seg.text,
        ...(seg.characterId !== null ? { characterId: seg.characterId } : {}),
        ...(seg.personaId !== null ? { personaId: seg.personaId, persona: seg.persona } : {}),
        ...(seg.italic ? { italic: true } : {}),
        ...(seg.bold ? { bold: true } : {}),
        ...(npc ? { npc: true, speaker: npc.name } : {}),
    };
}

/** A line as the API serves it: voice ids with their character/persona, segments as an array (null when unsegmented). */
export function toWireLine(line: LineWithVoices) {
    const { segments, speaker: _speaker, npcVoice: _npcVoice, legacySegments: _legacy, ...rest } = line;
    const npc = line.persona && line.persona.characterId === null ? line.persona : null;
    return {
        ...rest,
        segments: segments.length ? segments.map(toWireSegment) : null,
        // pre-persona fields, for one release (see toWireSegment)
        speaker: npc ? npc.name : null,
        npcVoice: !!npc,
    };
}

export type WireLine = ReturnType<typeof toWireLine>;
export type WireSegment = ReturnType<typeof toWireSegment>;
