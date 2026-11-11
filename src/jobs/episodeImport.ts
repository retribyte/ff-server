import { prisma } from "../db.js";
import { slugify } from "../utils/slug.js";
import { ImportConflictError } from "../utils/import.js";
import { findOrCreateNpcPersona } from "../speaker/speaker.service.js";
import { importEpisodeTx, validateEpisodeImport } from "../episode/episode.service.js";
import { insertMessages, type MessageData } from "../message/message.service.js";
import { alignMessages, alignStats, noteTargets } from "./messageAlign.js";
import type { JobContext, Tx } from "./runner.js";
import type { ImportPayload } from "./episodePayload.js";

export { parsePayloads, type ImportPayload } from "./episodePayload.js";

/** What re-importing an episode already in the archive changes. */
export type EpisodeChanges = {
    unchanged: number;
    edited: number;
    added: number;
    removed: number;
    /** commentary notes that stay on their message */
    notesKept: number;
    /** notes whose message was removed: they go to the nearest message kept */
    notesMoved: number;
    /** the old title, when the file renames the episode */
    renamedFrom: string | null;
};
export type EpisodePlan = {
    title: string;
    seasonTitle: string;
    episodeNo: number;
    reconstructed: boolean;
    messages: number;
    newSeason: boolean;
    /** new: not in the archive yet; update: replaces the episode with that number; unchanged: skipped */
    action: "new" | "update" | "unchanged";
    changes: EpisodeChanges | null;
    /** Why this episode can't be imported (its title is another episode's, a duplicate in the batch) */
    conflicts: string[];
};
export type ImportPlan = {
    episodes: EpisodePlan[];
    /** Players with no account: the import refuses them (accounts aren't made here) */
    missingPlayers: string[];
    newNpcVoices: string[];
    newPersonas: { character: string; name: string }[];
    /** Speakers matched to a character whose name differs only in case */
    caseMatches: { speaker: string; character: string }[];
    ok: boolean;
};

/** Name lookups from the database, updated as the import creates records. */
class Resolver {
    users = new Map<string, number>();
    chars = new Map<string, number>();
    personas = new Map<string, number>(); // `${characterId}:${name}` -> id
    personaByName = new Map<string, [number, number]>(); // name -> [characterId, id]
    npcs = new Map<string, number>(); // lower-case name -> NPC persona id
    caseMatches: { speaker: string; character: string }[] = [];

    static async load(tx: Tx, payloads: ImportPayload[]): Promise<Resolver> {
        const r = new Resolver();
        const [users, chars, personas] = await Promise.all([
            tx.user.findMany({ select: { id: true, username: true } }),
            tx.character.findMany({ select: { id: true, name: true } }),
            tx.persona.findMany({ where: { name: { not: null } }, select: { id: true, name: true, characterId: true } }),
        ]);
        for (const u of users) r.users.set(u.username, u.id);
        for (const c of chars) r.chars.set(c.name, c.id);
        for (const p of personas) {
            if (p.characterId === null) r.npcs.set(p.name!.toLowerCase(), p.id);
            else {
                r.personas.set(`${p.characterId}:${p.name}`, p.id);
                r.personaByName.set(p.name!, [p.characterId, p.id]);
            }
        }
        // A speaker differing from exactly one existing character only by case is that character
        const byLower = new Map<string, { name: string; id: number }[]>();
        for (const c of chars) byLower.set(c.name.toLowerCase(), [...(byLower.get(c.name.toLowerCase()) ?? []), c]);
        for (const speaker of speakers(payloads)) {
            const match = byLower.get(speaker.toLowerCase());
            if (!r.chars.has(speaker) && match?.length === 1) {
                r.chars.set(speaker, match[0].id);
                r.caseMatches.push({ speaker, character: match[0].name });
            }
        }
        return r;
    }

    /** -> [characterId, personaId]: a character line, an NPC line (null, npc), or neither (null, null). */
    resolve(char: string | null | undefined, persona: string | null | undefined): [number | null, number | null] {
        if (!char) return [null, null];
        const cid = this.chars.get(char);
        if (cid !== undefined) return [cid, persona ? this.personas.get(`${cid}:${persona}`) ?? null : null];
        const npc = this.npcs.get(char.toLowerCase());
        if (npc !== undefined) return [null, npc];
        return this.personaByName.get(char) ?? [null, null];
    }
}

