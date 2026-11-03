/**
 * NPC speaker conversion: applies the reviewed speaker spreadsheet
 * (seed-data/npc-speakers.csv, one row per legacy Character) through the
 * speaker operations in src/speaker/speaker.service.ts. PLAN-mvp.md Phase 2.
 *
 * seed-legacy.ts turns every transcript speaker tag into a Character, so a
 * fresh seed recreates "Enemy A" and "Llamanian Guard" as characters. This
 * script is what makes a fresh seed match the converted dev DB, which is why
 * it lives in SEED_SCRIPTS and not as a one-off. It runs after
 * seed-sanya-persona and before seed-overlay, so an overlay exported after
 * the conversion (with the renamed slugs) still applies. Every other persona
 * (Vec's hosts, Buzzcut's "Bee Emmett") comes from the markdown's
 * `X as Y` tags and meta personaTimeline, via seed-legacy.
 *
 * Decisions (column `decision`):
 *   keep     nothing to do (a scoped keep row just documents the split)
 *   rename   new slug = `target`; new name = the slug title-cased
 *            (squina_malreis -> "Squina Malreis")
 *   merge    lines move to `target`, which may itself be an `npc` row
 *   persona  lines move to `target`, stamped with a persona named after this row
 *   npc      character -> NPC persona of the same name (characterId null)
 *   delete   remove a character with no lines (fails if it has any)
 *   review   left alone
 * `scope`: empty = all of the character's lines; otherwise season slugs
 * ("ff4") and/or "msg:<episode_slug>#<messageNo>" refs.
 *
 * Order: rename -> merge/persona into characters -> npc -> merge into npc
 * rows -> delete -> sweep. The sweep deletes any converted character left
 * with no lines (e.g. Loudspeaker, split by two scoped rows), and fails if
 * one still has lines.
 *
 * The whole run is one transaction, then checked: total message count
 * unchanged, no QUOTE without a voice, every persona on its character
 * (the trigger's rule), no story segment pointing at a deleted character,
 * no DIALOGUE story line without a speaker. Any failure rolls everything back.
 *
 * Re-runnable: a row whose character is gone is reported as already applied,
 * and msg: refs already moved off the character are skipped.
 *
 *   npm run seed:npc-personas               apply
 *   npm run seed:npc-personas -- --dry-run  apply, print, roll back
 */
import { PrismaClient, MessageType } from "@prisma/client";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
    TX_OPTIONS,
    countReferences,
    deleteUnusedCharacterTx,
    demoteToNpcTx,
    mergeIntoTx,
    renameCharacterTx,
    type SpeakerScope,
} from "../../src/speaker/speaker.service.js";

const prisma = new PrismaClient();
const CSV_PATH = join(dirname(fileURLToPath(import.meta.url)), "seed-data", "npc-speakers.csv");
const DRY_RUN = process.argv.includes("--dry-run");

type Row = { decision: string; target: string; scope: string; slug: string; name: string; line: number };

const DECISIONS = new Set(["keep", "rename", "merge", "persona", "npc", "delete", "review"]);

class DryRunRollback extends Error {}

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field); field = "";
            if (row.some((f) => f !== "")) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some((f) => f !== "")) rows.push(row);
    return rows;
}

function loadRows(): Row[] {
    const [header, ...body] = parseCsv(readFileSync(CSV_PATH, "utf8"));
    const col = (name: string) => {
        const i = header.indexOf(name);
        if (i < 0) throw new Error(`npc-speakers.csv: missing column '${name}'`);
        return i;
    };
    const [d, t, sc, sl, n] = ["decision", "target", "scope", "slug", "name"].map(col);
    return body.map((r, i) => {
        const row = { decision: r[d]?.trim() ?? "", target: r[t]?.trim() ?? "", scope: r[sc]?.trim() ?? "", slug: r[sl]?.trim() ?? "", name: r[n]?.trim() ?? "", line: i + 2 };
        if (!DECISIONS.has(row.decision)) throw new Error(`npc-speakers.csv line ${row.line}: unknown decision '${row.decision}'`);
        if (!row.slug) throw new Error(`npc-speakers.csv line ${row.line}: no slug`);
        if (["rename", "merge", "persona"].includes(row.decision) && !row.target) {
            throw new Error(`npc-speakers.csv line ${row.line}: '${row.decision}' needs a target`);
        }
        return row;
    });
}

function parseScope(scope: string): SpeakerScope | undefined {
    const tokens = scope.split(/\s+/).filter(Boolean);
    if (!tokens.length) return undefined;
    return {
        seasons: tokens.filter((t) => !t.startsWith("msg:")),
        messages: tokens.filter((t) => t.startsWith("msg:")).map((t) => t.slice(4)),
    };
}

