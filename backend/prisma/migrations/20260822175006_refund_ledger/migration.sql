-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "refundedAt" DATETIME NOT NULL,
    "method" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "recordedByEmailSnapshot" TEXT,
    "recordedByNameSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Refund_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "Fee" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Refund_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Refund_tenantId_idx" ON "Refund"("tenantId");

-- CreateIndex
CREATE INDEX "Refund_feeId_idx" ON "Refund"("feeId");

-- CreateIndex
CREATE INDEX "Refund_tenantId_refundedAt_idx" ON "Refund"("tenantId", "refundedAt");
