/**
 * Admin data fixes that run through runJob, so each one is a row in the
 * /admin page's History (who, when, a summary, and a log of every change with
 * its before and after values). One transaction each; a dry run rolls back.
 * Everything writes through ctx.tx: helpers on the global client would escape
 * the transaction and survive a rollback.
 */
import { MessageType, Prisma } from "@prisma/client";
import type { JobContext, Tx } from "../jobs/runner.js";
import { deleteNpcPersonasIfUnused, findOrCreateNpcPersona } from "../speaker/speaker.service.js";

/** Job names in the History table */
export const MESSAGE_REASSIGN_JOB = "message-reassign";
export const OWNER_CHANGE_JOB = "owner-change";

export type ReassignInput = {
    episodeTitle: string;
    messageNos: number[];
    /** The new voice: a character (optionally as one of its personas), an NPC persona, or a new NPC voice by name */
    characterId: number | null;
    personaId: number | null;
    newNpcName?: string;
};

export function parseReassign(body: any): ReassignInput {
    const episodeTitle = typeof body?.episodeTitle === "string" ? body.episodeTitle : "";
    if (!episodeTitle) throw new Error("episodeTitle is required");
    const messageNos = Array.isArray(body?.messageNos) ? body.messageNos : [];
    if (messageNos.length === 0 || messageNos.length > 500 || !messageNos.every((n: unknown) => Number.isInteger(n) && (n as number) > 0)) {
        throw new Error("messageNos must be 1 to 500 message numbers");
    }
    const id = (v: unknown) => (v === null || v === undefined ? null : Number.isInteger(v) ? (v as number) : NaN);
    const characterId = id(body?.characterId);
    const personaId = id(body?.personaId);
    if (Number.isNaN(characterId) || Number.isNaN(personaId)) throw new Error("characterId and personaId must be ids or null");
    const newNpcName = typeof body?.newNpcName === "string" && body.newNpcName.trim() ? body.newNpcName.trim() : undefined;
    if (newNpcName && (characterId !== null || personaId !== null)) throw new Error("A new NPC voice can't also have a character or persona");
    return { episodeTitle, messageNos: [...new Set<number>(messageNos)].sort((a, b) => a - b), characterId, personaId, newNpcName };
}

type Voice = { character: { name: string } | null; persona: { name: string | null; label: string | null } | null };

function voiceName(v: Voice): string {
    const persona = v.persona ? v.persona.name ?? v.persona.label ?? "unnamed persona" : null;
    if (v.character) return persona ? `${v.character.name} (as ${persona})` : v.character.name;
    return persona ? `NPC ${persona}` : "no speaker";
}

/** Moves transcript lines to another voice. Text, type, player and time never change. */
export async function reassignMessages(input: ReassignInput, { tx, log }: JobContext): Promise<string> {
    let { characterId, personaId } = input;
    if (input.newNpcName) {
        const { persona, created } = await findOrCreateNpcPersona(tx, input.newNpcName);
        personaId = persona.id;
        log(created ? `Created NPC voice '${persona.name}' (#${persona.id})` : `Using existing NPC voice '${persona.name}' (#${persona.id})`);
    }
    if (characterId !== null && !(await tx.character.findUnique({ where: { id: characterId }, select: { id: true } }))) {
        throw new Error(`Character with id '${characterId}' not found`);
    }
    if (personaId !== null) {
        const persona = await tx.persona.findUnique({ where: { id: personaId } });
        if (!persona) throw new Error(`Persona with id '${personaId}' not found`);
        if ((persona.characterId ?? null) !== characterId) {
            throw new Error(
                persona.characterId === null
                    ? `Persona '${persona.name}' is an NPC voice, so the lines can't also have a character`
                    : `Persona with id '${personaId}' doesn't belong to that character`
            );
        }
    }

    const include = { character: { select: { name: true } }, persona: { select: { name: true, label: true } } } as const;
    const messages = await tx.message.findMany({
        where: { episodeTitle: input.episodeTitle, messageNo: { in: input.messageNos } },
        include,
        orderBy: { messageNo: "asc" },
    });
    const missing = input.messageNos.filter((n) => !messages.some((m) => m.messageNo === n));
    if (missing.length) throw new Error(`Episode '${input.episodeTitle}' has no line(s) ${missing.join(", ")}`);

    let changed = 0;
    let newName = "";
    for (const m of messages) {
        if (m.type === MessageType.QUOTE && characterId === null && personaId === null) {
            throw new Error(`Line ${m.messageNo} is a quote, so it needs a speaker`);
        }
        if (m.characterId === characterId && m.personaId === personaId) {
            log(`line ${m.messageNo}: already ${voiceName(m)}`);
            continue;
        }
        // characterId and personaId in one write: the persona-match trigger checks the pair
        const updated = await tx.message.update({
            where: { episodeTitle_messageNo: { episodeTitle: m.episodeTitle, messageNo: m.messageNo } },
            data: { characterId, personaId },
            include,
        });
        newName = voiceName(updated);
        log(`line ${m.messageNo}: ${voiceName(m)} -> ${newName}`);
        changed += 1;
    }
    return changed === 0
        ? `No change: ${messages.length} line(s) of ${input.episodeTitle} already had that speaker`
        : `${input.episodeTitle}: ${changed} line(s) now spoken by ${newName}`;
}

