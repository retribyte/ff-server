-- CreateTable
CREATE TABLE "portraits" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "race" TEXT NOT NULL,
    "recipe" JSONB NOT NULL,
    "image" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portraits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portraits_ownerId_idx" ON "portraits"("ownerId");

-- AddForeignKey
ALTER TABLE "portraits" ADD CONSTRAINT "portraits_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

