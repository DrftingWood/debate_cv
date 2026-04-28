-- Public CV sharing fields on User. Existing users default to disabled
-- + null slug + avatar shown when toggled on.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "publicCvEnabled"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicCvSlug"        TEXT,
  ADD COLUMN IF NOT EXISTS "publicAvatarEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "User_publicCvSlug_key" ON "User"("publicCvSlug");
