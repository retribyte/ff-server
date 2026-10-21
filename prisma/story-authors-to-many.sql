-- One-off migration: Story.authorId -> Story.authors (many-to-many), so
-- co-written stories (Final Pummel has four authors) can credit everyone. A
-- bare `prisma db push` would drop stories."authorId" and create an empty
-- join table, losing every author. This creates the join table exactly as
-- Prisma would (DDL taken from `prisma migrate diff`), copies each story's
-- author into it, then drops the old column, leaving the subsequent
-- `db push` a no-op.
--
-- Run BEFORE `npx prisma db push` against the updated schema.prisma:
--   docker exec -i ff-server-db-1 psql -U <user> <db> < prisma/story-authors-to-many.sql
--
-- Not idempotent (a second run fails on "already exists") — one-shot, like
-- species-to-many.sql.

BEGIN;

CREATE TABLE "_StoryToUser" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_StoryToUser_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_StoryToUser_B_index" ON "_StoryToUser"("B");

ALTER TABLE "_StoryToUser" ADD CONSTRAINT "_StoryToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_StoryToUser" ADD CONSTRAINT "_StoryToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A = Story, B = User (Prisma orders the sides by model name)
INSERT INTO "_StoryToUser" ("A", "B") SELECT id, "authorId" FROM stories WHERE "authorId" IS NOT NULL;

ALTER TABLE "stories" DROP CONSTRAINT "stories_authorId_fkey";
ALTER TABLE "stories" DROP COLUMN "authorId";

COMMIT;
