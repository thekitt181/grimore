-- CreateEnum
CREATE TYPE "DdbLibraryImportJobStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "DdbLibraryImportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "DdbLibraryImportJobStatus" NOT NULL DEFAULT 'RUNNING',
    "skipExisting" BOOLEAN NOT NULL DEFAULT false,
    "campaignId" INTEGER,
    "sourceIds" INTEGER[],
    "sourceNames" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB,
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DdbLibraryImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DdbLibraryImportJob_userId_status_idx" ON "DdbLibraryImportJob"("userId", "status");

-- CreateIndex
CREATE INDEX "DdbLibraryImportJob_userId_createdAt_idx" ON "DdbLibraryImportJob"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DdbLibraryImportJob" ADD CONSTRAINT "DdbLibraryImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
