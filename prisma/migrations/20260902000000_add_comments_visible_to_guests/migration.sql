-- 对应 prisma/schema.prisma SiteSettings.commentsVisibleToGuests
-- 站点设置新增「评论对游客可见」开关；默认 true 保持既有行为，存量行回填 true
ALTER TABLE "SiteSettings" ADD COLUMN "commentsVisibleToGuests" BOOLEAN NOT NULL DEFAULT true;
