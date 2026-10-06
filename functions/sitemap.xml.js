// 动态 sitemap.xml（生产环境）：首页、关于页 + 公开 API 里的全部文章。
// 本地静态预览没有这个文件也能正常用（会有 404），部署到 Cloudflare Pages 后自动生效。

const API_BASE = 'https://blog-api.hooay233.top';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  let posts = [];
  try {
    const res = await fetch(`${API_BASE}/api/posts?limit=100&sort=newest`, {
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    if (res.ok) {
      const data = await res.json();
      posts = data.posts || [];
    }
  } catch (e) {
    posts = [];
  }

  const urls = [
    { loc: `${origin}/`, lastmod: null },
    { loc: `${origin}/about.html`, lastmod: null }
  ].concat(posts.map((p) => ({
    loc: `${origin}/post/view?id=${encodeURIComponent(p.id)}`,
    lastmod: p.updatedAt || p.createdAt || null
  })));

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${esc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${esc(new Date(u.lastmod).toISOString())}</lastmod>` : ''}
  </url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600'
    }
  });
}
