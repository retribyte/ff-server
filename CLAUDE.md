# Final Frontier — API Server

Express/TypeScript/Prisma/Postgres API for the Final Frontier lore archive and
campaign reader: users, characters, seasons/episodes/messages,
stories (prose/CYOA), items, commentary. Consumed by the `ff-site` Next.js
frontend (sibling repo, symlinked in as `ff-site/ff-server`) and by any
external client via the token-authenticated API (FR-API-*).

Requirements live in `FF design document.md` (FR-*/NFR-* ids) — read it before
adding or changing scope. **Treat it as a starting point, not current truth**:
the schema has already grown past it in places (the `Story`/`StoryChapter`/
`StoryLine` models implement CYOA/prose reading, which the doc only gestures
at; `EightBallAnswer` isn't in the doc at all) and lags it in others
(`Relationship`, called for by FR-CHAR-4, doesn't exist as a model yet —
`Persona` (FR-CHAR-3, formerly `Alias`), `Season`, `Episode`,
`Message`, `Item`, `Commentary`, `Character`, `User` are implemented). Check
`prisma/schema.prisma` for what's actually there. There's no `Species`
model (removed 2026-11, MVP Phase 3): the wiki owns species lore. Species
exist here only as the wiki cache's `species` bucket. `GET /api/species` and
`/api/species/:slug` serve those cached rows read-only (for a future bot),
and they never fetch live: a species has no DB row to bound the cache. `npm
run refresh:wiki-cache` fills and refreshes the bucket, so run it on a fresh
DB. A character page shows the wiki's `species` field from its own wiki
data. Don't add a species table back.

## Environment

- `npm run dev` runs `tsx watch src/server.ts` — auto-restarts on save.
  Serves on `:3000`; API is under `/api`, Swagger docs (built from
  `src/openapi.ts`) at `/api/docs`.
- `.env` (gitignored; see `README.md` for the template) — `DATABASE_URL`,
  `JWT_SECRET`, `JWT_EXPIRATION`, `SALT_ROUNDS`, `PORT`, and
  `REGISTRATION_OPEN` (`"true"` to allow self-registration; anything else
  closes it — `POST /api/register` answers 403 and the site hides its form;
  `GET /api/register` reports `{ open }`). `FF_SITE_DIR`
  overrides the legacy-data path used by one-off scripts in `prisma/`
  (defaults to `../ff-site-old` or `../ff-site` depending on the script — see
  below).
- `docker-compose.yml` defines `db` (Postgres) and `ff-api` services.
  `npm run docker:up` (`docker compose up -d --build`) with no args starts
  **both** — since `ff-api` also binds host `:3000`, that collides with a
  locally-run `npm run dev`. When running the API locally, start only
  Postgres: `npm run docker:up -- db`. `npm run docker:down` stops both.
- Schema changes go through **`npx prisma db push`** — `prisma/migrations/` is
  present but empty; this project isn't using versioned migrations day to day
  despite NFR-REL-2's aspiration. Run `npx prisma generate` after any schema
  edit. `db push` can't see or manage the GIN expression indexes behind
  `/api/search`'s full-text search (Prisma has no syntax for expression
  indexes) — run `npm run db:search-indexes` after every `db push` too; it's
  idempotent and safe to re-run. Same for `npm run db:triggers`
  (`prisma/scripts/create-triggers.ts`): the trigger that keeps a message's
  persona on that message's character (null == null for NPC lines), the one
  that freezes a used persona's character, and the partial unique index on
  NPC persona names. None of these are in the schema.
- **Schema changes `db push` would lose data on** ship as a one-shot SQL
  script in `prisma/scripts/`, run against an *existing* DB **before** `db push`
  (fresh DBs just `db push` + seed). Check for unapplied ones whenever you
  pull onto another machine:
  - `rename-alias-to-persona.sql`: Alias → Persona. Needed if an `aliases`
    table still exists.
  - `story-authors-to-many.sql` (2026-10): `Story.authorId` →
    `Story.authors` many-to-many (`_StoryToUser`). Needed if `stories` still
    has an `authorId` column. Afterwards, `npm run backfill:story-authors`
    sets each story's authors from its manuscript's `authors:` frontmatter
    (re-runnable).

  Run with `docker exec -i ff-server-db-1 psql -U <user> <db> < prisma/scripts/<script>.sql`,
  then `db push`, `prisma generate`, `npm run db:search-indexes`,
  `npm run db:triggers`.

