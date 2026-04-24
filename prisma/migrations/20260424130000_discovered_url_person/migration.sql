-- Link each DiscoveredUrl to the registration Person parsed from its landing page.

ALTER TABLE "DiscoveredUrl" ADD COLUMN "registrationPersonId" BIGINT;

ALTER TABLE "DiscoveredUrl"
  ADD CONSTRAINT "DiscoveredUrl_registrationPersonId_fkey"
  FOREIGN KEY ("registrationPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
