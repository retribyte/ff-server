/**
 * Speaker operations: moving who voices archive lines between characters
 * and NPC personas (PLAN-mvp.md Phase 2). The admin endpoints
 * (speaker.controller.ts) and the seed script that applies the reviewed
 * speaker spreadsheet (prisma/scripts/seed-npc-personas.ts) both go through
 * these functions, so a fresh seed and a hand-fixed dev DB end up the same.
 *
 * Every operation runs in one transaction and returns counts of what moved.
 * Attribution changes are admin-only (FR-EP-2). Message text, type, player
 * and timestamp are never touched.
 *
 * A "voice" reaches the archive in three places, and each move rewrites all
 * three:
 *   - messages: characterId + personaId (the messages_persona_match trigger
 *     checks that the persona belongs to the character, null == null)
 *   - story_lines.characterId: whole DIALOGUE lines
 *   - story_lines.segments JSON: in-paragraph quotes, [{text, characterId?, speaker?}]
 * Story lines have no persona column. When lines leave a character to become
 * an NPC or a persona, their `speaker` text is set to the old character name,
 * which is what the reader was showing before.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { isValidSlug, slugify } from "../utils/slug.js";


type Tx = Prisma.TransactionClient;

// Generous: a full-character move rewrites every segment JSON it appears in.
export const TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 };

/** A speaker operation refused on purpose. `status` is the HTTP status the controller answers with. */
export class SpeakerError extends Error {
    constructor(message: string, public status: 400 | 404 | 409 = 400) {
        super(message);
    }
}

/**
 * Narrows a move to part of a character's lines. Empty or absent means
 * all of them, and only a full move deletes the source character.
 *   - seasons: season slugs ("ff4"). Covers messages in those seasons'
 *     episodes and story lines in stories filed under those seasons.
 *   - messages: "<episode_slug>#<messageNo>" refs. Each must currently be
 *     voiced by the source character, or the whole operation fails.
 */
export type SpeakerScope = { seasons?: string[]; messages?: string[] };

export type MoveCounts = {
    messages: number;
    storyLines: number;
    storySegmentLines: number;
    deletedCharacter: boolean;
};

type Destination = {
    characterId: number | null;
    personaId: number | null;
    /** Set story-line `speaker` to this (the old character's name), or leave it alone when undefined. */
    speaker?: string;
};

function isFullScope(scope?: SpeakerScope): boolean {
    return !scope || (!scope.seasons?.length && !scope.messages?.length);
}

async function getCharacterOrThrow(tx: Tx, id: number) {
    const character = await tx.character.findUnique({ where: { id } });
    if (!character) throw new SpeakerError(`Character with id '${id}' not found`, 404);
    return character;
}

/** Resolves a scope's season slugs and message refs into filters, failing loudly on anything unknown. */
async function resolveScope(tx: Tx, sourceId: number, scope?: SpeakerScope) {
    if (isFullScope(scope)) {
        return { messageWhere: {} as Prisma.MessageWhereInput, storyWhere: {} as Prisma.StoryLineWhereInput, storySeasonTitles: null as string[] | null };
    }
    const or: Prisma.MessageWhereInput[] = [];
    let storySeasonTitles: string[] = [];

    if (scope!.seasons?.length) {
        const seasons = await tx.season.findMany({ where: { slug: { in: scope!.seasons } } });
        const unknown = scope!.seasons.filter((s) => !seasons.some((x) => x.slug === s));
        if (unknown.length) throw new SpeakerError(`Unknown season slug(s): ${unknown.join(", ")}`);
        storySeasonTitles = seasons.map((s) => s.title);
        or.push({ episode: { seasonTitle: { in: storySeasonTitles } } });
    }

    for (const ref of scope!.messages ?? []) {
        const match = /^(.+)#(\d+)$/.exec(ref);
        if (!match) throw new SpeakerError(`Bad message ref '${ref}' (want <episode_slug>#<messageNo>)`);
        const episode = await tx.episode.findUnique({ where: { slug: match[1] } });
        if (!episode) throw new SpeakerError(`Message ref '${ref}': no episode with slug '${match[1]}'`);
        const messageNo = parseInt(match[2], 10);
        const message = await tx.message.findUnique({
            where: { episodeTitle_messageNo: { episodeTitle: episode.title, messageNo } },
        });
        if (!message) throw new SpeakerError(`Message ref '${ref}': no such message`);
        if (message.characterId !== sourceId) {
            throw new SpeakerError(
                `Message ref '${ref}' is voiced by character ${message.characterId ?? "none"}, not ${sourceId}`,
                409
            );
        }
        or.push({ episodeTitle: episode.title, messageNo });
    }

    return {
        messageWhere: { OR: or } as Prisma.MessageWhereInput,
        // msg: refs only ever name messages; story lines move only with a season scope.
        storyWhere: { chapter: { story: { seasonTitle: { in: storySeasonTitles } } } } as Prisma.StoryLineWhereInput,
        storySeasonTitles,
    };
}

