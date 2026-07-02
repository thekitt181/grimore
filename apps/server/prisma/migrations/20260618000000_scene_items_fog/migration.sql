-- Scene model fields added to schema without a prior migration
ALTER TABLE "Scene" ADD COLUMN IF NOT EXISTS "items" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Scene" ADD COLUMN IF NOT EXISTS "activeMapId" TEXT;
ALTER TABLE "Scene" ADD COLUMN IF NOT EXISTS "fogData" JSONB;
