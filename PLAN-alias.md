# Persona feature — complete plan

Supersedes `DEFERRED-appearance-overrides.md` (2026-07-18/19 notes) and the
first draft of this plan. The scoped-override design
(`CharacterPresentation` table, season/episode read-time defaults, `revert`
flag) discussed there is **rejected** — see §7 for the reasoning trail. Fold
the outcome into `FF design document.md` once implemented (Phase 4).

## 0. Pick-up notes (read first in a fresh session)

Watch-outs that must not get lost between sessions — each is detailed in the
section referenced:

1. **The `Alias` → `Persona` rename is destructive if done naively** —
   `prisma db push` can't rename; it would drop `aliases`/`aliasId` and
   recreate `personas`/`personaId`, **losing data**. Run the one-off
   `ALTER TABLE`/`ALTER COLUMN` script *first*, then push to reconcile. §6.
2. **Stray migrations directory** — untracked
   `prisma/migrations/20260719151729_idskdsa/` (accidental
   `prisma migrate dev` artifact, 2026-07-19) contradicts the project's
   `db push`-only convention. Remove it or consciously adopt migrations
   *before* any Phase 1 schema work, so the diff baseline is unambiguous. §6.
3. **Composite FK needs a Prisma feasibility check** — the hardening FK
   `(personaId, characterId) → personas(id, characterId)` requires
   `Message.characterId` to participate in two relations; verify Prisma
   accepts this before committing to it. Documented fallback: keep the
   service-level `assertAliasMatchesCharacter` as the guard. §3.
4. **Phase 1's API rename breaks the importer** — `EpisodeImporter` fetches
   `/aliases` at mount; its rename to `/personas` (and the
   `alias:<id>` → `persona:<id>` encoding) must land in the same Phase 1
   site commit, not wait for Phase 3. §5, §9.
5. **Repo state when this plan was written (2026-07-19)**: shipped baseline
   is ff-server `db2c4399` + ff-site `6a7e7e1`; this file is untracked in
   ff-server; `DEFERRED-appearance-overrides.md` has uncommitted working-tree
   edits (its 2026-07-19 additions). Neither has been committed — decide
   whether to commit the plan (and optionally rename this file to
   `PLAN-persona.md` to match the model) when picking this up.

## 1. Design summary

