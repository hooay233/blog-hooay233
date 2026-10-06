// Cloudflare Pages Functions 中间件
// 只做一件事：给首页和文章页补上 SEO / 社交预览用的 meta 标签。
// 文章页的标题、简介、关键词会实时去公开 API 取（取不到就原样返回，不影响页面）。
//
// 本地静态预览（dev-server.js）不会执行这个文件，所以本地看不到这些 meta 是正常的。

const SITE_NAME = 'Hooay 的博客';
const SITE_DESC = 'Hooay（@hooay233）的博客 —— 折腾笔记、代码片段与踩坑记录。';
const API_BASE = 'https://blog-api.hooay233.top';
const POST_ID_RE = /^\d{8}_\d+$/;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class HeadInserter {
  constructor(tags, title) {
    this.tags = tags;
    this.title = title;
  }
  element(el) {
    if (this.title) el.setInnerContent(this.title);
    el.append(this.tags, { html: true });
  }
}

async function fetchMeta(id) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${API_BASE}/api/posts/${encodeURIComponent(id)}/meta.json`, {
      signal: ctrl.signal,
      cf: { cacheTtl: 30, cacheEverything: true }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function onRequest(context) {
  const { request, next } = context;
  const res = await next();

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  const url = new URL(request.url);
  const isHome = url.pathname === '/' || url.pathname === '/index.html';
  const isPost = url.pathname === '/post/view' || url.pathname === '/post/view.html' ||
    url.pathname.startsWith('/post/view/');

  if (!isHome && !isPost) return res;

  let title = SITE_NAME;
  let desc = SITE_DESC;
  let keywords = 'hooay,hooay233,博客';
  let type = 'website';

  if (isPost) {
    let id = url.searchParams.get('id') || '';
    if (!id) {
      const m = /\/post\/view\/([^/?#]+)/.exec(url.pathname);
      if (m) id = decodeURIComponent(m[1]);
    }
    if (!POST_ID_RE.test(id)) return res;
    const meta = await fetchMeta(id);
    if (!meta) return res;
    title = `${meta.title || '文章'} · ${SITE_NAME}`;
    desc = meta.summary || SITE_DESC;
    keywords = (meta.keywords || []).join(',') || keywords;
    type = 'article';
  }

  const ogImage = `${url.origin}/favicon.png`;
  const tags = `
    <meta name="description" content="${esc(desc)}">
    <meta name="keywords" content="${esc(keywords)}">
    <meta property="og:site_name" content="${esc(SITE_NAME)}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc)}">
    <meta property="og:type" content="${type}">
    <meta property="og:url" content="${esc(url.href)}">
    <meta property="og:image" content="${esc(ogImage)}">
    <meta property="og:locale" content="zh_CN">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(desc)}">
  `;

  return new HTMLRewriter()
    .on('head', new HeadInserter(tags, title))
    .transform(res);
}
