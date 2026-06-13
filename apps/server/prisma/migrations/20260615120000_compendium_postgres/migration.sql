-- Compendium storage in PostgreSQL (replaces MongoDB typed collections + global doc)

CREATE TYPE "CompendiumEntryKind" AS ENUM ('MONSTER', 'ITEM', 'SPELL');

CREATE TABLE "CompendiumMeta" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "deleted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lockedSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedEntryKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompendiumMeta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompendiumEntry" (
    "id" TEXT NOT NULL,
    "kind" "CompendiumEntryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "originBookName" TEXT,
    "inTypedImport" BOOLEAN NOT NULL DEFAULT false,
    "inGlobalOverride" BOOLEAN NOT NULL DEFAULT false,
    "inGlobalHomebrew" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompendiumEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompendiumEntry_kind_idx" ON "CompendiumEntry"("kind");
CREATE INDEX "CompendiumEntry_kind_inTypedImport_idx" ON "CompendiumEntry"("kind", "inTypedImport");
CREATE INDEX "CompendiumEntry_kind_inGlobalOverride_idx" ON "CompendiumEntry"("kind", "inGlobalOverride");
CREATE INDEX "CompendiumEntry_kind_inGlobalHomebrew_idx" ON "CompendiumEntry"("kind", "inGlobalHomebrew");
CREATE INDEX "CompendiumEntry_kind_source_idx" ON "CompendiumEntry"("kind", "source");
CREATE INDEX "CompendiumEntry_nameKey_idx" ON "CompendiumEntry"("nameKey");

CREATE TABLE "CompendiumImageRef" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompendiumImageRef_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "CompendiumImageBlob" (
    "key" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompendiumImageBlob_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "CompendiumEntryImageHistory" (
    "entryName" TEXT NOT NULL,
    "urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompendiumEntryImageHistory_pkey" PRIMARY KEY ("entryName")
);

INSERT INTO "CompendiumMeta" ("id", "deleted", "lockedSources", "publishedEntryKeys", "lastUpdated", "updatedAt")
VALUES ('global', ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
