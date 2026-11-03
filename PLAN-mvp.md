# PLAN — MVP to deploy

Status: draft, 2026-11-03. Order matters: each phase is listed in the order it
should land. Phases 1–3 change the schema, so finish them **before** the first
prod seed; then prod never needs a destructive schema change.

Schema changes follow this repo's convention (see `CLAUDE.md`): edit
`schema.prisma` → `db push` → `prisma generate` → `npm run db:search-indexes`.
Anything `db push` would lose data on ships as a one-shot SQL script in
`prisma/scripts/` that runs first. Nothing below uses `prisma migrate`.

## Decisions this plan assumes

- **Archived transcripts are immutable to members.** This overrides the design
  doc. Members cannot create, edit or delete any part of an Episode, Messages
  included, and that covers attribution (`characterId`, `personaId`).
  Commentary is the member channel for annotating the archive. Import does not
  alter transcript text.
- **NPC speakers become character-less personas.** `Message.characterId` null
  plus `Message.personaId` set means "a named voice with no character record"
  ("Llamanian Guard", "Toll Booth Operator"). This requires
  `Persona.characterId` to be **nullable**, which is how this plan reads "not-null
  characterId for Persona".
- **Species is removed** from the DB. The wiki owns species lore.
- **Deferred:** bot rewrite, space builder, table-talk toggle (OOC is mostly
  deleted already, and bot COMMAND/BOT_RESPONSE messages aren't table talk),
  quote curation flag, `virtualization` branch merge.

---

## Phase 0 — NFSN deploy spike (today, first)

This is the biggest unknown, and it decides the SQL dialect for Phase 2's
trigger, so do it first. Use the current schema and an empty DB.

- [ ] Create the NFSN Custom-server-type site. `initdb` + `pg_ctl` as `me`.
      Check the Postgres version: dev is 16.
- [ ] `npm ci && npx prisma generate` on FreeBSD. **Pass/fail:** does the
      Prisma 6 query engine load? If not, try `@prisma/adapter-pg` +
      `queryCompiler` preview before falling back to SQLite. The SQLite fallback
      costs are listed in memory (`nfsn-deploy-plan`).
- [ ] `prisma db push` + `npm run db:search-indexes` → start ff-server daemon → `next build` +
      `next start` daemon → proxies for `/` and `/api`.
- [ ] Hit `/api/seasons` and the home page. Leave it unannounced.

**In parallel (no code dependency):** generate the NPC classification CSV for
Phase 2:
`name, owner, message_count, episode_count, story_line_count, has_image, has_wiki_cache_row`.
Strong NPC signals: no wiki_cache row, ≤ ~20 lines, generic names (Guard,
Enemy B, Cashier, "Llamanian Soldier 1"). Mark each row `keep` / `npc`
by hand.

## Phase 1 — Archive lockdown (#3)

Message/episode/season/story writes are already admin-only (402babc). Two leaks
remain:

- [ ] **Character delete rewrites history.** `messages_characterId_fkey` and
      `story_lines_characterId_fkey` are `ON DELETE SET NULL`, so deleting a
      character silently strips attribution from its archived lines. The
      comment in `character.service.ts` `deleteCharacter` claims the opposite.
      Fix: `onDelete: Restrict` on `Message.character` and
      `StoryLine.character`, then `db push`. This only changes the FK, so no
      data is lost. Return a clear 409 ("character appears in the archive")
      instead of a raw Prisma error.
- [ ] **Persona stamping is owner-or-admin.** `POST
      /episodes/:t/personas/apply` and `/seasons/:t/personas/apply` write
      `Message.personaId`. Make both `isAdmin` and drop the owner branch of
      `resolveStampAuthorization`. Gate `PersonaStampPanel` /
      `AttributionControl` to admin in the site (they mostly are already;
      verify).
- [ ] Owners keep: character bio/image/color/blurb, persona *definitions*
      (name/image/color of their own personas, CRUD), commentary, 8-ball,
      profile. Editing a persona's look changes how archived lines render.
      That's character presentation, not history, so it stays.
- [ ] Close open registration for launch: accounts are pre-seeded. Either
      remove `POST /register` from the site, or require an invite code.
- [ ] Design doc edits: §2.2 Member row, FR-CHAR-3's "owner or admin" stamp
      sentence → admin, §7 criterion 2 ("attach quotes to it" → quotes come
      from admin-imported transcripts), plus a new principle under §3.8
      stating the immutability rule.

## Phase 2 — NPC speakers as character-less personas (#5)

### Schema
- [ ] `Persona.characterId Int?`. For NPC personas `name` is required (the
      `label` rule only applies to name-less personas). NPC personas get no
      slug and no page.
- [ ] `Message.persona` relation becomes single-column
      (`personaId → Persona.id`). The composite FK can't carry a null
      characterId: MATCH SIMPLE skips the check, and Prisma can't load the
      relation. A hand-written composite FK won't help either: `db push`
      drops FKs that aren't in the schema.
- [ ] Enforce the match with a **trigger** instead, which `db push` leaves
      alone. Install it from an idempotent script (`npm run db:triggers`,
      modeled on `create-search-indexes.ts`), add it to `SEED_SCRIPTS`, and
      run it after every `db push` the same way:
      `BEFORE INSERT OR UPDATE OF "personaId","characterId" ON messages`, raise
      when `(SELECT "characterId" FROM personas WHERE id = NEW."personaId")
      IS DISTINCT FROM NEW."characterId"`. Guard `personas.characterId`
      updates the same way, or forbid them. Switch
      `assertPersonaMatchesCharacter` to IS DISTINCT semantics (null == null
      passes) as the app-level mirror.
- [ ] NPC persona uniqueness: global by case-insensitive name, enforced by
      find-or-create in the service. `@@unique([characterId, name])` does
      nothing when characterId is null.
- [ ] Update FR-CHAR-3 (composite FK → trigger) and FR-MSG-4 (QUOTE requires
      `characterId` **or** `personaId`).

### Server / site
- [ ] `POST /personas` (admin) for character-less create.
      `GET /personas?npc=true` for pickers.
- [ ] `createMessage` / `updateMessage`: relax the QUOTE check
      (`message.service.ts:219`).
- [ ] Importer: an unmatched speaker becomes a find-or-create NPC persona
      (instead of today's "unattributed, QUOTE → OTHER").
- [ ] Reader: `resolvePersonaIdentity` already handles `character = null`
      with a persona. Add a no-link branch for the
      `<Link href="/characters/${characterId}">` in `StoryBlock.tsx`.
- [ ] Character quote pages and `/quotes/random` exclude NPC personas.
      They're keyed on characterId, so this mostly happens on its own;
      verify.
- [ ] No bulk stamp for NPC personas. Per-line admin AttributionControl is
      enough for the MVP.

### Data conversion (script)
- [ ] **It has to live in the seed pipeline, not only run once on dev.**
      `seed-legacy.ts` replays ff-site-old's JSON and would recreate every
      NPC character on a fresh `npm run seed`. Commit the reviewed CSV
      (e.g. `prisma/scripts/seed-data/npc-speakers.csv`) and add a
      `seed-npc-personas.ts` to `SEED_SCRIPTS` after `seed-legacy`, so a
      seed and a dev→prod dump end up with the same data.
- [ ] Take a fresh `pg_dump` into `ff-server/backups/` before running it on
      dev.
- [ ] For each `npc` row in the CSV: find-or-create the persona by
      normalized name, merging duplicates across owners (`@@unique([creatorId,
      name])` allows Zander's "Guard" and Sean's "Guard"). Set
      `messages.characterId = null, personaId = persona`. Set story_lines
      `characterId = null, speaker = name`. Then delete the character, which
      the Phase 1 Restrict now makes safe.
- [ ] Also sweep the 766 QUOTE/ACTION messages with no character: match
      them to an NPC persona if their speaker is recoverable from the
      import JSON, otherwise leave them.
- [ ] Assertions: total message count unchanged, no message has a QUOTE
      without a voice, and the trigger accepts every row.
- [ ] Reconcile the two persona-stamping mechanisms (`seed-vec-personas.ts`
      vs import-time `personaTimeline`) while in here. Seeds in f41f57d
      touch both personas and species.

## Phase 3 — Remove Species

- [ ] Server: drop `src/species/`, the species parts of
      `character.service/controller`, `search.*`, `openapi.ts`, `app.ts`,
      and `"species"` in `WikiBucket` (check whether a species wiki proxy is
      still wanted first). Drop `Species`, `_CharacterToSpecies` and the
      `Class` enum. Make species not required on character create.
- [ ] Site: about 20 files. `/species` routes, the CharacterIndex species
      filter, editor fields, nav, search tabs.
- [ ] Seed scripts: drop `seed-species.ts` from `SEED_SCRIPTS`. Also strip
      species from `seed-data/characters.json` and from `export:overlay`.
      `db push` will drop the tables. Nothing needs saving, since the wiki
      has the lore.
- [ ] Update `CLAUDE.md` (both repos) where Species is listed as implemented.
- [ ] Design doc: delete §3.5, FR-CHAR-10's species filter and FR-SR-1's
      species mention.

## Phase 4 — Portraits (data pass, not a feature)

- [ ] Attach the existing Starbound portraits to main characters
      (`Character.image`). Biggest gaps by line count: Vec (1,483), Zacharias
      Smith (1,184), Matieu (782), Hector (716), Vargas, Deyner Revathen,
      Maia, Mateo Krovak, Grass Stalker. If they're on the booru, a script
      keyed on `character:*` tags can fill most of them.
- [ ] Re-run the coverage query afterward: character-attributed messages with
      no persona or character image (11.6k of 46.4k today).

## Phase 5 — Go live

- [ ] Fresh DB credentials and `JWT_SECRET`. Nothing from dev carries over: a
      DB password was pasted in DMs on 2026-08-19.
- [ ] Seed: dump dev → prod, then `npm run golive:flag-accounts`, *or* a fresh
      `npm run seed` plus stories via `story-md-to-api.py --upload`.
- [ ] Crawler protection. The booru's bandwidth went up 10× in Aug 2026 from
      crawlers on metered NFSN. Add `robots.txt` (or `app/robots.ts`),
      cache the immutable reader pages (`fa0b8a5` on `virtualization`; check
      whether it cherry-picks cleanly without `e7ccf8a`), and consider
      rate-limiting `/api`.
- [ ] Nightly `pg_dump` cron, stored somewhere other than the NFSN host
      (NFR-REL-3).
- [ ] Smoke test: an episode deep link, a legacy `/ff2/...` redirect, a story
      chapter, a character page, member login + must-change-password, a
      member commentary, and a member trying to stamp (expect 403).
- [ ] Announce in ff-chat.
