-- Token encryption column: null for legacy plaintext rows, 'v1' for AES-256-GCM.
ALTER TABLE "GmailToken" ADD COLUMN "encryptionVersion" TEXT;

-- Provenance tables.
CREATE TABLE "SourceDocument" (
  "id" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "contentLength" INTEGER NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceDocument_url_contentHash_key" ON "SourceDocument"("url", "contentHash");
CREATE INDEX "SourceDocument_url_idx" ON "SourceDocument"("url");
CREATE INDEX "SourceDocument_fetchedAt_idx" ON "SourceDocument"("fetchedAt");

CREATE TABLE "ParserRun" (
  "id" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "parserName" TEXT NOT NULL,
  "parserVersion" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParserRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ParserRun_sourceDocumentId_idx" ON "ParserRun"("sourceDocumentId");
CREATE INDEX "ParserRun_parserVersion_parserName_idx" ON "ParserRun"("parserVersion", "parserName");

ALTER TABLE "ParserRun"
  ADD CONSTRAINT "ParserRun_sourceDocumentId_fkey"
  FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