export type OwnerKind = "character" | "item" | "story";
export type OwnerInput = { kind: OwnerKind; id: number; userIds: number[] };

export function parseOwner(body: any): OwnerInput {
    const kind = body?.kind;
    if (kind !== "character" && kind !== "item" && kind !== "story") throw new Error("kind must be character, item or story");
    const id = body?.id;
    if (!Number.isInteger(id)) throw new Error("id is required");
    const userIds = Array.isArray(body?.userIds) ? [...new Set<number>(body.userIds)] : [];
    if (userIds.length === 0 || !userIds.every((u) => Number.isInteger(u))) throw new Error("userIds must list at least one user id");
    if (kind !== "story" && userIds.length !== 1) throw new Error(`${kind === "item" ? "An item" : "A character"} has exactly one owner`);
    return { kind, id, userIds };
}

async function usernames(tx: Tx, ids: number[]): Promise<string[]> {
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } });
    const missing = ids.filter((id) => !users.some((u) => u.id === id));
    if (missing.length) throw new Error(`No user with id ${missing.join(", ")}`);
    return ids.map((id) => users.find((u) => u.id === id)!.username);
}

/** Changes who a character or item belongs to ("played by" / creator), or a story's authors. */
export async function changeOwner(input: OwnerInput, { tx, log }: JobContext): Promise<string> {
    const next = await usernames(tx, input.userIds);
    if (input.kind === "story") {
        const story = await tx.story.findUnique({ where: { id: input.id }, include: { authors: { select: { username: true } } } });
        if (!story) throw new Error(`Story with id '${input.id}' not found`);
        const before = story.authors.map((a) => a.username);
        await tx.story.update({ where: { id: input.id }, data: { authors: { set: input.userIds.map((id) => ({ id })) } } });
        log(`story '${story.title}' (#${story.id}) authors: ${before.join(", ") || "none"} -> ${next.join(", ")}`);
        return `Story '${story.title}' now by ${next.join(", ")}`;
    }

    const userId = input.userIds[0];
    if (input.kind === "character") {
        const character = await tx.character.findUnique({ where: { id: input.id }, include: { creator: { select: { username: true } } } });
        if (!character) throw new Error(`Character with id '${input.id}' not found`);
        try {
            await tx.character.update({ where: { id: input.id }, data: { creatorId: userId } });
        } catch (error) {
            // characters are unique per (creator, name)
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new Error(`${next[0]} already has a character named '${character.name}'`);
            }
            throw error;
        }
        log(`character '${character.name}' (#${character.id}) played by: ${character.creator.username} -> ${next[0]}`);
        return `Character '${character.name}' now played by ${next[0]}`;
    }

    const item = await tx.item.findUnique({ where: { id: input.id }, include: { creator: { select: { username: true } } } });
    if (!item) throw new Error(`Item with id '${input.id}' not found`);
    await tx.item.update({ where: { id: input.id }, data: { creatorId: userId } });
    log(`item '${item.name}' (#${item.id}) owner: ${item.creator.username} -> ${next[0]}`);
    return `Item '${item.name}' now owned by ${next[0]}`;
}

// --- Story voices: who speaks story lines and in-paragraph quotes ---------

export const STORY_VOICE_JOB = "story-voice-fix";
/** An admin linking NPC quotes to a character from the story reader (PATCH /stories/:slug/voices) */
export const STORY_VOICE_NAME_JOB = "story-voice-name";

