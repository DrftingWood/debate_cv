-- Records "Not me" decisions so we don't re-prompt the user about a Person.

CREATE TABLE "PersonRejection" (
  "userId" TEXT NOT NULL,
  "personId" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonRejection_pkey" PRIMARY KEY ("userId", "personId")
);

CREATE INDEX "PersonRejection_personId_idx" ON "PersonRejection"("personId");

ALTER TABLE "PersonRejection"
  ADD CONSTRAINT "PersonRejection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonRejection"
  ADD CONSTRAINT "PersonRejection_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
