-- Tabs that moved to another address (owner, 2026-10-31: "allow me to add
-- an alternate url feature"). Additive: one new table, nothing altered.

-- CreateTable
CREATE TABLE "TabMove" (
    "id" BIGSERIAL NOT NULL,
    "fromHost" TEXT NOT NULL,
    "fromSlug" TEXT NOT NULL DEFAULT '',
    "toHost" TEXT NOT NULL,
    "toSlug" TEXT NOT NULL DEFAULT '',
    "addedBy" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TabMove_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TabMove_fromHost_fromSlug_key" ON "TabMove"("fromHost", "fromSlug");
