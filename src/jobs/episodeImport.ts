import { prisma } from "../db.js";
import { slugify } from "../utils/slug.js";
import { ImportConflictError } from "../utils/import.js";
import { findOrCreateNpcPersona } from "../speaker/speaker.service.js";
import { importEpisodeTx, validateEpisodeImport } from "../episode/episode.service.js";
import type { MessageData } from "../message/message.service.js";
import type { JobContext, Tx } from "./runner.js";

// One episode as md-to-api.py writes it (archive-to-markdown/api/<season>/*.json):
// speakers by name, resolved here the same way api-import.py does.
export type ImportMessage = {
    player: string;
    character?: string | null;
    persona?: string | null;
    timestamp?: string | null;
    type: string;
    text: string;
};
export type ImportPayload = {
    seasonTitle: string;
    episode: {
        title: string;
        episode_no: number;
        summary?: string | null;
        playedDate?: string | null;
        reconstructed?: boolean;
        slug?: string;
    };
    messages: ImportMessage[];
};

export type EpisodePlan = {
    title: string;
    seasonTitle: string;
    episodeNo: number;
    reconstructed: boolean;
    messages: number;
    newSeason: boolean;
    /** Why this episode can't be imported (already in the archive, a duplicate in the batch) */
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

const isStr = (v: unknown): v is string => typeof v === "string";

/** Checks the request body's shape: { episodes: ImportPayload[] }. Throws a 400-worthy Error. */
export function parsePayloads(body: unknown): ImportPayload[] {
    const episodes = (body as { episodes?: unknown })?.episodes;
    if (!Array.isArray(episodes) || episodes.length === 0) throw new Error("episodes must be a non-empty array");
    episodes.forEach((p: any, i) => {
        const where = `Episode ${i + 1}`;
        if (!p || !isStr(p.seasonTitle) || !p.seasonTitle) throw new Error(`${where}: seasonTitle is required`);
        if (!p.episode || !isStr(p.episode.title) || !p.episode.title) throw new Error(`${where}: episode.title is required`);
        if (!Number.isInteger(p.episode.episode_no)) throw new Error(`${where}: episode.episode_no must be an integer`);
        if (!Array.isArray(p.messages) || p.messages.length === 0) throw new Error(`${where}: messages must be a non-empty array`);
        p.messages.forEach((m: any, j: number) => {
            if (!m || !isStr(m.player) || !isStr(m.type) || !isStr(m.text)) {
                throw new Error(`${where}, message ${j + 1}: player, type and text are required`);
            }
        });
    });
    return episodes as ImportPayload[];
}

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
        const slug = p.episode.slug ?? slugify(title);
        const conflicts: string[] = [];
        const [byTitle, bySlug, byNumber] = await Promise.all([
            tx.episode.findUnique({ where: { title }, select: { title: true } }),
            tx.episode.findUnique({ where: { slug }, select: { title: true } }),
            tx.episode.findUnique({
                where: { seasonTitle_episode_no: { seasonTitle: p.seasonTitle, episode_no } },
                select: { title: true },
            }),
        ]);
        if (byTitle) conflicts.push("already in the archive");
        else if (bySlug) conflicts.push(`'${bySlug.title}' already uses the slug '${slug}'`);
        if (byNumber && byNumber.title !== title) conflicts.push(`${p.seasonTitle} #${episode_no} is '${byNumber.title}'`);
        const numberKey = `${p.seasonTitle}#${episode_no}`;
        if (seenTitles.has(title)) conflicts.push("this title is in the batch twice");
        if (seenNumbers.has(numberKey)) conflicts.push(`${p.seasonTitle} #${episode_no} is in the batch twice`);
        seenTitles.add(title);
        seenNumbers.add(numberKey);
        episodes.push({
            title,
            seasonTitle: p.seasonTitle,
            episodeNo: episode_no,
            reconstructed: Boolean(p.episode.reconstructed),
            messages: p.messages.length,
            newSeason: !seasons.has(p.seasonTitle),
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

/** What an import of these episodes would do, without writing anything. */
export async function previewEpisodeImport(payloads: ImportPayload[]): Promise<ImportPlan> {
    const r = await Resolver.load(prisma, payloads);
    return await plan(prisma, payloads, r);
}

/**
 * Imports every episode in the batch in the job's one transaction: creates the
 * new NPC voices and personas, then each episode with its messages. Refuses the
 * whole batch if a player has no account or any episode conflicts.
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
    for (const payload of payloads) {
        const messages: MessageData[] = payload.messages.map((m) => {
            const [characterId, personaId] = r.resolve(m.character, m.persona);
            return {
                playerId: r.users.get(m.player)!,
                characterId,
                personaId,
                timestamp: m.timestamp ?? null,
                // a QUOTE needs a voice: a character or an NPC persona
                type: (m.type === "QUOTE" && characterId === null && personaId === null ? "OTHER" : m.type) as MessageData["type"],
                text: m.text,
            };
        });
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
        log(`imported ${payload.seasonTitle} #${payload.episode.episode_no} '${payload.episode.title}': ${messages.length} messages`);
        total += messages.length;
    }
    const n = payloads.length;
    return `${n} episode${n === 1 ? "" : "s"}, ${total} messages`;
}
