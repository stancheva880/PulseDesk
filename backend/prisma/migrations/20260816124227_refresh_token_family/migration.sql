-- TKT-0026: add RefreshToken.familyId (reuse detection, RFC 9700 4.14.2).
--
-- `@default(cuid())` is a Prisma-client-side default, so it produces no SQL
-- default and Prisma cannot add the required column to a non-empty table.
-- Hand-edited from the generated skeleton: the INSERT below backfills
-- familyId from id, making every pre-existing row its own single-member
-- family. Same redefine+backfill shape as 20260814150000_user_memberships.
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RefreshToken" ("createdAt", "expiresAt", "familyId", "id", "revokedAt", "tokenHash", "userId") SELECT "createdAt", "expiresAt", "id", "id", "revokedAt", "tokenHash", "userId" FROM "RefreshToken";
DROP TABLE "RefreshToken";
ALTER TABLE "new_RefreshToken" RENAME TO "RefreshToken";
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
