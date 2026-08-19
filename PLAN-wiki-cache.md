# Wiki cache layer — plan

## Background

A prior migration (`5a1f349e Remove wiki-bound info from schema; add slug`)
stripped a batch of quick-reference fields off `Character`, `Species`, and
`Item` (see mapping table below) on the premise that this data now lives on
the wiki instead, queryable via Bucket. That migration landed the DB side
(the `slug` columns) but never built the read path back to the wiki. This
plan covers that read path: a cache table plus a service that serves it,
backed by the wiki's `Bucket` extension.

`FF design document.md` has zero mentions of wiki/bucket/cache — this is new
scope, not yet reflected there. Worth a one-line pointer added once this
lands.

## The wiki query wire format (reverse-engineered, confirmed working)

The `Bucket` MediaWiki extension exposes `action=bucket` on
`https://wiki.vortox.space/w/api.php`. The `query` param is a **raw Lua
expression**, evaluated server-side via a Scribunto console
(`= mw.text.jsonEncode(<query>)`), not JSON and not a declarative filter
object.

```
GET /w/api.php?action=bucket&format=json&query=<lua>
```

Example, confirmed live:

```lua
mw.ext.bucket("characters").select("slug","fullname").where("slug","=","emmett_tawfeek").limit(1).run()
```
```json
{"bucket":[{"fullname":"Squemfet Tawfeek","slug":"emmett_tawfeek"}]}
```

**Gotcha that cost most of the debugging time**: the shipped query-builder's
`__index` metamethod double-binds `self` under colon syntax (`:select(...)`)
— every call must chain with **dots**, not colons. This matches how
`wiki/Module:EntityStore.lua` itself calls it
(`newBucket(t).select(...).where(...).limit(1)`), which is the tell that
should have been checked first.

Reads are **anonymous** — no bot credentials needed, `readrights` is empty on
the module. Do not import `wiki/config.json` (bot password) into ff-server;
it isn't needed for this feature.

`pingLimiter('bucketapi', 1)` rate-limits the endpoint — another reason to
prefer whole-bucket pulls over per-slug requests (see below).

## Data reality (checked against the live wiki + local dev DB)

- Bucket sizes: `characters` 30 rows, `species` 37, `items` 8 — all well
  under the 500-row default limit (max 5000), so **one request per bucket
  retrieves everything**.
