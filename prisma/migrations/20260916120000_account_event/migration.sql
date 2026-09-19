-- What changed in the account, computed weekly.
--
-- A new table only: nothing existing is altered, so the previous version of the
-- app runs unchanged against a migrated database. See down.sql.
--
-- The unique index on "key" is what makes the detector idempotent — re-running
-- it over a week already processed updates those rows rather than writing a
-- second copy of the same fact.

CREATE TABLE "AccountEvent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "weekOf" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "creativeId" TEXT,
    "name" TEXT,
    "spend" DECIMAL(12,2) NOT NULL,
    "detail" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountEvent_key_key" ON "AccountEvent"("key");
CREATE INDEX "AccountEvent_weekOf_type_idx" ON "AccountEvent"("weekOf", "type");
CREATE INDEX "AccountEvent_creativeId_idx" ON "AccountEvent"("creativeId");
