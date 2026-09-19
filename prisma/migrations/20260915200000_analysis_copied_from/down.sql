-- Rollback for 20260915200000_analysis_copied_from.
--
-- Prisma doesn't run down migrations; apply this by hand if the change is
-- dropped:  psql "$DIRECT_URL" -f down.sql

ALTER TABLE "CreativeAnalysis" DROP COLUMN IF EXISTS "copiedFromAssetId";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260915200000_analysis_copied_from';
