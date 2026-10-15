# mdBook + GitHub Pages 管道调研

label: wayfinder:research
status: open
blocked-by: （无）
claimed-by: （待领）

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
