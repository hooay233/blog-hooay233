/*!
 * api.js —— Blog Public API 客户端（只读）
 * 文档：https://blog-api.hooay233.top   （v1.0，无需认证，CORS 全开）
 */
(function (global) {
  'use strict';

  var BASE = 'https://blog-api.hooay233.top';

  function ApiError(message, status, url) {
    var e = new Error(message);
    e.name = 'ApiError';
    e.status = status;
    e.url = url;
    return e;
  }

  function buildUrl(path, params) {
    var u = new URL(BASE + path);
    if (params) {
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v === undefined || v === null || v === '') return;
        u.searchParams.set(k, v);
      });
    }
    return u.toString();
  }

  function request(url, as) {
    return fetch(url, { headers: { Accept: as === 'text' ? 'text/plain,*/*' : 'application/json' } })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (body) {
            var msg = 'HTTP ' + r.status;
            try {
              var j = JSON.parse(body);
              if (j && j.message) msg = j.message;
            } catch (e) { /* 保持 HTTP 状态码 */ }
            throw ApiError(msg, r.status, url);
          }, function () { throw ApiError('HTTP ' + r.status, r.status, url); });
        }
        return as === 'text' ? r.text() : r.json();
      }, function (e) {
        throw ApiError('网络请求失败（可能是离线或被拦截）：' + e.message, 0, url);
      });
  }

  /** 文章列表：limit 1-100、offset、keyword 精确匹配关键词、q 标题/简介模糊搜索、sort newest|oldest */
  function listPosts(opts) {
    opts = opts || {};
    var params = {
      limit: opts.limit === undefined ? 10 : opts.limit,
      offset: opts.offset || 0,
      keyword: opts.keyword || '',
      q: opts.q || '',
      sort: opts.sort || 'newest'
    };
    if (opts.cacheBust) params._ = Date.now();
    return request(buildUrl('/api/posts', params), 'json');
  }

  /** 元信息 */
  function getMeta(id) {
    return request(buildUrl('/api/posts/' + encodeURIComponent(id) + '/meta.json', null), 'json');
  }

  /** 正文原文（text/markbottom）；注意：成功返回会让浏览量 +1 */
  function getPost(id) {
    return request(buildUrl('/api/posts/' + encodeURIComponent(id), null), 'text');
  }

  function health() {
    return request(buildUrl('/api/health', null), 'json');
  }

  /** 附件地址 */
  function fileUrl(id, name) {
    return BASE + '/api/posts/' + encodeURIComponent(id) + '/' + encodeURIComponent(name).replace(/%2F/gi, '/');
  }

  function basename(p) {
    return String(p).split(/[\\/]/).pop().split('?')[0].split('#')[0];
  }
  function stripExt(n) {
    return n.replace(/\.[^.]*$/, '');
  }

  /**
   * 把正文里的相对地址解析成附件地址。
   * 后缀名不作数（标准 3.21），所以先按文件名精确匹配，再按「同名不同后缀」兜底，
   * 最后再退回原样拼地址 —— 这样 `![img](./img1.png)` 也能指到实际存在的 `img1.webp`。
   */
  function makeResolver(id, meta) {
    var files = (meta && meta.files) || [];
    return function (url) {
      if (!url) return url;
      var u = String(url).trim();
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u)) return u;   // http(s): data: blob: mailto: …
      if (u.charAt(0) === '/') return u;                        // 站内绝对路径
      var name = basename(u);
      var hit = null;
      for (var i = 0; i < files.length; i++) {
        if (files[i].name === name) { hit = files[i].name; break; }
      }
      if (!hit) {
        var stem = stripExt(name).toLowerCase();
        for (var j = 0; j < files.length; j++) {
          if (stripExt(files[j].name).toLowerCase() === stem) { hit = files[j].name; break; }
        }
      }
      return fileUrl(id, hit || name);
    };
  }

  function formatDate(iso, withTime) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var p = function (n) { return String(n).length < 2 ? '0' + n : String(n); };
    var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    if (withTime) s += ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return s;
  }

  function formatBytes(n) {
    if (n === undefined || n === null || isNaN(n)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  global.BlogAPI = {
    BASE: BASE,
    listPosts: listPosts,
    getMeta: getMeta,
    getPost: getPost,
    health: health,
    fileUrl: fileUrl,
    makeResolver: makeResolver,
    formatDate: formatDate,
    formatBytes: formatBytes,
    ApiError: ApiError
  };
})(window);
