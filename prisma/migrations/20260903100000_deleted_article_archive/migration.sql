-- 文章物理删除 + 关联数据存档（方案 C）：DeletedArticle / DeletedComment
-- deletePost 改为存档后物理删除文章，评论与版本历史先快照进这两张表
CREATE TABLE "DeletedArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "cover" TEXT NOT NULL DEFAULT '',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" DATETIME,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "rawMarkdown" TEXT NOT NULL DEFAULT '',
    "versionsJson" TEXT NOT NULL DEFAULT '',
    "deletedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedBy" TEXT NOT NULL DEFAULT '',
    "commitSha" TEXT NOT NULL DEFAULT ''
);

CREATE TABLE "DeletedComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalId" TEXT NOT NULL,
    "deletedArticleId" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ipHmac" TEXT NOT NULL DEFAULT '',
    "visitorTokenHash" TEXT NOT NULL DEFAULT '',
    "regexDecision" TEXT,
    "aiDecision" TEXT,
    "aiCategory" TEXT,
    "aiReason" TEXT,
    "aiErrorCode" TEXT,
    "warningApplied" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moderatedAt" DATETIME,
    "moderatedBy" TEXT,
    "deletedAt" DATETIME,
    CONSTRAINT "DeletedComment_deletedArticleId_fkey" FOREIGN KEY ("deletedArticleId") REFERENCES "DeletedArticle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
