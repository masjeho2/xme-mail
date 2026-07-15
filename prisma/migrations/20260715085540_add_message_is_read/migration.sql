-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "fromAddr" TEXT NOT NULL,
    "toAddr" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "textBody" TEXT,
    "htmlBody" TEXT,
    "providerId" TEXT,
    "error" TEXT,
    "headersJson" TEXT,
    "rawMetaJson" TEXT,
    "domainId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("createdAt", "direction", "domainId", "error", "fromAddr", "headersJson", "htmlBody", "id", "providerId", "rawMetaJson", "status", "subject", "textBody", "toAddr") SELECT "createdAt", "direction", "domainId", "error", "fromAddr", "headersJson", "htmlBody", "id", "providerId", "rawMetaJson", "status", "subject", "textBody", "toAddr" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_direction_createdAt_idx" ON "Message"("direction", "createdAt");
CREATE INDEX "Message_direction_isRead_idx" ON "Message"("direction", "isRead");
CREATE INDEX "Message_toAddr_idx" ON "Message"("toAddr");
CREATE INDEX "Message_fromAddr_idx" ON "Message"("fromAddr");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
