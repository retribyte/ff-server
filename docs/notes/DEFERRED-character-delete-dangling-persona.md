# DEFERRED — character delete can leave a dangling `Message.personaId`

Found 2026-07-19 during the Persona Phase 1 work (`PLAN-alias.md`,
commit `dbb4836`). Pre-existing interaction, not introduced by the rename —
but the composite FK makes it newly visible. Needs a decision, not urgent.

## The gap

- `messages."characterId"` → `characters` has **`ON DELETE SET NULL`**
  (schema fact; contradicts a code comment claiming character deletion is
  blocked when messages exist).
- The new persona FK is composite: `(personaId, characterId)` →
  `personas(id, characterId)`, with Postgres's default `MATCH SIMPLE`
  semantics — the FK **stops enforcing entirely once either column is
  NULL**.
- So on character delete: messages get `characterId = NULL` (SET NULL fires
  first), then the character's personas cascade-delete — and the messages
  keep a now-dangling `personaId` pointing at a deleted persona row. The
  old single-column `Restrict` FK on `Alias` could never dangle like this.

Observed live on the dev DB during Phase 1 verification (throwaway
character delete left one orphaned `personaId`; fixed by hand).

## Consequences today

Message reads `include` the persona relation; a dangling id resolves to
`null` persona, so rendering falls back to canonical — except the character
is also gone, so it falls to player. Cosmetic, not a crash — but the id is
garbage in the row, and any future `COALESCE`-style raw SQL join would
silently miss.

## Options (pick one when reviewed)

1. **`Restrict` on `messages.characterId`** — block deleting characters who
   have messages (what the code comment already claims happens). Strictest;
   matches the archive's "messages are permanent record" stance. Would need
   an explicit "unassign messages first" admin flow for real deletions.
2. Keep `SET NULL` on `characterId` but also **`SET NULL` the `personaId`**
   on character delete (trigger, or service-level cleanup in the character
   delete path — schema-only can't express "null this other column").
3. Accept and document: dangling `personaId` behind a NULL `characterId` is
   harmless under Prisma reads; add a cleanup query to housekeeping.

Leaning: option 1 — it makes the existing code comment true and matches
`Message.personaId`'s own `Restrict` philosophy. Decide before any real
character deletion is needed.
