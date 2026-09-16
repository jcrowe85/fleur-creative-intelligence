-- Principle tags: which H/R/S toolkit moves a creative actually uses.
--
-- Additive only, like every migration before it on this branch: two nullable
-- additions, nothing existing altered, so the previous version of the app runs
-- unchanged against a migrated database. See down.sql.
--
-- `tools` defaults to an empty array so existing rows are valid immediately;
-- `toolsAt` stays NULL on them, which is what marks them untagged rather than
-- tagged-and-found-nothing.

ALTER TABLE "CreativeAnalysis" ADD COLUMN "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
                               ADD COLUMN "toolsAt" TIMESTAMP(3);
