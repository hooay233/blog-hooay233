# Hooay 的博客

一个跑在 **Cloudflare Pages** 上的纯静态博客，文章存放在 Cloudflare R2，通过公开只读 API 取回，
正文用自己写的 **MarkBottom（`.mbmd`）解释器** 在浏览器里实时解析成 DOM。

- 站点风格参考：[www.hooay233.top](https://www.hooay233.top/)（浅灰底 + 白卡片 + 粉色主色 + 明暗主题切换）
- 文章地址：`/post/view?id=YYYYMMDD_X`
- 列表页支持标题/简介模糊搜索、标签筛选、排序、分页
- 适配手机（导航栏折行、表格横向滚动、正文缩放、浮动图片归中）

## 目录结构

```
index.html               首页（导航 + 站长简介 + 搜索 + 文章列表 + 分页）
about.html               关于页
post/view.html           文章页（/post/view?id=… 由 _redirects 重写到这个文件）
css/site.css             站点外壳样式：导航、卡片、按钮、表单、明暗主题、响应式、文章页
css/mb.css               MarkBottom 必需样式（标准 §1/§1.1）+ 文章排版
css/all.min.css          Font Awesome 5 图标字体
fonts/                   Ubuntu / GWMSansUI / HYYuYuanLuoShenXing / UbuntuMono + FA 图标字体
js/theme.js              明暗主题（逐元素 dark_style + clip-path 扫描线转场）
js/api.js                Blog Public API 客户端（列表 / 元信息 / 正文 / 附件地址解析）
js/site.js               首页：列表、搜索、标签、排序、分页
js/mb-core.js            MarkBottom 解释器①：工具、表达式求值、内容语句
js/mb-inline.js          MarkBottom 解释器②：行内语法
js/mb-block.js           MarkBottom 解释器③：块级结构 + 运行时（data-mb、折叠、媒体嗅探、公式）
js/post.js               文章页：文章信息、目录、附件、上下篇
dev-server.js            本地预览服务器（干净 URL；不参与部署）
functions/_middleware.js Pages Functions：给首页/文章页补 SEO 与社交预览 meta
functions/robots.txt.js  动态 robots.txt（按访问域名生成 sitemap 地址）
functions/sitemap.xml.js 动态 sitemap.xml（把 API 里的文章全部列进去）
_redirects               /post/view -> /post/view.html（200 重写）
_headers                 缓存与预览域名 noindex
```

## 本地预览

```bash
node dev-server.js          # 默认 http://127.0.0.1:8788
node dev-server.js 9000     # 换端口
```

服务器会打印局域网地址，手机连同一个 Wi-Fi 就能直接打开验收移动端。

> `python3 -m http.server` 也能看首页，但 `/post/view?id=…` 会 404 —— 干净 URL 是
> `dev-server.js` 和 Cloudflare Pages 的 `_redirects` 负责的。

## 部署到 Cloudflare Pages

1. 新建 Pages 项目，连到这个仓库。
2. **构建命令留空**，**输出目录填 `/`**（纯静态，没有构建步骤）。
3. `_redirects`、`_headers`、`functions/` 会被自动识别。

注意事项：

- 页面里用的是**根路径**（`/css/site.css`、`/post/view?id=…`），所以站点必须部署在**域名根**上
  （例如 `blog.example.com`）。要部署到子目录得把这些绝对路径改成相对路径。
- `robots.txt` 里的 sitemap 域名是占位符，按自己的域名改一下；生产环境实际上由
  `functions/robots.txt.js` 动态生成，会自动用真实域名。
- 首页/文章页的 SEO 与 OG 标签由 `functions/_middleware.js` 注入（文章页会实时去 API 取
  标题、简介、关键词）。本地静态预览不跑 Functions，所以本地看不到这些标签是正常的。

## 文章数据从哪来

公开只读 API：`https://blog-api.hooay233.top`

| 用途 | 请求 |
|---|---|
| 文章列表 | `GET /api/posts?limit=&offset=&keyword=&q=&sort=newest\|oldest` |
| 元信息 | `GET /api/posts/{id}/meta.json` |
| 正文原文 | `GET /api/posts/{id}`（`text/markbottom`，成功返回会让浏览量 +1） |
| 附件 | `GET /api/posts/{id}/{filename}`（支持 Range / ETag） |

发布、修改、删除属于外部管理接口（需要动态口令），不在前端范围内。

正文里的相对地址会按附件文件名解析：`![img](./img1.png)` 先找 `img1.png`，找不到就找同名的
其它后缀（例如实际存在的 `img1.webp`），所以正文里的图片一般不用改。

## MarkBottom 解释器

标准：`MarkBottom 0.1 版本标准`（本机仓库 `gitrepos/markbottom`）。
和「把 `.mbmd` 编译成静态 HTML」的转换器不同，这里是**运行期解释器**：直接把 `.mbmd` 解析成
DOM 节点，交互语句（按钮、输入框、变量、计算、折叠、媒体类型探测、公式）都在浏览器里即时执行。

已实现：

- md 基础：标题、粗体、斜体、下划线（`_x_`）、删除线、行内代码、围栏代码块、链接、图片、
  有序/无序/任务列表、引用、分隔线、表格、脚注、双空格换行
- ruby text（`【基字|上标/下标】` / `[( … )]`，含全角写法、嵌套 ruby、着重号）
- 变大缩小、上标下标、灰色/注解/涂黑、五种上色、折叠块（`<details>` 与 checkbox 三段式）、
  分离式折叠块（折叠表格行 / 列表项）
- 按钮式连接、按钮、输入框、多行输入框、选择框、标签
- 转义符、原始转义符、原始文本、略过解析次数、竖排/横排
- 表格扩充：延续符 `[+]` / `[+>]`、斜线单元格 `%( … / … )%`（含多段扇形线）、侧边表头 `||`
- 功能语句：`{#id.class}`、`{|:---:|}` 等排版调整、`{{put}}`/`{{trigger}}`/`{{call}}`/`{{use}}`/
  `{{t}}`/`{{rplc}}`/`{{quote}}`、计算语句、`$变量$`、图表（bar / line / pie / table）、
  `((无障碍标签))`
- 媒体：先按图片输出，再按**文件头魔数**（Range 只取 64 字节）判断是视频还是音频并替换元素
- 公式：文档里出现公式时才加载 KaTeX；加载失败就按原文显示

### 与标准的已知差异

1. `put` 插入的文本会**完整地再做一遍 mb 解析**，但不会和相邻的已有文本节点合并成一段新文本
   （标准 3.9.3 规则 6 的后半句）。实际用途（插入文字、插入标记）不受影响。
2. 音频封面（MP3 的 `APIC`、FLAC 的 `PICTURE` 等）没有解析，`<audio>` 直接输出。
3. `{|:---:|}` 按标准 §3.9.4 ① 的表格实现为**居中**；标准 §3.9.4 正文里
   「这一行右对齐{|:---:|}」的示例把它当成右对齐 —— 标准自身矛盾，这里以表格（正式定义）为准。
4. `{{quote:"…"}}` 统一在运行期取回并解析（标准里的编译期展开对运行期解释器不适用），
   内容取回后按普通 mb 文本接着解析。
5. 不解析原始 HTML（正文里的 `<div>` 之类会按文本转义显示），避免文章里塞进任意脚本。
6. `{/`=n}` 只作用于紧随其后的代码段 / 原始文本，作用范围与标准一致。
7. **代码里的反斜杠原样保留**（行内代码段与围栏代码块都不当转义符），否则正则、Windows 路径、
   表格里 `\|` 这类内容会被转义规则破坏。正文（非代码）里 `\X` 仍然是转义符。

## 字体

| 用途 | 文件 | 家族 |
|---|---|---|
| 西文正/粗/斜/粗斜 | `Ubuntu-R/B/RI/BI.ttf` | `Ubuntu` |
| 中文正/粗 | `GWMSansUI-Regular/Bold.woff` | `GWMSansUI` |
| 中文斜/粗斜 | `HYYuYuanLuoShenXing-45U/65U.ttf` | `HYYuYuanLuoShenXing` |
| 等宽 | `UbuntuMono-R/B/RI/BI.ttf` | `UbuntuMono` |

正文栈 `Ubuntu, GWMSansUI, …`；斜体元素（`em`/`i`/`blockquote`…）用
`Ubuntu, HYYuYuanLuoShenXing, GWMSansUI, …`，浏览器逐字符回退：西文命中 Ubuntu 真斜体，
汉字命中 HYY 真斜体，HYY 缺字时回退 GWMSansUI 正体并由浏览器合成斜体。

> 中文字体没有做 subset，`GWMSansUI-*.woff` 每个约 5MB、HYY 每个约 6MB。功能没问题
> （`font-display: swap` 不阻塞渲染），介意流量的话可以用 `pyftsubset` 切常用字集。

## 许可

站点代码沿用仓库原有 MIT LICENSE；字体（Ubuntu、更纱黑体系 GWMSansUI、汉仪玉圆罗宋星、
Font Awesome）版权归各自作者，使用请遵守其许可。

## 自测

仓库里带了两套用 [jsdom](https://github.com/jsdom/jsdom) 跑的测试，改解释器之后可以直接验证：

```bash
npm i jsdom                 # 只需要这一个依赖（装在仓库根即可）
node tools/mbmd-selfcheck.js   # 113 条：标准里各种语法 -> 预期 DOM 结构、表达式求值、媒体魔数嗅探
node dev-server.js &           # 端到端测试需要一个在跑的服务器（默认 8788）
node tools/site-e2e.js         # 38 条：真跑首页/文章页的 JS，检查列表、搜索、目录、折叠、按钮交互、404
```

`tools/fixtures/post1.mbmd` 是一篇把标准里几乎所有语法都用了一遍的样张（也是 API 上那篇测试文章的快照）。
