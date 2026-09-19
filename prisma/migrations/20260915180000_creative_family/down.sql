-- Rollback for 20260915180000_creative_family.
--
-- The migration only adds things, so undoing it only removes them. No existing
-- column is altered on the way in or the way out, which is what lets the
-- previous version of the app keep running against a migrated database.
--
-- Prisma doesn't run down migrations; apply this by hand if the change is
-- dropped:  psql "$DIRECT_URL" -f down.sql

ALTER TABLE "CreativeAsset" DROP CONSTRAINT IF EXISTS "CreativeAsset_familyId_fkey";

DROP INDEX IF EXISTS "CreativeAsset_familyId_idx";

ALTER TABLE "CreativeAsset" DROP COLUMN IF EXISTS "familyId",
                            DROP COLUMN IF EXISTS "fpHashes",
                            DROP COLUMN IF EXISTS "fpDurationSec",
                            DROP COLUMN IF EXISTS "fpAt";

DROP TABLE IF EXISTS "CreativeFamily";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260915180000_creative_family';
