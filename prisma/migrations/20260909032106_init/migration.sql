-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaEntity" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignId" TEXT,
    "adsetId" TEXT,
    "status" TEXT,
    "effectiveStatus" TEXT,
    "objective" TEXT,
    "dailyBudget" DECIMAL(12,2),
    "lifetimeBudget" DECIMAL(12,2),
    "creativeThumbUrl" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaInsightDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "level" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "reach" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "inlineLinkClicks" INTEGER NOT NULL,
    "outboundClicks" INTEGER NOT NULL,
    "purchases" INTEGER NOT NULL,
    "purchaseValue" DECIMAL(12,2) NOT NULL,
    "addToCart" INTEGER NOT NULL,
    "initiateCheckout" INTEGER NOT NULL,
    "landingPageViews" INTEGER NOT NULL,
    "videoViews3s" INTEGER NOT NULL,
    "thruplays" INTEGER NOT NULL,
    "videoP25" INTEGER NOT NULL,
    "videoP50" INTEGER NOT NULL,
    "videoP75" INTEGER NOT NULL,
    "videoP100" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaInsightDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "recordsUpserted" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adIds" TEXT[],
    "thumbUrl" TEXT,
    "headline" TEXT,
    "primaryText" TEXT,
    "destinationUrl" TEXT,
    "durationSec" DOUBLE PRECISION,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "CreativeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeAnalysis" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "transcript" TEXT,
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
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeRun" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "status" TEXT NOT NULL DEFAULT 'idle',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "processed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "token" TEXT,

    CONSTRAINT "CreativeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "MetaEntity_level_idx" ON "MetaEntity"("level");

-- CreateIndex
CREATE INDEX "MetaEntity_campaignId_idx" ON "MetaEntity"("campaignId");

-- CreateIndex
CREATE INDEX "MetaEntity_adsetId_idx" ON "MetaEntity"("adsetId");

-- CreateIndex
CREATE INDEX "MetaInsightDaily_date_level_idx" ON "MetaInsightDaily"("date", "level");

-- CreateIndex
CREATE INDEX "MetaInsightDaily_entityId_idx" ON "MetaInsightDaily"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaInsightDaily_date_level_entityId_key" ON "MetaInsightDaily"("date", "level", "entityId");

-- CreateIndex
CREATE INDEX "SyncLog_source_startedAt_idx" ON "SyncLog"("source", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAsset_assetKey_key" ON "CreativeAsset"("assetKey");

-- CreateIndex
CREATE INDEX "CreativeAsset_assetType_idx" ON "CreativeAsset"("assetType");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAnalysis_assetId_key" ON "CreativeAnalysis"("assetId");

-- CreateIndex
CREATE INDEX "CreativeAnalysis_pillar_idx" ON "CreativeAnalysis"("pillar");

-- CreateIndex
CREATE INDEX "CreativeAnalysis_persona_idx" ON "CreativeAnalysis"("persona");

-- CreateIndex
CREATE INDEX "CreativeAnalysis_funnel_idx" ON "CreativeAnalysis"("funnel");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeAnalysis" ADD CONSTRAINT "CreativeAnalysis_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CreativeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
