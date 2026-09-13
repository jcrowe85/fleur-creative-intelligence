-- AlterTable
ALTER TABLE "ReferenceAsset" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "contentTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "ReferenceAsset_brandId_idx" ON "ReferenceAsset"("brandId");

-- CreateIndex
CREATE INDEX "User_brandId_idx" ON "User"("brandId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
