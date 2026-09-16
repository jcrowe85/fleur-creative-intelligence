-- Records that an analysis was copied from a sibling upload of the same
-- creative instead of being generated.
--
-- Additive only, like the migrations before it: one nullable column, no
-- existing column altered, so the previous version of the app runs unchanged
-- against a migrated database. See down.sql.

ALTER TABLE "CreativeAnalysis" ADD COLUMN "copiedFromAssetId" TEXT;
