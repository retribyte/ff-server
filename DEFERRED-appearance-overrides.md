# Deferred: character appearance overrides (image/color)

Noted 2026-07-18 while building the alias feature (`Alias` model +
`Message.aliasId`). The alias feature ships **minimal**: an alias is only a
display *name* — blocks attributed to an alias still render the character's
canonical avatar and theme color.

## The problem this defers

Era-accurate presentation. Example: Vec spends FF4 episodes 2–10 as "Fungus";
with name-only aliases, Fungus-era transcript blocks show Vec's avatar and
color — an anachronism and a mild spoiler (the visual identity reveals the
alias is the same character before the story does).

## Deferred design (direction, not commitment)

- Optional `image`/`color` override columns on `Alias`.
- **More granular still** (explicitly wanted): per-**season**, per-**episode**,
  and per-**message** image/color overrides for a character, so a character's
  look can evolve over the archive even without a name change.
- **Same granularity for the alias assignment itself, not just image/color**
  (noted 2026-07-19): optional `aliasId`/`Alias` fields on `Episode` and
  `Season`, in addition to the existing `Message.aliasId`. Goal: a character
  can go by an alias for most of an episode but revert to their real name (or
  a different alias) for a handful of messages, without hand-tagging every
  single message. Set the alias once at season/episode scope as the default,
  then override individual messages where the name changes mid-episode and
  changes back — e.g. Vec is "Fungus" for all of FF4E11 until a conflict
  occurs where he chooses his own name for the first time.
- Suggested resolution precedence when rendering a transcript block, now
  covering `aliasId` as well as `image`/`color`:
  `message > episode > season > alias > character`. A `null` at a given
  scope should be distinguishable from "unset" if we ever need to force a
  revert to canonical name/appearance mid-scope (the "changes back" case)
  rather than just falling through to the next-broader scope.

## Open questions for when this gets picked up

- Storage shape: override columns sprinkled on existing tables vs. a single
  `CharacterAppearance` table keyed by (character, scope, scope-id) — this
  now needs to hold `aliasId` too, not just `image`/`color`.
- Scoping conflict: `Alias` (and therefore `aliasId`) belongs to one
  `Character`, but a `Season`/`Episode` involves many characters. A single
  `Episode.aliasId` column only works if it's understood as "the alias
  override for whichever character this applies to" — which likely forces
  the join-table shape (keyed by character) rather than a plain column on
  `Episode`/`Season`, unlike `image`/`color` which could plausibly stay as
  simple nullable columns.
- Reader plumbing: `TranscriptData` would need the resolved appearance *and*
  resolved alias per block (resolve server-side vs. ship lookup tables to the
  client).
- Editing UI: where overrides are managed (character edit page? episode
  admin?), and how a bulk episode/season-level alias assignment interacts
  with per-message exceptions in that UI (e.g. "apply to all messages in this
  episode except the ones I've already overridden").
- `characterColor()` fallback hash (ff-site `src/lib/characterColors.ts`):
  when a character has no explicit color, should the name-hash use the alias
  name (visually distinct eras) or the character name (continuity)?

Related requirement ids: FR-CHAR-3 (aliases, now implemented), FR-CHAR-1
(avatar/theme color fields). Consider folding this into
`FF design document.md` when the design firms up.
