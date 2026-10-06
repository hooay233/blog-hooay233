/*!
 * mb-block.js —— MarkBottom 0.1 解释器 · 块级结构 + 运行时
 * 块级：围栏代码、行间公式、表格（延续符 / 斜线 / 侧边表头）、标题、引用、
 *       列表、脚注、折叠块（含分离式）、排版调整语句、图表。
 * 运行时：data-mb 执行、触发器、折叠切换、媒体类型嗅探、公式渲染。
 */
(function (global) {
  'use strict';

  var MB = global.MBMD;
  var U = MB.util;
  var elem = U.elem;

  var RE = {
    heading: /^(#{1,6})\s+(.*)$/,
    hr: /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/,
    fence: /^\s*(```+|~~~+)\s*([^\s`]*)\s*$/,
    quote: /^\s*>\s?(.*)$/,
    listItem: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    fnDef: /^\[\^([^\]\s]+)\]:\s?(.*)$/,
    tableRow: /^\s*\|/,
    mathLine: /^\s*\$\$\$/,
    execOnly: /^\s*(?:\{\{[\s\S]*?\}\}\s*)+$/,
    nameOnly: /^\s*\{#[^}]*\}\s*$/,
    formatOnly: /^\s*\{\|[^}]*\|\}\s*$/,
    ariaOnly: /^\s*\(\([\s\S]*\)\)\s*$/,
    chartOnly: /^\s*\{\[[\s\S]*\]\}\s*$/,
    skipOnly: /^\s*\{\/`?=?\d*\}\s*$/
  };

  function slug(s) {
    return String(s).replace(/[\s]+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 60) || 'sec';
  }

  /** 去掉块末尾残留的空白文本（行尾的 {#id} / {|…|} 会留下一个空格） */
  function trimTail(el) {
    var last = el.lastChild;
    if (last && last.nodeType === 3) last.data = last.data.replace(/[ \t\u00a0]+$/, '');
    return el;
  }

  /* =====================================================================
   * 1. 折叠块内容预抽取（分离式折叠块 / 标准 3.7）
   * ===================================================================== */

  function fenceRegions(src) {
    var regions = [], i = 0, open = -1, openTok = null;
    var lines = src.split('\n'), pos = 0;
    for (var li = 0; li < lines.length; li++) {
      var m = RE.fence.exec(lines[li]);
      if (m) {
        if (open < 0) { open = pos; openTok = m[1].slice(0, 3); }
        else if (m[1].slice(0, 3) === openTok) {
          regions.push([open, pos + lines[li].length]);
          open = -1;
        }
      }
      pos += lines[li].length + 1;
    }
    if (open >= 0) regions.push([open, src.length]);
    return regions;
  }

  function inRegions(regions, idx) {
    for (var i = 0; i < regions.length; i++) {
      if (idx >= regions[i][0] && idx < regions[i][1]) return true;
    }
    return false;
  }

  var FOLD_RE = /\[([^\[\]\n]{1,64})\]~>\[/g;

  /** 把 [标识符]~>[ 内容 ] 抽出来，用 \u0001id\u0001 ... \u0002 标记 */
  function markFolds(src) {
    var regions = fenceRegions(src);
    var out = '', last = 0, m;
    FOLD_RE.lastIndex = 0;
    while ((m = FOLD_RE.exec(src))) {
      var at = m.index;
      if (at < last) continue;
      if (inRegions(regions, at)) continue;
      if (at > 0 && src.charAt(at - 1) === '\\') continue;
      // 前面是 ~ 说明这是「分离式折叠块的按钮」~[标题]~>[标识符]，不是内容
      if (at > 0 && src.charAt(at - 1) === '~') continue;
      // 落在行内代码段（反引号）里的不算
      var lineStart = src.lastIndexOf('\n', at - 1) + 1;
      var ticks = 0;
      for (var t2 = lineStart; t2 < at; t2++) if (src.charAt(t2) === '`') ticks++;
      if (ticks % 2 === 1) continue;
      var openIdx = at + m[0].length - 1;
      var close = U.matchChar(src, openIdx, '[', ']');
      if (close < 0) continue;
      var ident = U.trimAll(m[1]);
      out += src.slice(last, at) + '\u0001' + ident + '\u0001';
      out += src.slice(openIdx + 1, close - 1);
      out += '\u0002';
      last = close;
      FOLD_RE.lastIndex = close;
    }
    out += src.slice(last);
    return out;
  }

  /** 源文本 -> 行对象数组 [{text, fold}] */
  function toLines(src) {
    var marked = markFolds(src);
    var raw = marked.split('\n');
    var lines = [], cur = null;
    function pushLine(txt, fold) {
      var lo = { text: txt, fold: fold };
      lines.push(lo);
    }
    for (var li = 0; li < raw.length; li++) {
      var rest = raw[li];
      while (true) {
        var fs = rest.indexOf('\u0001');
        var fe = rest.indexOf('\u0002');
        if (fs < 0 && fe < 0) {
          if (rest !== '' || cur === null) pushLine(rest, cur);
          else pushLine(rest, cur);
          break;
        }
        if (fs >= 0 && (fe < 0 || fs < fe)) {
          var before = rest.slice(0, fs);
          if (before.trim() !== '') pushLine(before, cur);
          var endMarker = rest.indexOf('\u0001', fs + 1);
          cur = rest.slice(fs + 1, endMarker);
          rest = rest.slice(endMarker + 1);
          if (rest === '') break;         // 内容从下一行开始
          continue;
        }
        var beforeE = rest.slice(0, fe);
        if (beforeE.trim() !== '') pushLine(beforeE, cur);
        cur = null;
        rest = rest.slice(fe + 1);
        if (rest === '') break;           // 折叠到行尾结束
      }
    }
    return lines;
  }

  /* =====================================================================
   * 2. 表格
   * ===================================================================== */

  /** 切单元格：先保护行内代码段与排版调整语句（标准 0 节第 6 条） */
  function splitRow(line) {
    var s = U.trimAll(line);
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|' && !s.endsWith('\\|')) s = s.slice(0, -1);
    var cells = [], buf = '', i = 0, inCode = false, fmt = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === '\\') { buf += s.substr(i, 2); i += 2; continue; }
      if (c === '`') { inCode = !inCode; buf += c; i++; continue; }
      if (!inCode && s.startsWith('{|', i)) { fmt++; buf += '{|'; i += 2; continue; }
      if (!inCode && fmt > 0 && s.startsWith('|}', i)) { fmt--; buf += '|}'; i += 2; continue; }
      if (!inCode && fmt === 0 && c === '|') { cells.push(buf); buf = ''; i++; continue; }
      buf += c; i++;
    }
    cells.push(buf);
    return cells;
  }

  function isSeparatorRow(cells) {
    var any = false;
    for (var i = 0; i < cells.length; i++) {
      var c = U.trimAll(cells[i]);
      if (c === '') continue;
      if (!/^:?-{2,}:?$/.test(c)) return false;
      any = true;
    }
    return any;
  }

  /** 斜线单元格：%( a / b ) 、( a \ b )% 等 */
  function parseSlashCell(text) {
    var s = U.trimAll(text);
    var m = /^(%?)\s*\(([\s\S]*)\)\s*(%?)$/.exec(s);
    if (!m) return null;
    if (!m[1] && !m[3]) return null;
    var inner = m[2];
    var sepIdx = -1, sepChar = null;
    for (var i = 0; i < inner.length; i++) {
      var c = inner.charAt(i);
      var prev = inner.charAt(i - 1), next = inner.charAt(i + 1);
      if (c === '/' || c === '／') {
        if (prev === '\\') continue;
        sepIdx = i; sepChar = '/'; break;
      }
      if (c === '\\' || c === '＼') {
        // 前后带空白的反斜杠才算分隔线，否则是转义符
        var spaced = (next === ' ' || next === '\t' || i === inner.length - 1) ||
                     (prev === ' ' || prev === '\t' || i === 0);
        if (spaced) { sepIdx = i; sepChar = '\\'; break; }
        i++; // 跳过被转义的字符
      }
    }
    if (sepIdx < 0) return null;
    var parts = [], buf = '';
    for (var j = 0; j < inner.length; j++) {
      var ch = inner.charAt(j);
      var isSep = false;
      if (sepChar === '/') {
        isSep = (ch === '/' || ch === '／') && inner.charAt(j - 1) !== '\\';
      } else {
        isSep = (ch === '\\' || ch === '＼') &&
          ((inner.charAt(j + 1) === ' ' || j === inner.length - 1) ||
           (inner.charAt(j - 1) === ' ' || j === 0));
      }
      if (isSep) { parts.push(buf); buf = ''; continue; }
      if (ch === '\\' && sepChar !== '\\' && j + 1 < inner.length) { buf += inner.charAt(j + 1); j++; continue; }
      buf += ch;
    }
    parts.push(buf);
    parts = parts.map(function (x) { return U.trimAll(x); });
    return { parts: parts, type: sepChar === '/' ? 'u' : 'd', apex: m[1] ? 'left' : 'right' };
  }

  function buildSlashCell(spec, tagName) {
    var th = document.createElement(tagName);
    th.className = 'mb-slash mb-slash-' + spec.type;
    var parts = spec.parts;
    if (parts.length > 2) {
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'mb-slash-fan');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      // 汇聚角：left => 左；right => 右。斜线型 u: / (左下→右上)、d: \ (左上→右下)
      var apexX = spec.apex === 'left' ? 0 : 100;
      var apexY = (spec.type === 'u') === (spec.apex === 'left') ? 100 : 0;
      // u+left => 左下(0,100)；u+right => 右上(100,0)；d+left => 左上(0,0)；d+right => 右下(100,100)
      var edgeY = apexY === 100 ? 0 : 100;
      var count = parts.length;
      for (var k = 1; k <= count - 2; k++) {
        var frac = k / (count - 1);
        var line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(apexX));
        line.setAttribute('y1', String(apexY));
        line.setAttribute('x2', String(Math.round(frac * 1000) / 10));
        line.setAttribute('y2', String(edgeY));
        svg.appendChild(line);
      }
      th.appendChild(svg);
    }
    parts.forEach(function (p, idx) {
      var cls = idx === 0 ? 'mb-slash-head' : (idx === parts.length - 1 ? 'mb-slash-tail' : 'mb-slash-mid');
      var span = elem('span', { class: cls });
      MB.inline.render(p, { target: span, doc: spec.doc, options: spec.options }, span);
      th.appendChild(span);
    });
    return th;
  }

  /* =====================================================================
   * 3. 块级解析
   * ===================================================================== */

  function render(src, options) {
    options = options || {};
    var doc = {
      options: options,
      foldSeq: 0,
      ids: Object.create(null),
      fnRefs: [],
      fnDefs: [],
      fnDefMap: Object.create(null),
      skipClose: 0
    };
    var lines = toLines(src);
    var out = document.createDocumentFragment();
    var pendingFormat = null;
    var pendingName = null;
    var pendingSkip = 0;
    var lastBlock = null;
    var i = 0;

    function ctxFor(target) {
      return { target: target, doc: doc, options: options, noSupsub: false, vertical: false };
    }

    function emit(el) {
      if (!el) return;
      if (el.nodeType === 11) { out.appendChild(el); return; }
      if (pendingName && el.nodeType === 1) {
        if (pendingName.id) el.id = pendingName.id;
        pendingName.classes.forEach(function (c) { el.classList.add(c); });
        pendingName = null;
      }
      if (pendingFormat) {
        var pf = pendingFormat;
        pendingFormat = null;
        var wrap = elem('div', { class: pf.classes.join(' ') });
        if (pf.height) wrap.style.height = pf.height + 'em';
        var single = null;
        if (el.tagName === 'P') {
          var kids = Array.prototype.filter.call(el.childNodes, function (c) {
            return !(c.nodeType === 3 && !c.data.trim());
          });
          if (kids.length === 1 && kids[0].nodeType === 1) single = kids[0];
        }
        if (single && (pf.position === 'float-right' || pf.position === 'float-left' ||
                       pf.position === 'inline-middle' || pf.position === 'block')) {
          wrap.appendChild(single);
        } else {
          wrap.appendChild(el);
        }
        out.appendChild(wrap);
        lastBlock = wrap;
        return;
      }
      out.appendChild(el);
      lastBlock = el;
    }

    function paragraph(text, fold) {
      // 只由执行语句组成的一行：直接输出 span（标准 3.9.3 规则 4）
      if (RE.execOnly.test(text)) {
        var f = document.createDocumentFragment();
        MB.inline.render(text, ctxFor(null), f);
        if (fold) {
          var d = elem('div', { class: 'mb-fold-off' });
          d.setAttribute('data-mb-fold', 'mbd-' + fold);
          d.hidden = true;
          d.appendChild(f);
          out.appendChild(d); lastBlock = d;
          return;
        }
        out.appendChild(f);
        return;
      }
      var p = elem('p');
      if (fold) { p.setAttribute('data-mb-fold', 'mbd-' + fold); p.classList.add('mb-fold-off'); p.hidden = true; }
      MB.inline.render(text, ctxFor(p), p);
      trimTail(p);
      // <p> 里不能放块级元素：把折叠块 / 图表这类块级节点从段落里提出来
      if (p.querySelector('details.mb-fold, figure.mb-chart, svg.mb-chart, table')) {
        splitParagraph(p, fold);
        return;
      }
      emit(p);
    }

    /** 把段落里的块级元素提出来，剩下的文字各自成段 */
    function splitParagraph(p, fold) {
      var BLOCKS = ['DETAILS', 'FIGURE', 'TABLE', 'SVG', 'DIV'];
      var current = null;
      function closeCurrent() {
        if (!current) return;
        trimTail(current);
        var keep = current.textContent.trim() !== '' ||
          current.querySelector('img, video, audio, button, input, code, ruby');
        if (keep) {
          if (fold) {
            current.setAttribute('data-mb-fold', 'mbd-' + fold);
            current.classList.add('mb-fold-off');
            current.hidden = true;
          }
          emit(current);
        }
        current = null;
      }
      Array.prototype.slice.call(p.childNodes).forEach(function (node) {
        var isBlock = node.nodeType === 1 && BLOCKS.indexOf(node.tagName) >= 0;
        if (isBlock) {
          closeCurrent();
          if (fold) {
            node.setAttribute('data-mb-fold', 'mbd-' + fold);
            node.classList.add('mb-fold-off');
            if (node.tagName !== 'TR') node.hidden = true;
          }
          emit(node);
          return;
        }
        if (!current) current = elem('p');
        current.appendChild(node);
      });
      closeCurrent();
    }

    function ensureHeadingId(h) {
      if (h.id) return;
      var base = slug(h.textContent);
      var id = base, k = 2;
      while (doc.ids[id]) { id = base + '-' + k++; }
      doc.ids[id] = 1;
      h.id = id;
    }

    function matchListItem(line) {
      var m = RE.listItem.exec(line.text);
      if (!m) return null;
      return {
        indent: m[1].replace(/\t/g, '    ').length,
        ordered: /^\d/.test(m[2]),
        content: m[3],
        fold: line.fold
      };
    }

    /* ---------- 表格 ---------- */
    function parseTable(startIdx) {
      var rows = [], idx = startIdx;
      while (idx < lines.length) {
        var L = lines[idx];
        if (!RE.tableRow.test(L.text)) break;
        rows.push({ cells: splitRow(L.text), fold: L.fold });
        idx++;
      }
      if (!rows.length) return null;

      var hasHeader = rows.length > 1 && isSeparatorRow(rows[1].cells);
      var grid = [];      // [{tag, el|null, removed, rowspan, colspan, merge}]
      var trs = [];
      var bodyRows = [];
      var headerCells = [];

      for (var r = 0; r < rows.length; r++) {
        if (hasHeader && r === 1) continue;              // 分隔行不产生单元格
        var isHead = hasHeader && r === 0;
        var raw = rows[r].cells;
        // 侧边表头：第一个空白单元格之前的是行表头
        var boundary = -1;
        for (var c = 1; c < raw.length - 1; c++) {
          if (U.trimAll(raw[c]) === '') { boundary = c; break; }
        }
        var tr = document.createElement('tr');
        if (rows[r].fold) {
          tr.setAttribute('data-mb-fold', 'mbd-' + rows[r].fold);
          tr.classList.add('mb-fold-off');
        }
        var rowCells = [];
        for (var c2 = 0; c2 < raw.length; c2++) {
          if (c2 === boundary) continue;                 // || 本身不产生单元格
          var rawCell = raw[c2];
          var trimmed = U.trimAll(rawCell);
          var isRowHead = !isHead && boundary > 0 && c2 < boundary;
          var tag = (isHead || isRowHead) ? 'TH' : 'TD';
          var rec = { removed: false, rowspan: 1, colspan: 1, merge: null, row: r, col: c2 };
          if (trimmed === '[+]') { rec.merge = '+'; rec.el = null; }
          else if (trimmed === '[+>]') { rec.merge = '+>'; rec.el = null; }
          else {
            var slash = parseSlashCell(rawCell);
            var cellEl;
            if (slash) {
              slash.doc = doc; slash.options = options;
              cellEl = buildSlashCell(slash, tag.toLowerCase());
            } else {
              cellEl = document.createElement(tag.toLowerCase());
              MB.inline.render(rawCell, ctxFor(cellEl), cellEl);
            }
            if (isRowHead) cellEl.setAttribute('scope', 'row');
            rec.el = cellEl;
            tr.appendChild(cellEl);
          }
          rowCells[c2] = rec;
        }
        grid.push(rowCells);
        trs.push(tr);
        if (isHead) headerCells = rowCells; else bodyRows.push({ tr: tr, recs: rowCells });
      }

      // 合并单元格：[+] 向上、[+>] 向左
      for (var r2 = 0; r2 < grid.length; r2++) {
        for (var c3 = 0; c3 < grid[r2].length; c3++) {
          var cell = grid[r2][c3];
          if (!cell || cell.removed) continue;
          if (cell.merge === '+') {
            var t = null;
            for (var rr = r2 - 1; rr >= 0; rr--) {
              var cand = grid[rr][c3];
              if (cand && !cand.removed && cand.el) { t = cand; break; }
            }
            if (t) { t.rowspan += cell.rowspan; cell.removed = true; }
            else { cell.merge = null; }
          } else if (cell.merge === '+>') {
            var t2 = null;
            for (var cc = c3 - 1; cc >= 0; cc--) {
              var cand2 = grid[r2][cc];
              if (cand2 && !cand2.removed && cand2.el) { t2 = cand2; break; }
            }
            if (t2) { t2.colspan += cell.colspan; cell.removed = true; }
            else { cell.merge = null; }
          }
        }
      }
      // 把合并结果写回 DOM
      for (var r3 = 0; r3 < grid.length; r3++) {
        for (var c4 = 0; c4 < grid[r3].length; c4++) {
          var cc2 = grid[r3][c4];
          if (!cc2 || !cc2.el) continue;
          if (cc2.rowspan > 1) cc2.el.rowSpan = cc2.rowspan;
          if (cc2.colspan > 1) cc2.el.colSpan = cc2.colspan;
        }
      }

      var table = document.createElement('table');
      if (hasHeader) {
        var thead = document.createElement('thead');
        if (headerCells.length) {
          var htr = document.createElement('tr');
          headerCells.forEach(function (rec) {
            if (rec && rec.el && !rec.removed) htr.appendChild(rec.el);
          });
          thead.appendChild(htr);
        }
        table.appendChild(thead);
      }
      var tbody = document.createElement('tbody');
      bodyRows.forEach(function (item) { tbody.appendChild(item.tr); });
      if (tbody.childNodes.length) table.appendChild(tbody);
      return { table: table, next: idx };
    }

    /* ---------- 列表 ---------- */
    function parseList(startIdx, baseIndent) {
      var first = matchListItem(lines[startIdx]);
      var ordered = first.ordered;
      var listEl = document.createElement(ordered ? 'ol' : 'ul');
      var idx = startIdx;
      var numRe = /^(\d+)[.)]/;
      if (ordered) {
        var mn0 = numRe.exec(U.trimAll(lines[startIdx].text));
        if (mn0 && mn0[1] !== '1') listEl.setAttribute('start', mn0[1]);
      }
      while (idx < lines.length) {
        var it = matchListItem(lines[idx]);
        if (!it) break;
        if (it.indent < baseIndent) break;
        if (it.indent > baseIndent) {
          var parentLi = listEl.lastElementChild;
          if (!parentLi) break;
          var sub = parseList(idx, it.indent);
          parentLi.appendChild(sub.list);
          idx = sub.next;
          continue;
        }
        if (it.ordered !== ordered) break;
        var li = document.createElement('li');
        if (it.fold) {
          li.setAttribute('data-mb-fold', 'mbd-' + it.fold);
          li.classList.add('mb-fold-off');
          li.hidden = true;
        }
        var content = it.content;
        var task = /^\[([ xX])\]\s+/.exec(content);
        var target = li;
        if (task) {
          var box = elem('input', { type: 'checkbox', class: 'mb-task-box' });
          box.disabled = true;
          if (task[1].toLowerCase() === 'x') { box.checked = true; box.setAttribute('checked', ''); }
          li.classList.add('mb-task');
          li.appendChild(box);
          content = content.slice(task[0].length);
          var span = elem('span', { class: 'mb-task-text' });
          li.appendChild(span);
          target = span;
        }
        MB.inline.render(content, ctxFor(target), target);
        // 续行（缩进更深的非列表行）
        idx++;
        while (idx < lines.length) {
          var nxt = lines[idx];
          if (U.trimAll(nxt.text) === '') break;
          if (RE.listItem.test(nxt.text)) break;
          if (RE.tableRow.test(nxt.text) || RE.heading.test(nxt.text) || RE.fence.test(nxt.text)) break;
          var li2 = matchListItem(nxt);
          if (li2) break;
          li.appendChild(document.createTextNode(' '));
          MB.inline.render(U.trimAll(nxt.text), ctxFor(li), li);
          idx++;
        }
        listEl.appendChild(li);
      }
      return { list: listEl, next: idx };
    }

    /* ---------- 主体循环 ---------- */
    while (i < lines.length) {
      var L = lines[i];
      var t = L.text;
      var trimmed = U.trimAll(t);

      if (trimmed === '' && !L.fold) { i++; continue; }

      var m;

      /* 单独成行的排版调整语句 */
      if (RE.formatOnly.test(trimmed) && !L.fold) {
        var fmt = MB.parseFormat(trimmed.slice(2, -2));
        if (fmt) { pendingFormat = fmt; i++; continue; }
      }
      /* 单独成行的命名语句：给上面的块取名；上面没有块就给下面的 */
      if (RE.nameOnly.test(trimmed)) {
        var spec = trimmed.slice(1, -1);
        var host = lastBlock;
        if (host) { MB.applyNameString(host, spec); i++; continue; }
        var tmp = elem('span');
        MB.applyNameString(tmp, spec);
        pendingName = { id: tmp.id, classes: Array.prototype.slice.call(tmp.classList) };
        i++;
        continue;
      }
      /* 单独成行的无障碍标签 */
      if (RE.ariaOnly.test(trimmed)) {
        var desc = trimmed.slice(2, -2);
        var host2 = lastBlock;
        if (host2) host2.setAttribute('aria-label', desc);
        i++; continue;
      }
      /* 单独成行的解析语句 */
      if (RE.skipOnly.test(trimmed)) {
        var sm = /=(\d*)/.exec(trimmed);
        pendingSkip = sm && sm[1] !== '' ? parseInt(sm[1], 10) : 1;
        i++; continue;
      }
      /* 单独成行的图表生成语句 */
      if (RE.chartOnly.test(trimmed) && !L.fold) {
        var body = trimmed.slice(2, -2);
        var parts = body.split(':');
        if (parts.length >= 2) {
          var f2 = document.createDocumentFragment();
          MB.inline.render(trimmed, ctxFor(null), f2);
          var node = f2.firstChild;
          if (node) {
            var holder = elem('div', { class: 'mb-chart-holder' });
            holder.appendChild(f2);
            emit(holder);
            i++; continue;
          }
        }
      }

      /* 围栏代码块 */
      if ((m = RE.fence.exec(t))) {
        var lang = m[2] || '';
        var buf = [];
        i++;
        while (i < lines.length && !RE.fence.test(lines[i].text)) { buf.push(lines[i].text); i++; }
        i++;  // 跳过收尾围栏
        var pre = document.createElement('pre');
        var code = document.createElement('code');
        if (lang) code.className = 'language-' + lang;
        code.textContent = buf.join('\n');
        pre.appendChild(code);
        emit(pre);
        pendingSkip = 0;
        continue;
      }

      /* 行间公式 */
      if (RE.mathLine.test(t)) {
        var first3 = t.indexOf('$$$');
        var sameLine = t.indexOf('$$$', first3 + 3);
        var tex2;
        if (sameLine >= 0) {
          tex2 = t.slice(first3 + 3, sameLine);
          i++;
        } else {
          var acc = t.slice(first3 + 3);
          i++;
          var found = false;
          while (i < lines.length) {
            var q = lines[i].text.indexOf('$$$');
            if (q >= 0) { acc += '\n' + lines[i].text.slice(0, q); i++; found = true; break; }
            acc += '\n' + lines[i].text;
            i++;
          }
          tex2 = acc;
        }
        var div = elem('div', { class: 'mb-math-block', 'data-mb-tex': tex2, 'data-mb-display': '1' });
        div.textContent = tex2;
        emit(div);
        continue;
      }

      /* 标题 */
      if ((m = RE.heading.exec(t))) {
        var lvl = m[1].length;
        var h = document.createElement('h' + lvl);
        if (L.fold) { h.setAttribute('data-mb-fold', 'mbd-' + L.fold); h.classList.add('mb-fold-off'); h.hidden = true; }
        MB.inline.render(m[2], ctxFor(h), h);
        trimTail(h);
        ensureHeadingId(h);
        emit(h);
        i++;
        continue;
      }

      /* 分隔线 */
      if (RE.hr.test(t)) { emit(document.createElement('hr')); i++; continue; }

      /* 表格 */
      if (RE.tableRow.test(t)) {
        var tb = parseTable(i);
        if (tb) {
          // 折叠的表格行交给同一张表
          emit(tb.table);
          i = tb.next;
          continue;
        }
      }

      /* 引用块 */
      if (RE.quote.test(t)) {
        var quoted = [];
        var qFold = L.fold;
        while (i < lines.length) {
          var qm = RE.quote.exec(lines[i].text);
          if (!qm) break;
          quoted.push(lines[i].text.replace(/^\s*>\s?/, ''));
          i++;
        }
        var bq = document.createElement('blockquote');
        if (qFold) { bq.setAttribute('data-mb-fold', 'mbd-' + qFold); bq.classList.add('mb-fold-off'); bq.hidden = true; }
        bq.appendChild(render(quoted.join('\n'), options));
        emit(bq);
        continue;
      }

      /* 脚注定义 */
      if ((m = RE.fnDef.exec(trimmed))) {
        if (!doc.fnDefMap[m[1]]) {
          doc.fnDefMap[m[1]] = { key: m[1], text: m[2] };
          doc.fnDefs.push(doc.fnDefMap[m[1]]);
        }
        i++;
        continue;
      }

      /* 列表 */
      if (matchListItem(L)) {
        var pl = parseList(i, matchListItem(L).indent);
        emit(pl.list);
        i = pl.next;
        continue;
      }

      /* 段落：连续行合并，遇空行 / 新块结束；可跨行的行内结构例外 */
      var acc2 = [t];
      var foldId = L.fold;
      i++;
      while (i < lines.length) {
        var nx = lines[i];
        var ntrim = U.trimAll(nx.text);
        if (ntrim === '' && !hasOpenMultiline(acc2.join('\n'))) break;
        if (nx.fold !== foldId) break;
        if (RE.heading.test(nx.text) || RE.fence.test(nx.text) || RE.hr.test(nx.text) ||
            RE.tableRow.test(nx.text) || RE.quote.test(nx.text) || RE.fnDef.test(ntrim) ||
            RE.mathLine.test(nx.text) || matchListItem(nx) ||
            RE.formatOnly.test(ntrim) || RE.chartOnly.test(ntrim) || RE.skipOnly.test(ntrim)) break;
        acc2.push(nx.text);
        i++;
      }
      paragraph(acc2.join('\n'), foldId);
    }

    /* 脚注区 */
    if (doc.fnRefs.length || doc.fnDefs.length) {
      var sec = elem('section', { class: 'mb-footnotes' });
      sec.appendChild(elem('hr'));
      var ol = document.createElement('ol');
      var listed = {};
      doc.fnRefs.forEach(function (key, idx) {
        var def = doc.fnDefMap[key];
        var n = idx + 1;
        var li = elem('li', { id: 'mb-fn-' + n });
        if (def) {
          listed[key] = 1;
          MB.inline.render(def.text, ctxFor(li), li);
        } else {
          li.textContent = '（未找到脚注 ' + key + ' 的内容）';
        }
        var back = elem('a', { class: 'mb-fn-back', href: '#mb-fnref-' + n, 'aria-label': '返回正文', title: '返回正文' });
        back.textContent = '↑';
        li.appendChild(document.createTextNode(' '));
        li.appendChild(back);
        ol.appendChild(li);
      });
      doc.fnDefs.forEach(function (d) {
        if (listed[d.key]) return;
        var li2 = elem('li');
        MB.inline.render(d.text, ctxFor(li2), li2);
        ol.appendChild(li2);
      });
      sec.appendChild(ol);
      out.appendChild(sec);
    }

    return out;
  }

  function hasOpenMultiline(s) {
    function count(open, close) {
      var o = s.split(open).length - 1;
      var c = s.split(close).length - 1;
      return o > c;
    }
    return count('[o[', ']o]') || count('[|[', ']|]') || count('「「', '」」');
  }

  /* =====================================================================
   * 4. 运行时
   * ===================================================================== */

  var rplcStartMark = null, rplcEndMark = null;
  var FLAGS = Object.create(null);

  function insertMark(anchor) {
    var mk = document.createComment('mb');
    anchor.parentNode.insertBefore(mk, anchor.nextSibling);
    return mk;
  }

  function execOne(name, arg, anchor, scope, rest, rawRest) {
    function val() { return arg === undefined ? '' : MB.evaluate(arg, scope); }
    switch (name) {
      case 'v': case 'l':
        return;
      case 'put':
        insertTextAfter(anchor, String(val()));
        return;
      case 'rplcStart':
        rplcStartMark = insertMark(anchor);
        return;
      case 'rplcEnd':
        rplcEndMark = insertMark(anchor);
        return;
      case 'rplc':
        if (rplcStartMark && rplcEndMark) {
          var range = document.createRange();
          range.setStartAfter(rplcStartMark);
          range.setEndBefore(rplcEndMark);
          range.deleteContents();
          var f = document.createDocumentFragment();
          renderFragmentInto(String(val()), f, anchor);
          range.insertNode(f);
          rplcStartMark.parentNode && rplcStartMark.parentNode.removeChild(rplcStartMark);
          rplcEndMark.parentNode && rplcEndMark.parentNode.removeChild(rplcEndMark);
          rplcStartMark = rplcEndMark = null;
        } else {
          console.warn('[mb] rplc 找不到配对的 rplcStart / rplcEnd');
        }
        return;
      case 't':
        try { document.title = String(val()); } catch (e) { /* noop */ }
        return;
      case 'trigger':
        FLAGS[String(val())] = { calls: rest || [], raw: rawRest || [], anchor: anchor };
        return 'stop';
      case 'call':
        var rec = FLAGS[String(val())];
        if (rec) {
          for (var k = 0; k < rec.calls.length; k++) {
            var c1 = MB.parseCall(rec.calls[k]);
            execOne(c1.name, c1.arg, rec.anchor, scope, rec.calls.slice(k + 1), rec.raw.slice(k + 1));
          }
        } else console.warn('[mb] call 找不到 trigger：' + val());
        return;
      case 'use':
        var rec2 = FLAGS[String(val())];
        if (rec2) {
          for (var k2 = 0; k2 < rec2.calls.length; k2++) {
            var c2 = MB.parseCall(rec2.calls[k2]);
            execOne(c2.name, c2.arg, anchor, scope, rec2.calls.slice(k2 + 1), rec2.raw.slice(k2 + 1));
          }
        } else console.warn('[mb] use 找不到 trigger：' + val());
        return;
      case 'quote':
        runQuote(String(val()), anchor);
        return;
      default:
        console.warn('[mb] 未知函数：' + name);
    }
  }

  function runtimeDoc(options) {
    return { options: options || {}, foldSeq: 0, ids: Object.create(null), fnRefs: [], fnDefs: [], fnDefMap: Object.create(null), skipClose: 0 };
  }

  function renderFragmentInto(text, parent, anchor) {
    var opts = (anchor && anchor.__mbOptions) || {};
    MB.inline.render(text, { target: null, doc: runtimeDoc(opts), options: opts }, parent);
    return parent;
  }

  function insertTextAfter(anchor, str) {
    var f = document.createDocumentFragment();
    renderFragmentInto(str, f, anchor);
    var parent = anchor.parentNode;
    if (!parent) return;
    parent.insertBefore(f, anchor.nextSibling);
  }

  function runQuote(range, anchor) {
    var uri = range, spec = '';
    var m = /^(.*?)\[([\s\S]*)\]$/.exec(range);
    if (m) { uri = m[1]; spec = m[2]; }
    uri = uri.replace(/^"|"$/g, '');
    var opts = (anchor.__mbOptions) || {};
    var url = opts.resolveUrl ? opts.resolveUrl(uri) : uri;
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(global) : null);
    if (!fetchFn) return;
    fetchFn(url).then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(r.status)); })
      .then(function (txt) {
        txt = sliceQuote(txt, spec);
        var parent = anchor.parentNode;
        if (!parent) return;
        var only = parent.childNodes.length === 1;
        if (only && parent.tagName === 'P') {
          // 整段只有这一条引用：按块级插入
          var f = render(txt, opts);
          parent.parentNode.insertBefore(f, parent);
          parent.parentNode.removeChild(parent);
          run(parent.parentNode || document, opts);
        } else {
          var frag2 = document.createDocumentFragment();
          renderFragmentInto(txt, frag2, anchor);
          parent.insertBefore(frag2, anchor.nextSibling);
          run(parent, opts);
        }
      })
      .catch(function (e) { console.warn('[mb] quote 取不到内容：' + uri + ' — ' + e.message); });
  }

  /** quote 范围切片（标准 3.24）：行号从 1 开始，负数从末尾数 */
  function sliceQuote(text, spec) {
    if (!spec) return text;
    var lines = text.split('\n');
    function resolveId(id) {
      for (var i = 0; i < lines.length; i++) {
        if (new RegExp('\\{#' + id + '(?:\\.|\\})').test(lines[i])) return i;
      }
      return -1;
    }
    function parsePoint(str) {
      str = U.trimAll(str);
      var m = /^#([\w\u4e00-\u9fa5-]+)(?:\[\s*(-?\d+)\s*(?:\[\s*(-?\d+)\s*(?::\s*(-?\d+)\s*)?\]\s*)?\])?$/.exec(str);
      if (m) {
        var base = resolveId(m[1]);
        if (base < 0) return null;
        var line = base + (m[2] ? parseInt(m[2], 10) : 0);
        var from = m[3] !== undefined && m[3] !== null && m[3] !== '' ? parseInt(m[3], 10) : 1;
        var to = m[4] !== undefined && m[4] !== null && m[4] !== '' ? parseInt(m[4], 10) : null;
        return { line: line, from: from, to: to };
      }
      var m2 = /^(-?\d+)(?:\[\s*(-?\d+)\s*(?::\s*(-?\d+)\s*)?\])?$/.exec(str);
      if (m2) {
        var ln = parseInt(m2[1], 10);
        var f2 = m2[2] !== undefined && m2[2] !== null && m2[2] !== '' ? parseInt(m2[2], 10) : 1;
        var t2 = m2[3] !== undefined && m2[3] !== null && m2[3] !== '' ? parseInt(m2[3], 10) : null;
        return { line: ln > 0 ? ln - 1 : lines.length + ln, from: f2, to: t2 };
      }
      return null;
    }
    var parts = spec.split(':');
    if (parts.length === 1) {
      var one = parsePoint(parts[0]);
      if (!one) return text;
      var ln = one.line;
      if (ln < 0 || ln >= lines.length) return '';
      var lineText = lines[ln];
      var from = one.from > 0 ? one.from - 1 : lineText.length + one.from;
      var to = one.to === null ? (one.from > 0 ? lineText.length : lineText.length + one.from + 1) : (one.to > 0 ? one.to : lineText.length + one.to + 1);
      return Array.from(lineText).slice(Math.max(0, from), Math.max(0, to)).join('');
    }
    var a = parsePoint(parts[0]), b = parsePoint(parts.slice(1).join(':'));
    if (!a || !b) return text;
    var l1 = a.line, l2 = b.line;
    if (l1 < 0 || l2 < 0 || l1 >= lines.length) return '';
    if (l1 === l2) {
      var lt = lines[l1];
      var f3 = a.from > 0 ? a.from - 1 : lt.length + a.from;
      var t3 = b.to !== null ? (b.to > 0 ? b.to : lt.length + b.to + 1) : (b.from > 0 ? b.from : lt.length + b.from + 1);
      return Array.from(lt).slice(Math.max(0, f3), Math.max(0, t3)).join('');
    }
    var outLines = [];
    var firstLine = lines[l1];
    var f4 = a.from > 0 ? a.from - 1 : firstLine.length + a.from;
    outLines.push(Array.from(firstLine).slice(Math.max(0, f4)).join(''));
    for (var k = l1 + 1; k < Math.min(l2, lines.length); k++) outLines.push(lines[k]);
    if (l2 < lines.length) {
      var lastLine = lines[l2];
      var t4 = b.to !== null ? (b.to > 0 ? b.to : lastLine.length + b.to + 1) : lastLine.length;
      outLines.push(Array.from(lastLine).slice(0, Math.max(0, t4)).join(''));
    }
    return outLines.join('\n');
  }

  function runScript(script, anchor, scope, options) {
    var inner = script.replace(/^\{/, '').replace(/\}$/, '');
    var calls = MB.splitCalls(inner);
    for (var i = 0; i < calls.length; i++) {
      var call = MB.parseCall(calls[i]);
      var stop = execOne(call.name, call.arg, anchor, scope, calls.slice(i + 1), calls.slice(i + 1));
      if (stop === 'stop') break;
    }
  }

  function fire(el, options) {
    var script = el.getAttribute('data-mb');
    if (!script) return;
    MB.tick();
    fillVars(el);
    var scope = Object.create(null);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') scope.cntnt = el.value;
    else scope.cntnt = el.textContent;
    runScript(script, el, scope, options);
    var block = el.closest ? el.closest('p,li,td,th,div,section,blockquote') : null;
    if (block) runExec(block, options);
  }

  /** 填按钮文字里的 $变量$（点击时求值，标准 3.10 规则 2） */
  function fillVars(root) {
    var list = root.querySelectorAll ? root.querySelectorAll('.mb-var[data-mb-var]') : [];
    Array.prototype.forEach.call(list, function (sp) {
      var name = sp.getAttribute('data-mb-var');
      sp.textContent = MB.vars[name] === undefined ? '' : String(MB.vars[name]);
    });
  }

  function runExec(root, options) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('.mb-exec[data-mb]'), function (el) {
      if (el.__mbDone) return;
      el.__mbDone = 1;
      el.__mbOptions = options || null;
      fire(el, options);
    });
  }

  /* ---- 媒体类型嗅探（标准 3.21：只看内容，不看后缀） ---- */
  function sniff(bytes) {
    function at(i) { return bytes[i] || 0; }
    function ascii(off, str) {
      for (var i = 0; i < str.length; i++) if (at(off + i) !== str.charCodeAt(i)) return false;
      return true;
    }
    if (bytes.length < 4) return null;
    // 图片
    if (at(0) === 0x89 && ascii(1, 'PNG')) return 'image';
    if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image';
    if (ascii(0, 'GIF8')) return 'image';
    if (ascii(0, 'BM')) return 'image';
    if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image';
    if (at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a) return 'image';
    if (at(0) === 0x4d && at(1) === 0x4d && at(2) === 0x00) return 'image';
    if (at(0) === 0x00 && at(1) === 0x00 && at(2) === 0x01 && at(3) === 0x00) return 'image';
    var head = '';
    for (var i = 0; i < Math.min(bytes.length, 64); i++) head += String.fromCharCode(at(i));
    if (/<svg[\s>]/i.test(head)) return 'image';
    if (ascii(4, 'ftyp')) {
      var brand = '';
      for (var j = 8; j < Math.min(bytes.length, 16); j++) brand += String.fromCharCode(at(j));
      if (/avif|heic|heif|mif1|msf1|png |jpeg/.test(brand)) return 'image';
      if (/isom|iso2|mp41|mp42|avc1|M4V|dash|qt  /.test(brand)) return 'video';
    }
    // 音频
    if (ascii(0, 'ID3')) return 'audio';
    if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return 'audio';
    if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio';
    if (ascii(0, 'fLaC')) return 'audio';
    if (ascii(0, 'OggS')) return 'audio';
    if (ascii(0, 'FORM') && ascii(8, 'AIFF')) return 'audio';
    if (ascii(0, 'MThd')) return 'audio';
    // 视频容器
    if (ascii(0, 'RIFF') && ascii(8, 'AVI ')) return 'video';
    if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return 'video';
    return null;
  }

  function probeMedia(root) {
    var list = root.querySelectorAll ? root.querySelectorAll('img[data-mb-media]') : [];
    Array.prototype.forEach.call(list, function (img) {
      if (img.__mbProbed) return;
      img.__mbProbed = 1;
      var url = img.getAttribute('data-mb-media');
      if (!url || /^data:/.test(url)) return;
      var fetchFn = (typeof fetch !== 'undefined') ? fetch.bind(global) : null;
      if (!fetchFn) return;
      fetchFn(url, { headers: { Range: 'bytes=0-63' }, cache: 'force-cache' })
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) {
          var kind = sniff(new Uint8Array(buf));
          if (kind !== 'video' && kind !== 'audio') return;
          var media = document.createElement(kind === 'video' ? 'video' : 'audio');
          media.className = 'mb-media';
          media.setAttribute('controls', '');
          media.setAttribute('preload', 'metadata');
          media.setAttribute('src', url);
          var label = img.getAttribute('aria-label') || img.getAttribute('alt') || '';
          if (label) media.setAttribute('aria-label', label);
          if (img.id) media.id = img.id;
          Array.prototype.forEach.call(img.classList, function (c) { if (c !== 'lazyload') media.classList.add(c); });
          img.parentNode && img.parentNode.replaceChild(media, img);
        })
        .catch(function (e) { console.warn('[mb] 媒体类型探测失败，按图片输出：' + url); });
    });
  }

  /* ---- 公式渲染（可选：有公式才加载 KaTeX） ---- */
  var katexPromise = null;
  function ensureKatex() {
    if (katexPromise) return katexPromise;
    katexPromise = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
      document.head.appendChild(css);
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
      s.onload = function () { resolve(global.katex); };
      s.onerror = function () { reject(new Error('KaTeX 加载失败')); };
      document.head.appendChild(s);
    });
    return katexPromise;
  }

  function renderMath(root) {
    var list = root.querySelectorAll ? root.querySelectorAll('[data-mb-tex]') : [];
    if (!list.length) return;
    ensureKatex().then(function (katex) {
      if (!katex) return;
      Array.prototype.forEach.call(list, function (el) {
        if (el.__mbMathDone) return;
        el.__mbMathDone = 1;
        var tex = el.getAttribute('data-mb-tex');
        try {
          katex.render(tex, el, {
            displayMode: el.hasAttribute('data-mb-display'),
            throwOnError: false,
            strict: false
          });
          el.classList.add('mb-math-rendered');
        } catch (e) {
          console.warn('[mb] 公式渲染失败，按原文显示：' + e.message);
        }
      });
    }).catch(function (e) { console.warn('[mb] ' + e.message + '（公式按原文显示）'); });
  }

  /* ---- 折叠块 ---- */
  function toggleFold(id, open) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mb-fold="' + id + '"]'), function (el) {
      el.classList.toggle('mb-fold-off', !open);
      if (el.tagName !== 'TR') { if (open) el.removeAttribute('hidden'); else el.setAttribute('hidden', ''); }
    });
  }

  function bindFolds(root) {
    var list = root.querySelectorAll ? root.querySelectorAll('input.mb-fold-state[data-mb-rows]') : [];
    Array.prototype.forEach.call(list, function (cb) {
      if (cb.__mbBound) return;
      cb.__mbBound = 1;
      cb.addEventListener('change', function () {
        toggleFold(cb.getAttribute('data-mb-rows'), cb.checked);
      });
    });
  }

  /* ---- 入口 ---- */
  function run(root, options) {
    root = root || document;
    options = options || {};
    Array.prototype.forEach.call(root.querySelectorAll ? root.querySelectorAll('[data-mb-tex]') : [], function (el) { el.__mbOptions = options; });
    fillVars(root);
    runExec(root, options);
    Array.prototype.forEach.call(root.querySelectorAll ? root.querySelectorAll('button[data-mb], a.mb-btn[data-mb]') : [], function (el) {
      if (el.__mbBound) return;
      el.__mbBound = 1;
      el.__mbOptions = options;
      el.addEventListener('click', function (e) {
        if (el.tagName === 'A') e.preventDefault();
        fire(el, options);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll ? root.querySelectorAll('input[data-mb], textarea[data-mb], select[data-mb]') : [], function (el) {
      if (el.__mbBound) return;
      el.__mbBound = 1;
      el.__mbOptions = options;
      el.addEventListener('change', function () { fire(el, options); });
    });
    Array.prototype.forEach.call(root.querySelectorAll ? root.querySelectorAll('[data-mb-enter]') : [], function (el) {
      if (el.__mbBound) return;
      el.__mbBound = 1;
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        var sel = el.getAttribute('data-mb-enter');
        var btn = sel ? document.querySelector(sel) : null;
        if (btn) { e.preventDefault(); btn.click(); }
      });
    });
    bindFolds(root);
    probeMedia(root);
    renderMath(root);
  }

  MB.render = render;
  MB.run = run;
  MB.toggleFold = toggleFold;
  MB.sniff = sniff;
  MB.renderInto = function (target, src, options) {
    target.appendChild(render(src, options));
    run(target, options);
    return target;
  };
})(typeof window !== 'undefined' ? window : globalThis);
