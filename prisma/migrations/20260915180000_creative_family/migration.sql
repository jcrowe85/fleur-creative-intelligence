-- One real creative, however many times it was uploaded.
CREATE TABLE "CreativeFamily" (
    "id" TEXT NOT NULL,
    "canonicalAssetId" TEXT,
    "fingerprints" TEXT[],
    "durationSec" DOUBLE PRECISION,
    "memberCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeFamily_pkey" PRIMARY KEY ("id")
);

-- Content fingerprints on each upload.
ALTER TABLE "CreativeAsset" ADD COLUMN "fpHashes" TEXT[],
                            ADD COLUMN "fpDurationSec" DOUBLE PRECISION,
                            ADD COLUMN "fpAt" TIMESTAMP(3),
                            ADD COLUMN "familyId" TEXT;

CREATE INDEX "CreativeAsset_familyId_idx" ON "CreativeAsset"("familyId");

ALTER TABLE "CreativeAsset" ADD CONSTRAINT "CreativeAsset_familyId_fkey"
    FOREIGN KEY ("familyId") REFERENCES "CreativeFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;
