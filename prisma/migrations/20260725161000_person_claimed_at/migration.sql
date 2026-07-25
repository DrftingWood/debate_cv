-- Audit timestamp for identity claims. Nullable: rows claimed before this
-- column existed have no recorded time and must not be back-dated to now().
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
