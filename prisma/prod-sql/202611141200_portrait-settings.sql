-- CreateTable
CREATE TABLE "portrait_mods" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "itemsOnlyFor" TEXT[],

    CONSTRAINT "portrait_mods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portrait_races" (
    "id" TEXT NOT NULL,
    "species" TEXT,
    "name" TEXT,
    "descriptor" TEXT,
    "category" TEXT,
    "exclude" TEXT[],
    "prefer" TEXT[],
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "lock" JSONB,
    "position" INTEGER NOT NULL,

    CONSTRAINT "portrait_races_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portrait_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "portrait_settings_pkey" PRIMARY KEY ("key")
);

