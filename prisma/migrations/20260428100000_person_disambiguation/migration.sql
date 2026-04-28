-- Person disambiguation: allow multiple Person rows to share the same
-- normalizedName, as long as they're claimed by different users (or only
-- one is unclaimed at any time).
--
-- Old constraint: exactly one Person per normalizedName, period.
-- Problem: two debaters named "John Smith" share a Person row, so one of
-- them gets credit for the other's tournaments.
--
-- New constraints (both partial unique indexes):
--   * one unclaimed Person per normalizedName  (the canonical "free" row
--     that becomes claimed when a user ingests a URL with that name)
--   * one claimed Person per (normalizedName, claimedByUserId)  (each user
--     gets their own row once they claim)

ALTER TABLE "Person" DROP CONSTRAINT "Person_normalizedName_key";

ALTER TABLE "Person" ADD COLUMN "institution" TEXT;

CREATE UNIQUE INDEX "Person_normalizedName_unclaimed"
  ON "Person" ("normalizedName")
  WHERE "claimedByUserId" IS NULL;

CREATE UNIQUE INDEX "Person_normalizedName_claimed"
  ON "Person" ("normalizedName", "claimedByUserId")
  WHERE "claimedByUserId" IS NOT NULL;

CREATE INDEX "Person_normalizedName_idx" ON "Person" ("normalizedName");
