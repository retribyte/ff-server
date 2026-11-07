-- Story.canon, Character.colorLight, Character.mainIn (_MainCharacters),
-- Episode.reconstructed; then the story-shelf data (the VM season, the
-- non-canon stories), the same steps as `npm run seed:story-shelf`.
-- DDL from `prisma migrate diff`, made re-runnable (IF NOT EXISTS) in case
-- any of it was applied by hand before migrations were tracked.
--
-- reviewed: the UPDATEs only file the `vm` story under the new VM season and
-- set canon = false on five named stories; no other rows change.

ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "colorLight" TEXT;
ALTER TABLE "episodes" ADD COLUMN IF NOT EXISTS "reconstructed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "canon" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "_MainCharacters" (
    "A" INTEGER NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MainCharacters_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX IF NOT EXISTS "_MainCharacters_B_index" ON "_MainCharacters"("B");
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_MainCharacters_A_fkey') THEN
        ALTER TABLE "_MainCharacters" ADD CONSTRAINT "_MainCharacters_A_fkey" FOREIGN KEY ("A") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_MainCharacters_B_fkey') THEN
        ALTER TABLE "_MainCharacters" ADD CONSTRAINT "_MainCharacters_B_fkey" FOREIGN KEY ("B") REFERENCES "seasons"("title") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Vortox Machina: a story-only spin-off campaign, like T&L
INSERT INTO "seasons" ("title", "slug", "kind") VALUES ('VM', 'vm', 'SIDE')
    ON CONFLICT ("title") DO UPDATE SET "kind" = 'SIDE';
UPDATE "stories" SET "seasonTitle" = 'VM' WHERE "slug" = 'vm';

-- Non-canon stories
UPDATE "stories" SET "canon" = false WHERE "slug" IN (
    'the_interviews',
    'zombification',
    'a_bad_day_for_everyone',
    'do_emmetts_dream_of_llamanian_sheep',
    'obama_story'
);
