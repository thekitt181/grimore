-- CreateTable
CREATE TABLE "DdbConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cobaltEncrypted" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastValidatedAt" TIMESTAMP(3),
    "syncHpToDdb" BOOLEAN NOT NULL DEFAULT true,
    "rollBridgeEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DdbConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdbCharacterCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ddbCharacterId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "campaignId" INTEGER,
    "snapshot" JSONB NOT NULL,
    "updateId" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DdbCharacterCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdbCampaignLink" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "ddbCampaignId" INTEGER NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DdbCampaignLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DdbConnection_userId_key" ON "DdbConnection"("userId");

-- CreateIndex
CREATE INDEX "DdbCharacterCache_userId_idx" ON "DdbCharacterCache"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DdbCharacterCache_userId_ddbCharacterId_key" ON "DdbCharacterCache"("userId", "ddbCharacterId");

-- CreateIndex
CREATE UNIQUE INDEX "DdbCampaignLink_campaignId_key" ON "DdbCampaignLink"("campaignId");

-- AddForeignKey
ALTER TABLE "DdbConnection" ADD CONSTRAINT "DdbConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdbCharacterCache" ADD CONSTRAINT "DdbCharacterCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdbCampaignLink" ADD CONSTRAINT "DdbCampaignLink_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
