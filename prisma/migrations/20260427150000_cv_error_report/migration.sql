CREATE TABLE "CvErrorReport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tournamentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "comment" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "CvErrorReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CvErrorReport_userId_idx" ON "CvErrorReport"("userId");
CREATE INDEX "CvErrorReport_createdAt_idx" ON "CvErrorReport"("createdAt");
CREATE INDEX "CvErrorReport_resolvedAt_idx" ON "CvErrorReport"("resolvedAt");

ALTER TABLE "CvErrorReport"
ADD CONSTRAINT "CvErrorReport_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
