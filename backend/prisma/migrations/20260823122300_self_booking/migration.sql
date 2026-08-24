-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Class" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billingMode" TEXT NOT NULL,
    "monthlyAmount" DECIMAL,
    "sessionPrice" DECIMAL,
    "courseStart" DATETIME,
    "courseEnd" DATETIME,
    "coursePrice" DECIMAL,
    "capacity" INTEGER,
    "waitlistMode" TEXT NOT NULL DEFAULT 'NONE',
    "allowSelfBooking" BOOLEAN NOT NULL DEFAULT false,
    "bookingCutoffMin" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Class_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Class" ("billingMode", "capacity", "courseEnd", "coursePrice", "courseStart", "createdAt", "description", "id", "isActive", "monthlyAmount", "name", "sessionPrice", "tenantId", "updatedAt", "waitlistMode") SELECT "billingMode", "capacity", "courseEnd", "coursePrice", "courseStart", "createdAt", "description", "id", "isActive", "monthlyAmount", "name", "sessionPrice", "tenantId", "updatedAt", "waitlistMode" FROM "Class";
DROP TABLE "Class";
ALTER TABLE "new_Class" RENAME TO "Class";
CREATE INDEX "Class_tenantId_idx" ON "Class"("tenantId");
CREATE UNIQUE INDEX "Class_tenantId_name_key" ON "Class"("tenantId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
