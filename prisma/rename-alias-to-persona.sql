-- One-off migration: Alias -> Persona rename (see PLAN-alias.md §6, watch-out
-- #1 in §0). `prisma db push` cannot rename tables/columns — run against a
-- bare `db push` diff it would DROP `aliases`/`messages."aliasId"` and
-- recreate `personas`/`messages."personaId"` from scratch, losing data. This
-- script does the rename with plain ALTER TABLE/COLUMN/CONSTRAINT statements
-- (metadata-only, no data movement), reconciling the DB to exactly what
-- `prisma db push` will expect to find for the new Persona model so the
-- subsequent `db push` is a no-op/near-no-op.
--
-- Run BEFORE `npx prisma db push` against the updated schema.prisma:
--   docker exec -i ff-server-db-1 psql -U <user> <db> < prisma/rename-alias-to-persona.sql
--
-- Deliberately NOT done here (left to `prisma db push`, which only ADDs
-- these — no drops, no data loss):
--   - new nullable columns: personas.label, personas.image, personas.color
--   - relaxing personas.name / personas.slug to nullable
--   - the new composite unique personas_id_characterId_key
--   - the new composite FK messages_personaId_characterId_fkey (replacing
--     the single-column messages_aliasId_fkey, which this script leaves in
--     place under its old name for db push to drop/replace)
--
-- Not idempotent as written (a second run will fail on "relation already
-- exists" / "does not exist" errors) — this is a one-shot script for the
-- live dev DB, matching backfill-slugs.ts's own one-off, not-repeatable-
-- tooling status (see CLAUDE.md).

BEGIN;

-- Table + column renames -----------------------------------------------
ALTER TABLE aliases RENAME TO personas;
ALTER TABLE personas RENAME COLUMN alias TO name;
ALTER TABLE messages RENAME COLUMN "aliasId" TO "personaId";

-- Sequence backing personas.id (implicit from @default(autoincrement()))
ALTER SEQUENCE aliases_id_seq RENAME TO personas_id_seq;

-- Constraint/index renames, to the exact names Prisma's default naming
-- convention (`<table>_<column(s)>_<key|pkey|fkey>`) expects for the
-- @@map("personas") Persona model. Only the primary key and the FK are real
-- pg_constraint rows (`ALTER TABLE ... RENAME CONSTRAINT`); `@unique`/
-- `@@unique` are plain unique indexes with no backing constraint row, so
-- those go through `ALTER INDEX ... RENAME TO` instead.
ALTER TABLE personas RENAME CONSTRAINT aliases_pkey TO personas_pkey;
ALTER TABLE personas RENAME CONSTRAINT "aliases_characterId_fkey" TO "personas_characterId_fkey";
ALTER INDEX aliases_id_key RENAME TO personas_id_key;
ALTER INDEX aliases_slug_key RENAME TO personas_slug_key;
-- Old index was @@unique([characterId, alias]); the new model's
-- @@unique([characterId, name]) covers the same two columns (characterId,
-- now-renamed name) so this is a straight rename, not a new index.
ALTER INDEX "aliases_characterId_alias_key" RENAME TO "personas_characterId_name_key";

COMMIT;
