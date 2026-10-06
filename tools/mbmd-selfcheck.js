/* 渲染自测：用 jsdom 跑 mb-*.js，检查标准里的各种语法是否产出预期结构 */
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

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><head><title>t</title></head><body><div id="out"></div></body></html>', {
  pretendToBeVisual: true,
  runScripts: 'outside-only',
  url: 'http://localhost/'
});
const { window } = dom;
['js/mb-core.js', 'js/mb-inline.js', 'js/mb-block.js'].forEach(function (f) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
});
const MBMD = window.MBMD;
if (!MBMD) { console.error('MBMD 未挂载到 window；window.eval 可用吗？', typeof window.eval); process.exit(1); }
const doc = window.document;

function render(src, options) {
  const host = doc.createElement('div');
  host.appendChild(MBMD.render(src, Object.assign({ resolveUrl: (u) => u }, options || {})));
  return host;
}

const cases = [];
let pass = 0, fail = 0;
const failures = [];
function t(name, src, checks) { cases.push({ name, src, checks }); }

/* ---- 标准 3.2 ruby ---- */
t('ruby 上标', '【振仮名|ふりがな】', ['<ruby>振仮名<rp>(</rp><rt>ふりがな</rt><rp>)</rp></ruby>']);
t('ruby 下标', '【振仮名/ふりがな】', ['class="mb-ruby-under"']);
t('ruby 上下', '【紅玉|モミだま/ルビ】', ['class="mb-ruby-under"', 'class="mb-ruby-over"']);
t('ruby 全角/半角混写', '[(紅玉|モミだま/ルビ)]', ['mb-ruby-over']);
t('ruby 着重号上', '【一般标在上方|】', ['<rt>●</rt>']);
t('ruby 着重号下', '【一般标在下方/】', ['mb-ruby-under', '<rt>●</rt>']);
t('ruby 无分隔符当普通文字', '【内容】', ['【内容】']);
t('ruby 嵌套', '【【基字/下标ruby】|【上标ruby|上标ruby】】', ['<ruby>', 'mb-ruby-under']);

/* ---- 3.3 / 3.4 ---- */
t('变大变小', '<-[Bigger Text]-> 与 ->[Smaller Text]<-', ['mb-bigger', 'mb-smaller']);
t('变大变小（别名）', '+[B]+ 与 -[S]-', ['mb-bigger', 'mb-smaller']);
t('上下标', 'x^[2]^ + y_[1]_', ['<sup>2</sup>', '<sub>1</sub>']);
t('下划线', '_文字_', ['<u>文字</u>']);

/* ---- 3.5 / 3.6 ---- */
t('灰/注解/涂黑', '@(灰)@ _(注)_ #(黑)#', ['mb-gray', 'mb-commental', 'mb-blacked']);
t('上色五种', "!'c'! !,c,! !.c.! !;c;! !:c:!",
  ['mb-fgcolored', 'mb-bgcolored', 'mb-bgpartialcolored', 'mb-fgcolored mb-bgcolored']);

/* ---- 3.7 折叠块 ---- */
t('折叠块基础', '~[标题][内容]', ['<details class="mb-fold">', '<summary>标题</summary>']);
t('折叠块默认展开', '~[标题]:[内容]', ['open']);
t('折叠块三段', '~[展开][内容][收起]', ['mb-fold-inline', 'mb-fold-state', 'mb-fold-body', 'mb-fold-close']);
t('折叠块三段空收起', '~[展开][内容][]', ['>▲<']);
t('分离式折叠按钮', '~[其他写法]~>[f1]', ['class="mb-fold-state" id="mbd-f1" data-mb-rows="mbd-f1"', 'class="mb-fold-title" for="mbd-f1"']);