/**
 * A voice in a story, the same rule as a message: a character (optionally as
 * one of its personas), or an NPC persona alone. `{speaker: name}` names an
 * NPC persona (as `from` it must exist; as `to` it's created if needed).
 * As `from`, a character without a persona matches all of its lines,
 * whatever persona they show.
 */
export type VoiceRef = { characterId: number; personaId?: number | null } | { personaId: number } | { speaker: string };

export type StoryVoiceInput = {
    from: VoiceRef;
    to: VoiceRef;
    /** Story slugs; empty means every story (narrowed by seasons if given) */
    stories: string[];
    /** Season slugs: stories filed under these campaigns */
    seasons: string[];
};

function parseVoice(v: any, label: string): VoiceRef {
    const personaId = v?.personaId ?? null;
    if (personaId !== null && !Number.isInteger(personaId)) throw new Error(`${label}: personaId must be an id`);
    if (Number.isInteger(v?.characterId)) return { characterId: v.characterId, personaId };
    if (personaId !== null) return { personaId };
    if (typeof v?.speaker === "string" && v.speaker.trim()) {
        const speaker = v.speaker.trim();
        if (speaker.length > 100) throw new Error(`${label}: names are at most 100 characters`);
        return { speaker };
    }
    throw new Error(`${label} must be {characterId, personaId?}, {personaId} (an NPC) or {speaker} (an NPC by name)`);
}

export function parseStoryVoice(body: any): StoryVoiceInput {
    const slugs = (v: unknown, label: string) => {
        if (v === undefined || v === null) return [];
        if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw new Error(`${label} must be a list of slugs`);
        return [...new Set(v.map((s: string) => s.trim().toLowerCase()).filter(Boolean))];
    };
    return {
        from: parseVoice(body?.from, "from"),
        to: parseVoice(body?.to, "to"),
        stories: slugs(body?.stories, "stories"),
        seasons: slugs(body?.seasons, "seasons"),
    };
}

/** A VoiceRef resolved to ids. `anyPersona`: a `from` character with no persona given matches all its lines. */
type ResolvedVoice = { characterId: number | null; personaId: number | null; anyPersona: boolean; name: string };

async function resolveVoice(tx: Tx, v: VoiceRef, role: "from" | "to", log: (line: string) => void): Promise<ResolvedVoice> {
    if ("speaker" in v) {
        if (role === "to") {
            const { persona, created } = await findOrCreateNpcPersona(tx, v.speaker);
            if (created) log(`Created NPC voice '${persona.name}' (#${persona.id})`);
            return { characterId: null, personaId: persona.id, anyPersona: false, name: `NPC ${persona.name}` };
        }
        const persona = await tx.persona.findFirst({ where: { characterId: null, name: { equals: v.speaker, mode: "insensitive" } } });
        if (!persona) throw new Error(`No NPC voice named '${v.speaker}'`);
        return { characterId: null, personaId: persona.id, anyPersona: false, name: `NPC ${persona.name}` };
    }
    const personaId = v.personaId ?? null;
    const persona = personaId === null ? null : await tx.persona.findUnique({ where: { id: personaId } });
    if (personaId !== null && !persona) throw new Error(`Persona with id '${personaId}' not found`);
    const characterId = "characterId" in v ? v.characterId : (persona!.characterId ?? null);
    const character = characterId === null ? null : await tx.character.findUnique({ where: { id: characterId }, select: { name: true } });
    if (characterId !== null && !character) throw new Error(`Character with id '${characterId}' not found`);
    if (persona && (persona.characterId ?? null) !== characterId) throw new Error(`Persona with id '${personaId}' doesn't belong to that character`);
    return { characterId, personaId, anyPersona: role === "from" && characterId !== null && personaId === null, name: voiceName({ character, persona }) };
}

/**
 * Moves story dialogue from one voice to another, in the stories in scope:
 * whole lines and in-paragraph quotes. Text never changes. An NPC persona
 * left with no lines anywhere is deleted. The log keeps every changed line's
 * before-values, standing in for a dump. Transcript messages aren't touched
 * (the attribution control and merge do those).
 */