## Architecture

- **Feature-module layout**: `src/<feature>/<feature>.controller.ts` (routes)
  + `<feature>.service.ts` (Prisma access + business logic). Controllers never
  call Prisma directly. Services and `prisma/scripts/` import the shared
  client from `src/db.ts` (`import { prisma } from ".../db.js"`). Never call
  `new PrismaClient()` elsewhere: each client owns a pg pool, and prod
  Postgres allows only 20 connections.
- **Prisma runs Rust-free** (`engineType = "client"` + `@prisma/adapter-pg`,
  set up in `src/db.ts`), because production is FreeBSD (NearlyFreeSpeech),
  where Prisma has no native engines. Run the Prisma CLI (`generate`, `db
  push`) on Linux only; it fails on FreeBSD. With the adapter, P2002/P2003
  errors don't carry `meta.target`/`meta.field_name`; the constraint is in
  `meta.driverAdapterError.cause.constraint` (see `constraintNames` in
  `src/utils/import.ts`). `.env` is loaded by `dotenv/config`, the first
  import in `src/server.ts` and `src/db.ts`. Don't rely on Prisma loading it.
- All routers mount under `/api` in `src/app.ts`.
- **Auth**: `Authorization: Bearer <JWT>` header, verified by `authenticate`
  (`src/auth/security.middleware.ts`), which sets `req.user`. `isAdmin` gates
  admin-only routes. Ownership checks (creator-or-admin) are done inline in
  each controller by comparing `req.user.id` to the record's `creatorId` —
  there's no shared ownership-middleware helper. The frontend never sees this
  token directly; `ff-site` wraps it in an httpOnly cookie itself.
  - **Archive immutability** (FR-EP-2, a deliberate override of the original
    doc): every write to Seasons/Episodes/Messages is `isAdmin`, including
    attribution. Owners may still stamp personas onto their own character's
    lines (`.../personas/apply`, owner-or-admin): that's presentation, not a
    message change. Don't add member write paths to archive data, and watch
    for indirect ones: `Message.character`/`StoryLine.character` are
    `onDelete: Restrict`, and `deleteCharacter` also refuses (409) when a
    character appears in `StoryLine.segments` JSON, which has no FK.
  - **NPC personas** (`Persona.characterId` null) voice one-off speakers;
    their lines have no character. Moving voices between characters and
    NPCs goes through `src/speaker/speaker.service.ts` (demote, promote,
    merge, rename; admin endpoints under `/api/admin/speakers/`), which
    rewrites messages, story lines and `segments` JSON together in one
    transaction. Don't hand-roll `updateMany`s for this: the segments JSON is
    easy to miss. `seed-npc-personas.ts` applies the reviewed
    `seed-data/npc-speakers.csv` through the same functions (`--dry-run`
    rolls back).
  - The JWT carries only `{id, username, role}`; `authenticate` reloads the
    user from the DB on every request (so `req.user` is never stale) and
    rejects tokens issued before `passwordChangedAt` and accounts with
    `loginDisabled`. While `mustChangePassword` is set, `authenticate` refuses
    every non-GET request — only `PUT /api/user/password` (behind
    `authenticateAllowingPasswordChange`) gets through.
  - Usernames are fixed: the archive import maps transcript players to
    accounts by username. Rename players in the archive's
    `meta/<season>.json` `usernames` map before seeding, not in the app.
  - Seeded player accounts get `mustChangePassword`; system accounts get
    `loginDisabled`. `npm run golive:flag-accounts` applies the same flags to
    an existing DB (idempotent — skips anyone who already changed their
    password). In dev, clear the flag with SQL if you don't want the forced
    change: `UPDATE "User" SET "mustChangePassword" = false;`
  - Avatars come from booru.vortox.space (Shimmie2): users pick a post ID
    (`iconBooruId`), and `src/utils/booru.ts` resolves it to an image URL via
    the Danbooru-compatible API, stored in `icon`. `BOORU_URL` configures it
    (optional `BOORU_USER`/`BOORU_PASSWORD` go along as Basic auth — Shimmie
    has no API keys). The live booru sits behind a Cloudflare bot challenge;
    `IMAGE_KEY` is sent as the `x-image-key` header, which Cloudflare lets
    through. Without it, lookups fail (502).
  - System accounts (`prisma/scripts/system-accounts.ts`: the Archivist, the FF 8 Ball
    bot) are `loginDisabled` in the seed and the go-live script.
  - `npm run docs` lints the OpenAPI spec (`scripts/lint-openapi.ts` dumps
    `src/openapi.ts` to JSON for Redocly). Public operations declare
    `security: []` explicitly.
