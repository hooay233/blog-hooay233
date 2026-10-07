/*!
 * mb-inline.js —— MarkBottom 0.1 解释器 · 行内解析
 * 逐字符扫描 + 就近配对，未闭合的定界符一律原样输出（标准 附录B 第 8 条）。
 */
(function (global) {
  'use strict';

  var MB = global.MBMD;
  var U = MB.util;

  var FOLD_CLASSES = {
    bigger: 'mb-bigger',
    smaller: 'mb-smaller'
  };

  /* =====================================================================
   * 行内解析主入口
   * =====================================================================
   * renderInline(src, ctx, out)
   *   src  源文本（一个逻辑行 / 一个块的内容）
   *   ctx  { target, doc, noSupsub, vertical, buttonText, noExec }
   *   out  追加到的父节点（Element / DocumentFragment）
   */
  function renderInline(src, ctx, out) {
    ctx = ctx || {};
    var doc = ctx.doc || (ctx.doc = { options: {}, foldSeq: 0, ids: Object.create(null), fnRefs: [], fnDefs: Object.create(null), skipClose: 0 });
    var buf = [];
    var pendingLabel = null;
    var pendingAttrs = { id: null, classes: [], aria: null };
    var i = 0;
    var n = src.length;

    function flush() {
      if (!buf.length) return;
      var s = buf.join('');
      buf.length = 0;
      out.appendChild(document.createTextNode(s));
    }
    function isInteractive(el) {
      if (!el || el.nodeType !== 1) return false;
      var t = el.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || t === 'BUTTON') return true;
      return el.classList && el.classList.contains('mb-fold-title');
    }
    function push(node) {
      if (node === null || node === undefined) return;
      if (Array.isArray(node)) { node.forEach(push); return; }
      if (pendingLabel) {
        if (typeof node === 'string') { push(document.createTextNode(node)); return; }
        if (isInteractive(node)) {
          flush();
          pendingLabel.appendChild(node);
          pendingLabel = null;
          return;
        }
        if (node.nodeType === 3 && !node.data.trim()) {
          // 标签与控件之间的空白：并进标签里
          pendingLabel.appendChild(node);
          return;
        }
        // 出现了别的东西：标签就只是个普通标签（标准 3.14 规则 4）
        pendingLabel = null;
      }
      flush();
      out.appendChild(node);
    }
    function pushText(s) { buf.push(s); }

    /** 找「紧挨在前面的元素」；没有就落到 ctx.target（所在块） */
    function targetFor(attrs) {
      var node = null;
      for (var k = out.childNodes.length - 1; k >= 0; k--) {
        var c = out.childNodes[k];
        if (c.nodeType === 3 && !c.data.trim()) continue;
        node = c; break;
      }
      return (node && node.nodeType === 1) ? node : (ctx.target || null);
    }
    function applyAttrs(attrs) {
      var t = targetFor(attrs);
      if (!t) return;
      applyTo(t, attrs);
    }
    function applyTo(t, attrs) {
      if (!t) return;
      if (attrs.id) t.id = attrs.id;
      if (attrs.classes) attrs.classes.forEach(function (c) { if (c) t.classList.add(c); });
      if (attrs.aria) t.setAttribute('aria-label', attrs.aria);
      if (attrs.height) t.style.height = attrs.height + 'em';
    }
    /** 行尾的排版调整语句：位置类把前一个元素包进容器 */
    function applyFormat(fmt) {
      var hasPos = !!fmt.position;
      if (hasPos) {
        var node = targetFor({});
        var isElem = node && node.nodeType === 1 && node !== ctx.target;
        if (isElem) {
          // 只把前一个行内元素包起来（标准 3.9.4 规则 6）
          var wrap = U.elem('div', { class: fmt.classes.join(' ') });
          if (fmt.height) wrap.style.height = fmt.height + 'em';
          flush();
          out.replaceChild(wrap, node);
          wrap.appendChild(node);
          return;
        }
      }
      var t = ctx.target;
      if (t) {
        fmt.classes.forEach(function (c) { t.classList.add(c); });
        if (hasPos && fmt.height) t.style.height = fmt.height + 'em';
      }
    }

    /* ---------- 各组匹配器：返回 {end, node|nodes} 或 null ---------- */

    function sub(src2, extra) {
      var c = {};
      for (var k in ctx) c[k] = ctx[k];
      c.target = null;
      if (extra) for (var k2 in extra) c[k2] = extra[k2];
      var f = document.createDocumentFragment();
      renderInline(src2, c, f);
      return f;
    }
    function subInto(el, src2, extra) {
      var c = {};
      for (var k in ctx) c[k] = ctx[k];
      c.target = el;
      if (extra) for (var k2 in extra) c[k2] = extra[k2];
      renderInline(src2, c, el);
      return el;
    }
    function rp() {
      var f = document.createDocumentFragment();
      f.appendChild(U.elem('rp', { text: '(' }));
      return f;
    }
    function rpClose() {
      var f = document.createDocumentFragment();
      f.appendChild(U.elem('rp', { text: ')' }));
      return f;
    }
    function rubyWrap(baseFrag, rtFrag, under) {
      var r = U.elem('ruby', under ? { class: 'mb-ruby-under' } : null);
      r.appendChild(baseFrag);
      r.appendChild(rp());
      r.appendChild(U.elem('rt')).appendChild(rtFrag);
      r.appendChild(rpClose());
      return r;
    }
    function dotsRuby(str, under) {
      var r = U.elem('ruby', under ? { class: 'mb-ruby-under' } : null);
      Array.from(str).forEach(function (ch) {
        r.appendChild(document.createTextNode(ch));
        r.appendChild(rp());
        r.appendChild(U.elem('rt', { text: '●' }));
        r.appendChild(rpClose());
      });
      return r;
    }
    function idName(prefix) {
      var id = prefix + (++doc.foldSeq);
      return id;
    }
    function uniqId(want) {
      var base = String(want).replace(/[^\w\u4e00-\u9fa5-]/g, '-');
      if (!doc.ids[base]) { doc.ids[base] = 1; return base; }
      var k = 2;
      while (doc.ids[base + '-' + k]) k++;
      doc.ids[base + '-' + k] = 1;
      return base + '-' + k;
    }

    /* ---- ruby： 【基字|上标/下标】 / [(基字|上标)] ---- */
    function tryRuby(s, p) {
      var open, close, start;
      if (s.charAt(p) === '【') { open = '【'; close = '】'; start = p + 1; }
      else if (s.charAt(p) === '[' && s.charAt(p + 1) === '(') { open = '[('; close = ')]'; start = p + 2; }
      else return null;
      var end = U.matchClose(s, p, open, close);
      if (end < 0) return null;
      var inner = s.slice(start, end - close.length);
      var k = U.findTopLevel(inner, '|/｜／', [['【', '】'], ['[', ']'], ['(', ')']]);
      if (k < 0) {
        // 没有任何分隔符：不是 ruby，连同定界符一起原样输出
        var lit = document.createDocumentFragment();
        lit.appendChild(document.createTextNode(open));
        lit.appendChild(sub(inner));
        lit.appendChild(document.createTextNode(close));
        return { end: end, node: lit };
      }
      var firstSep = inner.charAt(k);
      var rest = inner.slice(k + 1);
      var base = U.trimOne(inner.slice(0, k));
      var over = '', under = '';
      var overSep = firstSep === '|' || firstSep === '｜';
      var k2 = U.findTopLevel(rest, '/／', [['【', '】'], ['[', ']'], ['(', ')']]);
      if (overSep) {
        if (k2 >= 0) { over = U.trimOne(rest.slice(0, k2)); under = U.trimOne(rest.slice(k2 + 1)); }
        else over = U.trimOne(rest);
      } else {
        under = U.trimOne(rest);
      }
      if (base === '') {
        return { end: end, node: document.createTextNode(open + inner + close) };
      }
      // 着重号：写了分隔符但那一侧为空（标准 3.2 规则 3）
      if (over === '' && under === '') {
        return { end: end, node: dotsRuby(base, !overSep) };
      }
      if (over !== '' && under === '') {
        return { end: end, node: rubyWrap(sub(base), sub(over), false) };
      }
      if (under !== '' && over === '') {
        return { end: end, node: rubyWrap(sub(base), sub(under), true) };
      }
      // 上下都有：必须嵌套 ruby
      var outer = U.elem('ruby', { class: 'mb-ruby-under' });
      var inner2 = U.elem('ruby', { class: 'mb-ruby-over' });
      inner2.appendChild(sub(base));
      inner2.appendChild(rp());
      inner2.appendChild(U.elem('rt')).appendChild(sub(over));
      inner2.appendChild(rpClose());
      outer.appendChild(inner2);
      outer.appendChild(rp());
      outer.appendChild(U.elem('rt')).appendChild(sub(under));
      outer.appendChild(rpClose());
      return { end: end, node: outer };
    }

    /* ---- 变大 / 变小 ---- */
    function trySize(s, p) {
      var table = [
        ['<-[', ']->', FOLD_CLASSES.bigger],
        ['+[', ']+', FOLD_CLASSES.bigger],
        ['->[', ']<-', FOLD_CLASSES.smaller],
        ['-[', ']-', FOLD_CLASSES.smaller]
      ];
      for (var t = 0; t < table.length; t++) {
        var op = table[t][0];
        if (!s.startsWith(op, p)) continue;
        var start = p + op.length;
        var closeBracket = U.matchChar(s, p + op.length - 1, '[', ']');   // ”]” 之后的位置
        if (closeBracket < 0) continue;
        var after = s.substr(closeBracket - 1, table[t][1].length);       // ”]” 本身起算
        if (after !== table[t][1]) continue;
        var inner = s.slice(start, closeBracket - 1);
        var el = U.elem('span', { class: table[t][2] });
        el.appendChild(sub(inner));
        return { end: closeBracket - 1 + table[t][1].length, node: el };
      }
      return null;
    }

    /* ---- 竖排 / 横排 ---- */
    function tryVertical(s, p) {
      var specs = [
        { open: '[|[', close: ']|]', cls: 'mb-vertical' },
        { open: '「「', close: '」」', cls: 'mb-vertical' },
        { open: '[-[', close: ']-]', cls: 'mb-horizontal' },
        { open: '『『', close: '』』', cls: 'mb-horizontal' }
      ];
      for (var t = 0; t < specs.length; t++) {
        var sp = specs[t];
        if (!s.startsWith(sp.open, p)) continue;
        var end = U.matchClose(s, p, sp.open, sp.close);
        if (end < 0) return null;
        var inner = s.slice(p + sp.open.length, end - sp.close.length);
        var el = U.elem('span', { class: sp.cls });
        el.appendChild(sub(inner, { vertical: sp.cls === 'mb-vertical' ? true : ctx.vertical }));
        return { end: end, node: el };
      }
      return null;
    }

    /* ---- 原始文本 [o[ ... ]o] ---- */
    function tryOrigin(s, p) {
      if (!s.startsWith('[o[', p)) return null;
      var skip = doc.skipClose || 0;
      doc.skipClose = 0;
      var end = U.matchClose(s, p, '[o[', ']o]');
      if (end < 0) return null;
      var inner = s.slice(p + 3, end - 3);
      var el = U.elem('span', { class: 'mb-origin', text: inner });
      return { end: end, node: el };
    }

    /* ---- 折叠块 ---- */
    function tryFold(s, p) {
      if (s.charAt(p) !== '~' || s.charAt(p + 1) !== '[') return null;
      var tEnd = U.matchChar(s, p + 1, '[', ']');
      if (tEnd < 0) return null;
      var title = s.slice(p + 2, tEnd - 1);
      var q = tEnd;
      // 分离式折叠块按钮：~[标题]~>[标识符]
      if (s.startsWith('~>[', q)) {
        var iEnd = U.matchChar(s, q + 2, '[', ']');
        if (iEnd < 0) return null;
        var ident = U.trimAll(s.slice(q + 3, iEnd - 1));
        var id = 'mbd-' + ident;
        doc.ids[id] = 1;
        var box = document.createDocumentFragment();
        var input = U.elem('input', { type: 'checkbox', class: 'mb-fold-state', id: id, 'data-mb-rows': id });
        var label = U.elem('label', { class: 'mb-fold-title', for: id });
        label.appendChild(sub(title));
        box.appendChild(input); box.appendChild(label);
        return { end: iEnd, node: box };
      }
      var defOpen = false;
      if (s.charAt(q) === ':') { defOpen = true; q++; }
      if (s.charAt(q) !== '[') return null;
      var bEnd = U.matchChar(s, q, '[', ']');
      if (bEnd < 0) return null;
      var body = s.slice(q + 1, bEnd - 1);
      var q2 = bEnd;
      // 第三段：收起文本 -> checkbox + label 的纯 CSS 折叠
      if (s.charAt(q2) === '[') {
        var cEnd = U.matchChar(s, q2, '[', ']');
        if (cEnd >= 0) {
          var closeText = s.slice(q2 + 1, cEnd - 1);
          if (closeText === '') closeText = '▲';
          var cid = idName('mb-fold-');
          var wrap = U.elem('span', { class: 'mb-fold-inline' });
          var st = U.elem('input', { type: 'checkbox', id: cid, class: 'mb-fold-state' });
          if (defOpen) st.checked = true;
          var tLab = U.elem('label', { class: 'mb-fold-title', for: cid });
          tLab.appendChild(sub(title));
          var bodyEl = U.elem('span', { class: 'mb-fold-body' });
          bodyEl.appendChild(sub(body));
          var cLab = U.elem('label', { class: 'mb-fold-close', for: cid });
          cLab.appendChild(sub(closeText));
          U.append(wrap, [st, tLab, bodyEl, cLab]);
          return { end: cEnd, node: wrap };
        }
      }
      var det = U.elem('details', { class: 'mb-fold' });
      if (defOpen) det.setAttribute('open', '');
      var sum = U.elem('summary');
      sum.appendChild(sub(title));
      det.appendChild(sum);
      det.appendChild(sub(body));
      return { end: bEnd, node: det };
    }

    /* ---- 按钮 / 按钮式连接 ---- */
    function tryBracketButton(s, p) {
      if (!s.startsWith('[[', p)) return null;
      var lEnd = U.matchChar(s, p + 1, '[', ']');   // 第一个完整方括号 = 显示文本
      if (lEnd < 0) return null;
      var label = s.slice(p + 2, lEnd - 1);
      var rest = s.slice(lEnd);
      var m;
      if ((m = /^\s*\(/.exec(rest))) {          // [[文本](地址)]
        var rEnd = U.matchChar(s, lEnd + m[0].length - 1, '(', ')');
        if (rEnd < 0) return null;
        var href = U.trimAll(s.slice(lEnd + m[0].length, rEnd - 1));
        if (!/^\]/.test(s.slice(rEnd))) return null;
        var text = label.trim() === '' ? href : label;
        var a = U.elem('a', { class: 'mb-btn', href: resolveUrl(href) });
        a.appendChild(sub(text));
        return { end: rEnd + 1, node: a };
      }
      if ((m = /^\s*\{\{/.exec(rest))) {        // [[文本]{执行语句}]
        var scriptStart = lEnd + m[0].length - 2;
        var script = readExec(s, scriptStart);
        if (!script) return null;
        var after = s.slice(script.end);
        if (!/^\s*\]/.test(after)) return null;
        var btn = U.elem('button', { type: 'button', class: 'mb-btn', 'data-mb': script.attr });
        btn.appendChild(sub(label, { buttonText: true }));
        return { end: script.end + after.indexOf(']') + 1, node: btn };
      }
      return null;
    }

    function resolveUrl(u) {
      var opt = doc.options || {};
      return opt.resolveUrl ? opt.resolveUrl(u) : u;
    }

    /* ---- {{...}}：执行语句；相邻的多个组会合成一组 ---- */
    /** 找一组执行语句的收尾：{{ 单元 单元 … }}，内部字符串里的花括号不算 */
    function matchExecEnd(s, p) {
      var depth = 0, i = p, inStr = false;
      while (i < s.length) {
        var c = s.charAt(i);
        if (inStr) {
          if (c === '\\') { i += 2; continue; }
          if (c === '"') inStr = false;
          i++;
          continue;
        }
        if (c === '"') { inStr = true; i++; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return i + 1; }
        i++;
      }
      return -1;
    }
    function readExec(s, p) {
      if (!s.startsWith('{{', p)) return null;
      var j = p, inner = '';
      for (;;) {
        var close = matchExecEnd(s, j);
        if (close < 0) return null;
        inner += s.slice(j + 1, close - 1);              // 连单元自己的 { }
        j = close;
        if (s.startsWith('{{', j)) continue;              // {{a}}{{b}} 与 {{a}{b}} 等价
        break;
      }
      var norm = MB.normalizeScript(inner);
      return { end: j, attr: '{' + norm + '}', inner: norm };
    }

    /* ---- 输入框 / 多行输入框 / 选择框 ---- */
    function tryInput(s, p) {
      if (s.charAt(p) !== ':' || s.charAt(p + 1) !== '[') return null;
      return readInput(s, p);
    }
    function readInput(s, p) {
      var phEnd = U.matchChar(s, p + 1, '[', ']');
      if (phEnd < 0) return null;
      var placeholder = s.slice(p + 2, phEnd - 1);
      var q = phEnd, def = '';
      if (s.charAt(q) === '(') {
        var dEnd = U.matchChar(s, q, '(', ')');
        if (dEnd < 0) return null;
        def = s.slice(q + 1, dEnd - 1);
        q = dEnd;
      }
      var enter = null, script = null;
      var m = /^->\(#([^)\s]+)\)/.exec(s.slice(q));
      if (m) { enter = m[1]; q += m[0].length; }
      if (s.startsWith('{{', q)) {
        var sc = readExec(s, q);
        if (sc) { script = sc; q = sc.end; }
      }
      var input = U.elem('input', { type: 'text', class: 'mb-input' });
      if (placeholder !== '') input.setAttribute('placeholder', placeholder);
      if (def !== '') input.setAttribute('value', def);
      if (enter) input.setAttribute('data-mb-enter', '#' + enter);
      if (script) input.setAttribute('data-mb', script.attr);
      return { end: q, node: input };
    }
    function tryTextarea(s, p) {
      if (!s.startsWith('[:', p)) return null;
      var inner = readInput(s, p + 1);
      if (!inner) return null;
      if (s.charAt(inner.end) !== ']') return null;
      var ta = U.elem('textarea', { class: 'mb-input' });
      var src = inner.node;
      if (src.getAttribute('placeholder')) ta.setAttribute('placeholder', src.getAttribute('placeholder'));
      if (src.getAttribute('data-mb')) ta.setAttribute('data-mb', src.getAttribute('data-mb'));
      if (src.getAttribute('data-mb-enter')) ta.setAttribute('data-mb-enter', src.getAttribute('data-mb-enter'));
      if (src.getAttribute('value')) ta.textContent = src.getAttribute('value');
      return { end: inner.end + 1, node: ta };
    }
    function trySelect(s, p) {
      if (!s.startsWith('[;', p)) return null;
      var q = p + 2, placeholder = null, options = [], def = '', script = null;
      for (;;) {
        if (s.charAt(q) === '[') {
          var e = U.matchChar(s, q, '[', ']');
          if (e < 0) return null;
          var txt = s.slice(q + 1, e - 1);
          if (placeholder === null) placeholder = txt; else options.push(txt);
          q = e;
          continue;
        }
        if (s.charAt(q) === '(') {
          var de = U.matchChar(s, q, '(', ')');
          if (de < 0) return null;
          def = s.slice(q + 1, de - 1);
          q = de;
          continue;
        }
        break;
      }
      if (s.startsWith('{{', q)) {
        var sc = readExec(s, q);
        if (sc) { script = sc.attr; q = sc.end; }
      }
      if (s.charAt(q) !== ']') return null;
      var sel = U.elem('select', { class: 'mb-input' });
      if (script) sel.setAttribute('data-mb', script);
      var ph = U.elem('option', { value: '', disabled: true, hidden: true });
      ph.textContent = placeholder === null ? '' : placeholder;
      sel.appendChild(ph);
      options.forEach(function (o) {
        var parts = o.split('=');
        var opt = U.elem('option', parts.length > 1 ? { value: parts.slice(1).join('=') } : null);
        opt.textContent = parts[0];
        if (def !== '' && U.trimAll(o) === U.trimAll(def)) opt.setAttribute('selected', '');
        sel.appendChild(opt);
      });
      return { end: q + 1, node: sel };
    }

    /* ---- 标签 ::Label ---- */
    function tryLabel(s, p) {
      if (!s.startsWith('::', p)) return null;
      var q = p + 2, end = s.length;
      while (q < s.length) {
        var c = s.charAt(q);
        if (c === '\\') { q += 2; continue; }
        if (c === ':') { end = q; break; }
        if ((c === ':' && s.charAt(q + 1) === '[') || (c === '[' && (s.charAt(q + 1) === ':' || s.charAt(q + 1) === ';')) ||
            (c === '[' && s.charAt(q + 1) === '[')) { end = q; break; }
        q++;
      }
      var text = s.slice(p + 2, end);
      if (text.trim() === '') return null;
      var label = U.elem('label', { class: 'mb-label' });
      label.appendChild(sub(text));
      pendingLabel = label;
      return { end: end, node: label };
    }

    /* ---- 颜色 / 灰 / 注解 / 涂黑 ---- */
    function tryWrapped(s, p, spec) {
      if (!s.startsWith(spec.open, p)) return null;
      var end = U.matchClose(s, p, spec.open, spec.close);
      if (end < 0) return null;
      var inner = s.slice(p + spec.open.length, end - spec.close.length);
      var el = U.elem(spec.tag || 'span', spec.cls ? { class: spec.cls } : null);
      el.appendChild(sub(inner, spec.ctx));
      if (spec.raw) el.textContent = inner;
      return { end: end, node: el };
    }

    /* ---- 代码段 ---- */
    function tryCode(s, p) {
      if (s.charAt(p) !== '`') return null;
      var backticks = 1;
      while (s.charAt(p + backticks) === '`') backticks++;
      var open = '`'.repeat(backticks);
      var skip = doc.skipClose || 0;
      doc.skipClose = 0;
      var end = -1;
      if (skip > 0) {
        // {/`=n}：前 n 次遇到的结束标识不结束（标准 3.18）
        var matched = 0, k = p + open.length;
        while (k < s.length) {
          if (s.startsWith(open, k)) {
            if (matched < skip) { matched++; k += open.length; continue; }
            end = k + open.length;
            break;
          }
          k++;
        }
      } else {
        var k2 = s.indexOf(open, p + open.length);
        if (k2 >= 0) end = k2 + open.length;
      }
      if (end < 0) return null;
      var inner = s.slice(p + open.length, end - open.length);
      // 代码段里的反斜杠原样保留：不当转义符，否则正则、Windows 路径这类内容会被破坏
      var code = U.elem('code');
      code.textContent = inner;
      return { end: end, node: code };
    }

    /* ---- 图片 / 视频 / 音频 ---- */
    function tryMedia(s, p) {
      if (!s.startsWith('![', p)) return null;
      var aEnd = U.matchChar(s, p + 1, '[', ']');
      if (aEnd < 0 || s.charAt(aEnd) !== '(') return null;
      var uEnd = U.matchChar(s, aEnd, '(', ')');
      if (uEnd < 0) return null;
      var alt = s.slice(p + 2, aEnd - 1);
      var srcAttr = U.trimAll(s.slice(aEnd + 1, uEnd - 1));
      if (srcAttr === '') return null;
      var url = resolveUrl(srcAttr);
      var img = U.elem('img', { src: url, alt: alt.replace(/\\(.)/g, '$1') });
      img.setAttribute('data-mb-media', url);
      if (!alt) img.setAttribute('data-mb-noalt', '1');
      return { end: uEnd, node: img };
    }

    /* ---- md 链接 ---- */
    function tryLink(s, p) {
      if (s.charAt(p) !== '[') return null;
      var tEnd = U.matchChar(s, p, '[', ']');
      if (tEnd < 0 || s.charAt(tEnd) !== '(') return null;
      var uEnd = U.matchChar(s, tEnd, '(', ')');
      if (uEnd < 0) return null;
      var label = s.slice(p + 1, tEnd - 1);
      var href = U.trimAll(s.slice(tEnd + 1, uEnd - 1));
      var a = U.elem('a', { href: resolveUrl(href) });
      a.appendChild(sub(label));
      return { end: uEnd, node: a };
    }

    /* ---- 脚注引用 ---- */
    function tryFootnoteRef(s, p) {
      if (!s.startsWith('[^', p)) return null;
      var e = U.matchChar(s, p, '[', ']');
      if (e < 0) return null;
      var key = s.slice(p + 2, e - 1);
      var idx = doc.fnRefs.indexOf(key);
      if (idx < 0) { idx = doc.fnRefs.push(key) - 1; }
      var num = idx + 1;
      var sup = U.elem('sup', { class: 'mb-fn' });
      var a = U.elem('a', { id: 'mb-fnref-' + num, href: '#mb-fn-' + num });
      a.textContent = String(num);
      sup.appendChild(a);
      return { end: e, node: sup };
    }

    /* ---- 命名 / 排版调整 / 无障碍 语句 ---- */
    function parseName(inner) {
      var parts = inner.split('.');
      var id = null, classes = [];
      if (parts[0].charAt(0) === '#') {
        id = parts[0].slice(1);
      } else if (parts[0] !== '') {
        classes.push(parts[0].replace(/^#/, ''));
      }
      for (var i2 = (parts[0].charAt(0) === '#' ? 1 : 1); i2 < parts.length; i2++) {
        if (parts[i2]) classes.push(parts[i2]);
      }
      return { id: id, classes: classes };
    }
    function parseFormat(inner) {
      var s = U.trimAll(inner);
      var align = null;
      if (s.charAt(0) === ':') { align = 'left'; s = s.slice(1); }
      if (s.charAt(s.length - 1) === ':') { align = align ? 'center' : 'right'; s = s.slice(0, -1); }
      s = s.replace(/:/g, '');
      var position = null, height = null, m;
      if (/^=+$/.test(s)) position = 'block';
      else if ((m = /^-+\.([\d.]+)$/.exec(s))) { position = 'float-right'; height = parseFloat(m[1]); }
      else if ((m = /^\.([\d.]+)-+$/.exec(s))) { position = 'float-left'; height = parseFloat(m[1]); }
      else if ((m = /^-\.([\d.]+)-$/.exec(s))) { position = 'inline-middle'; height = parseFloat(m[1]); }
      var classes = [];
      if (position === 'block') classes.push('mb-block');
      else if (position === 'float-right') classes.push('mb-float-right');
      else if (position === 'float-left') classes.push('mb-float-left');
      else if (position === 'inline-middle') classes.push('mb-inline-middle');
      if (align === 'left') classes.push('mb-left');
      else if (align === 'center') classes.push('mb-center');
      else if (align === 'right') classes.push('mb-right');
      if (!classes.length) return null;
      return { classes: classes, position: position, align: align, height: height };
    }

    /* ---- 图表生成语句 ---- */
    function makeChart(kind, dataRaw, params, scope) {
      var vals = String(dataRaw).split(',').map(function (x) { return MB.chartValue(x, scope); });
      var nums = vals.map(function (v) { return Number(v); });
      if (kind === 'bar') {
        var max = Math.max.apply(null, nums.concat([0]));
        var fig = U.elem('figure', { class: 'mb-chart mb-chart-bar', role: 'img', 'aria-label': '柱状图' });
        fig.style.setProperty('--mb-max', String(max));
        vals.forEach(function (v, idx) {
          var bar = U.elem('div', { class: 'mb-bar' });
          bar.style.setProperty('--mb-v', String(nums[idx]));
          var sp = U.elem('span'); sp.textContent = String(v);
          bar.appendChild(sp);
          fig.appendChild(bar);
        });
        return fig;
      }
      if (kind === 'line') {
        var mx = Math.max.apply(null, nums.concat([1]));
        var mn = Math.min.apply(null, nums.concat([0]));
        var w = 100, h = 40;
        var pts = nums.map(function (v, idx) {
          var x = nums.length === 1 ? 0 : idx * w / (nums.length - 1);
          var y = h - (mx === mn ? h / 2 : (v - mn) / (mx - mn) * h);
          return (Math.round(x * 10) / 10) + ',' + (Math.round(y * 10) / 10);
        }).join(' ');
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'mb-chart');
        svg.setAttribute('viewBox', '0 0 100 40');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', '折线图');
        var pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        pl.setAttribute('fill', 'none');
        pl.setAttribute('stroke', 'currentColor');
        pl.setAttribute('stroke-width', '1');
        pl.setAttribute('vector-effect', 'non-scaling-stroke');
        pl.setAttribute('points', pts);
        svg.appendChild(pl);
        return svg;
      }
      if (kind === 'pie') {
        var total = nums.reduce(function (a, b) { return a + (isFinite(b) ? b : 0); }, 0) || 1;
        var svg2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg2.setAttribute('class', 'mb-chart mb-chart-pie');
        svg2.setAttribute('viewBox', '0 0 42 42');
        svg2.setAttribute('role', 'img');
        svg2.setAttribute('aria-label', '饼图');
        var acc = 0;
        nums.forEach(function (v, idx) {
          var pct = (isFinite(v) ? v : 0) / total * 100;
          var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('cx', '21'); c.setAttribute('cy', '21'); c.setAttribute('r', '15.9155');
          c.setAttribute('fill', 'none');
          c.setAttribute('stroke', MB.PIE_COLORS[idx % MB.PIE_COLORS.length]);
          c.setAttribute('stroke-width', '10');
          c.setAttribute('stroke-dasharray', (Math.round(pct * 100) / 100) + ' ' + (Math.round((100 - pct) * 100) / 100));
          c.setAttribute('stroke-dashoffset', String(Math.round((25 - acc) * 100) / 100));
          svg2.appendChild(c);
          acc += pct;
        });
        return svg2;
      }
      if (kind === 'table') {
        var rows = String(dataRaw).split(';');
        var tbl = document.createElement('table');
        var thead = document.createElement('thead'), tbody = document.createElement('tbody');
        rows.forEach(function (row, ri) {
          var tr = document.createElement('tr');
          row.split(',').forEach(function (cell) {
            var td = document.createElement(ri === 0 ? 'th' : 'td');
            td.appendChild(sub(cell, { target: null }));
            tr.appendChild(td);
          });
          (ri === 0 ? thead : tbody).appendChild(tr);
        });
        if (thead.childNodes.length) tbl.appendChild(thead);
        if (tbody.childNodes.length) tbl.appendChild(tbody);
        return tbl;
      }
      return null;
    }

    /* =====================================================================
     * 主循环
     * ===================================================================== */
    while (i < n) {
      var c = src.charAt(i);
      var m = null;

      /* --- 转义符（优先级最高） --- */
      if (c === '\\') {
        var nx = src.charAt(i + 1);
        if (nx === 'o' && i + 2 < n) { pushText(src.charAt(i + 2)); i += 3; continue; }
        if (nx === 'n') { push(U.elem('br')); i += 2; continue; }
        if (nx === 't') { pushText('\t'); i += 2; continue; }
        if (nx === ' ') { pushText('\u00a0'); i += 2; continue; }
        if (i + 1 < n) { pushText(nx); i += 2; continue; }
        pushText('\\'); i++; continue;
      }

      switch (c) {
        case '【':
          m = tryRuby(src, i); break;
        case '「':
          if (src.startsWith('「「', i)) m = tryVertical(src, i);
          break;
        case '『':
          if (src.startsWith('『『', i)) m = tryVertical(src, i);
          break;
        case '~':
          if (src.charAt(i + 1) === '[') m = tryFold(src, i);
          else if (src.startsWith('~~', i)) {
            var dEnd = src.indexOf('~~', i + 2);
            if (dEnd > 0) {
              var del = U.elem('del');
              del.appendChild(sub(src.slice(i + 2, dEnd)));
              m = { end: dEnd + 2, node: del };
            }
          }
          break;
        case '!':
          if (src.startsWith('![', i)) m = tryMedia(src, i);
          else if (src.startsWith("!'", i)) m = tryWrapped(src, i, { open: "!'", close: "'!", cls: 'mb-fgcolored' });
          else if (src.startsWith('!,', i)) m = tryWrapped(src, i, { open: '!,', close: ',!', cls: 'mb-bgcolored' });
          else if (src.startsWith('!.', i)) m = tryWrapped(src, i, { open: '!.', close: '.!', cls: 'mb-bgpartialcolored' });
          else if (src.startsWith('!;', i)) m = tryWrapped(src, i, { open: '!;', close: ';!', cls: 'mb-fgcolored mb-bgcolored' });
          else if (src.startsWith('!:', i)) m = tryWrapped(src, i, { open: '!:', close: ':!', cls: 'mb-fgcolored mb-bgpartialcolored' });
          break;
        case '$':
          if (src.startsWith('$$$', i)) {
            var me = src.indexOf('$$$', i + 3);
            if (me >= 0) {
              var tex = src.slice(i + 3, me);
              var div = U.elem('span', { class: 'mb-math-block', 'data-mb-tex': tex, 'data-mb-display': '1' });
              div.textContent = tex;
              m = { end: me + 3, node: div };
            }
          } else {
            var d2 = src.indexOf('$', i + 1);
            if (d2 > i + 1) {
              var vname = src.slice(i + 1, d2);
              if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(vname)) {
                if (ctx.buttonText) {
                  m = { end: d2 + 1, node: U.elem('span', { class: 'mb-var', 'data-mb-var': vname }) };
                } else {
                  m = { end: d2 + 1, node: U.elem('span', { class: 'mb-exec', 'data-mb': '{{put:$' + vname + '$}}' }) };
                }
              } else {
                var math = U.elem('span', { class: 'mb-math', 'data-mb-tex': vname });
                math.textContent = vname;
                m = { end: d2 + 1, node: math };
              }
            }
          }
          break;
        case '^':
          if (!ctx.noSupsub && src.charAt(i + 1) === '[') {
            var sEnd = U.matchChar(src, i + 1, '[', ']');
            if (sEnd > 0 && src.charAt(sEnd) === '^') {
              var sup = U.elem('sup');
              sup.appendChild(sub(src.slice(i + 2, sEnd - 1), { noSupsub: true }));
              m = { end: sEnd + 1, node: sup };
            }
          }
          break;
        case '_':
          if (src.charAt(i + 1) === '[' && !ctx.noSupsub) {
            var bEnd2 = U.matchChar(src, i + 1, '[', ']');
            if (bEnd2 > 0 && src.charAt(bEnd2) === '_') {
              var subEl = U.elem('sub');
              subEl.appendChild(sub(src.slice(i + 2, bEnd2 - 1), { noSupsub: true }));
              m = { end: bEnd2 + 1, node: subEl };
            }
          } else if (src.charAt(i + 1) === '(') {
            m = tryWrapped(src, i, { open: '_(', close: ')_', cls: 'mb-commental' });
          } else {
            var uEnd = src.indexOf('_', i + 1);
            if (uEnd > i + 1) {
              var inner3 = src.slice(i + 1, uEnd);
              if (inner3.trim() !== '' && !/^\s|\s$/.test(inner3)) {
                var u = U.elem('u');
                u.appendChild(sub(inner3));
                m = { end: uEnd + 1, node: u };
              }
            }
          }
          break;
        case '@':
          m = tryWrapped(src, i, { open: '@(', close: ')@', cls: 'mb-gray' });
          break;
        case '#':
          m = tryWrapped(src, i, { open: '#(', close: ')#', cls: 'mb-blacked' });
          break;
        case '*':
          if (src.startsWith('**', i)) {
            var st = src.indexOf('**', i + 2);
            if (st > i + 1) {
              var strong = U.elem('strong');
              strong.appendChild(sub(src.slice(i + 2, st)));
              m = { end: st + 2, node: strong };
            }
          } else {
            var em2 = src.indexOf('*', i + 1);
            if (em2 > i + 1) {
              var inner4 = src.slice(i + 1, em2);
              if (inner4.trim() !== '') {
                var em = U.elem('em');
                em.appendChild(sub(inner4));
                m = { end: em2 + 1, node: em };
              }
            }
          }
          break;
        case '`':
          m = tryCode(src, i); break;
        case '+':
          if (src.startsWith('+[', i)) m = trySize(src, i);
          break;
        case '-':
          if (src.startsWith('->[', i) || src.startsWith('-[', i)) m = trySize(src, i);
          break;
        case '<':
          if (src.startsWith('<-[', i)) m = trySize(src, i);
          break;
        case ':':
          if (src.startsWith('::', i)) m = tryLabel(src, i);
          else if (src.startsWith(':[', i)) m = tryInput(src, i);
          break;
        case '(':
          if (src.startsWith('((', i)) {
            var arEnd = U.matchClose(src, i, '((', '))');
            if (arEnd > 0) {
              var desc = src.slice(i + 2, arEnd - 2);
              var t = targetFor({});
              if (t) t.setAttribute('aria-label', desc);
              m = { end: arEnd, node: null };
            }
          }
          break;
        case '[':
          if (src.startsWith('[o[', i)) m = tryOrigin(src, i);
          else if (src.startsWith('[|[', i) || src.startsWith('[-[', i)) m = tryVertical(src, i);
          else if (src.startsWith('[[', i)) m = tryBracketButton(src, i);
          else if (src.startsWith('[(', i)) m = tryRuby(src, i);
          else if (src.startsWith('[;', i)) m = trySelect(src, i);
          else if (src.startsWith('[:', i)) m = tryTextarea(src, i);
          else if (src.startsWith('[^', i)) m = tryFootnoteRef(src, i);
          else m = tryLink(src, i);
          break;
        case '{':
          if (src.startsWith('{{', i)) {
            var ex = readExec(src, i);
            if (ex) {
              if (ctx.buttonText || ctx.noExec) {
                m = { end: ex.end, node: null };
              } else {
                m = { end: ex.end, node: U.elem('span', { class: 'mb-exec', 'data-mb': ex.attr }) };
              }
            }
          } else if (src.startsWith('{:', i)) {
            var cEnd2 = src.indexOf(':}', i + 2);
            if (cEnd2 > 0) {
              var body2 = src.slice(i + 2, cEnd2);
              var k3 = body2.indexOf(':');
              var out2 = k3 < 0 ? null : MB.contentStatement(body2.slice(0, k3), body2.slice(k3 + 1));
              if (out2 !== null && out2 !== undefined) m = { end: cEnd2 + 2, node: document.createTextNode(out2) };
            }
          } else if (src.startsWith('{#', i) || src.startsWith('{.', i)) {
            var nEnd = src.indexOf('}', i + 2);
            if (nEnd > 0) {
              applyAttrs(parseName(src.slice(i + 1, nEnd)));
              m = { end: nEnd + 1, node: null };
            }
          } else if (src.startsWith('{|', i)) {
            var fEnd = src.indexOf('|}', i + 2);
            if (fEnd > 0) {
              var fmt = parseFormat(src.slice(i + 2, fEnd));
              if (fmt) {
                if (fmt.position) applyFormat(fmt);
                else if (ctx.target) {
                  fmt.classes.forEach(function (cl) { ctx.target.classList.add(cl); });
                }
                m = { end: fEnd + 2, node: null };
              }
            }
          } else if (src.startsWith('{[', i)) {
            var chEnd = src.indexOf(']}', i + 2);
            if (chEnd > 0) {
              var bodyCh = src.slice(i + 2, chEnd);
              var cparts = bodyCh.split(':');
              var chartEl = null;
              if (cparts.length >= 2) chartEl = makeChart(cparts[0], cparts[1], cparts.slice(2).join(':'), ctx.scope);
              if (chartEl) m = { end: chEnd + 2, node: chartEl };
            }
          } else if (src.startsWith('{/', i)) {
            var pEnd2 = src.indexOf('}', i + 2);
            if (pEnd2 > 0) {
              var pm = /=(\d*)/.exec(src.slice(i + 2, pEnd2));
              doc.skipClose = pm && pm[1] !== '' ? parseInt(pm[1], 10) : 1;
              m = { end: pEnd2 + 1, node: null };
            }
          } else if (src.startsWith('{`', i)) {
            var qEnd = src.indexOf('`}', i + 2);
            if (qEnd > 0) {
              var expr = src.slice(i + 2, qEnd);
              m = { end: qEnd + 2, node: U.elem('span', { class: 'mb-exec', 'data-mb': '{{put:' + expr + '}}' }) };
            }
          } else if (src.startsWith('{$', i)) {
            var vEnd = src.indexOf('$}', i + 2);
            if (vEnd > 0) {
              var vn = src.slice(i + 2, vEnd);
              m = { end: vEnd + 2, node: U.elem('span', { class: 'mb-exec', 'data-mb': '{{put:$' + vn + '$}}' }) };
            }
          }
          break;
        default:
          if (c === '\n') {
            if (ctx.vertical) { push(U.elem('br')); i++; continue; }
            // md 的「行尾两个空格 = 换行」
            var joined = buf.join('');
            if (/ {2,}$/.test(joined)) {
              buf.length = 0;
              buf.push(joined.replace(/ +$/, ''));
              push(U.elem('br'));
              i++;
              continue;
            }
            pushText(' ');
            i++;
            continue;
          }
          break;
      }

      if (m) {
        if (m.node !== null && m.node !== undefined) push(m.node);
        i = m.end;
        continue;
      }
      pushText(c);
      i++;
    }
    flush();
    if (pendingAttrs.classes.length || pendingAttrs.id || pendingAttrs.aria) applyAttrs(pendingAttrs);
    return out;
  }

  /** 略过 n 次收尾标识的定界符匹配（{/`=n} 用） */
  U.matchCloseSkip = function (src, i, open, close, skip) {
    var depth = 0, j = i, skipped = 0, n = src.length;
    while (j < n) {
      var c = src.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (src.startsWith(open, j)) { depth++; j += open.length; continue; }
      if (src.startsWith(close, j)) {
        if (depth === 1 && skipped < skip && open === close) { skipped++; j += close.length; continue; }
        depth--; j += close.length;
        if (depth === 0) return j;
        continue;
      }
      j++;
    }
    return -1;
  };

  MB.inline = { render: renderInline };
  MB.applyNameString = function (el, spec) {
    // {#id.class} / {|...|}
    var parts = String(spec).split('.');
    if (parts[0].charAt(0) === '#') el.id = parts[0].slice(1);
    else if (parts[0]) el.classList.add(parts[0]);
    for (var i = 1; i < parts.length; i++) if (parts[i]) el.classList.add(parts[i]);
    return el;
  };
  MB.parseFormat = function (inner) {
    var s = U.trimAll(inner);
    var align = null;
    if (s.charAt(0) === ':') { align = 'left'; s = s.slice(1); }
    if (s.charAt(s.length - 1) === ':') { align = align ? 'center' : 'right'; s = s.slice(0, -1); }
    s = s.replace(/:/g, '');
    var position = null, height = null, m;
    if (/^=+$/.test(s)) position = 'block';
    else if ((m = /^-+\.([\d.]+)$/.exec(s))) { position = 'float-right'; height = parseFloat(m[1]); }
    else if ((m = /^\.([\d.]+)-+$/.exec(s))) { position = 'float-left'; height = parseFloat(m[1]); }
    else if ((m = /^-\.([\d.]+)-$/.exec(s))) { position = 'inline-middle'; height = parseFloat(m[1]); }
    var classes = [];
    if (position === 'block') classes.push('mb-block');
    else if (position === 'float-right') classes.push('mb-float-right');
    else if (position === 'float-left') classes.push('mb-float-left');
    else if (position === 'inline-middle') classes.push('mb-inline-middle');
    if (align === 'left') classes.push('mb-left');
    else if (align === 'center') classes.push('mb-center');
    else if (align === 'right') classes.push('mb-right');
    if (!classes.length) return null;
    return { classes: classes, position: position, align: align, height: height };
  };
})(typeof window !== 'undefined' ? window : globalThis);