function speakers(payloads: ImportPayload[]): Set<string> {
    const out = new Set<string>();
    for (const p of payloads) for (const m of p.messages) if (m.character) out.add(m.character);
    return out;
}

async function plan(tx: Tx, payloads: ImportPayload[], r: Resolver): Promise<ImportPlan> {
    const missingPlayers = [...new Set(payloads.flatMap((p) => p.messages.map((m) => m.player)))]
        .filter((name) => !r.users.has(name))
        .sort();

    const newNpcs = new Map<string, string>(); // lower-case -> first spelling seen
    const newPersonas = new Map<string, { character: string; name: string }>();
    for (const p of payloads) {
        for (const m of p.messages) {
            const c = m.character;
            if (!c) continue;
            const cid = r.chars.get(c);
            if (cid !== undefined) {
                if (m.persona && !r.personas.has(`${cid}:${m.persona}`)) {
                    newPersonas.set(`${cid}:${m.persona}`, { character: c, name: m.persona });
                }
            } else if (!r.personaByName.has(c) && !r.npcs.has(c.toLowerCase()) && !newNpcs.has(c.toLowerCase())) {
                newNpcs.set(c.toLowerCase(), c);
            }
        }
    }

    const seasons = new Set((await tx.season.findMany({ select: { title: true } })).map((s) => s.title));
    const seenTitles = new Set<string>();
    const seenNumbers = new Set<string>();
    const episodes: EpisodePlan[] = [];
    for (const p of payloads) {
        const { title, episode_no } = p.episode;
        const conflicts: string[] = [];
        const existing = await loadExisting(tx, p.seasonTitle, episode_no);
        const slug = episodeSlug(p, existing);
        const [byTitle, bySlug] = await Promise.all([
            tx.episode.findUnique({ where: { title }, select: { title: true, seasonTitle: true, episode_no: true } }),
            tx.episode.findUnique({ where: { slug }, select: { title: true } }),
        ]);
        const other = (e: { title: string } | null) => e !== null && e.title !== existing?.title;
        if (other(byTitle)) {
            conflicts.push(
                existing
                    ? `the title is already ${byTitle!.seasonTitle} #${byTitle!.episode_no}'s`
                    : `already in the archive as ${byTitle!.seasonTitle} #${byTitle!.episode_no} (moving an episode to a new number isn't supported)`
            );
        } else if (other(bySlug)) conflicts.push(`'${bySlug!.title}' already uses the slug '${slug}'`);
        const numberKey = `${p.seasonTitle}#${episode_no}`;
        if (seenTitles.has(title)) conflicts.push("this title is in the batch twice");
        if (seenNumbers.has(numberKey)) conflicts.push(`${p.seasonTitle} #${episode_no} is in the batch twice`);
        seenTitles.add(title);
        seenNumbers.add(numberKey);

        let action: EpisodePlan["action"] = "new";
        let changes: EpisodeChanges | null = null;
        if (existing) {
            const r2 = replacement(existing, p, r);
            changes = r2.changes;
            action = r2.same && sameDetails(existing, p, slug) ? "unchanged" : "update";
        }
        episodes.push({
            title,
            seasonTitle: p.seasonTitle,
            episodeNo: episode_no,
            reconstructed: Boolean(p.episode.reconstructed),
            messages: p.messages.length,
            newSeason: !seasons.has(p.seasonTitle),
            action,
            changes,
            conflicts,
        });
    }

    return {
        episodes,
        missingPlayers,
        newNpcVoices: [...newNpcs.values()].sort((a, b) => a.localeCompare(b)),
        newPersonas: [...newPersonas.values()],
        caseMatches: r.caseMatches,
        ok: missingPlayers.length === 0 && episodes.every((e) => e.conflicts.length === 0),
    };
}