/* ---- 3.8 / 3.10 ---- */
t('按钮式连接', '[[示例链接](example.com)]', ['<a class="mb-btn" href="example.com">示例链接</a>']);
t('按钮', '[[点击计算]{{put:1+1}}]', ['<button type="button" class="mb-btn" data-mb="{{put:1+1}}">']);
t('执行语句成行', '{{put:"hello world"}}', ['class="mb-exec" data-mb="{{put:&quot;hello world&quot;}}"']);
t('计算语句', '1+1={`1+1`}', ['data-mb="{{put:1+1}}"']);
t('变量', '{$timeY$}', ['data-mb="{{put:$timeY$}}"']);
t('公式', '质能方程 $E = mc^2$ 是', ['class="mb-math" data-mb-tex="E = mc^2"']);
t('内容语句', '{:greek:alpha:} {:unicode:1F600:} {:control:copy:}', ['α', '😀', '©']);
t('未知内容语句原样', '{:greek:nope:}', ['{:greek:nope:}']);

/* ---- 3.11-3.14 ---- */
t('输入框', ':[请输入](小明)->(#go1){{put:"d"}}',
  ['<input type="text" class="mb-input"', 'placeholder="请输入"', 'value="小明"', 'data-mb-enter="#go1"', 'data-mb="{{put:&quot;d&quot;}}"']);
t('多行输入框', '[:[占位](默认){{put:1}}]', ['<textarea class="mb-input"', '占位']);
t('选择框', '[;[请选择][甲][乙](乙){{put:1}}]', ['<select class="mb-input"', 'disabled="" hidden=""', 'selected=""']);
t('标签绑定输入框', '::你的名字: :[请输入]()', ['<label class="mb-label">', '<input type="text" class="mb-input"']);
t('标签空文字原样', '::', ['::']);

/* ---- 3.15-3.19 ---- */
t('转义符', '\\n\\<\\>', ['<br>', '&lt;', '&gt;']);
t('原始转义符', '\\o*星号还是星号\\o*', ['*星号还是星号*']);
t('原始文本', '[o[a    b]o]', ['class="mb-origin">a    b<']);
t('略过解析次数', '{/`=2}`a`b`c`', ['<code>a`b`c</code>']);
t('竖排', '「「右列『『in』』文字」」', ['class="mb-vertical"', 'class="mb-horizontal"']);
t('竖排别名', '[|[文字]|]', ['class="mb-vertical"']);
t('横排别名', '[|[文[-[x]-]字]|]', ['class="mb-horizontal"']);

/* ---- 3.1 命名 / 3.9.4 排版调整 / 3.22 aria ---- */
t('命名语句块', '# 标题1 {#t1}', ['<h1 id="t1">标题1</h1>']);
t('命名语句行内', '**注意**{#w1}', ['<strong id="w1">注意</strong>']);
t('命名语句只设类', '**注意**{.warn}', ['class="warn"']);
t('行尾对齐', '这一行右对齐{|---:|}', ['<p class="mb-right">']);
t('行尾居中', '这一行居中{|:---:|}', ['<p class="mb-center">']);
t('单独成行对齐', '{|:---:|}\n这是居中的段落。', ['<div class="mb-center">']);
t('单元格对齐', '| 内容{|---:|} | 普通 |\n|---|---|', ['class="mb-right"']);
t('图片浮动容器', '{|--.5|}\n![一只猫](cat.png)', ['mb-float-right', 'height: 5em', '<img src="cat.png" alt="一只猫"']);
t('aria 标签', '![图片](url)((一张猫的照片))', ['aria-label="一张猫的照片"']);

/* ---- 3.20 表格 ---- */
t('延续符', '| a | b |\n|---|---|\n| c | d |\n| [+] | e |\n| f | [+>] |',
  ['rowspan="2"', 'colspan="2"', '<td> e </td>']);
t('侧边表头', '| 班级 || 小明 | 小红 |\n|---|---|---|\n| 语文 || 90 | 88 |',
  ['<th scope="row"> 语文 </th>', '<th> 小明 </th>']);
t('斜线单元格', '| %( 项目 / 月份 )% | 一月 |\n|---|---|\n| 收入 | 100 |',
  ['class="mb-slash mb-slash-u"', 'mb-slash-head">项目<', 'mb-slash-tail">月份<']);
