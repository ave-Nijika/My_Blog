import { getPublicArticles, getSiteProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const articles = await getPublicArticles();
  const site = await getSiteProfile();
  const baseUrl = process.env.APP_URL || "http://localhost:3000";
  const now = new Date();

  const urls = [
    { url: baseUrl, lastmod: now },
    { url: `${baseUrl}/about`, lastmod: now },
    { url: `${baseUrl}/tags`, lastmod: now },
    { url: `${baseUrl}/categories`, lastmod: now },
    ...articles.map((article) => ({
      url: `${baseUrl}/posts/${article.slug}`,
      lastmod: article.updatedAt || article.createdAt || now,
    })),
  ];

  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

  urls.forEach((url) => {
    sitemap += `\n  <url>\n    <loc>${url.url}</loc>\n    <lastmod>${url.lastmod.toISOString()}</lastmod>\n    <priority>1.0</priority>\n  </url>`;
  });

  sitemap += "\n</urlset>";

  return new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml",
    },
  });
}
