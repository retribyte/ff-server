-- One-off migration: Character.speciesId -> Character.species (many-to-many),
-- so hybrids can have more than one species. A bare `prisma db push` would
-- drop characters."speciesId" and create an empty join table, losing every
-- assignment. This creates the join table exactly as Prisma would (DDL taken
-- from `prisma migrate diff`), copies each character's species into it, then
-- drops the old column, leaving the subsequent `db push` a no-op.
--
-- Run BEFORE `npx prisma db push` against the updated schema.prisma:
--   docker exec -i ff-server-db-1 psql -U <user> <db> < prisma/species-to-many.sql
--
-- Not idempotent (a second run fails on "already exists") — one-shot, like
-- rename-alias-to-persona.sql.

BEGIN;

CREATE TABLE "_CharacterToSpecies" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_CharacterToSpecies_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_CharacterToSpecies_B_index" ON "_CharacterToSpecies"("B");

ALTER TABLE "_CharacterToSpecies" ADD CONSTRAINT "_CharacterToSpecies_A_fkey" FOREIGN KEY ("A") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_CharacterToSpecies" ADD CONSTRAINT "_CharacterToSpecies_B_fkey" FOREIGN KEY ("B") REFERENCES "species"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A = Character, B = Species (Prisma orders the sides by model name)
INSERT INTO "_CharacterToSpecies" ("A", "B") SELECT id, "speciesId" FROM characters;

ALTER TABLE "characters" DROP CONSTRAINT "characters_speciesId_fkey";
ALTER TABLE "characters" DROP COLUMN "speciesId";

COMMIT;