- Every wiki row in these three buckets has a `slug` (the wiki's
  missing-slug backlog doesn't currently affect them).
- DB has 297 `characters` rows (`messages` has 43,490 — this is real seeded
  archive data), but only **17 of them slug-match a wiki character exactly**.
  The other ~280 are one-off NPCs/bit-parts from the chat archive that will
  never have a wiki page. This is expected, not a bug — most cache lookups
  for characters will be legitimate negatives.
- 13 wiki characters (`ameno`, `era`, `isis`, `llod_ravire`,
  `radimo_belleheim`, `reaper`, `squellis_tawfeek`, `squoat`,
  `theylin_revane`, `vokhul_grimbreath`, `wemmfort`, `wes_romaw`, `yeinud`)
  have **no** DB slug match despite clearly being real characters — naming
  drift between the two systems. **Decision: out of scope for this pass.**
  Exact-slug lookup only; unmatched wiki characters stay invisible to the DB
  side. Not fixed here, just logged.
- `species` has exactly 1 DB row (`unclassified`, a placeholder) and `items`
  has 0 in the current dev DB. **Decision: expected, build the cache layer
  for all three buckets anyway** — data will show up once those tables are
  properly seeded; no reason to special-case them out.

## Field mapping (removed DB field → wiki bucket field)

| DB (removed) | Wiki field (`characters` bucket) | Notes |
|---|---|---|
| `dob` (GUY equinox int) | `birthdate` | **Free text** (`"25-7 2998 GUY"`), not a GUY int. No parser exists — don't build one here. |
| `pob` | `birthplace` | Page ref (title string, e.g. `"Squoatopia, Vortox-56"`). |
| `sex` | `sex` | Enum on the wiki side. |
| `height`, `weight` | `height`, `weight` | Free text (e.g. `5'4"`, `87 lbs.`). |
| `hairColor` | `hair` | |
| `eyeColor` | `eyes` | |
| `homePlanet` | `planet` | Page ref, repeated. |
| `Alias[]` (model) | `aliases` | Repeated text. |
| `Relationship[]` (model) | `relationship` | Repeated text. |
| `wikiArticle` | — | Not a field; derive from `page_name` (the article title/URL) instead. |

| DB (removed, `Species`) | Wiki field (`species` bucket) |
|---|---|
| `binomialName` | `union_name` |
| `lifespan` | `lifespan` |
| `diet` | `diet` |
| `habitat` | `habitat` |
| `placeOfOrigin` | `homeworld` |
| `wikiArticle` | `page_name` |

| DB (removed, `Item`) | Wiki field (`items` bucket) |
|---|---|
| `characterId` (FK) | `character` / alias `used_by` | Page ref, not a resolved FK. |
| `wikiArticle` | `page_name` |

The wiki also carries fields the DB never had (`deathdate`, `deathcause`,
`technology_progression`, `government`, `religion`, `procreation_method`,
...) — free upside, not something to force into a fixed DB schema, which is
exactly why the cache is a JSON blob (see below).

## Design

### Cache table — one generic table, not per-type, not per-field

```prisma
model WikiCache {
  bucket    String   // "characters" | "species" | "items"
  slug      String
  data      Json?    // full row from the wiki, or null = confirmed absent
  fetchedAt DateTime @default(now())

  @@id([bucket, slug])
  @@map("wiki_cache")
}
```

- `data: null` is a first-class state (a **negative cache entry**), not an
  error — given how few characters have wiki pages, this is the common case,
  not the exception. Without it, every unmatched entity gets re-queried on
  every request forever.
- JSON blob means the vocab churn documented in
  `wiki/entitystore-migration-plan.md` (enums demoted to text, fields
  added/removed) never requires a `db push` on this side.
- TTL is read at query time from two constants, not stored per-row:
  **positive 24h, negative 7d** (wiki content changes rarely; a confirmed
  "no page" changes even less often).

### `src/wiki/` — new feature module, same layout as the rest of `src/`

- **`wiki.client.ts`** — builds the `.select().where().limit()` Lua query
  string and fetches it. Any slug interpolated into the query is validated
  against `/^[a-z0-9]+(_[a-z0-9]+)*$/` first — `query` is server-executed Lua
  on someone else's wiki, so this is real injection surface, not paranoia.
  Short timeout (`AbortSignal`, ~3–5s) — the wiki must never be able to hang
  an API response.
- **`wiki.service.ts`** — cache-aside `getWikiData(bucket, slug)`:
  1. Read `WikiCache`. If present (even if stale), return it immediately —
     never block a response on a live wiki refresh.
  2. Stale or absent → kick a background refresh, don't await it inline.
  3. True cache miss (row never seen) → one live fetch with the timeout
     above, upsert the result (or a negative entry), return it.

### Refresh — whole-bucket, not per-slug

Given bucket sizes (30/37/8 rows), a single `.limit(500).run()` per bucket
pulls everything in one request. A script,
`prisma/refresh-wiki-cache.ts` (same spirit as
`wiki/scripts/bucket-refresh.js`), does one pull per bucket, upserts every
returned row, and writes negative entries for every DB slug that didn't come
back — negatives and positives fall out of the same pass. Runnable
standalone; cron/schedule wiring is a separate future decision, not part of
this pass.

### Serving

Wiki-sourced fields go in a nullable sub-object on the character/species/item
response:

```json
{ "id": 12, "name": "Emmett Tawfeek", "slug": "emmett_tawfeek", "wiki": { "sex": "Male", "height": "5'4\"", ... } }
```

so a down wiki or a missing page never breaks `/api/characters/:slug` — the
envelope stays `{status:"success", data}` either way, just with `wiki: null`.

### Sanitization

Wiki text fields carry raw wikitext debris confirmed in real data:
`{{Icon|Duckett}}` (items.value), `<small>` (ships.manufacturer), stray
`[[...]]` on non-`page_ref` fields, `<super>2</super>` (Luna). Run values
through the existing `src/utils/sanitize.ts` **once, at cache-write time**
(in the refresh script / on a live miss), not on every read.

## Explicitly out of scope for this pass

- Write-back to the wiki.
- RecentChanges/webhook-based cache invalidation — TTL is enough for now.
- Resolving `page_ref` fields (`planet`, `birthplace`, `faction`, item
  `character`) to actual DB rows/slugs. These come back as wiki page titles;
  resolving them means re-deriving a slug from a title and hoping — the same
  fragile join this feature already has to live with once. Keep them as
  display strings for v1.
- Reconciling the 13 wiki/DB character slug mismatches listed above.
- Per-field TTLs, or a generic all-17-entity-type abstraction (only
  `characters`, `species`, `items` have DB counterparts today).

## Execution order

1. `prisma/schema.prisma` — add the `WikiCache` model. `npx prisma db push`
   + `npx prisma generate`.
2. `src/wiki/wiki.client.ts` — slug-validated Lua query builder + fetch
   against `action=bucket` (dot-chained, anonymous read, short timeout).
3. `src/wiki/wiki.service.ts` — cache-aside `getWikiData(bucket, slug)` as
   described above.
4. `prisma/refresh-wiki-cache.ts` — whole-bucket pull per type, upsert
   positives, write negatives for unmatched DB slugs.
5. Wire `wiki.service.ts` into `character.service.ts` / `species.service.ts`
   / `item.service.ts` `get...ById`/`get...BySlug` — attach the nullable
   `wiki` sub-object, sanitized via `sanitizeText()` at cache-write time.
6. One-line pointer added to `FF design document.md` noting the wiki-cache
   layer exists.