type Existing = {
    title: string;
    slug: string;
    summary: string | null;
    playedDate: Date | null;
    reconstructed: boolean;
    messages: {
        messageNo: number;
        playerId: number;
        characterId: number | null;
        personaId: number | null;
        timestamp: Date | null;
        type: string;
        text: string;
    }[];
    notes: { id: number; creatorId: number; messageNo: number; content: string }[];
};

/** The episode with this number, its messages in order and its commentary notes; null if there's none. */
async function loadExisting(tx: Tx, seasonTitle: string, episode_no: number): Promise<Existing | null> {
    const episode = await tx.episode.findUnique({
        where: { seasonTitle_episode_no: { seasonTitle, episode_no } },
        select: { title: true, slug: true, summary: true, playedDate: true, reconstructed: true },
    });
    if (!episode) return null;
    const [messages, notes] = await Promise.all([
        tx.message.findMany({
            where: { episodeTitle: episode.title },
            orderBy: { messageNo: "asc" },
            select: { messageNo: true, playerId: true, characterId: true, personaId: true, timestamp: true, type: true, text: true },
        }),
        tx.commentary.findMany({
            where: { messageEpisodeTitle: episode.title },
            orderBy: { id: "asc" },
            select: { id: true, creatorId: true, messageNo: true, content: true },
        }),
    ]);
    // a note on a message always has its messageNo (the commentaries_one_target check)
    return { ...episode, messages, notes: notes.map((n) => ({ ...n, messageNo: n.messageNo! })) };
}

/** An existing episode keeps its slug (links to it keep working) unless the file renames it or names one. */
function episodeSlug(p: ImportPayload, existing: Existing | null): string {
    if (p.episode.slug) return p.episode.slug;
    return existing && existing.title === p.episode.title ? existing.slug : slugify(p.episode.title);
}

/** The file wins; an empty summary or date in it leaves the stored one alone. */
function episodeDetails(p: ImportPayload, existing: Existing | null, slug: string) {
    return {
        title: p.episode.title,
        slug,
        summary: p.episode.summary ?? existing?.summary ?? null,
        playedDate: p.episode.playedDate ? new Date(p.episode.playedDate) : existing?.playedDate ?? null,
        reconstructed: Boolean(p.episode.reconstructed),
    };
}

function sameDetails(existing: Existing, p: ImportPayload, slug: string): boolean {
    const d = episodeDetails(p, existing, slug);
    return (
        d.title === existing.title &&
        d.slug === existing.slug &&
        d.summary === existing.summary &&
        d.playedDate?.getTime() === existing.playedDate?.getTime() &&
        d.reconstructed === existing.reconstructed
    );
}

/** A payload's messages with speakers resolved to ids; `personaGiven` marks lines whose file names a persona. */
function toMessages(p: ImportPayload, r: Resolver): { messages: MessageData[]; personaGiven: boolean[] } {
    const messages = p.messages.map((m) => {
        const [characterId, personaId] = r.resolve(m.character, m.persona);
        return {
            playerId: r.users.get(m.player) ?? 0,
            characterId,
            personaId,
            timestamp: m.timestamp ?? null,
            // a QUOTE needs a voice: a character or an NPC persona
            type: (m.type === "QUOTE" && characterId === null && personaId === null ? "OTHER" : m.type) as MessageData["type"],
            text: m.text,
        };
    });
    return { messages, personaGiven: p.messages.map((m) => Boolean(m.persona)) };
}

type KeyFields = {
    playerId: number;
    characterId?: number | null;
    personaId?: number | null;
    type: string;
    text: string;
};

/**
 * What identifies a message across a re-import: who said what. Not when (see
 * clockOffset), and not a character's persona stamp.
 */
function messageKey(m: KeyFields): string {
    const npc = m.characterId == null ? m.personaId ?? "" : "";
    return [m.playerId, m.characterId ?? "", npc, m.type, m.text].join("\u0000");
}

/** messageKey plus the time, for telling a re-timed message from an unchanged one. */
const fullKey = (m: KeyFields & { timestamp: Date | string | null }) =>
    messageKey(m) + "\u0000" + (m.timestamp ? new Date(m.timestamp).getTime() : "");

