-- Creator attribution.
--
-- Additive only, like the creative-family migration before it: a new table and
-- three nullable columns. Nothing existing is altered, so the previous version
-- of the app keeps running against a migrated database. See down.sql.

CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "codes" TEXT[],
    "brandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Creator_slug_key" ON "Creator"("slug");
CREATE INDEX "Creator_brandId_idx" ON "Creator"("brandId");

ALTER TABLE "CreativeAsset" ADD COLUMN "creatorId" TEXT,
                            ADD COLUMN "creatorCode" TEXT,
                            ADD COLUMN "creatorSource" TEXT;

CREATE INDEX "CreativeAsset_creatorId_idx" ON "CreativeAsset"("creatorId");

ALTER TABLE "CreativeAsset" ADD CONSTRAINT "CreativeAsset_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