function titleFromSlug(slug: string): string {
    return slug.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function describe(row: Row): string {
    return `${row.decision} ${row.slug}${row.target ? ` -> ${row.target}` : ""}${row.scope ? ` [${row.scope}]` : ""}`;
}

async function main() {
    const rows = loadRows();
    if ((await prisma.character.count()) === 0) {
        console.log("No characters (archive not loaded) — skipping.");
        return;
    }
    const messagesBefore = await prisma.message.count();

    const counts: Record<string, number> = {};
    const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

    try {
        await prisma.$transaction(async (tx) => {
            const bySlug = (slug: string) => tx.character.findUnique({ where: { slug } });
            const renamed = new Map<string, string>(); // old slug -> new slug
            const npcPersonaBySlug = new Map<string, number>(); // demoted slug -> NPC persona id
            const rowsBySlug = new Map<string, Row[]>();
            for (const r of rows) rowsBySlug.set(r.slug, [...(rowsBySlug.get(r.slug) ?? []), r]);
            const isNpcRow = (slug: string) => (rowsBySlug.get(slug) ?? []).some((r) => r.decision === "npc");

            // Narrows a msg-scoped row to the refs still on its character; null = nothing left to do.
            const liveScope = async (row: Row, characterId: number): Promise<SpeakerScope | undefined | null> => {
                const scope = parseScope(row.scope);
                if (!scope?.messages?.length) return scope;
                const live: string[] = [];
                for (const ref of scope.messages) {
                    const [episodeSlug, no] = ref.split("#");
                    const episode = await tx.episode.findUnique({ where: { slug: episodeSlug } });
                    const message = episode && (await tx.message.findUnique({
                        where: { episodeTitle_messageNo: { episodeTitle: episode.title, messageNo: parseInt(no, 10) } },
                    }));
                    if (!message) throw new Error(`line ${row.line}: msg:${ref} doesn't exist`);
                    if (message.characterId === characterId) live.push(ref);
                }
                if (!live.length && !scope.seasons?.length) return null;
                return { ...scope, messages: live };
            };

            const log = (row: Row, what: string) => console.log(`  line ${row.line}: ${describe(row)}: ${what}`);

            // 1. rename
            for (const row of rows.filter((r) => r.decision === "rename")) {
                renamed.set(row.slug, row.target);
                const character = await bySlug(row.slug);
                if (!character) { log(row, "already applied / not loaded"); bump("skipped"); continue; }
                await renameCharacterTx(tx, character.id, { slug: row.target, name: titleFromSlug(row.target) });
                log(row, `now '${titleFromSlug(row.target)}'`);
                bump("rename");
            }
            const resolveTarget = (slug: string) => renamed.get(slug) ?? slug;

            const moveRow = async (row: Row) => {
                const source = await bySlug(row.slug);
                if (!source) { log(row, "already applied / not loaded"); bump("skipped"); return; }
                const scope = await liveScope(row, source.id);
                if (scope === null) { log(row, "msg refs already moved"); bump("skipped"); return; }
                const targetSlug = resolveTarget(row.target);
                const target = await bySlug(targetSlug);
                if (target) {
                    const r = await mergeIntoTx(tx, source.id, target.id, { asPersona: row.decision === "persona", scope });
                    log(row, `${r.messages} msgs, ${r.storyLines} story lines, ${r.storySegmentLines} prose lines${r.persona ? `, persona '${r.persona.name}'${r.personaCreated ? " (new)" : ""}` : ""}${r.deletedCharacter ? ", source deleted" : ""}`);
                    bump(row.decision);
                    return;
                }
                // Target is an NPC row that's already been demoted: fold into its NPC persona.
                if (row.decision === "merge" && isNpcRow(targetSlug)) {
                    let personaId = npcPersonaBySlug.get(targetSlug);
                    if (!personaId) {
                        const targetName = rowsBySlug.get(targetSlug)!.find((r) => r.decision === "npc")!.name;
                        const persona = await tx.persona.findFirst({ where: { characterId: null, name: { equals: targetName, mode: "insensitive" } } });
                        if (!persona) throw new Error(`line ${row.line}: target '${targetSlug}' is neither a character nor an NPC persona named '${targetName}'`);
                        personaId = persona.id;
                    }
                    const r = await demoteToNpcTx(tx, source.id, { scope, intoPersonaId: personaId });
                    log(row, `${r.messages} msgs, ${r.storyLines} story lines, ${r.storySegmentLines} prose lines into NPC '${r.persona.name}'${r.deletedCharacter ? ", source deleted" : ""}`);
                    bump(row.decision);
                    return;
                }
                throw new Error(`line ${row.line}: target '${targetSlug}' not found`);
            };

            // 2. merge/persona into targets that stay characters
            for (const row of rows.filter((r) => (r.decision === "merge" || r.decision === "persona") && !isNpcRow(resolveTarget(r.target)))) {
                await moveRow(row);
            }

            // 3. npc
            for (const row of rows.filter((r) => r.decision === "npc")) {
                const character = await bySlug(row.slug);
                if (!character) { log(row, "already applied / not loaded"); bump("skipped"); continue; }
                const r = await demoteToNpcTx(tx, character.id, { scope: parseScope(row.scope) });
                npcPersonaBySlug.set(row.slug, r.persona.id);
                if (r.persona.name!.toLowerCase() !== character.name.toLowerCase()) throw new Error(`line ${row.line}: persona name mismatch`);
                log(row, `${r.messages} msgs, ${r.storyLines} story lines, ${r.storySegmentLines} prose lines${r.personaCreated ? "" : " (joined an existing NPC)"}`);
                bump("npc");
            }

            // 4. merge into NPC rows (now personas)
            for (const row of rows.filter((r) => (r.decision === "merge" || r.decision === "persona") && isNpcRow(resolveTarget(r.target)))) {
                await moveRow(row);
            }

            // 5. delete
            for (const row of rows.filter((r) => r.decision === "delete")) {
                const character = await bySlug(row.slug);
                if (!character) { log(row, "already applied / not loaded"); bump("skipped"); continue; }
                await deleteUnusedCharacterTx(tx, character.id);
                bump("delete");
            }

            // 6. sweep: a converted character with no keep row must end up gone.
            const keep = new Set(rows.filter((r) => r.decision === "keep" || r.decision === "review" || r.decision === "rename").map((r) => r.slug));
            for (const slug of new Set(rows.map((r) => r.slug))) {
                if (keep.has(slug)) continue;
                const character = await bySlug(slug);
                if (!character) continue;
                const refs = await countReferences(tx, character.id);
                if (refs > 0) throw new Error(`'${slug}' was converted but still voices ${refs} line(s); check its rows' scopes`);
                await tx.character.delete({ where: { id: character.id } });
                console.log(`  sweep: deleted '${slug}' (no lines left)`);
                bump("swept");
            }

            // Assertions
            const messagesAfter = await tx.message.count();
            if (messagesAfter !== messagesBefore) throw new Error(`message count changed: ${messagesBefore} -> ${messagesAfter}`);
            const voiceless = await tx.message.count({ where: { type: MessageType.QUOTE, characterId: null, personaId: null } });
            if (voiceless) throw new Error(`${voiceless} QUOTE message(s) left without a voice`);
            const [{ mismatched }] = await tx.$queryRaw<{ mismatched: bigint }[]>`
                SELECT count(*) AS mismatched FROM messages m JOIN personas p ON p.id = m."personaId"
                WHERE p."characterId" IS DISTINCT FROM m."characterId"
            `;
            if (mismatched > 0n) throw new Error(`${mismatched} message(s) carry a persona of another character`);
            // Segment characterIds have no FK, so a dangling one would go unnoticed.
            const [{ dangling }] = await tx.$queryRaw<{ dangling: bigint }[]>`
                SELECT count(*) AS dangling FROM story_lines sl, jsonb_array_elements(sl.segments) seg
                WHERE seg ? 'characterId' AND jsonb_typeof(seg->'characterId') = 'number'
                  AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.id = (seg->>'characterId')::int)
            `;
            if (dangling > 0n) throw new Error(`${dangling} story segment(s) point at a character that no longer exists`);
            const voicelessDialogue = await tx.storyLine.count({ where: { type: "DIALOGUE", characterId: null, npcVoice: false, OR: [{ speaker: null }, { speaker: "" }] } });
            if (voicelessDialogue) throw new Error(`${voicelessDialogue} DIALOGUE story line(s) left without a speaker`);
            const npcPersonas = await tx.persona.count({ where: { characterId: null } });
            const npcLines = await tx.message.count({ where: { characterId: null, personaId: { not: null } } });
            console.log(`\nOK: ${messagesAfter} messages (unchanged), ${npcPersonas} NPC personas voicing ${npcLines} lines.`);
            console.log("Counts:", counts);

            if (DRY_RUN) throw new DryRunRollback();
        }, { ...TX_OPTIONS, timeout: 600_000 });
    } catch (e) {
        if (e instanceof DryRunRollback) {
            console.log("Dry run: rolled back, nothing written.");
            return;
        }
        throw e;
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
