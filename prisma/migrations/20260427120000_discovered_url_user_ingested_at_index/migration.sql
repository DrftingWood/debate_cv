-- Compound index: /cv and /onboarding/names filter DiscoveredUrl by
-- (userId, ingestedAt-not-null) and the existing (userId)-only index
-- forced row-by-row scans on ingestedAt. The compound index lets these
-- common queries do an index-only seek.
CREATE INDEX "DiscoveredUrl_userId_ingestedAt_idx" ON "DiscoveredUrl"("userId", "ingestedAt");
