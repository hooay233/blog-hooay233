// 动态 robots.txt（生产环境）：sitemap 地址按实际访问域名生成，换域名不用改文件。
// 本地静态预览用同目录的静态 robots.txt。

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const body = `# ${url.hostname}
User-agent: *
Allow: /
Disallow: /cdn-cgi/

Sitemap: ${url.origin}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
