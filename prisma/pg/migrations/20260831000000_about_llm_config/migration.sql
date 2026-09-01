-- 对应 prisma/migrations/20260830220915_about_page_config + 20260830221807_llm_providers
-- 生产库用 PG（prisma/pg/schema.prisma），需在 PG 侧补同样三列（均为可空 TEXT，零数据风险）
ALTER TABLE "SiteSettings" ADD COLUMN "aboutContacts" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "aboutNotes" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "llmProviders" TEXT;