type Segment = { text: string; characterId?: number | null; speaker?: string | null; [key: string]: unknown };

/** Moves a character's lines (all three places) to `dest`. The caller decides whether to delete the source. */
async function moveVoice(tx: Tx, sourceId: number, dest: Destination, scope?: SpeakerScope): Promise<Omit<MoveCounts, "deletedCharacter">> {
    const { messageWhere, storyWhere, storySeasonTitles } = await resolveScope(tx, sourceId, scope);

    const { count: messages } = await tx.message.updateMany({
        where: { ...messageWhere, characterId: sourceId },
        data: { characterId: dest.characterId, personaId: dest.personaId },
    });

    const { count: storyLines } = await tx.storyLine.updateMany({
        where: { ...storyWhere, characterId: sourceId },
        data: { characterId: dest.characterId, ...(dest.speaker !== undefined ? { speaker: dest.speaker } : {}) },
    });

    // In-paragraph quotes: no FK, so rewrite the JSON. Scoped by story season
    // the same way as whole lines (msg-only scopes skip stories entirely).
    let storySegmentLines = 0;
    if (storySeasonTitles === null || storySeasonTitles.length) {
        const containment = JSON.stringify([{ characterId: sourceId }]);
        const rows = await tx.$queryRaw<{ id: number; segments: Segment[] }[]>`
            SELECT sl.id, sl.segments
            FROM story_lines sl
            JOIN story_chapters ch ON ch.id = sl."chapterId"
            JOIN stories s ON s.id = ch."storyId"
            WHERE sl.segments @> ${containment}::jsonb
              AND (${storySeasonTitles === null} OR s."seasonTitle" = ANY(${storySeasonTitles ?? []}::text[]))
        `;
        for (const row of rows) {
            const segments = row.segments.map((seg) => {
                if (seg.characterId !== sourceId) return seg;
                const { characterId: _drop, ...rest } = seg;
                return {
                    ...rest,
                    ...(dest.characterId !== null ? { characterId: dest.characterId } : {}),
                    ...(dest.speaker !== undefined ? { speaker: dest.speaker } : {}),
                };
            });
            await tx.storyLine.update({ where: { id: row.id }, data: { segments: segments as Prisma.InputJsonValue } });
        }
        storySegmentLines = rows.length;
    }

    return { messages, storyLines, storySegmentLines };
}

