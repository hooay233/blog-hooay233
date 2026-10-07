/* 端到端自测：用 jsdom 真跑站点的 HTML + JS（脚本从本地 dev-server 取），
 * 拦截 fetch 走 Node 的真实网络，检查首页列表、搜索、文章页渲染的结果。
 * 用法：先起 dev-server，再 node .tools/test-site.js
 */
/* jsdom 可能装在仓库根、tools/ 或 .tools/ 里，这里都找一遍 */
function loadJsdom() {
  const candidates = [
    'jsdom',
    require('path').join(__dirname, 'node_modules', 'jsdom'),
    require('path').join(__dirname, '..', 'node_modules', 'jsdom'),
    require('path').join(__dirname, '..', '.tools', 'node_modules', 'jsdom')
  ];
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 试下一个 */ }
  }
  console.error('找不到 jsdom。先在仓库根目录执行：npm i jsdom');
  process.exit(3);
}
const { JSDOM, VirtualConsole } = loadJsdom();

const PORT = process.env.PORT || 8788;
const BASE = `http://127.0.0.1:${PORT}`;

const vc = new VirtualConsole();
const logs = [];
vc.on('jsdomError', (e) => logs.push('[jsdomError] ' + (e.message || e)));
vc.on('error', (...a) => logs.push('[error] ' + a.join(' ')));
vc.on('warn', (...a) => logs.push('[warn] ' + a.join(' ')));

function load(path) {
  return JSDOM.fromURL(BASE + path, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        const abs = /^https?:/.test(url) ? url : BASE + (url.startsWith('/') ? '' : '/') + url;
        return fetch(abs, init);
      };
      window.HTMLElement.prototype.scrollIntoView = function () {};
    }
  });
}

function waitFor(fn, timeout = 20000, step = 150) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      let v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeout) return reject(new Error('等待超时'));
      setTimeout(poll, step);
    })();
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

