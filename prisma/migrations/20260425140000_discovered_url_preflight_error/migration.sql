-- Persist the exact error from the most recent onboarding-preflight attempt
-- on each DiscoveredUrl, so the user can see why a particular URL didn't
-- yield a name (HTTP 403, parse miss, etc.) without re-running.

ALTER TABLE "DiscoveredUrl" ADD COLUMN "lastPreflightError" TEXT;
