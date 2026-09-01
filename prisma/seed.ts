import { db } from "../lib/db.ts";

async function main() {
  const siteProfileCount = await db.siteProfile.count();
  const profileData = {
    nickname: "主人",
    avatarUrl: "",
    biography: "个人学习博客",
    socialLinks: "[]",
    learningDynamics: "[]",
  };
  if (siteProfileCount === 0) {
    await db.siteProfile.create({ data: profileData });
    console.log("[db:seed] 已创建默认 SiteProfile。");
  } else {
    await db.siteProfile.updateMany({ data: profileData });
    console.log("[db:seed] SiteProfile 已存在，已更新为默认值。");
  }

  const siteSettingsCount = await db.siteSettings.count();
  if (siteSettingsCount === 0) {
    await db.siteSettings.create({
      data: {
        commentCooldownSeconds: 600,
        commentMinLength: 2,
        commentMaxLength: 2000,
        commentBodyMaxBytes: 10000,
        autoBanWarningThreshold: 3,
        allowRegexOnlyOnLlmFailure: false,
      },
    });
    console.log("[db:seed] 已创建默认 SiteSettings。");
  } else {
    console.log("[db:seed] SiteSettings 已存在，跳过创建。");
  }

  const profile = await db.siteProfile.findFirst();
  console.log(
    `[db:seed] 当前站点资料：昵称=${profile?.nickname ?? "-"}，简介=${profile?.biography ?? "-"}`
  );
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("[db:seed] 初始化失败：", error);
    await db.$disconnect();
    process.exit(1);
  });