- **Response envelope**, every JSON response: `{ status: "success", data }` or
  `{ status: "error", message }`. Never leak raw Prisma objects or stack
  traces.
- **Slugs** (`src/utils/slug.ts`): the derivation (accented letters
  transliterated to plain Latin — à→a, ß→ss, æ→ae, ø→o — not dropped;
  lowercase; spaces/hyphens → single underscore; punctuation dropped; doubled
  underscores collapsed) must stay byte-for-byte identical to the wiki's slug
  rules (`Final Frontier Wiki:Slugs` on wiki.vortox.space), to `ff-site`'s
  copy (`src/lib/slug.ts`) and to its docx CLI
  (`archive-to-markdown/story-docx-to-md.py`) — slugs are a cross-site
  identity, not a local convenience. Cases live in `test/slug.test.ts`
  (`npm test`). The rule only governs *new* slugs; stored slugs never change.
- **GUY calendar dates** (`src/utils/guy-time.ts`): in-universe dates
  (`Character` DOB, etc.) are stored as integer equinox counts, not
  `DateTime`. An identical copy lives at `ff-site/src/lib/guy-time.ts` —
  changes must land in both. Real-world timestamps (`Message.timestamp`,
  `Episode.playedDate`) stay plain `DateTime`.
- **Story import is atomic**: `POST /api/stories/import` takes a whole story
  (`{story, chapters:[{chapter_no, title?, lines}]}`) and writes it in one
  interactive transaction — all or nothing, so an existing story is always a
  complete one. Conflicts return **409**: slug, title (case-insensitive), or
  identical text via `Story.contentHash` (`src/story/story-hash.ts`;
  import-time fingerprint, not updated by line edits; `npm run
  backfill:story-hashes` fills it for stories created any other way — the
  seed runs it). The route skips the global 100kb JSON parser and mounts a
  10mb one *after* `authenticate` (`src/utils/import.ts`).
  - **Who may import** (the user's call, 2026-11-03): any member converts
    (`POST /stories/convert`) and imports, and a member is always credited
    among the authors (the route adds them). Stories go straight to the
    shelf, with no drafts; the site's `/import` previews the story with the
    real reader first. Replacing a story's text (`PUT .../import`) and naming
    its NPC voices are for its **authors** and admins
    (`storyService.isAuthorOrAdmin`). Every other story write (metadata,
    delete, chapter/line edits) stays `isAdmin`. Members get only
    `{id, username, icon}` from `GET /users`, for the author picker.
  - `PUT /api/stories/:slug/import` is the revision path: `{chapters}` replaces
    every chapter and line in one transaction, keeping the story row (id,
    slug, title, authors, season, blurb, theme) and recomputing `contentHash`.
    `chapter_no` 0 is allowed (a preface before Chapter 1). Unnamed NPC voice
    fragments in the revision (segment `npc: true` / line `npcVoice: true`, no
    speaker) take the voice their text already had, matched by occurrence;
    placeholder voices ("NPC", "?", "Unknown") aren't carried.
  - `Story.importMeta` (`src/story/import-meta.ts`): the `{format, colors}`
    a Google Doc import was converted with. Both import routes take it as an
    optional top-level `importMeta` and store it. A PUT without it keeps the
    stored one. `GET /stories/:slug` returns it, and the site's docx form
    pre-fills a revision's colors from it, so only new colors need a pick.
  - **NPC voices**: `PATCH /api/stories/:slug/voices` names or un-names NPC
    fragments (authors or admins). It can only touch NPC-flagged fragments,
    never text or character attribution. NPC voices are plain text, never
    NPC `Persona` rows (the user's call): story NPCs aren't archive speakers.
  - `POST /api/episodes/import` (same idea for `{seasonTitle, episode,
    messages}`) is **retired and answers 410**: the archive is seeded, and
    episode re-imports go through ff-site's `archive-to-markdown/api-import.py`
    via the chunked append endpoints. `episodeService.importEpisode` (atomic,
    409 on title/slug/season+number) is kept for re-enabling.
  - The append endpoints (`.../chapters/:n/lines`, `.../messages`) remain for
    incremental API use and the CLI episode uploaders.
- **HTML sanitization** (`src/utils/sanitize.ts`, NFR-SEC-3): user-submitted
  rich text (character blurbs, item descriptions,
  commentary) goes through `sanitizeText()` before storage.
- `prisma/scripts/seed.ts` is the orchestrator: wipes all data, then runs
  `SEED_SCRIPTS` (`seed-legacy.ts`, persona/character-data scripts,
  `seed-npc-personas.ts`, `seed-vm-appended.ts`, `seed-overlay.ts`, `seed-8ball.ts`, `seed-galaxy.ts`, `backfill-story-hashes.ts`, `create-search-indexes.ts`, `create-triggers.ts`) as child processes. The first script that fails
  or is missing stops the seed with a non-zero exit (the DB is then
  incomplete: fix and re-seed). Only `OPTIONAL_SCRIPTS` may be absent:
  `seed-galaxy.ts`, listed but not written yet.
  `seed:legacy` replays the real archive: episodes from ff-site's
  `archive-to-markdown/api/<season>/*.json` (`FF_SITE_DIR`), plus Vortox
  Machina and legacy colors/avatars from `ff-site-old` (`FF_SITE_OLD_DIR`) —
  **only safe against an empty DB**, don't rerun against a live dev database
  with user-authored content. That `api/` folder is gitignored build output:
  **run `python3 md-to-api.py --all` in ff-site's `archive-to-markdown/`
  before any seed** (dev or prod). The hand-edited markdown is the source of
  truth for transcript text, speakers and personas (`` `Vec as Sascha` ``
  tags, meta `personaTimeline`); fix attribution there, not with post-hoc
  scripts keyed on message numbers, which go stale on the next re-import
  (that's why seed-vec-personas/seed-buzzcut-persona were retired). Two
  files for one episode is a seed error; park stale ones in
  `archive-to-markdown/api-superseded/`.
  Character colors/avatars/blurbs and user color/icon/bio that have no
  other source live in `prisma/scripts/seed-data/{characters,users}.json`, applied by
  `seed-overlay.ts`; after editing records in the site, `npm run export:overlay`
  rewrites those files from the dev DB so the change can be committed.
  Vortox Machina lines appended from Discord (`append-vm-from-discord.ts`,
  speakers keyed by slug) are replayed by `seed-vm-appended.ts` (right after
  `seed-npc-personas.ts`, whose renames the slugs assume) from
  `seed-data/vm-appended-lines.json`: after appending to dev, run `npm run
  export:vm-appended` and commit. seed-legacy also holds `SLUG_OVERRIDES`
  (characters whose slug isn't `slugify(name)`, e.g. Los → `los_yelsi`) and
  `STORY_ONLY_SEASONS` (T&L, FF5: no episodes, but stories file under them).
  `migrate-vm-to-story.ts` and `backfill-slugs.ts` are one-off historical
  migration scripts, already run against the live data; treat them as
  reference, not as repeatable tooling. `create-search-indexes.ts` (and
  `create-triggers.ts`) is different in kind from those two — it's idempotent by design and must stay
  re-runnable (see its header comment and the `db push` bullet above).

## Conventions

- Route handler shape, HTTP status code table, service function naming
  (`getAll[X]`, `get[X]By[Y]`, `create[X]`, `update[X]`, `delete[X]`), and the
  three-layer error-handling pattern (service throws → controller maps to
  status code → global fallback in `app.ts`) are documented in
  `docs/notes/NEW_STYLE_GUIDE.md`. **Follow the patterns, not the examples** — that
  file's code samples (`song`, `playlist`, `mood`, Spotify OAuth env vars,
  MongoDB) are inherited from an unrelated prior project and don't correspond
  to anything in this codebase. This app has no `song`/`playlist`/`mood`
  modules and uses Postgres, not MongoDB.
- Services: no classes, default-exported object of async functions; throw
  `Error` on known-bad input, return `null` (not throw) when a record simply
  doesn't exist.
- 4-space indent, double quotes (matches existing `src/`).
- `GET /:id` routes on `character`/`item`/etc. accept either a numeric id or a
  slug (`/^\d+$/` test picks the lookup path) — follow this pattern for any
  new lookup-by-id-or-slug route.

## Testing

- `api-tests/` is a Bruno collection (`bruno.json`) with folders per
  resource — use it for manual endpoint exercising; there's no automated
  request-level test suite yet despite `docs/notes/NEW_STYLE_GUIDE.md` referencing
  `*.spec.ts` files (none currently exist in `src/`).
