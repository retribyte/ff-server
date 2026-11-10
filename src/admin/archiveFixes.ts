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
