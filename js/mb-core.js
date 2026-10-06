/*!
 * mb-core.js —— MarkBottom 0.1 解释器 · 公共内核
 * 交付物：文本工具、定界符配对、表达式求值器、功能语句切分、内容语句
 * 说明：这套实现按《MarkBottom 0.1 版本标准》重写，是运行期解释器（直接产出 DOM），
 *       不是把 mbmd 编译成静态 HTML 的构建工具。
 */
(function (global) {
  'use strict';

  var MB = global.MBMD = global.MBMD || {};
  MB.version = '0.1';

  /* =====================================================================
   * 1. 基础工具
   * ===================================================================== */

  /** 生成元素：elem('p', {class:'x', text:'hi'}) */
  function elem(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    return e;
  }

  function textNode(s) { return document.createTextNode(s); }

  /** 追加子节点（跳过 null） */
  function append(parent, child) {
    if (child === null || child === undefined) return parent;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return parent; }
    parent.appendChild(child);
    return parent;
  }

  function frag(nodes) {
    var f = document.createDocumentFragment();
    append(f, nodes || []);
    return f;
  }

  var HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return HTML_ESC[c]; });
  }

  function isSpace(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\u3000'; }
  function isDigit(c) { return c >= '0' && c <= '9'; }

  /** 去掉内容首尾各一个空格（标准 附录B 第 10 条） */
  function trimOne(s) {
    if (s.charAt(0) === ' ') s = s.slice(1);
    if (s.charAt(s.length - 1) === ' ') s = s.slice(0, -1);
    return s;
  }
  function trimAll(s) { return String(s).replace(/^\s+|\s+$/g, ''); }

  /**
   * 定界符配对（就近配对）：src 从 i 开始必须是 open，
   * 返回「配对 close 之后」的下标；没有配对时返回 -1。
   * 转义符 \X 一律跳过，被转义的字符不参与配对。
   */
  function matchClose(src, i, open, close) {
    var depth = 0, j = i, n = src.length;
    while (j < n) {
      var c = src.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (src.startsWith(open, j)) { depth++; j += open.length; continue; }
      if (src.startsWith(close, j)) {
        depth--; j += close.length;
        if (depth === 0) return j;
        continue;
      }
      j++;
    }
    return -1;
  }

  /** 只要 open/close 是同一个字符时的高频版本 */
  function matchChar(src, i, open, close) {
    var depth = 0, j = i, n = src.length;
    while (j < n) {
      var c = src.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return j + 1; }
      j++;
    }
    return -1;
  }

  /** 跳过定界符的 n 次收尾（{/`=n} 解析语句 / 3.18） */
  function matchCharSkip(src, i, open, close, skip) {
    var depth = 0, j = i, n = src.length, skipped = 0;
    while (j < n) {
      var c = src.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (c === open) depth++;
      else if (c === close) {
        if (depth === 1 && skipped < (skip || 0)) { skipped++; j++; continue; }
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    return -1;
  }

  /**
   * 在 s 中找第一个「顶层」分隔符（不在括号 / 定界符里面）。
   * pairs 形如 [['【','】'],['[',']'],['(',')']]，按深度计数。
   */
  function findTopLevel(s, seps, pairs) {
    pairs = pairs || [['【', '】'], ['[', ']'], ['(', ')']];
    var depth = 0, i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === '\\') { i += 2; continue; }
      var opened = false;
      for (var p = 0; p < pairs.length; p++) {
        if (c === pairs[p][0]) { depth++; opened = true; break; }
        if (c === pairs[p][1]) { depth--; opened = true; break; }
      }
      if (!opened && depth <= 0 && seps.indexOf(c) >= 0) return i;
      i++;
    }
    return -1;
  }

  /** 按顶层分隔符切分（保留分隔符信息） */
  function splitTopLevel(s, sep, pairs) {
    var out = [], buf = '', i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === '\\' && i + 1 < s.length) { buf += c + s.charAt(i + 1); i += 2; continue; }
      if (c === sep && findTopLevel(buf, sep, pairs) < 0) {
        out.push(buf); buf = ''; i++; continue;
      }
      buf += c; i++;
    }
    out.push(buf);
    return out;
  }

  /* =====================================================================
   * 2. 变量表
   * ===================================================================== */

  var GLOBAL_VARS = Object.create(null);

  function pad2(n) { return String(n).length >= 2 ? String(n) : '0' + n; }

  /** 时间类变量在每次被调用时刷新（标准 3.9.8 规则 6） */
  function tick() {
    var d = new Date();
    GLOBAL_VARS.timeh = pad2(d.getHours());
    GLOBAL_VARS.timem = pad2(d.getMinutes());
    GLOBAL_VARS.times = pad2(d.getSeconds());
    GLOBAL_VARS.timeY = String(d.getFullYear());
    GLOBAL_VARS.timeM = pad2(d.getMonth() + 1);
    GLOBAL_VARS.timeD = pad2(d.getDate());
  }

  if (typeof navigator !== 'undefined') {
    GLOBAL_VARS.browser = navigator.userAgent;
    GLOBAL_VARS.os = navigator.platform ||
      (navigator.userAgentData && navigator.userAgentData.platform) || '';
  }
  tick();

  /* =====================================================================
   * 3. 计算语句：表达式求值（标准 3.9.7）
   * ===================================================================== */

  var VAR_RE = /^\$[A-Za-z_][A-Za-z0-9_]*\$/;

  function tokenize(src) {
    var out = [], i = 0, n = src.length;
    while (i < n) {
      var c = src.charAt(i);
      if (isSpace(c)) { i++; continue; }
      if (isDigit(c) || (c === '.' && isDigit(src.charAt(i + 1)))) {
        // 小数点后面必须跟数字，否则 "1.5.?" 会把 ".?" 一起吞掉
        var j = i;
        while (j < n) {
          if (isDigit(src.charAt(j))) { j++; continue; }
          if (src.charAt(j) === '.' && isDigit(src.charAt(j + 1))) { j++; continue; }
          break;
        }
        out.push(src.slice(i, j)); i = j; continue;
      }
      if (c === '"') {
        var k = i + 1;
        while (k < n) {
          if (src.charAt(k) === '\\') { k += 2; continue; }
          if (src.charAt(k) === '"') break;
          k++;
        }
        if (k >= n) throw new SyntaxError('字符串缺少结束引号');
        out.push(src.slice(i, k + 1)); i = k + 1; continue;
      }
      if (c === '$') {
        var m = VAR_RE.exec(src.slice(i));
        if (!m) throw new SyntaxError('变量名不合法：' + src.slice(i, i + 12));
        out.push(m[0]); i += m[0].length; continue;
      }
      var three = src.substr(i, 2);
      var two = src.substr(i, 2);
      var multi = ['+:', '-:', '%:', '>:', '++', '--', '+=', '-=', '*=', '/=', '>=', '<=', '==', '!=', '.-', '.+', '.?'];
      var matched = null;
      for (var t = 0; t < multi.length; t++) {
        if (two === multi[t]) { matched = multi[t]; break; }
      }
      if (matched) { out.push(matched); i += 2; continue; }
      if ('+-*/%()[],=!|&<>?:'.indexOf(c) >= 0) { out.push(c); i++; continue; }
      throw new SyntaxError('非法字符：“' + c + '”');
    }
    return out;
  }

  function unquote(raw) {
    return raw.slice(1, -1).replace(/\\(.)/g, '$1');
  }

  function truthy(v) {
    return !(v === '' || v === 0 || v === '0' || v === false || v === null || v === undefined);
  }

  /**
   * 求值：evaluate('1+1') -> 2
   * scope 用来承载 $cntnt$ 这类局部变量。
   */
  function evaluate(src, scope) {
    scope = scope || Object.create(null);
    var toks = tokenize(src), p = 0;

    function peek() { return toks[p]; }
    function eat(t) { if (toks[p] === t) { p++; return true; } return false; }
    function expect(t) {
      if (!eat(t)) throw new SyntaxError('期望 “' + t + '”，实际是 “' + toks[p] + '”');
    }
    function getVar(name) {
      if (name === 'cntnt') return scope.cntnt === undefined ? '' : scope.cntnt;
      if (name in scope) return scope[name];
      if (name in GLOBAL_VARS) return GLOBAL_VARS[name];
      return '';
    }
    function setVar(name, v) {
      if (name === 'cntnt') scope.cntnt = v; else scope[name] = v;
      return v;
    }

    function conditional() {
      var c = assignment();
      if (eat('?')) {
        var a = conditional();
        expect(':');
        var b = conditional();
        return truthy(c) ? a : b;
      }
      return c;
    }

    function assignment() {
      var t = peek();
      if (t && t.charAt(0) === '$' && t.charAt(t.length - 1) === '$') {
        var name = t.slice(1, -1), op = toks[p + 1];
        if (op === '=' || op === '+=' || op === '-=' || op === '*=' || op === '/=') {
          p += 2;
          var old = getVar(name), rhs = assignment();
          if (op === '=') return setVar(name, rhs);
          if (op === '+=') return setVar(name, Number(old) + Number(rhs));
          if (op === '-=') return setVar(name, Number(old) - Number(rhs));
          if (op === '*=') return setVar(name, Number(old) * Number(rhs));
          return setVar(name, Number(old) / Number(rhs));
        }
        if (op === '++' || op === '--') {
          p += 2;
          var v0 = Number(getVar(name));
          setVar(name, op === '++' ? v0 + 1 : v0 - 1);
          return v0;
        }
      }
      return orExpr();
    }

    function orExpr() {
      var v = andExpr();
      while (eat('|')) { var r = andExpr(); v = truthy(v) || truthy(r); }
      return v;
    }
    function andExpr() {
      var v = equExpr();
      while (eat('&')) { var r = equExpr(); v = truthy(v) && truthy(r); }
      return v;
    }
    function equExpr() {
      var v = relExpr();
      for (;;) {
        if (eat('==')) v = (v == relExpr());
        else if (eat('!=')) v = (v != relExpr());
        else return v;
      }
    }
    function relExpr() {
      var v = strExpr();
      for (;;) {
        if (eat('>=')) v = (v >= strExpr());
        else if (eat('<=')) v = (v <= strExpr());
        else if (eat('>')) v = (v > strExpr());
        else if (eat('<')) v = (v < strExpr());
        else return v;
      }
    }
    function strExpr() {
      var v = addExpr();
      for (;;) {
        if (eat('+:')) { v = String(v) + String(addExpr()); }
        else if (eat('-:')) { v = String(v).split(String(addExpr())).join(''); }
        else if (eat('%:')) {
          var oldS = addExpr();
          if (!eat('>:')) throw new SyntaxError('“%:” 必须与 “>:” 配对使用');
          v = String(v).split(String(oldS)).join(String(addExpr()));
        } else return v;
      }
    }
    function addExpr() {
      var v = mulExpr();
      for (;;) {
        if (eat('+')) v = Number(v) + Number(mulExpr());
        else if (eat('-')) v = Number(v) - Number(mulExpr());
        else return v;
      }
    }
    function mulExpr() {
      var v = unary();
      for (;;) {
        if (eat('*')) v = Number(v) * Number(unary());
        else if (eat('/')) v = Number(v) / Number(unary());
        else if (eat('%')) v = Number(v) % Number(unary());
        else return v;
      }
    }
    function unary() {
      if (eat('!')) return !truthy(unary());
      if (eat('-')) return -Number(unary());
      if (eat('+')) return Number(unary());
      return postfix();
    }
    function postfix() {
      var v = primary();
      for (;;) {
        if (eat('[')) {
          var n = conditional();
          expect(']');
          var idx = Number(n) - 1;                       // 下标从 1 开始
          var str = String(v);
          var chars = Array.from(str);
          v = (idx < 0 || idx >= chars.length) ? '' : chars[idx];
        }
        else if (eat('.-')) v = Math.floor(Number(v));
        else if (eat('.+')) v = Math.ceil(Number(v));
        else if (eat('.?')) v = Math.round(Number(v));
        else return v;
      }
    }
    function primary() {
      var t = peek();
      if (t === undefined) throw new SyntaxError('表达式意外结束');
      if (isDigit(t.charAt(0)) || (t.charAt(0) === '.' && isDigit(t.charAt(1)))) { p++; return parseFloat(t); }
      if (t.charAt(0) === '"') { p++; return unquote(t); }
      if (t.charAt(0) === '$') { p++; return getVar(t.slice(1, -1)); }
      if (eat('(')) { var v = conditional(); expect(')'); return v; }
      throw new SyntaxError('无法解析：“' + t + '”');
    }

    var value = conditional();
    if (p !== toks.length) {
      throw new SyntaxError('表达式未完全解析：“' + toks.slice(p).join(' ') + '”');
    }
    return value;
  }

  /* =====================================================================
   * 4. 功能语句：切分与规范化
   * ===================================================================== */

  /** 把参数里的计算语句定界符去掉：put:{`1+1`} -> put:1+1 */
  function normalizeScript(s) {
    return String(s).replace(/`([^`]*)`/g, '$1');
  }

  /** 在一段 {{...}} 内部找「顶层 {…} 单元」 */
  function splitCalls(inner) {
    var calls = [], i = 0;
    while (i < inner.length) {
      if (inner.charAt(i) !== '{') { i++; continue; }
      var depth = 1, j = i + 1, inStr = false;
      while (j < inner.length && depth > 0) {
        var c = inner.charAt(j);
        if (inStr) {
          if (c === '\\') j++;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
        j++;
      }
      calls.push(inner.slice(i + 1, j - 1));
      i = j;
    }
    return calls;
  }

  /** 'put:"a"' -> {name:'put', arg:'"a"'}（arg 为 undefined 表示无参数） */
  function parseCall(call) {
    var k = call.indexOf(':');
    return {
      name: (k < 0 ? call : call.slice(0, k)).trim(),
      arg: k < 0 ? undefined : call.slice(k + 1)
    };
  }

  /* =====================================================================
   * 5. 内容语句（标准 3.9.2）
   * ===================================================================== */

  var GREEK = {
    alpha: 0x3b1, beta: 0x3b2, gamma: 0x3b3, delta: 0x3b4, epsilon: 0x3b5,
    zeta: 0x3b6, eta: 0x3b7, theta: 0x3b8, iota: 0x3b9, kappa: 0x3ba,
    lambda: 0x3bb, mu: 0x3bc, nu: 0x3bd, xi: 0x3be, omicron: 0x3bf,
    pi: 0x3c0, rho: 0x3c1, sigma: 0x3c3, tau: 0x3c4, upsilon: 0x3c5,
    phi: 0x3c6, chi: 0x3c7, psi: 0x3c8, omega: 0x3c9, varepsilon: 0x3b5,
    varphi: 0x3c6, vartheta: 0x3b8
  };

  var EMOJI = {
    smile: '😄', grin: '😁', joy: '😂', cry: '😭', sob: '😭', wink: '😉',
    heart: '❤️', hearts: '💕', brokenheart: '💔', thumbsup: '👍', '+1': '👍',
    thumbsdown: '👎', '-1': '👎', ok: '👌', clap: '👏', pray: '🙏', wave: '👋',
    fire: '🔥', star: '⭐', sparkles: '✨', zap: '⚡', boom: '💥', tada: '🎉',
    check: '✅', cross: '❌', warning: '⚠️', info: 'ℹ️', question: '❓',
    thinking: '🤔', eyes: '👀', cool: '😎', sunglasses: '😎', facepalm: '🤦',
    shrug: '🤷', skull: '💀', ghost: '👻', alien: '👽', robot: '🤖', poo: '💩',
    rainbow: '🌈', moon: '🌙', sun: '☀️', cloud: '☁️', rain: '🌧️', snow: '❄️',
    rocket: '🚀', bug: '🐛', cat: '🐱', dog: '🐶', panda: '🐼', coffee: '☕',
    gift: '🎁', cake: '🎂', bell: '🔔', bulb: '💡', lock: '🔒', key: '🔑',
    hundred: '💯', point: '👉', pointup: '👆', pointdown: '👇', muscle: '💪',
    '100': '💯', sweat: '😅', angel: '😇', devil: '😈', clown: '🤡', nerd: '🤓'
  };

  var ICON = {
    warning: '⚠️', check: '✅', cross: '❌', info: 'ℹ️', fire: '🔥',
    star: '⭐', heart: '❤️', bulb: '💡', lock: '🔒', key: '🔑',
    bell: '🔔', search: '🔍', gear: '⚙️', flag: '🚩', pin: '📌',
    arrow: '→', up: '↑', down: '↓', left: '←', right: '→'
  };

  /** HTML 实体名 -> 字符；不认识返回 null（调用方原样输出） */
  function htmlEntity(name) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return null;
    var box = document.createElement('textarea');
    box.innerHTML = '&' + name + ';';
    var v = box.value;
    return v === '&' + name + ';' ? null : v;
  }

  /**
   * 内容语句求值：contentStatement('greek', 'alpha')
   * 返回字符串；返回 null 表示「不认识，请原样输出该语句」。
   */
  function contentStatement(cat, arg) {
    cat = String(cat || '');
    arg = String(arg == null ? '' : arg);
    if (cat === 'greek') {
      var name = arg.replace(/^:+|:+$/g, '');
      var lower = name.toLowerCase();
      if (!(lower in GREEK)) return null;
      var code = GREEK[lower];
      if (name.charAt(0) === name.charAt(0).toUpperCase() && /[a-z]/.test(name.charAt(0))) code -= 32;
      return String.fromCodePoint(code);
    }
    if (cat === 'unicode') {
      var hex = arg.replace(/^:+|:+$/g, '').replace(/^U\+/i, '');
      if (!/^[0-9A-Fa-f]+$/.test(hex)) return null;
      var cp = parseInt(hex, 16);
      if (!isFinite(cp) || cp < 0 || cp > 0x10ffff) return null;
      try { return String.fromCodePoint(cp); } catch (e) { return null; }
    }
    if (cat === 'control') {
      var ent = arg.replace(/^:+|:+$/g, '').replace(/^&|;$/g, '');
      return htmlEntity(ent);
    }
    if (cat === 'emoji' || cat === 'icon') {
      var key = arg.replace(/^:+|:+$/g, '').split(':')[0];
      var table = cat === 'emoji' ? EMOJI : ICON;
      if (key in table) return table[key];
      return null;
    }
    return null;
  }

  /* =====================================================================
   * 6. 图表数据（标准 3.9.6）
   * ===================================================================== */

  var PIE_COLORS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];

  /** 数据项允许写变量 / 表达式：$a、`2+3`、1+1 */
  function chartValue(raw, scope) {
    var s = trimAll(raw);
    if (s === '') return '';
    try { return evaluate(s, scope); } catch (e) { return s; }
  }

  /* =====================================================================
   * 导出
   * ===================================================================== */
  MB.util = {
    elem: elem, textNode: textNode, append: append, frag: frag, esc: esc,
    isSpace: isSpace, isDigit: isDigit, trimOne: trimOne, trimAll: trimAll,
    matchClose: matchClose, matchChar: matchChar, matchCharSkip: matchCharSkip,
    findTopLevel: findTopLevel, splitTopLevel: splitTopLevel
  };
  MB.vars = GLOBAL_VARS;
  MB.tick = tick;
  MB.evaluate = evaluate;
  MB.truthy = truthy;
  MB.normalizeScript = normalizeScript;
  MB.splitCalls = splitCalls;
  MB.parseCall = parseCall;
  MB.contentStatement = contentStatement;
  MB.chartValue = chartValue;
  MB.PIE_COLORS = PIE_COLORS;
})(typeof window !== 'undefined' ? window : globalThis);
