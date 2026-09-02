import { getPublicArticles, getSiteProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** XML 文本节点/属性转义（修复审核报告 P2：标题/摘要含 &、< 时输出非法 XML） */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const articles = await getPublicArticles();
  const site = await getSiteProfile();

  const baseUrl = process.env.APP_URL || "http://localhost:3000";
  const now = new Date();

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site?.nickname || "普拉娜的手账")}</title>
    <description>${escapeXml(site?.biography || "记录学习过程中的所思所想，一个技术学习者的个人博客。")}</description>
    <link>${baseUrl}</link>
    <language>zh-CN</language>
    <pubDate>${now.toUTCString()}</pubDate>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
    <generator>Next.js Blog</generator>

    ${articles
      .map(
        (article) => `
    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${baseUrl}/posts/${article.slug}</link>
      <pubDate>${article.publishedAt ? new Date(article.publishedAt).toUTCString() : now.toUTCString()}</pubDate>
      <description>${escapeXml(article.summary)}</description>
      <guid isPermaLink="true">${baseUrl}/posts/${article.slug}</guid>
    </item>`
      )
      .join("")}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}
