-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Fee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "classId" TEXT,
    "traineeId" TEXT NOT NULL,
    "sessionId" TEXT,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "amount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Fee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Fee_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Fee_traineeId_fkey" FOREIGN KEY ("traineeId") REFERENCES "Trainee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Fee_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Fee" ("amount", "classId", "createdAt", "id", "notes", "periodEnd", "periodStart", "sessionId", "status", "tenantId", "traineeId", "updatedAt") SELECT "amount", "classId", "createdAt", "id", "notes", "periodEnd", "periodStart", "sessionId", "status", "tenantId", "traineeId", "updatedAt" FROM "Fee";
DROP TABLE "Fee";
ALTER TABLE "new_Fee" RENAME TO "Fee";
CREATE INDEX "Fee_tenantId_idx" ON "Fee"("tenantId");
CREATE INDEX "Fee_tenantId_status_idx" ON "Fee"("tenantId", "status");
CREATE INDEX "Fee_tenantId_periodStart_idx" ON "Fee"("tenantId", "periodStart");
CREATE INDEX "Fee_classId_idx" ON "Fee"("classId");
CREATE INDEX "Fee_traineeId_idx" ON "Fee"("traineeId");
CREATE INDEX "Fee_sessionId_idx" ON "Fee"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
