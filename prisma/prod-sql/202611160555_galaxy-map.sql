-- CreateEnum
CREATE TYPE "MapPlaceKind" AS ENUM ('SYSTEM', 'LANDMARK');

-- CreateEnum
CREATE TYPE "MapBodyKind" AS ENUM ('STAR', 'PLANET', 'MOON', 'STATION', 'BELT');

-- CreateEnum
CREATE TYPE "MapRegion" AS ENUM ('GU', 'ADE', 'LR', 'RIM');

-- CreateTable
CREATE TABLE "map_places" (
    "id" SERIAL NOT NULL,
    "kind" "MapPlaceKind" NOT NULL,
    "name" TEXT,
    "slug" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "region" "MapRegion",
    "category" TEXT,
    "description" TEXT,
    "creatorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "map_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_bodies" (
    "id" SERIAL NOT NULL,
    "placeId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "kind" "MapBodyKind" NOT NULL,
    "name" TEXT,
    "slug" TEXT,
    "type" TEXT NOT NULL,
    "radiusKm" DOUBLE PRECISION,
    "orbit" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "ordinal" INTEGER,
    "color" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "map_bodies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "map_travelogue" (
    "id" SERIAL NOT NULL,
    "placeId" INTEGER NOT NULL,
    "bodyId" INTEGER,
    "episodeSlug" TEXT NOT NULL,
    "creatorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_travelogue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "map_places_slug_key" ON "map_places"("slug");

-- CreateIndex
CREATE INDEX "map_places_creatorId_idx" ON "map_places"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "map_bodies_slug_key" ON "map_bodies"("slug");

-- CreateIndex
CREATE INDEX "map_bodies_placeId_idx" ON "map_bodies"("placeId");

-- CreateIndex
CREATE INDEX "map_bodies_parentId_idx" ON "map_bodies"("parentId");

-- CreateIndex
CREATE INDEX "map_travelogue_placeId_idx" ON "map_travelogue"("placeId");

-- CreateIndex
CREATE INDEX "map_travelogue_episodeSlug_idx" ON "map_travelogue"("episodeSlug");

-- AddForeignKey
ALTER TABLE "map_places" ADD CONSTRAINT "map_places_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_bodies" ADD CONSTRAINT "map_bodies_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "map_places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_bodies" ADD CONSTRAINT "map_bodies_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "map_bodies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_travelogue" ADD CONSTRAINT "map_travelogue_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "map_places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_travelogue" ADD CONSTRAINT "map_travelogue_bodyId_fkey" FOREIGN KEY ("bodyId") REFERENCES "map_bodies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_travelogue" ADD CONSTRAINT "map_travelogue_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

