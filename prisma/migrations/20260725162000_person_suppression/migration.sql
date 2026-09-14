-- Erasure support for non-users. See the column doc in schema.prisma: the
-- participation rows are deliberately retained, only the identifying name
-- is masked.
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "suppressedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Person_suppressedAt_idx" ON "Person"("suppressedAt");
