#!/usr/bin/env node
/*!
 * dev-server.js —— 本地预览用的极简静态服务器（只在开发时用，不参与部署）
 *
 * 为什么要它：文章地址是 /post/view?id=xxx，而真实文件是 post/view.html。
 * Cloudflare Pages 靠 _redirects 完成这个映射，python -m http.server 不会，
 * 所以这里自己实现「去掉 .html 后缀也能访问」的干净 URL。
 *
 * 用法：
 *   node dev-server.js            # 默认 0.0.0.0:8788
 *   node dev-server.js 9000       # 指定端口
 *   PORT=9000 node dev-server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2] || process.env.PORT || '8788', 10);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.mbmd': 'text/markbottom; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf'
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body && body.pipe) body.pipe(res);
  else res.end(body);
}

function notFound(res, pathname) {
  send(res, 404, { 'Content-Type': 'text/html; charset=utf-8' },
    `<!doctype html><meta charset="utf-8"><title>404</title>
     <body style="font-family:system-ui;padding:2em">
     <h1>404</h1><p><code>${pathname.replace(/[<>&]/g, '')}</code> 不存在。</p>
     <p><a href="/index.html">回首页</a></p></body>`);
}

/** 把 URL 路径解析成真实文件；支持干净 URL 与目录索引 */
function resolveFile(pathname) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, safe);
  if (!full.startsWith(ROOT)) return null;

  const candidates = [];
  candidates.push(full);
  if (!path.extname(full)) candidates.push(full + '.html');
  candidates.push(path.join(full, 'index.html'));

  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) return c;
    } catch (e) { /* 继续试下一个 */ }
  }
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';

  const file = resolveFile(pathname);
  if (!file) {
    console.log(`${req.method} ${pathname} -> 404`);
    return notFound(res, pathname);
  }

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(file);
  console.log(`${req.method} ${pathname} -> 200 ${type} ${stat.size}B`);
  send(res, 200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  }, fs.createReadStream(file));
});

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((ni) => {
      if (ni.family === 'IPv4' && !ni.internal) lan.push(ni.address);
    });
  });
  console.log('');
  console.log('  MarkBottom 博客 · 本地预览');
  console.log('  ─────────────────────────────────────────');
  console.log(`  首页      http://127.0.0.1:${PORT}/`);
  console.log(`  文章示例  http://127.0.0.1:${PORT}/post/view?id=20261006_1`);
  console.log(`  关于      http://127.0.0.1:${PORT}/about.html`);
  if (lan.length) console.log(`  局域网    http://${lan[0]}:${PORT}/   （手机可以这样访问，用来验收移动端）`);
  console.log('  ─────────────────────────────────────────');
  console.log('  Ctrl+C 退出');
  console.log('');
});
