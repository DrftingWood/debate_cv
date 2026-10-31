-- Lets an admin mark a test or demo tournament as ignored, so it leaves the
-- admin scores, Inbox, lists and Captured stats (never a user's own CV).
-- Additive: one column with a default, nothing altered or dropped.
ALTER TABLE "Tournament" ADD COLUMN "ignored" BOOLEAN NOT NULL DEFAULT false;

-- The parser version under which an admin's old-parser refresh last re-read
-- every recorded page. Separate from "parserVersion", which only a full
-- ingest may write.
ALTER TABLE "Tournament" ADD COLUMN "pagesRefreshedUnder" TEXT;
