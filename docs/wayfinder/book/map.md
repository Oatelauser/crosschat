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
- 参考件：`docs/embassy-main/.github/workflows/pages.yml`（embassy 本地副本的 Pages 管线，001 的对照物）。
- 技能：按票型调用 research / grilling(+domain-modeling) / prototype / task。
- Tracker 约定（本地 markdown，同产品图）：claim = 把票的 `claimed-by` 改成自己；blocking 用 `blocked-by` 字段；解决 = 在票文件末尾追加 `## Resolution` 一节并把 `status` 改为 `closed`，然后在下方 Decisions so far 加一行。编号独立于产品图（本图自有 001 起）。

## Decisions so far

（空——制图会话不开票）

## Not yet specified

- README 瘦身形态与旧文档删除时点——等目录与首章成型后再钉
- 书名/主题皮肤（中文搜索、侧边栏体验）——001 出结论、002 定目录后，如用户在意再入票
- drill-reports 实战素材是否入书（教学主线成型后再评估）

## Out of scope

- 章节正文写作执行——图外「一文件一验收」渐进共创（用户 Step 3 流程）
- 英文版、PDF 导出、评论/统计、版本快照机制（活文档已拍）、自定义域名
- 「删旧文档」不含 docs/wayfinder、docs/research、docs/drill-reports、docs/embassy-main——过程资产不动