t('斜线反斜杠', '| ( 语法 \\ 示例 \\ 格式 )% || mbmd | html |\n|---|---|---|\n|a|b|c|',
  ['mb-slash-d', 'mb-slash-fan', 'mb-slash-mid">示例<', 'mbmd']);

/* ---- 3.9.6 图表 ---- */
t('柱状图', '{[bar:3,5,2,8]}', ['mb-chart mb-chart-bar', 'mb-bar', '<span>3</span>']);
t('折线图', '{[line:1,4,2,8]}', ['<svg class="mb-chart"', 'polyline']);
t('饼图', '{[pie:30,20,50]}', ['mb-chart-pie', 'stroke-dasharray="30 70"']);
t('图表表格', '{[table:姓名,年龄;小明,12]}', ['<th>姓名</th>', '<td>小明</td>']);

/* ---- 3.21 媒体 ---- */
t('图片', '![alt](pic.png)', ['<img src="pic.png" alt="alt" data-mb-media="pic.png">']);

/* ---- md 基础 ---- */
t('标题级别', '### 三级', ['<h3 id="三级">三级</h3>']);
t('粗斜删', '**粗** *斜* ~~删~~', ['<strong>粗</strong>', '<em>斜</em>', '<del>删</del>']);
t('行内代码', '`a|b`', ['<code>a|b</code>']);
t('链接', '[文字](http://a.b)', ['<a href="http://a.b">文字</a>']);
t('无序列表', '- a\n- b', ['<ul>', '<li>a</li>']);
t('有序列表', '1. a\n2. b', ['<ol>', '<li>a</li>']);
t('任务列表', '- [x] 完成\n- [ ] 未完成', ['type="checkbox"', 'checked']);
t('引用', '> 引用内容', ['<blockquote>']);
t('分隔线', '---', ['<hr>']);
t('代码块', '```js\nvar a = 1;\n```', ['<pre>', 'language-js', 'var a = 1;']);
t('脚注', '文字[^1]\n\n[^1]: 脚注内容', ['mb-fnref-1', 'mb-fn-1', '脚注内容']);
t('行间公式', '$$$\n\\int_0^1 x\n$$$', ['mb-math-block', 'data-mb-display="1"']);

/* ---- 3.7 分离式折叠块：表格行 / 列表项 ---- */
t('折叠表格行', '|列 A |列 B |\n|---|---|\n| 正常行 | ~[展开]~>[f-tbl] |\n[f-tbl]~>[\n| 隐藏行一 | 内容一 |\n| 隐藏行二 | 内容二 |\n]',
  ['data-mb-fold="mbd-f-tbl"', 'mb-fold-off', '<td> 隐藏行一 </td>']);
t('折叠列表项', '- 列表第一项 ~[展开]~>[f-list]\n[f-list]~>[\n- 被折叠的第二项\n- 被折叠的第三项\n]',
  ['data-mb-fold="mbd-f-list"', '被折叠的第二项', 'mb-fold-title']);


/* ---- 全角定界符 ---- */
t('ruby 全角上标', '【振仮名｜ふりがな】', ['<ruby>振仮名<rp>(</rp><rt>ふりがな</rt>']);
t('ruby 全角下标', '【振仮名／ふりがな】', ['mb-ruby-under']);
t('ruby 全角上下', '【紅玉｜モミだま／ルビ】', ['mb-ruby-over', 'mb-ruby-under']);
t('ruby 半中括号全角分隔', '[(紅玉｜モミだま／ルビ)]', ['mb-ruby-over']);
t('ruby 空基字原样', '【|x】', ['【|x】']);

