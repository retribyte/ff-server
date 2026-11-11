-- Story notes: a margin note (commentaries) can sit on a story line instead of
-- a transcript message. The message columns become optional and a story line
-- link is added; the check keeps every note on exactly one of the two. A
-- story line's notes are deleted with it (a revision moves them first).
--
-- And app_settings: state the admin Vortox Machina import keeps between runs
-- (the last Discord message it appended, the speaker codes it has learned).
--
-- reviewed: DROP NOT NULL only relaxes the two message columns, which every
-- existing row keeps; nothing is rewritten or removed. The check holds for
-- every existing row (each has its message and no story line), and the new
-- storyLineId foreign key too (the column starts NULL everywhere).
-- AlterTable
ALTER TABLE "commentaries" ADD COLUMN     "storyLineId" INTEGER,
ALTER COLUMN "messageEpisodeTitle" DROP NOT NULL,
ALTER COLUMN "messageNo" DROP NOT NULL;

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "commentaries_storyLineId_idx" ON "commentaries"("storyLineId");

-- AddForeignKey
ALTER TABLE "commentaries" ADD CONSTRAINT "commentaries_storyLineId_fkey" FOREIGN KEY ("storyLineId") REFERENCES "story_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one target per note (Prisma can't express this, so it lives here)
ALTER TABLE "commentaries" ADD CONSTRAINT "commentaries_one_target" CHECK (
    ("messageEpisodeTitle" IS NOT NULL AND "messageNo" IS NOT NULL AND "storyLineId" IS NULL)
    OR ("messageEpisodeTitle" IS NULL AND "messageNo" IS NULL AND "storyLineId" IS NOT NULL)
);
