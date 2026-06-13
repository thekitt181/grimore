-- AlterTable
ALTER TABLE "Handout" ADD COLUMN IF NOT EXISTS "compendiumItemId" TEXT;
ALTER TABLE "Handout" ADD COLUMN IF NOT EXISTS "ddbDefinitionId" INTEGER;
ALTER TABLE "Handout" ADD COLUMN IF NOT EXISTS "itemMeta" JSONB;
ALTER TABLE "Handout" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "HandoutReceipt" (
    "id" TEXT NOT NULL,
    "handoutId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "imageUrl" TEXT,
    "type" "HandoutType" NOT NULL,
    "itemMeta" JSONB,
    "compendiumItemId" TEXT,
    "ddbDefinitionId" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoutReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "HandoutReceipt_handoutId_userId_key" ON "HandoutReceipt"("handoutId", "userId");
CREATE INDEX IF NOT EXISTS "HandoutReceipt_userId_idx" ON "HandoutReceipt"("userId");
CREATE INDEX IF NOT EXISTS "HandoutReceipt_sessionId_idx" ON "HandoutReceipt"("sessionId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "HandoutReceipt" ADD CONSTRAINT "HandoutReceipt_handoutId_fkey" FOREIGN KEY ("handoutId") REFERENCES "Handout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
