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
- Suggested resolution precedence when rendering a transcript block:
  `message > episode > season > alias > character`.

## Open questions for when this gets picked up

- Storage shape: override columns sprinkled on existing tables vs. a single
  `CharacterAppearance` table keyed by (character, scope, scope-id).
- Reader plumbing: `TranscriptData` would need the resolved appearance per
  block (resolve server-side vs. ship lookup tables to the client).
- Editing UI: where overrides are managed (character edit page? episode
  admin?).
- `characterColor()` fallback hash (ff-site `src/lib/characterColors.ts`):
  when a character has no explicit color, should the name-hash use the alias
  name (visually distinct eras) or the character name (continuity)?

Related requirement ids: FR-CHAR-3 (aliases, now implemented), FR-CHAR-1
(avatar/theme color fields). Consider folding this into
`FF design document.md` when the design firms up.
