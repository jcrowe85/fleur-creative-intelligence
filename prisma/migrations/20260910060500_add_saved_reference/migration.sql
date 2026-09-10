-- CreateTable
CREATE TABLE "SavedReference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'saved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedReference_userId_status_idx" ON "SavedReference"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SavedReference_userId_assetId_key" ON "SavedReference"("userId", "assetId");

-- AddForeignKey
ALTER TABLE "SavedReference" ADD CONSTRAINT "SavedReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReference" ADD CONSTRAINT "SavedReference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ReferenceAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