/** Lines, story lines and story segments still voiced by a character. */
export async function countReferences(tx: Tx, characterId: number): Promise<number> {
    const containment = JSON.stringify([{ characterId }]);
    const [messages, storyLines, [{ count }]] = await Promise.all([
        tx.message.count({ where: { characterId } }),
        tx.storyLine.count({ where: { characterId } }),
        tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM story_lines WHERE segments @> ${containment}::jsonb`,
    ]);
    return messages + storyLines + Number(count);
}

/** Deletes a character that nothing in the archive references any more (its personas cascade). */
async function deleteIfUnreferenced(tx: Tx, characterId: number): Promise<void> {
    const remaining = await countReferences(tx, characterId);
    if (remaining > 0) {
        throw new SpeakerError(`Character ${characterId} is still referenced ${remaining} time(s), so it can't be deleted`, 409);
    }
    await tx.character.delete({ where: { id: characterId } });
}

/**
 * Finds the NPC persona with this name (case-insensitive) or creates it.
 * NPC personas are global: the FF2 and FF4 "Receptionist" share one.
 */
export async function findOrCreateNpcPersona(tx: Tx, name: string, extra: { image?: string | null; color?: string | null } = {}) {
    const trimmed = name.trim();
    if (!trimmed) throw new SpeakerError("An NPC persona needs a name");
    const existing = await tx.persona.findFirst({
        where: { characterId: null, name: { equals: trimmed, mode: "insensitive" } },
    });
    if (existing) return { persona: existing, created: false };
    const persona = await tx.persona.create({
        data: { name: trimmed, characterId: null, image: extra.image ?? null, color: extra.color ?? null },
    });
    return { persona, created: true };
}

async function getNpcPersonaOrThrow(tx: Tx, personaId: number) {
    const persona = await tx.persona.findUnique({ where: { id: personaId } });
    if (!persona) throw new SpeakerError(`Persona with id '${personaId}' not found`, 404);
    if (persona.characterId !== null) throw new SpeakerError(`Persona ${personaId} belongs to a character, not an NPC`);
    return persona;
}

// --- Operations ---------------------------------------------------------

/**
 * Character → NPC voice. Its lines become NPC lines (characterId null) under
 * the NPC persona of the same name, created if needed, or under
 * `intoPersonaId` when given (merging into an NPC that already exists). A
 * full move then deletes the character. The character's image and color carry
 * over to a newly created persona.
 */
export async function demoteToNpcTx(tx: Tx, characterId: number, opts: { scope?: SpeakerScope; intoPersonaId?: number } = {}) {
    const source = await getCharacterOrThrow(tx, characterId);
    const { persona, created } = opts.intoPersonaId
        ? { persona: await getNpcPersonaOrThrow(tx, opts.intoPersonaId), created: false }
        : await findOrCreateNpcPersona(tx, source.name, { image: source.image, color: source.color });

    const moved = await moveVoice(tx, source.id, { characterId: null, personaId: persona.id, speaker: source.name }, opts.scope);
    const full = isFullScope(opts.scope);
    if (full) await deleteIfUnreferenced(tx, source.id);
    return { persona, personaCreated: created, ...moved, deletedCharacter: full };
}

/**
 * NPC voice → new character. The owner defaults to the player who voiced
 * most of its lines (usually the GM). Its lines move back to the new
 * character with no persona, and the NPC persona is deleted.
 */
export async function promoteNpcTx(tx: Tx, personaId: number, opts: { ownerId?: number; name?: string; slug?: string } = {}) {
    const persona = await getNpcPersonaOrThrow(tx, personaId);

    let ownerId = opts.ownerId;
    if (ownerId === undefined) {
        const [top] = await tx.message.groupBy({
            by: ["playerId"],
            where: { personaId },
            _count: { _all: true },
            orderBy: { _count: { playerId: "desc" } },
            take: 1,
        });
        if (!top) throw new SpeakerError("This NPC has no lines, so ownerId is required");
        ownerId = top.playerId;
    } else if (!(await tx.user.findUnique({ where: { id: ownerId } }))) {
        throw new SpeakerError(`User with id '${ownerId}' not found`, 404);
    }

    const name = opts.name?.trim() || persona.name!;
    const slug = opts.slug ?? slugify(name);
    if (!isValidSlug(slug)) throw new SpeakerError(`'${slug}' isn't a valid slug; pass one`);
    if (await tx.character.findUnique({ where: { slug } })) {
        throw new SpeakerError(`A character with slug '${slug}' already exists`, 409);
    }

    const character = await tx.character.create({
        data: { name, slug, creatorId: ownerId, image: persona.image, color: persona.color },
    });
    const { count: messages } = await tx.message.updateMany({
        where: { personaId },
        data: { characterId: character.id, personaId: null },
    });
    await tx.persona.delete({ where: { id: personaId } });
    return { character, messages };
}

/**
 * Moves the source character's lines onto the target character.
 *   - plain merge: the lines show the target's canonical name. Any persona
 *     stamped on the moved lines is cleared, since it belonged to the source.
 *   - asPersona: the lines are stamped with a persona of the target named
 *     after the source (found or created), so they keep reading as before.
 * A full move then deletes the source character.
 */
export async function mergeIntoTx(tx: Tx, sourceId: number, targetId: number, opts: { asPersona?: boolean; scope?: SpeakerScope } = {}) {
    if (sourceId === targetId) throw new SpeakerError("A character can't merge into itself");
    const source = await getCharacterOrThrow(tx, sourceId);
    const target = await getCharacterOrThrow(tx, targetId);

    let persona = null;
    let personaCreated = false;
    if (opts.asPersona) {
        persona = await tx.persona.findUnique({ where: { characterId_name: { characterId: target.id, name: source.name } } });
        if (!persona) {
            const slug = `${slugify(target.name)}_${slugify(source.name)}`;
            const slugTaken = await tx.persona.findUnique({ where: { slug } });
            persona = await tx.persona.create({
                data: { characterId: target.id, name: source.name, slug: slugTaken ? null : slug, image: source.image, color: source.color },
            });
            personaCreated = true;
        }
    }

    const moved = await moveVoice(
        tx,
        source.id,
        { characterId: target.id, personaId: persona?.id ?? null, speaker: opts.asPersona ? source.name : undefined },
        opts.scope
    );
    const full = isFullScope(opts.scope);
    if (full) await deleteIfUnreferenced(tx, source.id);
    return { target, persona, personaCreated, ...moved, deletedCharacter: full };
}

/**
 * Renames a character and/or changes its slug. Pre-go-live only: once the
 * site is public, slugs are permanent identities. Persona slugs derived from
 * the old name are left alone (they never cascade).
 */
export async function renameCharacterTx(tx: Tx, characterId: number, data: { name?: string; slug?: string }) {
    const name = data.name?.trim();
    const slug = data.slug;
    if (!name && !slug) throw new SpeakerError("Pass a new name and/or slug");
    if (slug !== undefined && !isValidSlug(slug)) throw new SpeakerError(`'${slug}' isn't a valid slug`);
    await getCharacterOrThrow(tx, characterId);
    if (slug) {
        const clash = await tx.character.findUnique({ where: { slug } });
        if (clash && clash.id !== characterId) throw new SpeakerError(`A character with slug '${slug}' already exists`, 409);
    }
    return tx.character.update({ where: { id: characterId }, data: { name, slug } });
}

/** Deletes a character with no lines anywhere in the archive. */
export async function deleteUnusedCharacterTx(tx: Tx, characterId: number) {
    await getCharacterOrThrow(tx, characterId);
    await deleteIfUnreferenced(tx, characterId);
}

/** Admin "create an NPC voice" (for per-line reassignment before any line uses it). */
async function createNpcPersona(data: { name: string; image?: string; color?: string }) {
    return prisma.$transaction((tx) => findOrCreateNpcPersona(tx, data.name, data), TX_OPTIONS);
}

// Each operation on its own transaction, for the admin endpoints. The *Tx
// variants above let the seed script run a whole spreadsheet in one.
type Rest<F> = F extends (tx: Tx, ...rest: infer R) => unknown ? R : never;
function inTransaction<F extends (tx: Tx, ...rest: any[]) => Promise<unknown>>(fn: F) {
    return (...args: Rest<F>) => prisma.$transaction((tx) => fn(tx, ...args), TX_OPTIONS) as ReturnType<F>;
}

export default {
    demoteToNpc: inTransaction(demoteToNpcTx),
    promoteNpc: inTransaction(promoteNpcTx),
    mergeInto: inTransaction(mergeIntoTx),
    renameCharacter: inTransaction(renameCharacterTx),
    deleteUnusedCharacter: inTransaction(deleteUnusedCharacterTx),
    createNpcPersona,
};
