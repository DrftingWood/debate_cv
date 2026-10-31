-- Tab addresses an admin deleted (owner, 2026-10-31: delete demo
-- tournaments, note which were deleted, and never ingest them again).
-- Additive: one new table, nothing altered or dropped.

-- CreateTable
CREATE TABLE "DeletedTournament" (
    "id" BIGSERIAL NOT NULL,
    "host" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "tabUrl" TEXT NOT NULL,
    "deletedBy" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedTournament_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeletedTournament_host_slug_key" ON "DeletedTournament"("host", "slug");
