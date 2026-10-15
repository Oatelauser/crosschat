# mdBook + GitHub Pages 管道调研（book 图票 001）

- 调研日期：2026-10-15。所有版本号当日经 GitHub Releases API 逐一核实，非记忆值；查不到的一律注明「未能核实」。
- 分层：先「事实」（带来源链接与版本号），后「推荐」（定案权在 004 落地票，本报告不定案）。
- 仓库语境：Oatelauser/crosschat，已有 ci/publish 两管线，deploy-book 纯增量；源文件住 `/docs-book`（map.md 已拍板）。

## 一、事实

### 1. Actions 里装 mdBook 的可靠方式

mdBook 本体最新版为 **v0.5.4**（2026-07-06 发布，[releases](https://github.com/rust-lang/mdBook/releases/tag/v0.5.4)）；0.4 线终于 v0.4.52。注意 0.5.0 是**大版本重构**（拆 crate、预处理期/渲染器接口破坏性变更、HTML 渲染管线重写），详见 [CHANGELOG](https://github.com/rust-lang/mdBook/blob/master/CHANGELOG.md)。

官方指南（[mdBook guide: Continuous integration](https://rust-lang.github.io/mdBook/continuous-integration.html)，源文件 `guide/src/continuous-integration.md`@master）给出两条官方路线：

1. **curl 下载预编译二进制**（官方称"perhaps the easiest method"）：免 Rust、免缓存，URL 里版本天然钉死；缺点是换版要手改脚本。
2. **cargo install 自建**：`cargo install mdbook --no-default-features --features search --vers "^0.5" --locked`（官方推荐参数：`--no-default-features` 去掉 serve 的 HTTP server 提速，`--locked` 用发布时锁定的依赖）。需要 Rust 工具链与缓存；官方明言"building mdBook can be somewhat slow"。若走此路，装 Rust 用 [dtolnay/rust-toolchain](https://github.com/dtolnay/rust-toolchain)（浮动 tag `v1`/`stable`，该 tag 自 2022 年起就是滚动更新语义，不钉具体版本）。

社区 action 路线：**[peaceiris/actions-mdbook](https://github.com/peaceiris/actions-mdbook)**，最新 tag **v2.0.0**（2024-04-08 发布）。它本质上就是路线 1 的封装：下载 rust-lang/mdBook 的 GitHub Releases 预编译二进制，支持 `mdbook-version: '0.5.4'` 精确钉版或 `'latest'`（经 Homebrew formula 页解析最新版号）。仓库仍在维护（最后提交 2026-05-11 "build: update Node runtime and dependencies"，[commits](https://github.com/peaceiris/actions-mdbook/commits/main)），但 README 示例已陈旧（仍写 `@v1`、ubuntu-20.04、actions-gh-pages v3），且未发新 tag——用 `@v2.0.0` 引用即可。

### 2. 部署路线现状：官方 artifact 路线 vs gh-pages 分支推送

**官方 artifact 路线**的三件套与当前版本（全部当日核实）：

| action | 最新版 | 发布日期 |
|---|---|---|
| [actions/checkout](https://github.com/actions/checkout/releases) | v7.0.1 | 2026-07-20 |
| [actions/configure-pages](https://github.com/actions/configure-pages/releases) | v6.0.0 | 2026-03-25 |
| [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact/releases) | v5.0.0 | 2026-04-10 |
| [actions/deploy-pages](https://github.com/actions/deploy-pages/releases) | v5.0.1 | 2026-09-01 |

**gh-pages 分支推送路线**的社区标配是 [peaceiris/actions-gh-pages](https://github.com/peaceiris/actions-gh-pages)，最新 **v4.1.0**（2026-05-12）。

2026 年哪种是默认推荐——证据链：

- GitHub 官方博客 2022-08-10 [GitHub Pages now uses Actions by default](https://github.blog/2022-08-10-github-pages-now-uses-actions-by-default/)：所有 Pages 站点改由 GitHub Actions 构建部署，部署以 deployment 追踪（默认 environment 名 `github-pages`），"a source branch is not required anymore"。
- GitHub 官方文档 [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)（2026 现行版）：publishing source 二选一——"Deploy from a branch" 或 "GitHub Actions"；自定义工作流通用流程就是 checkout → 构建 → `upload-pages-artifact` → `deploy-pages`。即使选分支源，底层也是 GitHub 内置的 pages workflow 在部署。
- peaceiris/actions-gh-pages 的 README 自己在置顶注记 "**See also the GitHub official GitHub Pages Action first**" 并链接上述官方博客——作者本人都把官方路线排在前面。

两条路线的 Settings 前提与手点步骤：

- **官方 artifact 路线**：仓库 Settings → Pages → Build and deployment → **Source 选 "GitHub Actions"**（用户手点一次，选保存即生效）。之后 `deploy-pages` 自动完成部署，无需分支、无需 PAT。
- **gh-pages 分支路线**：Source 需选 "Deploy from a branch" 并指定分支；且 actions-gh-pages README「First Deployment with `GITHUB_TOKEN`」一节明确：**首次部署会因 GITHUB_TOKEN 权限受限而失败，需手动去 Settings 页选定 Pages 分支后再跑第二次**；workflow 还需显式 `permissions: contents: write`（[README 原文](https://github.com/peaceiris/actions-gh-pages#%EF%B8%8F-first-deployment-with-github_token)）。多一次"首败-手点-重跑"的仪式。

### 3. book.toml 关键项（中文书）

来源：官方指南 [General configuration](https://rust-lang.github.io/mdBook/format/configuration/general.html) 与 [HTML renderer options](https://rust-lang.github.io/mdBook/format/configuration/renderers.html)（master 树）。

- `[book]`：`title`（书名，中文直接写）、`authors`、`description`（进每页 `<head>` meta）、`language = "zh"`（生成 `<html lang="zh">`，并用于推导文字方向 LTR/RTL）、`text-direction`、`src`（默认 `src`）、`logo`。0.5.0 已移除从未生效的 `book.multilingual`。
- `[build]`：`build-dir`（默认 `book`）；`create-missing`（默认 `true`——SUMMARY.md 引用不存在的文件会**自动建空页**，防断链应设 `false` 让它直接报错）。
- `[output.html]`：`theme`（整体换肤目录）、`default-theme`/`preferred-dark-theme`（内置 light/rust/coal/navy/ayu）、`site-url`（**项目页必须设**，如 `"/crosschat/"`，否则 404 页与静态资源路径错）、`cname`（自定义域名时写 CNAME）、`git-repository-url`、`edit-url-template`（"Suggest an edit" 按钮）、`additional-css`/`additional-js`（小修样式/行为而不换主题）。
- 0.5.0 起的配置纪律：**未知字段直接报错**（0.4 是忽略）；`smart-punctuation` 默认 `true`（引号/省略号/破折号自动排版——中文书建议先体验再决定是否关）。

### 4. 中文体验

**内置搜索的中文分词现状：不支持。** 搜索基于 elasticlunr（构建期 [elasticlunr-rs](https://github.com/mattico/elasticlunr-rs) 生成索引，浏览器端 elasticlunr.js 检索），按空白分词，无 CJK 分词器。证据：

- [rust-lang/mdBook#1081](https://github.com/rust-lang/mdBook/issues/1081) "Search does not support non-English languages"——2019 年开，**至今 open**；2024-04 评论实测确认构建索引"completely ignore language settings in book.toml"，只能靠覆盖 `searcher.js` + lunr-languages 魔改。
- [rust-lang/mdBook#2052](https://github.com/rust-lang/mdBook/issues/2052) "Support CJK (mutiple language) search"——**open**（标签 C-enhancement/A-Search）。
- 社区 fork（switefaster/mdBook，jieba-wasm 方案）与 PR #1496 均未被上游接受/停滞。0.5.x 全部 changelog 无搜索分词改动。

实际效果：中文**连续子串/整句**恰落在分词边界时可命中；按单词搜不可靠。现成补救都是重活：换 Algolia DocSearch（外部服务，`head.hbs` 注入）或装 fork（破坏可维护性）。

**侧边栏/目录增强**：mdBook **0.5.0 已内置 sidebar heading navigation**（[PR #2822](https://github.com/rust-lang/mdBook/pull/2822)，配置项 `output.html.sidebar-header-nav`，默认 `true`）——左栏直接显示当前页各级标题，pagetoc 的主诉求已被官方覆盖。第三方现状：

| 方案 | stars | 最后实质提交 | 与 0.5 兼容性 |
|---|---|---|---|
| [JorelAli/mdBook-pagetoc](https://github.com/JorelAli/mdBook-pagetoc)（右侧浮动页内 TOC） | 105 | 2025-09-04 | 靠覆盖 index.hbs/CSS/JS；0.5.0 重写 HTML 渲染管线且内部 HTML ID 全部加 `mdbook-` 前缀，旧模板覆盖大概率要改 |
| [slowsage/mdbook-pagetoc](https://github.com/slowsage/mdbook-pagetoc) | 50 | 2022 年 | pre-0.5，停更 |
| [zjp-CN/mdbook-theme](https://github.com/zjp-CN/mdbook-theme)（pagetoc+主题，v0.1.6） | 55 | 2025-01-01 | pre-0.5 时代 |

### 5. {{#include}} 与多文件组织（简述）

来源：官方指南 [mdBook-specific features](https://rust-lang.github.io/mdBook/format/mdbook.html)。能力：`{{#include file}}`（路径相对当前源文件）、行号片段四种写法（`:2`/`::10`/`:2:`/`:2:10`）、`ANCHOR: name` … `ANCHOR_END: name` 锚点片段（改文件不致断）、`{{#rustdoc_include}}`（折叠显示+rustdoc 完整测试）、`{{#title}}` 覆盖页标题；目录结构由 `SUMMARY.md` 树定义（支持 draft 章与分组标题）。能力足够，但本图已拍「书为唯一真源」——**不用于嵌 repo 现有文档**，仅作章节内拆小文件之用。

### 6. 断链与构建检查

- `mdbook build` 自带的检查：SUMMARY.md 引用缺文件（配 `create-missing = false` 后）报错；`{{#include}}` 路径不存在报错；0.5.0 起未知配置字段报错。**书内 markdown 断链 build 不查**——官方 CI 指南把链接检查列为"你可能想额外跑的其他测试"。
- 断链检查的官方推荐：**[mdbook-linkcheck2](https://github.com/marxin/mdbook-linkcheck2)**，最新 **v0.13.0**（2026-08-16）。mdBook 0.5.4 changelog 明确"Switched recommendation to linkcheck2 fork"（它是 Michael-F-Bryan/mdbook-linkcheck 的后继）。用法：`cargo install mdbook-linkcheck2`，`book.toml` 加 `[output.linkcheck2]` 表，`warning-policy = "error"` 让断链直接 fail build；`follow-web-links = false` 只查本地链接（避免外网抖动挂 CI），`exclude` 正则可豁免。**注意**：多 `[output]` 表并存时 HTML 会挪进 `book/html/` 子目录——部署上传路径要跟着改（或 CI 里单独跑一次带 linkcheck 的构建、部署仍用纯 HTML 构建）。
- `mdbook test`：跑书内 **Rust 代码块**的 doctest（需 Rust 工具链，[cli/test 文档](https://rust-lang.github.io/mdBook/cli/test.html)）。本书以 shell/命令实录为主，基本用不上。
- CI 集成做法：官方 CI 指南的建议组合就是 `mdbook build`（+ linkcheck2 一类检查）+ 部署；404 页由 mdBook 自动生成（`site-url` 设对才工作，见官方指南 404 handling 节）。

### 7. 对照本仓库副本 docs/embassy-main/.github/workflows/pages.yml

它走**官方 artifact 路线**，且是教科书式结构：`actions/checkout` v7.0.1（SHA 钉）→ `actions/upload-pages-artifact` v4（SHA 钉，直接上传仓库里的 `site/` 目录）→ `actions/configure-pages` v5（SHA 钉）→ `actions/deploy-pages` v4（SHA 钉）；build/deploy 双 job，deploy job 专属 `permissions: pages: write + id-token: write` 与 `environment: github-pages`；`concurrency: group=pages, cancel-in-progress=false`；仅 main + `paths` 过滤 `site/**`；`persist-credentials: false`。

与主流的差异两点：①它**不做任何构建**——embassy 的站点是手写静态目录，上传即部署；我们要在 build job 里多一步装 mdBook + `mdbook build`。②action 版本落后一拍（upload v4/configure v5/deploy v4，对照 2026-10 最新为 v5.0.0/v6.0.0/v5.0.1）；checkout v7.0.1 恰是最新。结构本身与 GitHub 官方自定义工作流文档完全同构，照抄骨架、换版本、插构建步骤即可。

## 二、推荐（供 004 定案参考）

1. **装法**：`peaceiris/actions-mdbook@v2.0.0` + `mdbook-version: '0.5.4'`——预编译二进制、免 Rust、免缓存、action 与 mdBook 双钉版。若想零第三方依赖，备选官方 curl 法（一行管道解压，版本在 URL 里自钉）。不建议 cargo install（要 Rust+缓存，慢）。
2. **路线**：官方 artifact 路线（configure-pages v6.0.0 + upload-pages-artifact v5.0.0 + deploy-pages v5.0.1，checkout v7.0.1，均可再 SHA 钉）。依据：官方文档+官方博客定位、peaceiris 自家 README 亦让位、embassy 副本同路线可对照。用户唯一手点步骤：Settings → Pages → Source 选 "GitHub Actions"。
3. **book.toml 起步**（最小可用）：`[book] title=<中文书名> authors=[...] language="zh"`；`[build] create-missing=false`；`[output.html] site-url="/crosschat/" git-repository-url=<repo>`；搜索节保持默认开。主题先用内置（default-theme 可选 light/navy），皮肤问题按 map.md 约定等用户在意再入票。
4. **中文搜索**：接受内置搜索的整词/整句局限，不引入第三方或 fork（零回归铁律+维护性）。侧边栏体验直接吃 0.5.0 内置 `sidebar-header-nav` 红利，不装 pagetoc 类。日后用户在意搜索质量，再单独入票评估 Algolia DocSearch。
5. **include**：不嵌 repo 旧文档（已拍板），章节内部拆小文件用 `{{#include}}` + ANCHOR 锚点足够。
6. **检查**：`create-missing=false` + mdbook-linkcheck2 v0.13.0（`warning-policy="error"`、`follow-web-links=false` 只查本地链），在 CI 的 build job 里随 `mdbook build` 一起跑，断链 fail build 挡在部署前；`mdbook test` 不开。linkcheck2 会让 HTML 挪进 `book/html/`——部署与检查要么分两次构建，要么上传路径写 `book/html`。
7. **workflow 骨架**：抄 embassy pages.yml 结构（双 job、SHA 钉、专用 permissions、concurrency group=pages、main+paths 过滤 `docs-book/**` 与 workflow 自身），换 2026-10 最新 action 版本，插入 mdbook 安装+构建两步，upload 的 path 指向构建产物。全新文件 `.github/workflows/deploy-book.yml`，与既有 ci/publish 管线零交集。

## 附：本报告的版本核实清单（2026-10-15，GitHub Releases API）

mdBook v0.5.4（2026-07-06）｜peaceiris/actions-mdbook v2.0.0（2024-04-08，仓库最后提交 2026-05-11）｜peaceiris/actions-gh-pages v4.1.0（2026-05-12）｜actions/checkout v7.0.1（2026-07-20）｜actions/configure-pages v6.0.0（2026-03-25）｜actions/upload-pages-artifact v5.0.0（2026-04-10）｜actions/deploy-pages v5.0.1（2026-09-01）｜marxin/mdbook-linkcheck2 v0.13.0（2026-08-16）｜dtolnay/rust-toolchain 浮动 tag v1（不钉具体版本）