/* ---- 计算语句（标准 3.9.7 的运算符表） ---- */
const EV = [
  ['7%3', 1], ['"abc"[2]', 'b'], ['"a"+:"b"', 'ab'], ['"abcb"-:"b"', 'ac'],
  ['"a-b-c"%:"-">:"+"', 'a+b+c'], ['!0', true], ['0|1', true], ['1&1', true],
  ['1==2', false], ['2>=2', true], ['1.5.?', 2], ['1.5.-', 1], ['1.1.+', 2],
  ['1?"y":"n"', 'y'], ['0?"y":"n"', 'n'], ['2*3+4', 10], ['10/4', 2.5],
  ['"x"+:"y"+:"z"', 'xyz'], ['1+1', 2], ['(1+2)*3', 9]
];
EV.forEach(function (pair) {
  let got, err = null;
  try { got = MBMD.evaluate(pair[0]); } catch (e) { err = e.message; }
  if (err || String(got) !== String(pair[1])) {
    fail++; failures.push({ name: '计算 ' + pair[0], src: pair[0], missing: ['期望 ' + pair[1] + '，得到 ' + (err || got)], html: '' });
  } else pass++;
});
t('变量赋值', '{`$a=1`}{`$a+=2`}{`$a`}', ['data-mb="{{put:$a}}"', 'data-mb="{{put:$a+=2}}"']);
t('三目与取整', 'x{`1.5.?`}', ['{{put:1.5.?}}']);

/* ---- 媒体类型嗅探（标准 3.21） ---- */
const SNIFF = [
  [[0x89, 0x50, 0x4e, 0x47], 'image', 'PNG'],
  [[0xff, 0xd8, 0xff, 0xe0], 'image', 'JPEG'],
  [[0x47, 0x49, 0x46, 0x38], 'image', 'GIF'],
  [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 'image', 'WEBP'],
  [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20], 'video', 'AVI'],
  [[0x1a, 0x45, 0xdf, 0xa3], 'video', 'WebM'],
  [[0x49, 0x44, 0x33, 0x03], 'audio', 'MP3(ID3)'],
  [[0xff, 0xfb, 0x90, 0x00], 'audio', 'MP3帧同步'],
  [[0x66, 0x4c, 0x61, 0x43], 'audio', 'FLAC'],
  [[0x4f, 0x67, 0x67, 0x53], 'audio', 'OggS'],
  [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 'audio', 'WAVE'],
  [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 'image', 'AVIF'],
  [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 'video', 'MP4'],
  [[0x3c, 0x73, 0x76, 0x67, 0x20], 'image', 'SVG'],
  [[0x00, 0x01, 0x02, 0x03], null, '未知']
];
SNIFF.forEach(function (c) {
  const got = MBMD.sniff(new Uint8Array(c[0]));
  if (got === c[1]) pass++;
  else { fail++; failures.push({ name: '嗅探 ' + c[2], src: c[2], missing: ['期望 ' + c[1] + '，得到 ' + got], html: '' }); }
});

/* ---- 运行 ---- */
for (const c of cases) {
  const host = render(c.src);
  const html = host.innerHTML;
  const missing = c.checks.filter((s) => html.indexOf(s) < 0);
  if (missing.length) {
    fail++;
    failures.push({ name: c.name, src: c.src, missing, html });
  } else pass++;
}

/* 真实文章渲染 */
const fixture = path.join(__dirname, 'fixtures', 'post1.mbmd');
let articleHtml = '';
if (fs.existsSync(fixture)) {
  articleHtml = render(fs.readFileSync(fixture, 'utf8')).innerHTML;
  fs.writeFileSync(path.join(__dirname, 'out-article.html'), articleHtml);
}

console.log('通过 ' + pass + ' / 失败 ' + fail);
failures.forEach((f) => {
  console.log('\n✗ ' + f.name + '\n  源: ' + JSON.stringify(f.src) + '\n  缺少: ' + JSON.stringify(f.missing) + '\n  实际: ' + f.html.slice(0, 500));
});
if (!failures.length) {
  console.log('全部通过 ✓');
  fs.writeFileSync(path.join(__dirname, 'out-cases.html'), cases.map(c => '<h3>' + c.name + '</h3>' + render(c.src).innerHTML).join('\n'));
}
