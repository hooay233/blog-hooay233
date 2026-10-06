/*!
 * post.js —— 文章页：/post/view?id=YYYYMMDD_X
 * 用 MarkBottom 解释器把 .mbmd 渲染成 DOM，并补齐导航、文章信息、目录、附件等。
 */
(function (global) {
  'use strict';

  var id = '';
  var meta = null;
  var opts = {};

  function $(sel) { return document.querySelector(sel); }

  /** MarkBottom 解释器（js/mb-*.js 挂在 window.MBMD 上） */
  function mb() { return global.MBMD; }

  function setStatus(html, isError) {
    var body = $('#post-body');
    if (!body) return;
    body.textContent = '';
    var div = document.createElement('div');
    div.className = isError ? 'post-error' : 'post-loading';
    div.innerHTML = html;
    body.appendChild(div);
  }

  function readId() {
    var p = new URLSearchParams(location.search);
    var v = (p.get('id') || p.get('postid') || '').trim();
    if (!v) {
      // 也支持 /post/view/20261006_1 这种写法
      var m = /\/post\/view\/([^/?#]+)/.exec(location.pathname);
      if (m) v = decodeURIComponent(m[1]);
    }
    return v;
  }

  function metaItem(icon, text) {
    var span = document.createElement('span');
    span.className = 'meta-item';
    if (icon) {
      var i = document.createElement('i');
      i.className = icon;
      span.appendChild(i);
    }
    span.appendChild(document.createTextNode(text));
    return span;
  }

  function renderHead() {
    var titleEl = $('#post-title');
    var metaEl = $('#post-meta');
    var sumEl = $('#post-summary');
    var kwEl = $('#post-keywords');
    var crumb = $('#crumb-title');

    document.title = (meta.title || '文章') + ' · Hooay 的博客';
    if (titleEl) titleEl.textContent = meta.title || '(无标题)';
    if (crumb) crumb.textContent = meta.title || '文章';

    if (metaEl) {
      metaEl.textContent = '';
      metaEl.appendChild(metaItem('far fa-calendar-alt', '发布于 ' + BlogAPI.formatDate(meta.createdAt, true)));
      if (meta.updatedAt && meta.updatedAt !== meta.createdAt) {
        metaEl.appendChild(metaItem('far fa-edit', '修改于 ' + BlogAPI.formatDate(meta.updatedAt, true)));
      }
      metaEl.appendChild(metaItem('far fa-eye', (meta.views || 0) + ' 次阅读'));
      if (meta.contentLength) {
        metaEl.appendChild(metaItem('far fa-file-alt', BlogAPI.formatBytes(meta.contentLength) + ' 正文'));
      }
      metaEl.appendChild(metaItem('fas fa-fingerprint', meta.id));
    }

    if (sumEl) {
      if (meta.summary) {
        sumEl.textContent = meta.summary;
        sumEl.hidden = false;
      } else sumEl.hidden = true;
    }

    if (kwEl) {
      kwEl.textContent = '';
      (meta.keywords || []).forEach(function (k) {
        var a = document.createElement('a');
        a.className = 'kw';
        a.href = '/index.html?keyword=' + encodeURIComponent(k);
        a.textContent = '#' + k;
        kwEl.appendChild(a);
      });
      kwEl.hidden = !(meta.keywords && meta.keywords.length);
    }
  }

  /* ---------- 目录 ---------- */
  function buildToc() {
    var body = $('#post-body');
    var toc = $('#toc');
    if (!body || !toc) return;
    var heads = body.querySelectorAll('h1, h2, h3, h4');
    if (heads.length < 2) { toc.hidden = true; return; }
    var list = document.createElement('ol');
    var levels = [0, 0, 0, 0];
    var stack = [list];
    Array.prototype.forEach.call(heads, function (h) {
      var lvl = parseInt(h.tagName.slice(1), 10);
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + (h.id || '');
      a.textContent = h.textContent.trim();
      li.appendChild(a);
      var parent = stack[Math.min(stack.length, lvl) - 1] || list;
      if (lvl > 1 && parent.lastElementChild) parent.lastElementChild.appendChild(li);
      else list.appendChild(li);
      levels[lvl - 1]++;
    });
    var title = document.createElement('div');
    title.className = 'toc-title';
    title.innerHTML = '<i class="fas fa-list-ul"></i>目录';
    title.addEventListener('click', function () {
      var collapsed = toc.classList.toggle('collapsed');
      try { localStorage.setItem('blog-toc-collapsed', collapsed ? '1' : '0'); } catch (e) { /* 忽略 */ }
    });
    toc.textContent = '';
    toc.appendChild(title);
    toc.appendChild(list);
    try {
      if (localStorage.getItem('blog-toc-collapsed') === '1') toc.classList.add('collapsed');
    } catch (e) { /* 忽略 */ }
    toc.hidden = false;
    // 点目录平滑滚动
    toc.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var target = document.getElementById(a.getAttribute('href').slice(1));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState({}, '', a.getAttribute('href'));
    });
  }

  /* ---------- 附件 ---------- */
  function renderAttachments() {
    var box = $('#post-attachments');
    if (!box) return;
    var files = (meta.files || []);
    if (!files.length) { box.hidden = true; return; }
    box.hidden = false;
    var title = document.createElement('h2');
    title.textContent = '附件（' + files.length + '）';
    var ul = document.createElement('ul');
    files.forEach(function (f) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = BlogAPI.fileUrl(meta.id, f.name);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = f.name;
      li.appendChild(a);
      li.appendChild(document.createTextNode(' · ' + (f.contentType || '未知类型') + ' · ' + BlogAPI.formatBytes(f.size)));
      ul.appendChild(li);
    });
    box.textContent = '';
    box.appendChild(title);
    box.appendChild(ul);
  }

  /* ---------- 上一篇 / 下一篇 ---------- */
  function renderNeighbors() {
    var nav = $('#post-nav');
    if (!nav) return;
    BlogAPI.listPosts({ limit: 100, sort: 'newest' }).then(function (data) {
      var posts = data.posts || [];
      var idx = -1;
      for (var i = 0; i < posts.length; i++) if (posts[i].id === meta.id) { idx = i; break; }
      if (idx < 0) return;
      var newer = posts[idx - 1], older = posts[idx + 1];
      var html = [];
      nav.textContent = '';
      var left = document.createElement('span');
      if (newer) {
        var a1 = document.createElement('a');
        a1.href = '/post/view?id=' + encodeURIComponent(newer.id);
        a1.textContent = '← 较新：' + newer.title;
        left.appendChild(a1);
      }
      var right = document.createElement('span');
      if (older) {
        var a2 = document.createElement('a');
        a2.href = '/post/view?id=' + encodeURIComponent(older.id);
        a2.textContent = '较旧：' + older.title + ' →';
        right.appendChild(a2);
      }
      var back = document.createElement('span');
      var a3 = document.createElement('a');
      a3.href = '/index.html';
      a3.textContent = '返回文章列表';
      back.appendChild(a3);
      nav.appendChild(left);
      nav.appendChild(back);
      nav.appendChild(right);
    }).catch(function () { /* 邻篇拿不到就算了 */ });
  }

  /* ---------- 主流程 ---------- */
  function boot() {
    id = readId();
    if (!/^\d{8}_\d+$/.test(id)) {
      setStatus('文章地址不合法：需要一个形如 <code>YYYYMMDD_X</code> 的 <code>id</code>。' +
        '<br><a href="/index.html">← 回到文章列表</a>', true);
      var h = $('#post-title');
      if (h) h.textContent = '找不到这篇文章';
      return;
    }
    opts = { resolveUrl: function (u) { return u; }, fetch: global.fetch ? global.fetch.bind(global) : null };

    Promise.all([
      BlogAPI.getMeta(id),
      BlogAPI.getPost(id)
    ]).then(function (res) {
      meta = res[0];
      var text = res[1];
      opts.resolveUrl = BlogAPI.makeResolver(id, meta);
      renderHead();
      var body = $('#post-body');
      body.textContent = '';
      mb().renderInto(body, text, opts);
      buildToc();
      renderAttachments();
      renderNeighbors();
      if (global.Theme && typeof global.Theme.apply === 'function' &&
          document.body.classList.contains('dark-mode')) {
        global.Theme.apply(true);
      }
    }).catch(function (err) {
      var notFound = err && (err.status === 404);
      setStatus((notFound ? '这篇文章不存在（可能已经被删掉了）。' : '加载失败：' + (err.message || err)) +
        '<br><a href="/index.html">← 回到文章列表</a>', true);
      var t = $('#post-title');
      if (t) t.textContent = notFound ? '文章不存在' : '加载失败';
      document.title = (notFound ? '文章不存在' : '加载失败') + ' · Hooay 的博客';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
