# Final Frontier — API Server

Express/TypeScript/Prisma/Postgres API for the Final Frontier lore archive and
campaign reader: users, characters, species, seasons/episodes/messages,
stories (prose/CYOA), items, commentary. Consumed by the `ff-site` Next.js
frontend (sibling repo, symlinked in as `ff-site/ff-server`) and by any
external client via the token-authenticated API (FR-API-*).

Requirements live in `FF design document.md` (FR-*/NFR-* ids) — read it before
adding or changing scope. **Treat it as a starting point, not current truth**:
the schema has already grown past it in places (the `Story`/`StoryChapter`/
`StoryLine` models implement CYOA/prose reading, which the doc only gestures
at; `EightBallAnswer` isn't in the doc at all) and lags it in others
(`Relationship`, called for by FR-CHAR-4, doesn't exist as a model yet —
`Persona` (FR-CHAR-3, formerly `Alias`), `Species`, `Season`, `Episode`,
`Message`, `Item`, `Commentary`, `Character`, `User` are implemented). Check
`prisma/schema.prisma` for what's actually there.

## Environment

- `npm run dev` runs `tsx watch src/server.ts` — auto-restarts on save.
  Serves on `:3000`; API is under `/api`, Swagger docs (built from
  `src/openapi.ts`) at `/api/docs`.
- `.env` (gitignored; see `README.md` for the template) — `DATABASE_URL`,
  `JWT_SECRET`, `JWT_EXPIRATION`, `SALT_ROUNDS`, `PORT`. `FF_SITE_DIR`
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
  idempotent and safe to re-run.

## Architecture

- **Feature-module layout**: `src/<feature>/<feature>.controller.ts` (routes)
  + `<feature>.service.ts` (Prisma access + business logic). Controllers never
  call Prisma directly. Each service instantiates its own
  `new PrismaClient()` — there is no shared `prisma.ts` singleton (despite
  `NEW_STYLE_GUIDE.md` documenting one; that guide was carried over from a
  different, unrelated project — see caveat below).
- All routers mount under `/api` in `src/app.ts`.
- **Auth**: `Authorization: Bearer <JWT>` header, verified by `authenticate`
  (`src/auth/security.middleware.ts`), which sets `req.user`. `isAdmin` gates
  admin-only routes. Ownership checks (creator-or-admin) are done inline in
  each controller by comparing `req.user.id` to the record's `creatorId` —
  there's no shared ownership-middleware helper. The frontend never sees this
  token directly; `ff-site` wraps it in an httpOnly cookie itself.
- **Response envelope**, every JSON response: `{ status: "success", data }` or
  `{ status: "error", message }`. Never leak raw Prisma objects or stack
  traces.
- **Slugs** (`src/utils/slug.ts`): the derivation (lowercase, spaces/hyphens →
  single underscore, punctuation dropped, doubled underscores collapsed) must
  stay byte-for-byte identical to the wiki's slug rules
  (`Final Frontier Wiki:Slugs` on wiki.vortox.space) and to `ff-site`'s copy —
  slugs are a cross-site identity, not a local convenience.
- **GUY calendar dates** (`src/utils/guy-time.ts`): in-universe dates
  (`Character` DOB, etc.) are stored as integer equinox counts, not
  `DateTime`. An identical copy lives at `ff-site/src/lib/guy-time.ts` —
  changes must land in both. Real-world timestamps (`Message.timestamp`,
  `Episode.playedDate`) stay plain `DateTime`.
- **HTML sanitization** (`src/utils/sanitize.ts`, NFR-SEC-3): user-submitted
  rich text (character blurbs, species descriptions, item descriptions,
  commentary) goes through `sanitizeText()` before storage.
- `prisma/seed.ts` is the orchestrator: wipes all data, then runs
  `SEED_SCRIPTS` (`seed-legacy.ts`, `seed-8ball.ts`, `seed-galaxy.ts`,
  `create-search-indexes.ts`) as child processes, skipping (not aborting) any
  that fail or don't exist on disk — `seed-galaxy.ts` is currently in that
  list but not present in the repo, and is expected to just be skipped.
  `seed:legacy` replays the real archive from `ff-site-old`'s bundled JSON
  (`FF_SITE_DIR`, default `../ff-site-old`) — **only safe against an empty
  DB**, don't rerun against a live dev database with user-authored content.
  `migrate-vm-to-story.ts` and `backfill-slugs.ts` are one-off historical
  migration scripts, already run against the live data; treat them as
  reference, not as repeatable tooling. `create-search-indexes.ts` is
  different in kind from those two — it's idempotent by design and must stay
  re-runnable (see its header comment and the `db push` bullet above).

## Conventions

- Route handler shape, HTTP status code table, service function naming
  (`getAll[X]`, `get[X]By[Y]`, `create[X]`, `update[X]`, `delete[X]`), and the
  three-layer error-handling pattern (service throws → controller maps to
  status code → global fallback in `app.ts`) are documented in
  `NEW_STYLE_GUIDE.md`. **Follow the patterns, not the examples** — that
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
  request-level test suite yet despite `NEW_STYLE_GUIDE.md` referencing
  `*.spec.ts` files (none currently exist in `src/`).
