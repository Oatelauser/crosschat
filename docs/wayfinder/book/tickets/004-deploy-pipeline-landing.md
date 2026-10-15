# 部署管道落地（空书上线）

label: wayfinder:task
status: open
blocked-by: 001（管道选型依据）、002（SUMMARY.md 定稿才配脚手架）
claimed-by: （待领）

## Question

空书上线：docs-book 脚手架 + 自动部署管道打通。

- `docs-book/book.toml`（按 001 结论配中文/主题）+ `docs-book/src/SUMMARY.md`（002 定稿版）+ 首页欢迎页（书名一句话 + 「书还在写」告示）
- `.github/workflows/deploy-book.yml`：按 001 拍板的路线（artifact vs gh-pages）写，触发=push main
- 推 main、Actions 绿灯、Pages 在线可打开、目录可点、断链检查绿
- 人工一步属用户：repo Settings → Pages → Source 翻到对应源（票面给一句口令，其余全自动）

本票是本图唯一执行票（站定性：目的地含管道落地）。书内容一章不写。

## 预算与停止条件

- 规模 S：脚手架三文件 + 一条 workflow + 一次绿灯验证。
- 停止条件：在线 URL 用户亲眼打开确认；mdbook build 零警告；不触碰 ci/publish 两管线。
