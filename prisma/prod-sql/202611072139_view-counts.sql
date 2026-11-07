-- CreateEnum
CREATE TYPE "ViewKind" AS ENUM ('EPISODE', 'STORY');

-- CreateTable
CREATE TABLE "view_counts" (
    "kind" "ViewKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "member" INTEGER NOT NULL DEFAULT 0,
    "anonymous" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "view_counts_pkey" PRIMARY KEY ("kind","slug","day")
);

-- CreateIndex
CREATE INDEX "view_counts_day_idx" ON "view_counts"("day");

