-- C100: the public CV photo is off unless the owner opts in.
--
-- The column was NOT NULL DEFAULT true, so a stored `true` cannot be told
-- apart from a deliberate opt-in. Existing users therefore all move to hidden
-- ("new/unchanged users get the avatar hidden"); anyone who wants the photo
-- turns it back on in Settings -> Public sharing.
--
-- Rollback (the backfill is not reversible per user; this restores the old
-- default and shows the photo for everyone again):
--   ALTER TABLE "User" ALTER COLUMN "publicAvatarEnabled" SET DEFAULT true;
--   UPDATE "User" SET "publicAvatarEnabled" = true;
ALTER TABLE "User" ALTER COLUMN "publicAvatarEnabled" SET DEFAULT false;
UPDATE "User" SET "publicAvatarEnabled" = false WHERE "publicAvatarEnabled" = true;
