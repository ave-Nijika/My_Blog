-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "category" TEXT NOT NULL DEFAULT '',
    "cover" TEXT NOT NULL DEFAULT '',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceCommitSha" TEXT NOT NULL DEFAULT '',
    "sourceContentHash" TEXT NOT NULL DEFAULT '',
    "lastSyncedAt" DATETIME,
    "plainTextCache" TEXT NOT NULL DEFAULT '',
    "viewCount" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_Article" ("category", "cover", "createdAt", "id", "lastSyncedAt", "pinned", "plainTextCache", "publishedAt", "slug", "sourceCommitSha", "sourceContentHash", "sourcePath", "status", "summary", "title", "updatedAt") SELECT "category", "cover", "createdAt", "id", "lastSyncedAt", "pinned", "plainTextCache", "publishedAt", "slug", "sourceCommitSha", "sourceContentHash", "sourcePath", "status", "summary", "title", "updatedAt" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