/**
 * The file's times carry no time zone; they were stored in whatever zone the
 * importing server ran in, which needn't be this one's. The offset (ms) most
 * matched messages show between stored and file time, so a re-import keeps
 * the episode on the clock it was stored on.
 */
function clockOffset(alignment: (number | null)[], existing: Existing, messages: MessageData[]): number {
    const tally = new Map<number, number>();
    alignment.forEach((o, j) => {
        const stored = o === null ? null : existing.messages[o].timestamp;
        const file = messages[j].timestamp;
        if (!stored || !file) return;
        const d = stored.getTime() - new Date(file).getTime();
        tally.set(d, (tally.get(d) ?? 0) + 1);
    });
    let best = 0;
    let most = 0;
    for (const [d, n] of tally) if (n > most) [best, most] = [d, n];
    return best;
}

/**
 * The file's messages for an episode already in the archive, lined up with the
 * stored ones so what readers added survives: a line whose file names no
 * persona keeps the persona stamp it had (or, if it's new, the one its
 * character carried on every line of the episode), and each commentary note
 * moves to its message's new number (a removed message's notes go to the
 * nearest message kept).
 */
function replacement(existing: Existing, p: ImportPayload, r: Resolver) {
    const { messages, personaGiven } = toMessages(p, r);
    const oldKeys = existing.messages.map(messageKey);
    const newKeys = messages.map(messageKey);
    const alignment = alignMessages(oldKeys, newKeys);
    const offset = clockOffset(alignment, existing, messages);
    for (const m of messages) {
        if (m.timestamp) m.timestamp = new Date(new Date(m.timestamp).getTime() + offset).toISOString();
    }

    // a character's stamp for the whole episode: the one persona all its lines had
    const stamps = new Map<number, number | null | undefined>(); // undefined: mixed
    for (const m of existing.messages) {
        if (m.characterId === null) continue;
        const seen = stamps.get(m.characterId);
        if (!stamps.has(m.characterId)) stamps.set(m.characterId, m.personaId);
        else if (seen !== m.personaId) stamps.set(m.characterId, undefined);
    }
    messages.forEach((m, j) => {
        if (personaGiven[j] || m.characterId == null) return;
        const o = alignment[j];
        const before = o === null ? null : existing.messages[o];
        if (before && before.characterId === m.characterId) m.personaId = before.personaId;
        else m.personaId = stamps.get(m.characterId) ?? null;
    });

    const { target, moved } = noteTargets(alignment, existing.messages.length);
    const indexOf = new Map(existing.messages.map((m, k) => [m.messageNo, k]));
    const notes = existing.notes.map((n) => {
        const k = indexOf.get(n.messageNo)!;
        return { ...n, messageNo: target[k] + 1, moved: moved[k] };
    });

    // a message only re-timed counts as edited
    const stats = alignStats(alignment, existing.messages.map(fullKey), messages.map(fullKey));
    const same =
        stats.edited + stats.added + stats.removed === 0 &&
        messages.every((m, j) => (m.personaId ?? null) === existing.messages[j].personaId);
    const changes: EpisodeChanges = {
        ...stats,
        notesKept: notes.filter((n) => !n.moved).length,
        notesMoved: notes.filter((n) => n.moved).length,
        renamedFrom: existing.title === p.episode.title ? null : existing.title,
    };
    return { messages, notes, changes, same };
}

/** What an import of these episodes would do, without writing anything. */
export async function previewEpisodeImport(payloads: ImportPayload[]): Promise<ImportPlan> {
    const r = await Resolver.load(prisma, payloads);
    return await plan(prisma, payloads, r);
}

/**
 * Imports every episode in the batch in the job's one transaction: creates the
 * new NPC voices and personas, then each episode with its messages. An episode
 * whose season and number are already in the archive is updated in place
 * (see replacement()), or skipped if nothing changed. Refuses the whole batch
 * if a player has no account or any episode conflicts.
 */
