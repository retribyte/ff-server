// The admin Vortox Machina import (/admin, POST /api/admin/vm-import): a
// DiscordChatExporter JSON export of #cyoa-vm in, the GM entries posted since
// the last import appended to the "vm" story's last chapter. No Discord access
// on the server: the export is the input. What it remembers between runs
// lives in app_settings ("vm-import"): the newest message it has read, and the
// voice each speaker code stands for (codes it hasn't seen are asked for in
// the preview, then remembered).

import { Prisma, StoryLineType } from "@prisma/client";
import { prisma } from "../db.js";
import { findOrCreateNpcPersona } from "../speaker/speaker.service.js";
import { storyContentHash } from "../story/story-hash.js";
import type { JobContext } from "./runner.js";
import { newEntries, snowflakeDate, type VmMessage } from "./vm-parse.js";

export const VM_IMPORT_JOB = "vm-import";
const SETTING_KEY = "vm-import";
const STORY_SLUG = "vm";

/** A code's voice: a character (by slug, optionally as one of its personas), or an NPC (null: the unnamed one). */
export type CodeVoice = { character: string; personaId?: number | null } | { npc: string | null };

export type VmState = { lastMessageId: string; speakers: Record<string, CodeVoice> };

// Where the import starts before it has ever run: the last message the CLI
// script (append-vm-from-discord.ts) appended before this existed, and its
// speaker codes. Slugs, since ids differ between databases.
const DEFAULT_STATE: VmState = {
    lastMessageId: "1567680430419742764",
    speakers: {
        E: { character: "emmett_tawfeek" },
        L: { character: "los_yelsi" },
        I: { character: "irene" },
        W: { character: "wes_romaw" },
        F: { character: "felps" },
        FP: { character: "felps" },
        S: { character: "squorchy_vurkallus" },
        "?": { npc: null },
    },
};

const UNNAMED_NPC = "Unnamed NPC";

type Db = Prisma.TransactionClient | typeof prisma;

export async function loadState(db: Db = prisma): Promise<VmState> {
    const row = await db.appSetting.findUnique({ where: { key: SETTING_KEY } });
    const value = row?.value as Partial<VmState> | undefined;
    return {
        lastMessageId: typeof value?.lastMessageId === "string" ? value.lastMessageId : DEFAULT_STATE.lastMessageId,
        speakers: { ...DEFAULT_STATE.speakers, ...(value?.speakers ?? {}) },
    };
}

/** A speaker pick as the admin page sends it: by id, as the voice options list them. */
export type SpeakerPick = { characterId: number; personaId?: number | null } | { npc: string | null };

/** The page's picks as stored voices (character ids to slugs). Throws on an unknown character or persona. */
async function picksToVoices(picks: unknown, db: Db = prisma): Promise<Record<string, CodeVoice>> {
    if (picks === undefined || picks === null) return {};
    if (typeof picks !== "object" || Array.isArray(picks)) throw new Error("speakers must be an object of code -> voice");
    const voices: Record<string, CodeVoice> = {};
    for (const [code, pick] of Object.entries(picks as Record<string, SpeakerPick>)) {
        if (!/^([A-Z][A-Z0-9]{0,2}|\?)$/.test(code)) throw new Error(`'${code}' isn't a speaker code`);
        if (pick && "npc" in pick) {
            const name = typeof pick.npc === "string" ? pick.npc.trim() : "";
            voices[code] = { npc: name || null };
            continue;
        }
        const characterId = (pick as { characterId?: unknown })?.characterId;
        if (!Number.isInteger(characterId)) throw new Error(`${code}: pick a character or an NPC`);
        const character = await db.character.findUnique({ where: { id: characterId as number }, select: { slug: true } });
        if (!character?.slug) throw new Error(`${code}: no character with id ${String(characterId)}`);
        const personaId = (pick as { personaId?: unknown }).personaId ?? null;
        if (personaId !== null) {
            const persona = await db.persona.findFirst({ where: { id: personaId as number, characterId: characterId as number } });
            if (!persona) throw new Error(`${code}: persona ${String(personaId)} isn't one of that character's`);
        }
        voices[code] = { character: character.slug, personaId: personaId as number | null };
    }
    return voices;
}

/** How a voice reads in the preview and the log. */
async function voiceLabels(speakers: Record<string, CodeVoice>, db: Db = prisma): Promise<Record<string, string>> {
    const slugs = Object.values(speakers).flatMap((v) => ("character" in v ? [v.character] : []));
    const personaIds = Object.values(speakers).flatMap((v) => ("character" in v && v.personaId ? [v.personaId] : []));
    const [characters, personas] = await Promise.all([
        db.character.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } }),
        db.persona.findMany({ where: { id: { in: personaIds } }, select: { id: true, name: true, label: true } }),
    ]);
    const nameOf = new Map(characters.map((c) => [c.slug, c.name]));
    const personaOf = new Map(personas.map((p) => [p.id, p.name ?? p.label]));
    const labels: Record<string, string> = {};
    for (const [code, v] of Object.entries(speakers)) {
        if ("npc" in v) labels[code] = v.npc ? `NPC ${v.npc}` : "an unnamed NPC";
        else {
            const name = nameOf.get(v.character) ?? `(missing character '${v.character}')`;
            const as = v.personaId ? personaOf.get(v.personaId) : null;
            labels[code] = as ? `${name} as ${as}` : name;
        }
    }
    return labels;
}

