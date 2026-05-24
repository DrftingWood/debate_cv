-- Restore the schema-canonical state of GmailToken after the orphan
-- 20260512000000_multi_gmail_tokens migration left two pieces of drift:
--   * a new nullable `email` column never written by the application
--     (the Prisma model doesn't reference it),
--   * the @unique constraint on `userId` silently dropped — presumably
--     in preparation for a follow-up that would make `(userId, email)`
--     the new composite unique key. That follow-up never landed.
--
-- Net effect since 2026-05-12: every `prisma.gmailToken.upsert()` that
-- hits the CREATE branch fails in production with "no unique or
-- exclusion constraint matching the ON CONFLICT specification".
-- NextAuth's events.signIn handler swallows the throw, so the
-- Reconnect Gmail UI reads as success but the GmailToken row never
-- writes. /api/ingest/gmail then returns 400 no_gmail_token forever.
-- (Confirmed via the [gmail.sync] failed log path added in f80ea10 and
-- the live information_schema dump from /api/admin/schema-probe.)
--
-- Two paths considered: forward-port multi-Gmail support into the
-- application or roll the schema back to match the repo. Rolling back —
-- multi-Gmail is real product work (which Gmail to scan, primary
-- selection, per-token cooldowns) and the app has been operating on a
-- single-token-per-user model continuously.

-- 1. Defensive dedupe. With the upsert failing for two weeks no new
--    duplicates could land via the events path, but kept here so the
--    AddConstraint below can't trip on legacy data. Keeps the row
--    with the most recent updatedAt.
DELETE FROM "GmailToken" a
USING "GmailToken" b
WHERE a."userId" = b."userId"
  AND a."updatedAt" < b."updatedAt";

-- 2. Drop the orphan column. NULL for every row (Prisma never wrote it).
ALTER TABLE "GmailToken" DROP COLUMN IF EXISTS "email";

-- 3. Restore the unique constraint. Name matches Prisma's default
--    generator output (`<Model>_<field>_key`) so a later
--    `prisma migrate diff` against the repo schema sees a clean state.
ALTER TABLE "GmailToken" ADD CONSTRAINT "GmailToken_userId_key" UNIQUE ("userId");
