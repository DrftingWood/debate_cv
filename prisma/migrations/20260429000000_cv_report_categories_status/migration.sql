-- Adds structured categories + closed-loop status + admin note to
-- CvErrorReport. Backfills existing rows: those that already had a
-- resolvedAt timestamp move to status='fixed'; the rest stay 'open'.

DO $$
BEGIN
  CREATE TYPE "CvReportStatus" AS ENUM ('open', 'acknowledged', 'fixed', 'wont_fix');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "CvErrorReport"
  ADD COLUMN IF NOT EXISTS "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "status" "CvReportStatus" NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS "adminNote" TEXT;

UPDATE "CvErrorReport"
SET "status" = 'fixed'
WHERE "resolvedAt" IS NOT NULL AND "status" = 'open';

CREATE INDEX IF NOT EXISTS "CvErrorReport_status_idx" ON "CvErrorReport"("status");
