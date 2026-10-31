-- Names the tab home page's Tournament Staff block lists as adjudication
-- core (the `home` scrape piece). Additive: a new table, nothing altered.
CREATE TABLE "TournamentStaff" (
    "id" BIGSERIAL NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'staff_block',
    "personId" BIGINT,
    "candidatePersonId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentStaff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentStaff_tournamentId_role_nameKey_key" ON "TournamentStaff"("tournamentId", "role", "nameKey");
CREATE INDEX "TournamentStaff_personId_idx" ON "TournamentStaff"("personId");
CREATE INDEX "TournamentStaff_candidatePersonId_idx" ON "TournamentStaff"("candidatePersonId");

ALTER TABLE "TournamentStaff" ADD CONSTRAINT "TournamentStaff_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentStaff" ADD CONSTRAINT "TournamentStaff_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TournamentStaff" ADD CONSTRAINT "TournamentStaff_candidatePersonId_fkey" FOREIGN KEY ("candidatePersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
