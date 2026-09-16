-- Rollback for 20260916120000_account_event.
--
-- Prisma doesn't run down migrations; apply this by hand if the change is
-- dropped:  psql "$DIRECT_URL" -f down.sql
--
-- Dropping the table loses the recorded events. They are all recomputable from
-- MetaInsightDaily, which is the point of a computed log — nothing here is
-- typed in by hand, so nothing here is unrecoverable.

DROP TABLE IF EXISTS "AccountEvent";

DELETE FROM "_prisma_migrations" WHERE migration_name = '20260916120000_account_event';
