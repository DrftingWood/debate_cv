-- The fields an admin set by hand on a tournament's page (format, year,
-- region), which a scrape must not overwrite (owner, 2026-10-31).
-- Additive: one column with a default, nothing altered or dropped.
ALTER TABLE "Tournament" ADD COLUMN "manualFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
