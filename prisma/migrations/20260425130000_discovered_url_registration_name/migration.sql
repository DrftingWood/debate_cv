-- Add a column to cache the registration-page name extracted from each
-- private URL's landing page. Populated lazily by the onboarding preflight
-- (POST /api/onboarding/preflight) before the user is asked which names are
-- theirs. Stays NULL if the landing fetch failed (e.g. dead Heroku app).

ALTER TABLE "DiscoveredUrl" ADD COLUMN "registrationName" TEXT;
