-- CreateTable
CREATE TABLE "ReferenceAsset" (
    "id" TEXT NOT NULL,
    "ttAdId" TEXT NOT NULL,
    "collationId" TEXT,
    "platform" TEXT,
    "advertiserName" TEXT,
    "advertiserId" TEXT,
    "mediaType" TEXT NOT NULL,
    "sourceMediaUrl" TEXT,
    "sourceThumbUrl" TEXT,
    "mediaUrl" TEXT,
    "thumbUrl" TEXT,
    "mediaBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "title" TEXT,
    "body" TEXT,
    "transcript" TEXT,
    "landingPageUrl" TEXT,
    "cta" TEXT,
    "reach" INTEGER,
    "estSpend" DOUBLE PRECISION,
    "daysRunning" INTEGER,
    "variants" INTEGER,
    "reachDelta7d" INTEGER,
    "reachDelta30d" INTEGER,
    "gender" TEXT,
    "ageMin" INTEGER,
    "ageMax" INTEGER,
    "countries" TEXT[],
    "mainCountry" TEXT,
    "raw" JSONB NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "ReferenceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceAnalysis" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "synopsis" TEXT,
    "hookText" TEXT,
    "pillar" TEXT NOT NULL,
    "pillarConf" DOUBLE PRECISION NOT NULL,
    "pillarReason" TEXT,
    "secondaryPillar" TEXT,
    "persona" TEXT NOT NULL,
    "personaConf" DOUBLE PRECISION NOT NULL,
    "hook" TEXT NOT NULL,
    "hookConf" DOUBLE PRECISION NOT NULL,
    "funnel" TEXT NOT NULL,
    "funnelConf" DOUBLE PRECISION NOT NULL,
    "awareness" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "production" TEXT NOT NULL,
    "placementFit" TEXT NOT NULL,
    "hookStrength" INTEGER NOT NULL,
    "messageClarity" INTEGER NOT NULL,
    "differentiation" INTEGER NOT NULL,
    "productionQuality" INTEGER NOT NULL,
    "placementNativeness" INTEGER NOT NULL,
    "complianceFlags" TEXT[],
    "critique" TEXT,
    "suggestedAdjacent" TEXT[],
    "model" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceAsset_ttAdId_key" ON "ReferenceAsset"("ttAdId");

-- CreateIndex
CREATE INDEX "ReferenceAsset_mediaType_idx" ON "ReferenceAsset"("mediaType");

-- CreateIndex
CREATE INDEX "ReferenceAsset_advertiserName_idx" ON "ReferenceAsset"("advertiserName");

-- CreateIndex
CREATE INDEX "ReferenceAsset_daysRunning_idx" ON "ReferenceAsset"("daysRunning");

-- CreateIndex
CREATE INDEX "ReferenceAsset_reach_idx" ON "ReferenceAsset"("reach");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceAnalysis_assetId_key" ON "ReferenceAnalysis"("assetId");

-- CreateIndex
CREATE INDEX "ReferenceAnalysis_pillar_idx" ON "ReferenceAnalysis"("pillar");

-- CreateIndex
CREATE INDEX "ReferenceAnalysis_persona_idx" ON "ReferenceAnalysis"("persona");

-- CreateIndex
CREATE INDEX "ReferenceAnalysis_funnel_idx" ON "ReferenceAnalysis"("funnel");

-- CreateIndex
CREATE INDEX "ReferenceAnalysis_format_idx" ON "ReferenceAnalysis"("format");

-- AddForeignKey
ALTER TABLE "ReferenceAnalysis" ADD CONSTRAINT "ReferenceAnalysis_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ReferenceAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
