import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.APP_URL || "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 修复审核报告 P2：不在 robots.txt 中披露任何后台/登录路径。
      // 此前硬编码的 /private-admin-login 恰好把"隐藏登录路径"公布给了爬虫。
      // 隐藏登录页依赖 ADMIN_LOGIN_PATH + noindex，而不是 robots 披露。
      disallow: ["/admin", "/api/admin"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