export async function reassignStoryVoices(input: StoryVoiceInput, { tx, log }: JobContext): Promise<string> {
    const from = await resolveVoice(tx, input.from, "from", log);
    const to = await resolveVoice(tx, input.to, "to", log);
    if (from.characterId === to.characterId && (from.anyPersona ? to.personaId === null : from.personaId === to.personaId)) {
        throw new Error("from and to are the same voice");
    }

    // Stories in scope
    const storyWhere: Prisma.StoryWhereInput = {};
    if (input.stories.length) {
        const found = await tx.story.findMany({ where: { slug: { in: input.stories } }, select: { slug: true } });
        const unknown = input.stories.filter((s) => !found.some((f) => f.slug === s));
        if (unknown.length) throw new Error(`Unknown story slug(s): ${unknown.join(", ")}`);
        storyWhere.slug = { in: input.stories };
    }
    if (input.seasons.length) {
        const found = await tx.season.findMany({ where: { slug: { in: input.seasons } }, select: { slug: true, title: true } });
        const unknown = input.seasons.filter((s) => !found.some((f) => f.slug === s));
        if (unknown.length) throw new Error(`Unknown season slug(s): ${unknown.join(", ")}`);
        storyWhere.seasonTitle = { in: found.map((f) => f.title) };
    }

    const voiceWhere = { characterId: from.characterId, ...(from.anyPersona ? {} : { personaId: from.personaId }) };
    const lines = await tx.storyLine.findMany({
        where: { chapter: { story: storyWhere }, OR: [voiceWhere, { segments: { some: voiceWhere } }] },
        select: {
            id: true,
            line_no: true,
            characterId: true,
            personaId: true,
            segments: { where: voiceWhere, select: { id: true, position: true, characterId: true, personaId: true } },
            chapter: { select: { chapter_no: true, story: { select: { title: true } } } },
        },
        orderBy: [{ chapterId: "asc" }, { line_no: "asc" }],
    });

    const data = { characterId: to.characterId, personaId: to.personaId };
    const released = new Set<number>();
    const perStory = new Map<string, { lines: number; segments: number }>();
    let wholeLines = 0;
    let segmentCount = 0;
    // Per-line detail goes after the per-story totals, so the log reads top-down
    const details: string[] = [];
    for (const line of lines) {
        const lineHit = line.characterId === from.characterId && (from.anyPersona || line.personaId === from.personaId);
        const before: Record<string, unknown> = {};
        if (lineHit) {
            Object.assign(before, { characterId: line.characterId, personaId: line.personaId });
            if (line.personaId !== null) released.add(line.personaId);
            await tx.storyLine.update({ where: { id: line.id }, data });
        }
        if (line.segments.length) {
            before.segments = line.segments.map(({ position, characterId, personaId }) => ({ position, characterId, personaId }));
            line.segments.forEach((seg) => seg.personaId !== null && released.add(seg.personaId));
            await tx.storySegment.updateMany({ where: { id: { in: line.segments.map((seg) => seg.id) } }, data });
        }
        const hits = line.segments.length;
        const tally = perStory.get(line.chapter.story.title) ?? { lines: 0, segments: 0 };
        if (lineHit) {
            tally.lines += 1;
            wholeLines += 1;
        }
        tally.segments += hits;
        segmentCount += hits;
        perStory.set(line.chapter.story.title, tally);
        details.push(`${line.chapter.story.title}, ch. ${line.chapter.chapter_no}, line ${line.line_no}: ${lineHit ? "whole line" : `${hits} quote(s)`}; before ${JSON.stringify(before)}`);
    }

    if (perStory.size === 0) {
        return `No story lines in scope are spoken by ${from.name}`;
    }
    log("Per story:");
    for (const [title, t] of perStory) log(`  ${title}: ${t.lines} whole line(s), ${t.segments} in-paragraph quote(s)`);
    if (from.characterId !== null) {
        const messages = await tx.message.count({ where: { characterId: from.characterId } });
        if (messages) log(`(${from.name} also speaks ${messages} transcript line(s); those are unchanged)`);
    }
    if (to.personaId !== null) released.delete(to.personaId);
    const deleted = await deleteNpcPersonasIfUnused(tx, released);
    if (deleted.length) log(`Deleted NPC voice(s) no line uses any more: ${deleted.join(", ")}`);
    log("");
    log("Each line changed, with its values before:");
    details.forEach((d) => log(d));
    return `${from.name} -> ${to.name}: ${wholeLines} whole line(s) and ${segmentCount} quote(s) in ${perStory.size} stor${perStory.size === 1 ? "y" : "ies"}`;
}
