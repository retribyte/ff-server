/**
 * Admin data fixes that run through runJob, so each one is a row in the
 * /admin page's History (who, when, a summary, and a log of every change with
 * its before and after values). One transaction each; a dry run rolls back.
 * Everything writes through ctx.tx: helpers on the global client would escape
 * the transaction and survive a rollback.
 */
import { MessageType, Prisma } from "@prisma/client";
import type { JobContext, Tx } from "../jobs/runner.js";
import { findOrCreateNpcPersona } from "../speaker/speaker.service.js";

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

/** A voice in a story: a Character, or plain speaker text (a name with no Character row) */
export type VoiceRef = { characterId: number } | { speaker: string };

export type StoryVoiceInput = {
    from: VoiceRef;
    to: VoiceRef;
    /** Story slugs; empty means every story (narrowed by seasons if given) */
    stories: string[];
    /** Season slugs: stories filed under these campaigns */
    seasons: string[];
};

function parseVoice(v: any, label: string): VoiceRef {
    if (Number.isInteger(v?.characterId)) return { characterId: v.characterId };
    if (typeof v?.speaker === "string" && v.speaker.trim()) {
        const speaker = v.speaker.trim();
        if (speaker.length > 100) throw new Error(`${label}: names are at most 100 characters`);
        return { speaker };
    }
    throw new Error(`${label} must be {characterId} or {speaker}`);
}

export function parseStoryVoice(body: any): StoryVoiceInput {
    const slugs = (v: unknown, label: string) => {
        if (v === undefined || v === null) return [];
        if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw new Error(`${label} must be a list of slugs`);
        return [...new Set(v.map((s: string) => s.trim().toLowerCase()).filter(Boolean))];
    };
    const input = {
        from: parseVoice(body?.from, "from"),
        to: parseVoice(body?.to, "to"),
        stories: slugs(body?.stories, "stories"),
        seasons: slugs(body?.seasons, "seasons"),
    };
    const same =
        ("characterId" in input.from && "characterId" in input.to && input.from.characterId === input.to.characterId) ||
        ("speaker" in input.from && "speaker" in input.to && input.from.speaker === input.to.speaker);
    if (same) throw new Error("from and to are the same voice");
    return input;
}

type Segment = { text: string; characterId?: number | null; speaker?: string | null; npc?: boolean; [key: string]: unknown };

/**
 * Moves story dialogue from one voice to another, in the stories in scope:
 * whole lines (characterId / speaker) and in-paragraph quotes (the segments
 * JSON, which has no FK). Moving to a character clears the speaker text and
 * the NPC flag; moving to plain text clears the character and keeps the flag.
 * The log keeps every changed line's before-values, standing in for a dump.
 * Transcript messages aren't touched (the attribution control and merge do those).
 */
export async function reassignStoryVoices(input: StoryVoiceInput, { tx, log }: JobContext): Promise<string> {
    const names = new Map<number, string>();
    const describe = async (v: VoiceRef) => {
        if ("speaker" in v) return `"${v.speaker}"`;
        const c = await tx.character.findUnique({ where: { id: v.characterId }, select: { name: true } });
        if (!c) throw new Error(`Character with id '${v.characterId}' not found`);
        names.set(v.characterId, c.name);
        return c.name;
    };
    const fromName = await describe(input.from);
    const toName = await describe(input.to);

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

    const matchesSegment = (seg: Segment) =>
        "characterId" in input.from
            ? seg.characterId === input.from.characterId
            : !seg.characterId && typeof seg.speaker === "string" && seg.speaker.toLowerCase() === input.from.speaker.toLowerCase();
    const lineWhere: Prisma.StoryLineWhereInput =
        "characterId" in input.from
            ? { characterId: input.from.characterId }
            : { characterId: null, speaker: { equals: input.from.speaker, mode: "insensitive" } };
    // Segment candidates: containment for a character; a text match narrowed in JS for a name
    const segmentFilter: Prisma.StoryLineWhereInput =
        "characterId" in input.from
            ? { segments: { array_contains: [{ characterId: input.from.characterId }] } }
            : { segments: { not: Prisma.AnyNull } };

    const lines = await tx.storyLine.findMany({
        where: { chapter: { story: storyWhere }, OR: [lineWhere, segmentFilter] },
        include: { chapter: { select: { chapter_no: true, story: { select: { title: true } } } } },
        orderBy: [{ chapterId: "asc" }, { line_no: "asc" }],
    });

    const perStory = new Map<string, { lines: number; segments: number }>();
    let wholeLines = 0;
    let segmentCount = 0;
    // Per-line detail goes after the per-story totals, so the log reads top-down
    const details: string[] = [];
    for (const line of lines) {
        const where = `${line.chapter.story.title}, ch. ${line.chapter.chapter_no}, line ${line.line_no}`;
        const data: Prisma.StoryLineUpdateInput = {};
        const before: Record<string, unknown> = {};
        const lineHit =
            "characterId" in input.from
                ? line.characterId === input.from.characterId
                : line.characterId === null && (line.speaker ?? "").toLowerCase() === input.from.speaker.toLowerCase();
        if (lineHit) {
            Object.assign(before, { characterId: line.characterId, speaker: line.speaker, npcVoice: line.npcVoice });
            if ("characterId" in input.to) {
                Object.assign(data, { character: { connect: { id: input.to.characterId } }, speaker: null, npcVoice: false });
            } else {
                Object.assign(data, { character: { disconnect: true }, speaker: input.to.speaker });
            }
        }
        let hits = 0;
        if (Array.isArray(line.segments)) {
            const segments = (line.segments as Segment[]).map((seg) => {
                if (!matchesSegment(seg)) return seg;
                hits += 1;
                const { characterId: _c, speaker: _s, npc, ...rest } = seg;
                return "characterId" in input.to
                    ? { ...rest, characterId: input.to.characterId }
                    : { ...rest, speaker: input.to.speaker, ...(npc ? { npc } : {}) };
            });
            if (hits) {
                before.segments = line.segments;
                data.segments = segments as Prisma.InputJsonValue;
            }
        }
        if (!lineHit && !hits) continue;
        await tx.storyLine.update({ where: { id: line.id }, data });
        const tally = perStory.get(line.chapter.story.title) ?? { lines: 0, segments: 0 };
        if (lineHit) {
            tally.lines += 1;
            wholeLines += 1;
        }
        tally.segments += hits;
        segmentCount += hits;
        perStory.set(line.chapter.story.title, tally);
        details.push(`${where}: ${lineHit ? "whole line" : `${hits} quote(s)`}; before ${JSON.stringify(before)}`);
    }

    if (perStory.size === 0) {
        return `No story lines in scope are spoken by ${fromName}`;
    }
    log("Per story:");
    for (const [title, t] of perStory) log(`  ${title}: ${t.lines} whole line(s), ${t.segments} in-paragraph quote(s)`);
    if ("characterId" in input.from) {
        const messages = await tx.message.count({ where: { characterId: input.from.characterId } });
        if (messages) log(`(${fromName} also speaks ${messages} transcript line(s); those are unchanged)`);
    }
    log("");
    log("Each line changed, with its values before:");
    details.forEach((d) => log(d));
    return `${fromName} -> ${toName}: ${wholeLines} whole line(s) and ${segmentCount} quote(s) in ${perStory.size} stor${perStory.size === 1 ? "y" : "ies"}`;
}