export async function importEpisodes(payloads: ImportPayload[], { tx, log }: JobContext): Promise<string> {
    const r = await Resolver.load(tx, payloads);
    const p = await plan(tx, payloads, r);
    if (p.missingPlayers.length) throw new Error(`No account for player(s): ${p.missingPlayers.join(", ")}`);
    const conflicted = p.episodes.filter((e) => e.conflicts.length);
    if (conflicted.length) {
        throw new ImportConflictError(conflicted.map((e) => `'${e.title}': ${e.conflicts.join("; ")}`).join(". "));
    }
    for (const { speaker, character } of p.caseMatches) log(`'${speaker}' matched the character '${character}'`);

    for (const name of p.newNpcVoices) {
        const { persona } = await findOrCreateNpcPersona(tx, name);
        r.npcs.set(name.toLowerCase(), persona.id);
        log(`NPC voice created: ${name}`);
    }
    for (const { character, name } of p.newPersonas) {
        const cid = r.chars.get(character)!;
        const persona = await tx.persona.create({
            data: { name, characterId: cid, slug: `${slugify(character)}_${slugify(name)}` },
        });
        r.personas.set(`${cid}:${name}`, persona.id);
        log(`persona created: ${character} as ${name}`);
    }

    let total = 0;
    const counts = { new: 0, update: 0, unchanged: 0 };
    for (const payload of payloads) {
        const label = `${payload.seasonTitle} #${payload.episode.episode_no} '${payload.episode.title}'`;
        const existing = await loadExisting(tx, payload.seasonTitle, payload.episode.episode_no);
        if (!existing) {
            const { messages } = toMessages(payload, r);
            const body = {
                seasonTitle: payload.seasonTitle,
                episode: {
                    title: payload.episode.title,
                    episode_no: payload.episode.episode_no,
                    summary: payload.episode.summary ?? undefined,
                    playedDate: payload.episode.playedDate ?? undefined,
                    reconstructed: Boolean(payload.episode.reconstructed),
                    slug: payload.episode.slug,
                },
                messages,
            };
            await validateEpisodeImport(body, { checkPersonas: false });
            const created = await importEpisodeTx(tx, body);
            if (created.seasonCreated) log(`season created: ${payload.seasonTitle}`);
            log(`imported ${label}: ${messages.length} messages`);
            counts.new++;
            total += messages.length;
            continue;
        }

        const slug = episodeSlug(payload, existing);
        const { messages, notes, changes, same } = replacement(existing, payload, r);
        if (same && sameDetails(existing, payload, slug)) {
            log(`unchanged, skipped: ${label}`);
            counts.unchanged++;
            continue;
        }
        await validateEpisodeImport(
            {
                seasonTitle: payload.seasonTitle,
                episode: { title: payload.episode.title, episode_no: payload.episode.episode_no },
                messages,
            },
            { checkPersonas: false }
        );
        // notes point at messages and messages at the episode's title: clear
        // both, update the episode (it may be renamed), then put them back
        await tx.commentary.deleteMany({ where: { messageEpisodeTitle: existing.title } });
        await tx.message.deleteMany({ where: { episodeTitle: existing.title } });
        await tx.episode.update({ where: { title: existing.title }, data: episodeDetails(payload, existing, slug) });
        await insertMessages(tx, payload.episode.title, 1, messages);
        if (notes.length) {
            await tx.commentary.createMany({
                data: notes.map((n) => ({
                    id: n.id,
                    creatorId: n.creatorId,
                    messageEpisodeTitle: payload.episode.title,
                    messageNo: n.messageNo,
                    content: n.content,
                })),
            });
        }
        const c = changes;
        const parts = [`${c.edited} edited`, `${c.added} added`, `${c.removed} removed`];
        if (notes.length) parts.push(`${c.notesKept + c.notesMoved} notes kept${c.notesMoved ? ` (${c.notesMoved} moved)` : ""}`);
        if (c.renamedFrom) parts.push(`renamed from '${c.renamedFrom}'`);
        log(`updated ${label}: ${messages.length} messages; ${parts.join(", ")}`);
        counts.update++;
        total += messages.length;
    }
    const done = [
        counts.new && `${counts.new} new`,
        counts.update && `${counts.update} updated`,
        counts.unchanged && `${counts.unchanged} unchanged`,
    ].filter(Boolean);
    return `${done.join(", ")} (${total} messages written)`;
}