/** What the admin page shows before an import: where the last one stopped, and the known codes. */
export async function vmImportStatus() {
    const state = await loadState();
    const story = await prisma.story.findUnique({ where: { slug: STORY_SLUG }, select: { title: true, chapters: { select: { _count: { select: { lines: true } } } } } });
    return {
        storyTitle: story?.title ?? null,
        lineCount: story?.chapters.reduce((n, c) => n + c._count.lines, 0) ?? 0,
        lastMessageId: state.lastMessageId,
        lastMessageAt: snowflakeDate(state.lastMessageId).toISOString(),
        speakers: await voiceLabels(state.speakers),
    };
}

/**
 * What an export would add, before any job runs: the new entries' line count,
 * and every speaker code with its voice (null: not known yet, so the page asks).
 * `picks` are the page's answers for unknown codes so far.
 */
export async function previewVmImport(messages: VmMessage[], picks: unknown) {
    const state = await loadState();
    const { rows, entries, codes, newestId } = newEntries(messages, state.lastMessageId);
    const speakers = { ...state.speakers, ...(await picksToVoices(picks)) };
    const labels = await voiceLabels(speakers);
    return {
        lastMessageId: state.lastMessageId,
        lastMessageAt: snowflakeDate(state.lastMessageId).toISOString(),
        newestId,
        entries,
        lineCount: rows.length,
        codes: [...codes.entries()].map(([code, c]) => ({ code, count: c.count, example: c.example, voice: code in speakers ? labels[code] : null })),
        unknown: [...codes.keys()].filter((code) => !(code in speakers)),
    };
}

/**
 * The job: appends the new entries to the "vm" story's last chapter, updates
 * its duplicate fingerprint, and remembers where it stopped and the codes it
 * used. Rejects an export that has unknown codes left, or that another import
 * has already moved past.
 */
export async function runVmImport(messages: VmMessage[], picks: unknown, { tx, log }: JobContext): Promise<string> {
    const state = await loadState(tx);
    const { rows, entries, newestId } = newEntries(messages, state.lastMessageId);
    if (!newestId || rows.length === 0) {
        if (newestId) await saveState(tx, { ...state, lastMessageId: newestId });
        return `Nothing new from the GM since ${snowflakeDate(state.lastMessageId).toISOString().slice(0, 10)}`;
    }
    const speakers = { ...state.speakers, ...(await picksToVoices(picks, tx)) };
    const unknown = [...new Set(rows.flatMap((r) => (r.code !== undefined && !(r.code in speakers) ? [r.code] : [])))];
    if (unknown.length) throw new Error(`Pick a voice for speaker code${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")} first`);

    // Each code's voice as ids in this database
    const voiceIds = new Map<string, { characterId: number | null; personaId: number | null }>();
    const labels = await voiceLabels(speakers, tx);
    for (const code of new Set(rows.flatMap((r) => (r.code !== undefined ? [r.code] : [])))) {
        const v = speakers[code];
        if ("npc" in v) {
            const { persona } = await findOrCreateNpcPersona(tx, v.npc ?? UNNAMED_NPC);
            voiceIds.set(code, { characterId: null, personaId: persona.id });
        } else {
            const character = await tx.character.findUnique({ where: { slug: v.character }, select: { id: true } });
            if (!character) throw new Error(`Speaker code ${code}: no character '${v.character}' in this database`);
            voiceIds.set(code, { characterId: character.id, personaId: v.personaId ?? null });
        }
    }

    const story = await tx.story.findUnique({ where: { slug: STORY_SLUG }, select: { id: true } });
    if (!story) throw new Error(`No '${STORY_SLUG}' story to append to`);
    const chapter = await tx.storyChapter.findFirst({ where: { storyId: story.id }, orderBy: { chapter_no: "desc" }, select: { id: true, chapter_no: true } });
    if (!chapter) throw new Error(`The '${STORY_SLUG}' story has no chapter to append to`);
    const max = await tx.storyLine.aggregate({ where: { chapterId: chapter.id }, _max: { line_no: true } });
    const start = (max._max.line_no ?? 0) + 1;

    await tx.storyLine.createMany({
        data: rows.map((r, i) => ({
            chapterId: chapter.id,
            line_no: start + i,
            type: StoryLineType[r.type],
            text: r.text,
            ...(r.code !== undefined ? voiceIds.get(r.code)! : { characterId: null, personaId: null }),
        })),
    });
    rows.forEach((r, i) => {
        const who = r.code !== undefined ? `${r.code} (${labels[r.code]}): ` : "";
        const text = r.text.replace(/\s+/g, " ");
        log(`line ${start + i} ${r.type.toLowerCase()}: ${who}${text.length > 100 ? `${text.slice(0, 100)}…` : text}`);
    });

    await refreshContentHash(tx, story.id);
    await saveState(tx, { lastMessageId: newestId, speakers });
    log(`next import starts after message ${newestId} (${snowflakeDate(newestId).toISOString()})`);
    return `${rows.length} line${rows.length === 1 ? "" : "s"} from ${entries} GM entr${entries === 1 ? "y" : "ies"} (ch. ${chapter.chapter_no}, lines ${start}-${start + rows.length - 1})`;
}

async function saveState(tx: Prisma.TransactionClient, state: VmState) {
    const value = state as unknown as Prisma.InputJsonValue;
    await tx.appSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
}

// The duplicate-import fingerprint follows the new text (as the story-hashes job would)
async function refreshContentHash(tx: Prisma.TransactionClient, storyId: number) {
    const story = await tx.story.findUniqueOrThrow({
        where: { id: storyId },
        select: { chapters: { orderBy: { chapter_no: "asc" }, select: { lines: { orderBy: { line_no: "asc" }, select: { type: true, text: true } } } } },
    });
    const hash = storyContentHash(story.chapters);
    const holder = await tx.story.findFirst({ where: { contentHash: hash, id: { not: storyId } }, select: { id: true } });
    await tx.story.update({ where: { id: storyId }, data: { contentHash: holder ? null : hash } });
}