(async function () {
  /* ---------------- 首页 ---------------- */
  console.log('\n== 首页 / ==');
  let dom = await load('/');
  const w = dom.window, d = w.document;
  await waitFor(() => d.querySelectorAll('.post-card').length > 0);
  const cards = d.querySelectorAll('.post-card');
  check('渲染出文章卡片', cards.length >= 1, 'cards=' + cards.length);
  const first = cards[0];
  check('卡片标题链接指向 /post/view?id=', /post\/view\?id=\d{8}_\d+/.test(first.querySelector('.post-card-title a').getAttribute('href')),
    first.querySelector('.post-card-title a').getAttribute('href'));
  check('卡片有日期与浏览量', /20\d\d-\d\d-\d\d/.test(first.querySelector('.post-card-meta').textContent) &&
    /次|阅读|[0-9]/.test(first.querySelector('.post-card-meta').textContent),
    first.querySelector('.post-card-meta').textContent.replace(/\s+/g, ' '));
  check('状态行显示总数', /共 \d+ 篇/.test(d.getElementById('status').textContent), d.getElementById('status').textContent);
  await waitFor(() => d.querySelectorAll('#keyword-bar .kw-chip').length > 0).catch(() => {});
  check('关键词云出现', d.querySelectorAll('#keyword-bar .kw-chip').length > 0,
    'chips=' + d.querySelectorAll('#keyword-bar .kw-chip').length);
  check('主题按钮有文案', /模式/.test(d.getElementById('theme-toggle').textContent), d.getElementById('theme-toggle').textContent);
  check('搜索/重置按钮不再是"无效果按钮"',
    d.querySelectorAll('#search-form .spcbtn_disabled').length === 0,
    '仍带 spcbtn_disabled 的搜索按钮数：' + d.querySelectorAll('#search-form .spcbtn_disabled').length);

  // 搜索
  console.log('\n== 首页搜索 ?q= ==');
  const dom2 = await load('/?q=' + encodeURIComponent('测试'));
  await waitFor(() => dom2.window.document.querySelectorAll('.post-card').length > 0);
  const st2 = dom2.window.document.getElementById('status').textContent;
  check('搜索后状态行带上关键词', /搜索「测试」/.test(st2), st2);
  check('搜索输入框回填', dom2.window.document.getElementById('search-input').value === '测试');
  check('搜索命中数正确', /共 [1-9]\d* 篇/.test(st2), st2);

  console.log('\n== 首页搜索（无结果） ==');
  const dom3 = await load('/?q=' + encodeURIComponent('zzz不可能存在的词zzz'));
  await waitFor(() => /共 0 篇|没有匹配/.test(dom3.window.document.getElementById('status').textContent));
  check('无结果时给出提示', /共 0 篇/.test(dom3.window.document.getElementById('status').textContent) &&
    /没有匹配/.test(dom3.window.document.getElementById('post-list').textContent),
    dom3.window.document.getElementById('status').textContent + ' | ' + dom3.window.document.getElementById('post-list').textContent);

  /* ---------------- 文章页 ---------------- */
  console.log('\n== 文章页 /post/view?id=20261006_1 ==');
  const dom4 = await load('/post/view?id=20261006_1');
  const w4 = dom4.window, d4 = w4.document;
  await waitFor(() => d4.querySelectorAll('#post-body h1, #post-body h2').length > 0, 30000);
  const body = d4.querySelectorAll('#post-body');
  const txt = d4.getElementById('post-body').textContent;
  check('标题渲染', d4.getElementById('post-title').textContent.trim().length > 0, d4.getElementById('post-title').textContent);
  check('文章信息（日期/浏览量/正文大小/id）', /发布于/.test(d4.getElementById('post-meta').textContent) &&
    /次阅读/.test(d4.getElementById('post-meta').textContent) && /20261006_1/.test(d4.getElementById('post-meta').textContent),
    d4.getElementById('post-meta').textContent.replace(/\s+/g, ' '));
  check('简介', d4.getElementById('post-summary').textContent.length > 10);
  check('标签', d4.querySelectorAll('#post-keywords .kw').length >= 3,
    'kw=' + d4.querySelectorAll('#post-keywords .kw').length);
  check('目录生成', d4.querySelectorAll('#toc .toc-title').length === 1 && d4.querySelectorAll('#toc a').length >= 5,
    'toc links=' + d4.querySelectorAll('#toc a').length);
  check('标题已自动加 id', d4.querySelector('#post-body h2').id.length > 0, d4.querySelector('#post-body h2').id);
  check('ruby 渲染', d4.querySelectorAll('#post-body ruby').length >= 4, 'ruby=' + d4.querySelectorAll('#post-body ruby').length);
  check('表格渲染', d4.querySelectorAll('#post-body table').length >= 4, 'tables=' + d4.querySelectorAll('#post-body table').length);
  check('延续符 rowspan', d4.querySelector('#post-body td[rowspan]') !== null);
  check('斜线单元格', d4.querySelector('#post-body .mb-slash') !== null);
  check('折叠块（details）', d4.querySelector('#post-body details.mb-fold') !== null);
  check('分离式折叠（表格行/列表项）', d4.querySelector('#post-body [data-mb-fold]') !== null);
  check('图表', d4.querySelectorAll('#post-body .mb-chart').length >= 2, 'charts=' + d4.querySelectorAll('#post-body .mb-chart').length);
  check('公式保留原文并有标记', d4.querySelectorAll('#post-body [data-mb-tex]').length >= 2);
  check('脚注', d4.querySelector('#post-body .mb-footnotes') !== null);
  check('任务列表', d4.querySelectorAll('#post-body input.mb-task-box').length >= 2);
  check('图片地址已解析成附件地址', (d4.querySelector('#post-body img') || {}).src &&
    /blog-api\.hooay233\.top\/api\/posts\/20261006_1\/img1\.webp/.test(d4.querySelector('#post-body img').src),
    (d4.querySelector('#post-body img') || {}).src);
  check('附件区', d4.querySelectorAll('#post-attachments li').length >= 1);

  /* 层级关系：主体 div 下直接挂 文章信息 / 正文内容 / 附件 / 上下篇 */
  const main = d4.getElementById('post-main');
  const kids = Array.prototype.map.call(main.children, (el) => el.id || el.className);
  check('主体 div 的直接子元素是这四个块', kids.length === 4 &&
    main.children[0].id === 'post-info' && main.children[1].id === 'post-content' &&
    main.children[2].id === 'post-attachments' && main.children[3].id === 'post-nav',
    JSON.stringify(kids));
  check('文章信息在 #post-info 里', d4.querySelector('#post-info #post-title') !== null &&
    d4.querySelector('#post-info #post-meta') !== null);
  check('正文在 #post-content 里', d4.querySelector('#post-content #post-body') !== null &&
    d4.querySelector('#post-content #toc') !== null);
  check('正文没有被塞进 文章信息 div', d4.querySelector('#post-info #post-body') === null);

  /* 附件默认折叠 */
  const attachToggle = d4.getElementById('attach-toggle');
  const attachBody = d4.getElementById('attach-body');
  check('附件默认折叠', attachBody.hidden === true && attachToggle.getAttribute('aria-expanded') === 'false');
  attachToggle.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
  check('点标题能展开附件', attachBody.hidden === false && attachToggle.getAttribute('aria-expanded') === 'true');
  attachToggle.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
  check('再点一下收起附件', attachBody.hidden === true && attachToggle.getAttribute('aria-expanded') === 'false');
  await waitFor(() => d4.querySelectorAll('#post-nav a').length >= 1, 8000).catch(() => {});
  check('上下篇 / 返回列表导航', d4.querySelectorAll('#post-nav a').length >= 1,
    'links=' + d4.querySelectorAll('#post-nav a').length + ' text=' + d4.getElementById('post-nav').textContent);
  check('document.title 已更新', /Hooay/.test(d4.title) && /测试/.test(d4.title), d4.title);

  /* 交互：点按钮 -> put 插入文字 */
  console.log('\n== 文章页交互 ==');
  const btn = [...d4.querySelectorAll('#post-body button.mb-btn')].find((b) => /点我/.test(b.textContent));
  const before = d4.getElementById('post-body').textContent;
  if (btn) {
    btn.dispatchEvent(new w4.MouseEvent('click', { bubbles: true }));
    await waitFor(() => d4.getElementById('post-body').textContent.includes('你好，世界！')).catch(() => {});
    check('按钮 {{put}} 生效', d4.getElementById('post-body').textContent.includes('你好，世界！'),
      '之前长度 ' + before.length + ' → ' + d4.getElementById('post-body').textContent.length);
  } else check('找到按钮', false);

  /* trigger / call / use */
  check('{{call}} 把内容放到 trigger 的位置', (() => {
    const beforeTrigger = [...d4.querySelectorAll('#post-body .mb-exec')].find((s) => /trigger/.test(s.getAttribute('data-mb') || ''));
    return beforeTrigger && beforeTrigger.nextSibling && /hello/.test(beforeTrigger.nextSibling.textContent || '');
  })());
  check('{{use}} 把内容放到 use 的位置', (() => {
    const useEl = [...d4.querySelectorAll('#post-body .mb-exec')].find((s) => /use:/.test(s.getAttribute('data-mb') || ''));
    return useEl && useEl.nextSibling && /hello/.test(useEl.nextSibling.textContent || '');
  })());

  /* 折叠展开 */
  const foldCb = d4.querySelector('#post-body input.mb-fold-state[data-mb-rows]');
  if (foldCb) {
    const target = d4.querySelector('#post-body [data-mb-fold="' + foldCb.getAttribute('data-mb-rows') + '"]');
    const hiddenBefore = target.classList.contains('mb-fold-off');
    foldCb.checked = true;
    foldCb.dispatchEvent(new w4.Event('change', { bubbles: true }));
    check('折叠块可以展开', hiddenBefore && !target.classList.contains('mb-fold-off'));
    foldCb.checked = false;
    foldCb.dispatchEvent(new w4.Event('change', { bubbles: true }));
    check('折叠块可以收起', target.classList.contains('mb-fold-off'));
  } else check('找到折叠控件', false);

  /* 变量 */
  check('变量被替换成时间', /20\d\d-\d\d-\d\d/.test(txt), (txt.match(/现在是[^\n]{0,40}/) || [''])[0]);

  /* 不存在的文章 */
  console.log('\n== 文章页 404 ==');
  const dom5 = await load('/post/view?id=20201006_9');
  await waitFor(() => /不存在|加载失败/.test(dom5.window.document.getElementById('post-title').textContent));
  check('不存在的文章给出提示', /不存在/.test(dom5.window.document.getElementById('post-title').textContent),
    dom5.window.document.getElementById('post-title').textContent);

  /* 非法 id */
  const dom6 = await load('/post/view?id=abc');
  await waitFor(() => /不合法|找不到/.test(dom6.window.document.getElementById('post-title').textContent));
  check('非法 id 给出提示', /找不到|不合法/.test(dom6.window.document.getElementById('post-title').textContent));

  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  const noisy = logs.filter((l) => !/Could not parse CSS|Not implemented/.test(l));
  if (noisy.length) {
    console.log('\n--- 页面日志（前 20 条）---');
    console.log(noisy.slice(0, 20).join('\n'));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试崩溃：', e);
  process.exit(2);
});
