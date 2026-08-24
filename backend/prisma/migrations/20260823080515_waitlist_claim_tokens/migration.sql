-- CreateTable
CREATE TABLE "WaitlistClaimToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaitlistClaimToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WaitlistClaimToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WaitlistClaimToken_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WaitlistEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistClaimToken_tokenHash_key" ON "WaitlistClaimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "WaitlistClaimToken_tenantId_idx" ON "WaitlistClaimToken"("tenantId");

-- CreateIndex
CREATE INDEX "WaitlistClaimToken_sessionId_idx" ON "WaitlistClaimToken"("sessionId");
