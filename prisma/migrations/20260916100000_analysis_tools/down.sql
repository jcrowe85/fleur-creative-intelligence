-- Rollback for 20260916100000_analysis_tools.
--
-- Prisma doesn't run down migrations; apply this by hand if the change is
-- dropped:  psql "$DIRECT_URL" -f down.sql

ALTER TABLE "CreativeAnalysis" DROP COLUMN IF EXISTS "tools",
                               DROP COLUMN IF EXISTS "toolsAt";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260916100000_analysis_tools';