The shipped `Alias` model generalizes into **`Persona`**: optionally a
different display *name*, optionally a different *image*/*color*, attached to
a character. `Message.personaId` (today `Message.aliasId`) is the **single
presentation mechanism** — message-only truth, no scoped defaults, no
read-time precedence:

- "Vec goes by Fungus" → persona with `name: "Fungus"`.
- "Vec looks battle-scarred from E12 on" → persona with only `image` set.
- "Fungus with the spore-cloud avatar" → one persona carrying both.

Season/episode-wide assignment is a **write-time bulk stamp** (an endpoint
that sets `personaId` across matching messages), not a stored default
consulted at render time. Exceptions ("except the three messages where his
real name slips out") are just cleared stamps — `personaId = null`
unambiguously means canonical, because nothing sits behind it. Two-state, no
`revert`.

**Determinacy requirement** (the driving constraint): a character's effective
presentation per message is resolvable in one SQL query, with every invariant
a real database constraint:

```sql
SELECT COALESCE(p.name,  c.name)  AS display_name,
       COALESCE(p.image, c.image) AS display_image,
       COALESCE(p.color, c.color) AS display_color
FROM messages m
LEFT JOIN characters c ON c.id = m."characterId"
LEFT JOIN personas   p ON p.id = m."personaId";
```

Nulls compose per-field: a persona setting only `image` falls through to the
canonical name and color inside the same expression.

## 2. Where things stand (shipped)

`ff-server` db2c4399 + `ff-site` 6a7e7e1 shipped the minimal name-only
feature under the `Alias` name:

- `Alias { id, alias, slug, characterId }`, `@@unique([characterId, alias])`,
  cascade on character delete; nullable `Message.aliasId` with
  `onDelete: Restrict`.
- Server: alias CRUD (`/characters/:id/aliases`, `/aliases`), alias-aware
  character search (FR-CHAR-9), character-by-slug falls back to alias slugs
  (`vec_fungus` → Vec), `assertAliasMatchesCharacter` on every message write,
  message reads include `alias {id, alias}`.
- Site: `TranscriptData.aliases` lookup table; block grouping splits on
  `aliasId`; speaker = `alias ?? character ?? player`; character-page
  "also known as" chips and "(as Fungus)" quote context; `AliasManager` on
  the character edit page; `EpisodeImporter` matches speakers against aliases
  (`char:<id>` / `alias:<id>` encoding).

Gaps: alias-era blocks still render canonical avatar/color (the anachronism);
no bulk assignment; no post-import tagging UI.

## 3. Data model

```prisma
// A way a character is presented for some stretch of the archive: a
// different name, a different look, or both. Attached per message via
// Message.personaId — the only presentation mechanism. Named-persona slugs
// are permanent once created (same philosophy as Character/Item/Species).
model Persona {
  id          Int       @id @unique @default(autoincrement())
  name        String?   // null = no name opinion → canonical name shows
  label       String?   // admin-facing handle ("fungus era", "battle-scarred"); never rendered in transcripts
  slug        String?   @unique // null for name-less personas (no URL identity)
  image       String?   // era avatar; falls back to character.image
  color       String?   // era theme color; falls back to character.color
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  characterId Int
  messages    Message[]

  @@unique([characterId, name]) // Postgres: NULLs distinct → many name-less personas allowed
  @@unique([id, characterId])   // target for Message's composite FK (§ hardening)
  @@map("personas")
}

model Message {
  // ...existing fields; aliasId renamed:
  persona     Persona? @relation(fields: [personaId, characterId], references: [id, characterId], onDelete: Restrict)
  personaId   Int?
}
```

Key properties:

- **Nullable `name`** makes "no name change, new look only" a schema fact,
  not a convention — no alias-literally-named-"Vec" trick, no
  `name !== character.name` filters that break on character rename, no
  `vec_vec` slugs.
- **Composite-FK hardening**: `(personaId, characterId)` referencing
  `personas(id, characterId)` makes a cross-character persona
  *unrepresentable* at the DB level, retiring `assertAliasMatchesCharacter`
  as the load-bearing guard (keep it for friendly error messages). ⚠️ Verify
  Prisma accepts `characterId` participating in both the `character` and
  `persona` relations on `Message`; if it refuses, fall back to the current
  service-level assert — everything else stands.
- **Uniqueness**: `@@unique([characterId, name])` forbids duplicate persona
  *names* per character while allowing many name-less personas (Postgres
  treats NULLs as distinct). Same mechanics let `slug` stay `@unique` while
  null for name-less personas.
- **Delete guard**: `Restrict` on `Message.personaId` — a persona used in the
  archive can't be deleted (the `AliasManager` delete-error handling already
  copes with this).
- Service-level validation (friendliness, not integrity): a persona must set
  at least one of `name`/`image`/`color`; require `label` when `name` is
  null so `PersonaManager` rows are distinguishable.

## 4. API surface (ff-server)

Rename-in-place of the alias endpoints plus one new operation:

- **Persona CRUD**: `/characters/:id/personas`, `/personas`,
  `/personas/:id` (today `…/aliases`). Create/update accept
  `name?`, `label?`, `slug?`, `image?`, `color?`. Slug default for named
  personas stays `<character_slug>_<name_slug>`; name-less personas get no
  slug.
- **Bulk stamp** (the "set it once" path, write-time):
  - `POST /episodes/:episodeTitle/personas/apply` body
    `{characterId, personaId}` — sets `personaId` on every message of that
    character in the episode; `personaId: null` clears. Returns the updated
    count.
  - `POST /seasons/:seasonTitle/personas/apply` — same across a season.
  - Exceptions afterward via the existing per-message
    `PUT /episodes/:t/messages/:no` (payload field renamed
    `aliasId` → `personaId`).
- **Message payloads**: `personaId` in `POST`/`PUT` bodies; reads include
  `persona {id, name, image, color}` (nullable fields included so the site
  can build its lookup table without a second fetch).
- **Character-by-slug fallback**: persona slugs resolve to the owning
  character, as alias slugs do today.
- Auth on bulk stamp: character owner or admin (FR-CHAR-8's spirit) — see
  open question §8.2.
- `openapi.ts` + `api-tests/` Bruno folder renamed/extended (`aliases/` →
  `personas/`, plus apply-endpoint requests).

## 5. ff-site changes

- **Types/plumbing**: `Alias` type → `Persona` (`name` nullable, `label`,
  `image`, `color`); `TranscriptData.aliases` → `personas` lookup table
  carrying `{name, image, color}`; `SlimMessage.aliasId` → `personaId`.
  Block grouping splits on `personaId` — correct even for look-only changes
  (a mid-episode look change is a visual break).
- **`StoryBlock`**: speaker = `persona?.name ?? character?.name ??
  player?.name`; avatar = `persona?.image ?? character?.image ??
  player?.icon`; color passes `persona?.color ?? character?.color` into
  `characterColor()`.
- **`characterColor()` fallback hash**: keep hashing the *displayed* name
  (current behavior — `speaker` is what's passed in). Visual distinctness is
  the point of the feature; continuity is served by the block linking to the
  real character page. Side effect worth keeping: the light-mode legacy
  color table won't match era names like "Fungus", so it can't leak the
  canonical color.
- **Character page**: "also known as" chips filter to `name != null`
  (name-less personas are presentation plumbing, not lore facts); quote
  context "(as Fungus)" reads `persona.name` and skips name-less personas.
- **Editing UI**:
  - `AliasManager` → **`PersonaManager`** on the character edit page: rows
    gain `label`, `image` URL, and color inputs; name now optional (with the
    require-label-when-name-less rule surfaced inline).
  - **Episode/season stamp UI**: admin section on episode (and season) pages —
    pick character, pick persona (or "canonical"), apply; calls the bulk
    endpoints. This replaces the previously planned "presentation defaults
    panel"; it *does* something once rather than *meaning* something forever.
  - **Reader per-block control**: admin-only affordance on a block (next to
    the copy button) opening an "attribution" popover — set/clear persona for
    that message or the whole block. Closes the post-import tagging gap.
  - **`EpisodeImporter`**: encoding `alias:<id>` → `persona:<id>`; dropdown
    labels use `name ?? label`. Optional nicety: when every one of a
    character's speaker matches resolved through one persona, note that the
    bulk endpoint could have done it — no behavior change required, since
    stamping at import time already yields the same rows.

## 6. Migration & rollout

The rename is the delicate step under the `db push`-only workflow — **push
cannot rename**, it would drop `aliases` and recreate `personas`, losing
data. Sequence:

1. One-off SQL script (in the spirit of `backfill-slugs.ts`):
   `ALTER TABLE aliases RENAME TO personas`, rename column `alias` → `name`,
   `messages."aliasId"` → `"personaId"`, and rename the affected
   indexes/constraints to what Prisma will expect.
2. Update `prisma/schema.prisma` (§3), then `npx prisma db push` to
   reconcile (should be a no-op or near-no-op if step 1 matched) +
   `npx prisma generate`.
3. Verify row counts and the composite FK before/after on a dev DB first;
   the live data is young and small, but it's real.
4. Housekeeping while in there: the untracked
   `prisma/migrations/20260719151729_idskdsa/` contradicts the project's
   `db push`-only convention (looks like a stray `prisma migrate dev`
   artifact) — remove or consciously adopt migrations before this schema
   work, so the diff baseline is unambiguous.
5. Legacy seed untouched — FF2/Vortox Machina data has no personas; FF4
   enters through the importer.

## 7. Decisions made (and why)

1. **Message-only truth; no scoped read-time defaults** — season/episode
   defaults required a tri-state (`revert`) to escape mid-scope, and
   DB-enforcing "one override row per (character, scope)" on a polymorphic
   table needed partial unique indexes that Prisma can't express and
   `db push` would drop. Write-time bulk stamping keeps the workflow ("set
   once, override exceptions") while making presentation resolvable in one
   constrained SQL query. Accepted costs: messages appended later don't
   inherit anything (imports are one-shot; re-stamp if needed), and eras are
   *derived* from messages rather than *declared* anywhere (fine for
   rendering; derivable with GROUP BY if the character page ever wants to
   state them).
2. **Appearance lives on `Persona`, not on `Message`** — per-message
   `image`/`color` columns would be equally determinate but denormalized: an
   era's look copied across hundreds of rows, edits become re-stamps, and two
   mechanisms can disagree about one message. The persona-creation overhead
   for a genuine one-off look is one form submission.
3. **Nullable `name` rather than same-name aliases** for look-only eras —
   "no name opinion" as schema fact beats convention (see §3).
4. **Rename `Alias` → `Persona`** — the model now holds more than names;
   renamed everywhere (schema, API paths, payload fields, site types,
   components) in one churn event while the feature is days old and has one
   consumer.
5. **Fallback hash on displayed name** (§5).
6. **If declared defaults are ever truly needed later**: per-scope tables
   (`SeasonPresentation` / `EpisodePresentation`) with plain composite
   uniques are the shape to add — they layer on top of this design without
   undoing it. Explicitly out of scope now.

## 8. Open questions

1. **Character-page spoilers** — persona chips and persona-slug redirects
   openly reveal the mapping the transcript works to hide. Accept (the
   archive is for people who've read the story) or gate later; out of scope
   here.
2. **Who may bulk-stamp** — admin-only, or character owner too? Stamping
   touches someone else's episode but *their* character. Leaning: owner or
   admin, matching FR-CHAR-8; decide at Phase 2.
3. **Write-time prefill metadata** — an optional per-episode "default
   persona" record used only to prefill the importer/stamp UI (never read at
   render time) would restore "new messages inherit the default" without
   reintroducing precedence. Deferred until the workflow actually demands it.

## 9. Phasing

| Phase | Scope | Ships value alone? |
|-------|-------|--------------------|
| **1** | Rename + schema (§3, §6): `Persona`, nullable `name`, `label`, `image`/`color`, composite FK; API rename; reader renders persona image/color; `PersonaManager` inputs; openapi/Bruno | Yes — fixes the Fungus anachronism for already-tagged messages |
| **2** | Bulk-stamp endpoints (episode + season) + Bruno coverage | Yes — season/episode-wide assignment via API before any UI |
| **3** | UI: episode/season stamp section, reader per-block attribution control, importer encoding update | Yes |
| **4** | Fold into `FF design document.md` (rewrite FR-CHAR-3 around personas; extend FR-CHAR-1's avatar/color story), delete `DEFERRED-appearance-overrides.md` and this file | Housekeeping |

Phase 1 carries the rename, so it's the churn event — land it in one sitting
across both repos (separate commits: `git -C ff-server`, `git -C ff-site`).
Phases 2→3 are sequential and small. The importer keeps working throughout
(only its encoding string changes, in Phase 3 at the latest — Phase 1's API
rename does break the `/aliases` fetch, so the importer's rename belongs in
Phase 1's site commit).
