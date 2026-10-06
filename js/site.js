/*!
 * site.js —— 首页：文章列表 / 搜索 / 关键词筛选 / 排序 / 分页
 * 依赖：api.js（BlogAPI）、theme.js（可选 window.Theme）
 */
(function (global) {
  'use strict';

  var S = {
    q: '',
    keyword: '',
    sort: 'newest',
    page: 1,
    pageSize: 8,
    total: 0
  };

  var el = {};
  var universeCache = null;

  function $(id) { return document.getElementById(id); }

  /* ---------- 地址栏同步 ---------- */
  function readUrl() {
    var p = new URLSearchParams(location.search);
    S.q = p.get('q') || '';
    S.keyword = p.get('keyword') || '';
    S.sort = p.get('sort') === 'oldest' ? 'oldest' : 'newest';
    var page = parseInt(p.get('page') || '1', 10);
    S.page = (isFinite(page) && page > 0) ? page : 1;
  }

  function writeUrl(push) {
    var p = new URLSearchParams();
    if (S.q) p.set('q', S.q);
    if (S.keyword) p.set('keyword', S.keyword);
    if (S.sort !== 'newest') p.set('sort', S.sort);
    if (S.page > 1) p.set('page', String(S.page));
    var qs = p.toString();
    var url = location.pathname + (qs ? '?' + qs : '') + (location.hash || '');
    try {
      history[push ? 'pushState' : 'replaceState']({}, '', url);
    } catch (e) { /* file:// 下可能受限 */ }
  }

  /* ---------- 状态提示 ---------- */
  function setStatus(msg, kind) {
    if (!el.status) return;
    el.status.textContent = msg || '';
    el.status.className = 'status small ' + (kind === 'error' ? 'status-error' : 'gray');
  }

  /* ---------- 渲染 ---------- */
  function makeCard(post) {
    var card = document.createElement('article');
    card.className = 'post-card card';

    var h2 = document.createElement('h2');
    h2.className = 'post-card-title';
    var a = document.createElement('a');
    a.href = 'post/view?id=' + encodeURIComponent(post.id);
    a.textContent = post.title || '(无标题)';
    h2.appendChild(a);

    var summary = document.createElement('p');
    summary.className = 'post-card-summary';
    summary.textContent = post.summary || '（这篇文章没有写简介）';

    var meta = document.createElement('div');
    meta.className = 'post-card-meta';
    meta.appendChild(metaItem('far fa-calendar-alt', BlogAPI.formatDate(post.createdAt)));
    meta.appendChild(metaItem('far fa-eye', String(post.views === undefined ? 0 : post.views)));
    if (post.fileCount) meta.appendChild(metaItem('fas fa-paperclip', post.fileCount + ' 个附件'));
    if (post.updatedAt && post.updatedAt !== post.createdAt) {
      meta.appendChild(metaItem('far fa-edit', '改于 ' + BlogAPI.formatDate(post.updatedAt)));
    }

    card.appendChild(h2);
    card.appendChild(summary);
    card.appendChild(meta);

    if (post.keywords && post.keywords.length) {
      var kw = document.createElement('div');
      kw.className = 'post-card-keywords';
      post.keywords.forEach(function (k) {
        var link = document.createElement('a');
        link.className = 'kw' + (S.keyword && S.keyword.toLowerCase() === String(k).toLowerCase() ? ' active' : '');
        link.href = 'index.html?keyword=' + encodeURIComponent(k);
        link.textContent = '#' + k;
        kw.appendChild(link);
      });
      card.appendChild(kw);
    }
    return card;
  }

  function metaItem(icon, text) {
    var span = document.createElement('span');
    span.className = 'meta-item';
    var i = document.createElement('i');
    i.className = icon;
    span.appendChild(i);
    span.appendChild(document.createTextNode(text));
    return span;
  }

  function renderList(posts) {
    if (!el.list) return;
    el.list.textContent = '';
    if (!posts.length) {
      var empty = document.createElement('div');
      empty.className = 'post-empty';
      empty.textContent = (S.q || S.keyword)
        ? '没有匹配的文章，换个关键词试试？'
        : '这里还什么都没有……去写第一篇吧。';
      el.list.appendChild(empty);
      return;
    }
    posts.forEach(function (p) { el.list.appendChild(makeCard(p)); });
  }

  function renderPager() {
    if (!el.pager) return;
    el.pager.textContent = '';
    var pages = Math.max(1, Math.ceil(S.total / S.pageSize));
    if (pages <= 1) return;

    var prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'pager-btn';
    prev.textContent = '上一页';
    prev.disabled = S.page <= 1;
    prev.addEventListener('click', function () { goto(S.page - 1); });
    el.pager.appendChild(prev);

    var nums = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - S.page) <= 2) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    nums.forEach(function (n) {
      if (n === '…') {
        var span = document.createElement('span');
        span.className = 'pager-gap';
        span.textContent = '…';
        el.pager.appendChild(span);
        return;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pager-btn' + (n === S.page ? ' active' : '');
      b.textContent = String(n);
      b.addEventListener('click', function () { goto(n); });
      el.pager.appendChild(b);
    });

    var next = document.createElement('button');
    next.type = 'button';
    next.className = 'pager-btn';
    next.textContent = '下一页';
    next.disabled = S.page >= pages;
    next.addEventListener('click', function () { goto(S.page + 1); });
    el.pager.appendChild(next);

    var info = document.createElement('span');
    info.className = 'pager-info';
    info.textContent = S.page + ' / ' + pages + '（共 ' + S.total + ' 篇）';
    el.pager.appendChild(info);
  }

  /* ---------- 关键词云（拿一篇大列表推导，缓存 10 分钟） ---------- */
  function loadUniverse() {
    if (universeCache) return Promise.resolve(universeCache);
    var KEY = 'blog-kw-universe-v1';
    try {
      var raw = sessionStorage.getItem(KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && obj.t && Date.now() - obj.t < 600000 && obj.kw) {
          universeCache = obj.kw;
          return Promise.resolve(universeCache);
        }
      }
    } catch (e) { /* 忽略 */ }
    return BlogAPI.listPosts({ limit: 100, sort: 'newest' }).then(function (data) {
      var map = Object.create(null);
      (data.posts || []).forEach(function (p) {
        (p.keywords || []).forEach(function (k) { map[k] = (map[k] || 0) + 1; });
      });
      var arr = Object.keys(map).map(function (k) { return { name: k, count: map[k] }; });
      arr.sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
      universeCache = arr.slice(0, 24);
      try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), kw: universeCache })); } catch (e2) { /* 忽略 */ }
      return universeCache;
    }).catch(function () { return []; });
  }

  function renderKeywords(list) {
    if (!el.keywords) return;
    el.keywords.textContent = '';
    if (!list.length) return;
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'kw-chip' + (S.keyword ? '' : ' active');
    all.textContent = '全部';
    all.addEventListener('click', function () { S.keyword = ''; S.page = 1; load(); });
    el.keywords.appendChild(all);

    list.forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'kw-chip' + (S.keyword && S.keyword.toLowerCase() === item.name.toLowerCase() ? ' active' : '');
      b.textContent = '#' + item.name;
      b.title = item.count + ' 篇';
      b.addEventListener('click', function () {
        S.keyword = (S.keyword && S.keyword.toLowerCase() === item.name.toLowerCase()) ? '' : item.name;
        S.page = 1;
        load();
      });
      el.keywords.appendChild(b);
    });
  }

  /* ---------- 主流程 ---------- */
  function load() {
    if (el.input) el.input.value = S.q;
    if (el.sort) el.sort.value = S.sort;
    setStatus('正在加载文章…');
    if (el.list) el.list.textContent = '';
    if (el.pager) el.pager.textContent = '';
    writeUrl(false);

    BlogAPI.listPosts({
      limit: S.pageSize,
      offset: (S.page - 1) * S.pageSize,
      q: S.q,
      keyword: S.keyword,
      sort: S.sort
    }).then(function (data) {
      S.total = data.total || 0;
      var pages = Math.max(1, Math.ceil(S.total / S.pageSize));
      if (S.page > pages) { S.page = pages; return load(); }
      renderList(data.posts || []);
      renderPager();
      var parts = [];
      if (S.q) parts.push('搜索「' + S.q + '」');
      if (S.keyword) parts.push('标签「#' + S.keyword + '」');
      parts.push('共 ' + S.total + ' 篇');
      setStatus(parts.join(' · '));
      loadUniverse().then(renderKeywords);
      applyTheme();
    }).catch(function (err) {
      setStatus('加载失败：' + err.message, 'error');
    });
  }

  function goto(page) {
    S.page = page;
    load();
    var anchor = $('posts');
    if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** 动态生成的元素也要跟上暗色模式（主题用的是逐元素 dark_style 类） */
  function applyTheme() {
    if (global.Theme && typeof global.Theme.apply === 'function' &&
        document.body.classList.contains('dark-mode')) {
      global.Theme.apply(true);
    }
  }

  function bind() {
    el = {
      form: $('search-form'),
      input: $('search-input'),
      clear: $('search-clear'),
      sort: $('sort-select'),
      keywords: $('keyword-bar'),
      status: $('status'),
      list: $('post-list'),
      pager: $('pager')
    };
    if (el.form) {
      el.form.addEventListener('submit', function (e) {
        e.preventDefault();
        S.q = el.input ? el.input.value.trim() : '';
        S.page = 1;
        load();
      });
    }
    if (el.clear) {
      el.clear.addEventListener('click', function () {
        S.q = '';
        S.keyword = '';
        S.page = 1;
        if (el.input) el.input.value = '';
        load();
      });
    }
    if (el.sort) {
      el.sort.addEventListener('change', function () {
        S.sort = el.sort.value === 'oldest' ? 'oldest' : 'newest';
        S.page = 1;
        load();
      });
    }
    global.addEventListener('popstate', function () { readUrl(); load(); });
  }

  function init() {
    bind();
    readUrl();
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
