# Wayfinder Book Map：crosschat 在线书（mdBook / GitHub Pages）

label: wayfinder:map

## Destination

书开工前的一切拍板完毕 + 空书上线：①SUMMARY.md 完整目录经用户逐项拍板；②写作规范与样板章定调；③部署管道落地——docs-book 脚手架 + deploy-book.yml 推上 GitHub、Actions 绿灯、Pages 空书可在线打开。章节正文写作图外渐进共创，不入本图。

## Notes

- 2026-10-15 立图（制图 grilling：四目的地拍板 + 两轮追问）。
- 站定性约束（制图 grilling 已锁定，2026-10-15）：
  - **目的地含管道落地**：本图携带一项执行（落地票 004），除此之外仍只规划不实施
  - **读者=真零基础一体**：从装 Node → 装 Claude Code/Codex（账号/订阅墙给官方链接 + 最小验证命令）→ 装 crosschat → 同机第一条消息，一线教到底，安装链不折叠进附录
  - **书为唯一真源**：六份旧文档（README/usage/commands/architecture/broker/federation）只作重写参考素材，全量重造进书；旧 docs 即日起冻结不再投入，书成型后删除；README 保留、瘦身为指书入口
  - **活文档跟最新发布**：书教最新已发布 npm 版，随 main 推送自动重部署；无版本快照，CHANGELOG 不入书
- 技术栈：mdBook + GitHub Pages；源文件住 `/docs-book`，与业务代码隔离；仓库已有 ci/publish 两管线，deploy-book 纯增量（零回归铁律不破）。
- 写作规范（承用户题词 + 家规）：Diátaxis 四分流（Tutorial=五分钟无错闭环不讲原理 / How-To=「如何 XXX」Recipe / Reference=表格零废话 / Explanation=原理类比与图）；禁 AI 废话与主观最高级；代码块必指定语言 + 关键行中文注释；文字先行、完整命令实录；渐进揭示——前三章不塞底层细节（Vue/FastAPI 官方文档同款坡度）。
- 加规（2026-10-15 用户两条）：**emoji 角色标识**——对话与场景中机器人/用户等角色一看符号即辨（🤖/👤 类），全书统一词表随 003 定调；**图示优先**——一图胜千言，流程/架构/拓扑尽量用图不讲长文，命令实录仍走文字（复制可用优先）。
- 参考件：`docs/embassy-main/.github/workflows/pages.yml`（embassy 本地副本的 Pages 管线，001 的对照物）。
- 技能：按票型调用 research / grilling(+domain-modeling) / prototype / task。
- Tracker 约定（本地 markdown，同产品图）：claim = 把票的 `claimed-by` 改成自己；blocking 用 `blocked-by` 字段；解决 = 在票文件末尾追加 `## Resolution` 一节并把 `status` 改为 `closed`，然后在下方 Decisions so far 加一行。编号独立于产品图（本图自有 001 起）。

## Decisions so far

- [mdBook + GitHub Pages 管道调研](tickets/001-mdbook-pipeline-research.md): 装 mdBook 用 peaceiris/actions-mdbook@v2.0.0 钉 0.5.4；部署走官方 artifact 路线（configure-pages v6.0.0 / upload-pages-artifact v5.0.0 / deploy-pages v5.0.1，Settings→Pages→Source 手点选 GitHub Actions）；中文搜索无分词接受整词局限、侧边栏用 0.5.0 内置 header-nav；断链用 mdbook-linkcheck2 v0.13.0 挡在部署前（详见 research/book-mdbook 分支 docs/wayfinder/book/research/mdbook-pipeline.md）
- [书的完整目录拍板](tickets/002-book-toc-grilling.md): **v2.3 定稿（2026-10-16 七轮修订，取经三本样板书）**——三课主线（单机→ssh→tcp，命名溶解：-n//rename 入 1.4、extends/id8 入 3.5）+ 指南 8 条 + 参考 7 表（命令总表收全量命令细节）+ 原理 7 篇 + 附录 3 件；主次铁律「命令为主、效果就地讲」；tcp 课含命令一览与升级；净标题带编号、双题制；Windows 演示主线不变

## Not yet specified

- README 瘦身形态与旧文档删除时点——等目录与首章成型后再钉
- drill-reports 实战素材是否入书（教学主线成型后再评估）

## Out of scope

- 章节正文写作执行——图外「一文件一验收」渐进共创（用户 Step 3 流程）
- 英文版、PDF 导出、评论/统计、版本快照机制（活文档已拍）、自定义域名
- 「删旧文档」不含 docs/wayfinder、docs/research、docs/drill-reports、docs/embassy-main——过程资产不动
