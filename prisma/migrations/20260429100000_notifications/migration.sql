-- In-app notification feed. One row per event; readAt nullable so the
-- header bell can show an unread-count badge.

CREATE TABLE IF NOT EXISTS "Notification" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT,
  "href"      TEXT,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
  ON "Notification"("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx"
  ON "Notification"("userId", "readAt");
