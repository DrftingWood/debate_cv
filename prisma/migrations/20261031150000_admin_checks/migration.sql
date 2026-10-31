-- CreateTable
CREATE TABLE "AdminCheck" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "note" TEXT,
    "checkedBy" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminCheck_kind_subject_key" ON "AdminCheck"("kind", "subject");
