# mdBook + GitHub Pages 管道调研

label: wayfinder:research
status: closed
blocked-by: （无）
claimed-by: research-subagent

## Question

本仓库（Oatelauser/crosschat，已有 ci/publish 两管线）在 GitHub Pages 上自动构建 mdBook 的现行最佳管道是什么？

1. Actions 里装 mdBook 的可靠方式：rust-toolchain 自建 vs 社区 action（peaceiris/actions-mdbook 等），给具体 action 与钉死的版本/tag
2. 部署路线二选一的现状依据：官方 artifact 路线（configure-pages + upload-pages-artifact + deploy-pages）vs gh-pages 分支推送路线——2026 年哪种是默认推荐，各自 Settings 前提（Source 怎么设、用户需手点哪一步）
3. book.toml 关键项：中文书名/作者/语言、输出与主题
4. 中文体验：mdBook 内置搜索的中文分词现状；侧边栏/目录增强（pagetoc 类）现成方案与引入成本
5. {{#include}} 与多文件组织能力（简述即可——已拍「书为唯一真源」，不嵌 repo 文档）
6. 断链与构建检查：mdbook build 警告、mdbook test、CI 集成做法
7. 对照本仓库副本 `docs/embassy-main/.github/workflows/pages.yml`：它走哪条路线、与主流差异

要求：结论全部带来源链接与版本号；分「事实」与「推荐」两层写。

## 预算与停止条件

- 半小时调研量级；只报事实与推荐，不定案（定案权在 004 落地票）。
- 产出：`docs/wayfinder/book/research/mdbook-pipeline.md`（research/book-mdbook 一次性分支）；Resolution 记要点 gist + 分支指针。

## Resolution

调研完成（2026-10-15，全部版本号当日 GitHub Releases API 核实），完整报告在 `research/book-mdbook` 分支 `docs/wayfinder/book/research/mdbook-pipeline.md`（commit 427b535）。要点 gist：

1. **装法**：`peaceiris/actions-mdbook@v2.0.0` + `mdbook-version: '0.5.4'`（预编译二进制、免 Rust、双钉版）；备选官方 curl 法；不建议 cargo 自建。
2. **路线**：官方 artifact 路线是 2026 默认推荐（官方文档 + 2022 官方博客"Pages 默认 Actions 部署" + peaceiris README 自己让位）——configure-pages v6.0.0 + upload-pages-artifact v5.0.0 + deploy-pages v5.0.1 + checkout v7.0.1；用户唯一手点：Settings → Pages → Source 选 "GitHub Actions"。gh-pages 分支路线（actions-gh-pages v4.1.0）首次部署要"失败-手点-重跑"，不选。
3. **book.toml**：`title`/`authors`/`language="zh"`/`create-missing=false`/`site-url="/crosschat/"`；0.5.0 起未知字段报错。
4. **中文体验**：内置搜索无 CJK 分词（#1081/#2052 至今 open，无低成本解），接受整词局限；侧边栏标题导航 0.5.0 已内置（`sidebar-header-nav` 默认开），不引入 pagetoc 类第三方。
5. **include**：能力足够但按拍板不嵌 repo 旧文档，仅章节内拆文件用。
6. **检查**：`create-missing=false` + mdbook-linkcheck2 v0.13.0（`warning-policy="error"`、`follow-web-links=false`）随 CI build 跑，断链挡在部署前；注意多 output 时 HTML 挪 `book/html/`；`mdbook test`（Rust doctest）不开。
7. **embassy 对照**：其 pages.yml 即官方 artifact 路线（SHA 钉、双 job、专用 permissions、concurrency），差异仅"零构建直传静态目录"与 action 版本落后一拍——骨架可抄，换新版+插 mdbook build 两步。
