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
  included: no changes to text, type, timestamp, player, or which character a
  line belongs to (`characterId`). Commentary is the member channel for
  annotating the archive. Import does not alter transcript text.
- **Exception: owners keep persona stamping.** Stamping `personaId` across
  their character's lines (episode/season scope) is presentation, not a
  message change. It lets players customize how their character's name and
  appearance read over time. The existing owner-or-admin rule in
  `resolveStampAuthorization` stays.
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

**In parallel (no code dependency):**
- [x] NPC classification CSV: `prisma/scripts/seed-data/npc-speakers.csv`
      (untracked until final). It got a wiki-backed merge pass, then the
      user's review, then an extension of the user's rulings (2026-11-03).
      Columns: `decision`, `target`, `scope`, `reason`, `wiki_page`, then the
      data. `scope` limits a row to part of the character's lines. Empty
      means all lines. Otherwise it's space-separated season slugs (`ff4`)
      and/or single messages (`msg:<episode_slug>#<messageNo>`). A character
      can have several scoped rows (Dread, Loudspeaker).
      Reasons say who decided: the user's own text, `extends your ruling:`,
      `context:` (read from the transcript), `guess:`, or a wiki citation.
      Decision values:
      - `keep`: a real character
      - `npc`: becomes a character-less persona; story lines become plain
        `speaker` text
      - `merge` + target: a duplicate or a later reveal. Lines move to the
        target and display its canonical name (the user is fine with
        canonical over short names). The target may itself be an `npc` row,
        in which case the lines join that NPC persona.
      - `persona` + target: an alias or disguise of a real character. Lines
        move to the target, stamped with a persona named after this row.
      - `rename` + target: keep, but take this slug, plus the wiki title if
        there is one. A slug that doesn't match the wiki's Bucket slug means
        no infobox.
      - `delete`: no lines anywhere
      - `review`: unresolved (none left)

      **The user's rulings:** keep named NPCs even for one scene; keep
      prominent role characters when they're one recurring individual (Owner,
      Mission Control; not the "Receptionist" rows, which are two different
      NPCs); keep relatives of named characters (Isaac's Mother); a
      disguise or hidden identity is a persona of the real character
      (Mysterious Voice → Gretta, Shadow → Sonichu, Sanya's Flower → Dread,
      Fungo hosts → Vec, The Crave → Emmett, Voice → Marv's projection,
      LS → Mission Control). **Dread is two rows:** a character in FF2/FF3,
      and a persona of Sanya in FF4. **Loudspeaker is split per message**
      (each line checked in context): 3 lines are a persona of Zion and 2 are
      the ship computer (merged into the `computer` NPC).

      Wiki notes: the `wiki_cache` table only holds fetched pages (58), so
      don't use it as an "is this on the wiki" check. Query the live wiki
      instead: titles+redirects, `Category:Characters`, Bucket `characters`.

## Phase 1 — Archive lockdown (#3)

Message/episode/season/story writes are already admin-only (402babc). One leak
remains:

- [x] **Character delete rewrites history.** `messages_characterId_fkey` and
      `story_lines_characterId_fkey` are `ON DELETE SET NULL`, so deleting a
      character silently strips attribution from its archived lines. The
      comment in `character.service.ts` `deleteCharacter` claims the opposite.
      Fix: `onDelete: Restrict` on `Message.character` and
      `StoryLine.character`, then `db push`. This only changes the FK, so no
      data is lost. Return a clear 409 ("character appears in the archive")
      instead of a raw Prisma error.
- [ ] Owners keep: character bio/image/color/blurb, personas (CRUD and
      episode/season stamping onto their own character's lines), commentary,
      8-ball, profile. Stamping is deliberately **not** locked down (see
      Decisions). Consider exposing `PersonaStampPanel` to owners in the site
      if it's currently admin-only.
- [ ] Persona delete is safe as-is: the message→persona FK is `RESTRICT`, so
      a persona still stamped on lines can't be deleted out from under them.
      Keep that through Phase 2's FK rewrite.
- [x] Close open registration for launch. `REGISTRATION_OPEN` env flag
      (default closed): `POST /register` → 403, `GET /register` → `{open}`,
      and the site's login page hides the Register tab unless it's open.
- [x] Design doc edits (+ FR-AUTH-1, new FR-EP-2): §2.2 Member row, §7 criterion 2 ("attach quotes to
      it" → quotes come from admin-imported transcripts), plus a new principle
      under §3.8 stating the immutability rule and the stamping exception.
      FR-CHAR-3's owner-or-admin stamp rule stays as written.

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
      (instead of today's "unattributed, QUOTE → OTHER"). Episode import now
      goes through ff-site's `archive-to-markdown/api-import.py` and the append
      endpoints (`POST /episodes/import` answers 410), so the change lands
      there. Also update the site's `EpisodeImporter` if it's still in use.
- [ ] Reader: `resolvePersonaIdentity` already handles `character = null`
      with a persona. Add a no-link branch for the
      `<Link href="/characters/${characterId}">` in `StoryBlock.tsx`.
- [ ] Character quote pages and `/quotes/random` exclude NPC personas.
      They're keyed on characterId, so this mostly happens on its own;
      verify.
- [ ] No bulk stamp for NPC personas. Per-line admin AttributionControl is
      enough for the MVP. Owner stamping stays keyed on characterId, so NPC
      personas, which have no owner, are admin-only by construction.

### Speaker operations (shared by the seed script and admin UI)

The user will have missed some calls, so the CSV is a starting point, not the
last word. Put each conversion in one service module (e.g.
`src/speaker/speaker.service.ts`). The seed script applies the CSV through
these functions, and admins get the same operations as buttons:

- `demoteToNpc(characterId)`: character → NPC persona of the same name. Moves
  messages (`characterId = null`, `personaId = npc`), turns story lines into
  `speaker` text, then deletes the character. Folds into an existing NPC
  persona of the same name if there is one.
- `promoteNpc(personaId, ownerId)`: NPC persona → new character. The owner
  defaults to the player who voiced most of its lines (usually the GM).
  Moves messages back (`characterId = new`, `personaId = null`), then
  deletes the NPC persona.
- `mergeInto(sourceId, targetId, { asPersona?: boolean, seasons?: string[] })`:
  covers `merge`, `persona` (asPersona creates or reuses a persona of the
  target named after the source) and season-scoped splits like Dread's
  FF4 lines.
- `renameCharacter(id, { slug, name })`: before go-live only. Slugs are
  permanent once public.
- Per-message reassignment (e.g. Loudspeaker lines): extend admin
  `AttributionControl` to pick a character + persona, or an NPC persona,
  per line or block. Today it only switches personas within the line's
  current character.

All of these are admin-only. They change attribution, which FR-EP-2 allows
admins and not members. Each runs in one transaction, refuses to leave a
QUOTE without a voice, and returns counts moved. Endpoints:
`POST /api/admin/speakers/{demote,promote,merge}`. Site: admin-only actions
on the character page (Demote to NPC, Merge into…), plus a small NPC-voices
list for admins (with Promote) under `/characters`. That stays inside
§1.3's "admins use the same UI plus elevated rights", with no separate
dashboard.

### Data conversion (script)
- [ ] **It has to live in the seed pipeline, not only run once on dev.**
      `seed-legacy.ts` replays ff-site-old's JSON and would recreate every
      NPC character on a fresh `npm run seed`. Commit the reviewed CSV
      (e.g. `prisma/scripts/seed-data/npc-speakers.csv`) and add a
      `seed-npc-personas.ts` to `SEED_SCRIPTS` after `seed-legacy`, so a
      seed and a dev→prod dump end up with the same data.
- [ ] Take a fresh `pg_dump` into `ff-server/backups/` before running it on
      dev.
- [ ] `seed-npc-personas.ts` reads the CSV and calls the speaker operations
      in this order: `rename`, then `merge`/`persona` (honoring `scope`,
      including `msg:` refs, which fail loudly if the message isn't currently
      attributed to the row's character;
      merges into `npc` rows go after those rows are demoted), then `npc`,
      then `delete`. Leave `review` rows alone.
- [ ] **Story display after a merge:** the story reader prefers
      `character.name` over `speaker` (`StoryReader.tsx:50,135`,
      `stories.ts` `voiceName`). So Dakari's and Jess's prose would start
      reading "Dakari Vatssel"/"Jessica". Keep the manuscript's names by
      having the merge set `speaker` (and the segment's `speaker`) to the old
      name, and flipping the reader to `speaker ?? character.name` when both
      are set. This is presentation only, and the character link and quote
      attribution still move. **User decision 2026-11-03: not needed**, since
      the canonical name is fine. Skip it.
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
      member commentary, a member stamping their own character (expect 200)
      and someone else's (expect 403), and a member deleting a character that
      appears in the archive (expect 409).
- [ ] Announce in ff-chat.
