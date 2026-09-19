-- Rollback for 20260915190000_creator.
--
-- Prisma doesn't run down migrations; apply this by hand if the change is
-- dropped:  psql "$DIRECT_URL" -f down.sql

ALTER TABLE "CreativeAsset" DROP CONSTRAINT IF EXISTS "CreativeAsset_creatorId_fkey";

DROP INDEX IF EXISTS "CreativeAsset_creatorId_idx";

ALTER TABLE "CreativeAsset" DROP COLUMN IF EXISTS "creatorId",
                            DROP COLUMN IF EXISTS "creatorCode",
                            DROP COLUMN IF EXISTS "creatorSource";

DROP TABLE IF EXISTS "Creator";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260915190000_creator';
