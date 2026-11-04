# C08-I01-R1：新上下文执行包

2026-10-29（UTC+8）。你是 Claude 执行会话 **cworker1**，派单/审查方是 Codex Desktop 会话 **多工具适配**。用户已清空你的聊天上下文，本任务书不要求记得旧聊天。你只执行这一单，报告后停写；下一单由 root 发，不自行认领。

## 授权与当前结果

用户要求 root 持续派单、独立验收，直到用户喊停或必须拍板；新增非skill功能文件或用户必需操作要先讨论。用户已明确“skill可以新增，这个不影响”，所以 Harness 默认技能安装/覆盖更新及相应卸载已获允许，不重复审批。

C08-I01 已交付 RED `fdde712`、GREEN `f6fbaf1`、证据 `9df42ba`；统一 Claude→Codex→Harness 技能计划、默认/自定义 DSH_HOME、--dir/TUI隔离、匹配卸载已接通。worker完整检查2537通过/11原有跳过（max2/min1），root六套件64通过；独立审查发现下列三个缺陷，**尚未验收**。不要从零重做、安装工具或改通信代码。

## 必读与仓库

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`。基线为 root 派发本单时的明确 SHA。读取顺序：AGENTS.md、`docs/development/code-standards.md`、本文件、[本轮审查](I01-review.md)、相关实现/测试；需要首轮合同细节再读 [I01-task](I01-task.md) 与 review-input，不必加载整批历史。

开始/结束核对 branch、真实HEAD及dirty。基线若仅因他方无关文件推进，核对祖先与本单白名单未变后继续，报告真实父提交。禁止 checkout/pull/reset/clean/stash/amend/push，不回退共享文件归责，不夹带他方index。原未跟踪 `docs/代码消息投递.md` 不动、不stage。

## 固定通信入口（清空上下文后仍适用）

本协作只用仓库 `node dist/cli.js`。**不要用 Claude 的 ListAgents/SendMessage 判断或联系 Codex Desktop**；它们此前只看见 Claude 会话，曾导致交付未回报，并非 crosschat 链路失败。使用前读仓库 `skills/crosschat/SKILL.md` 及对应 `references/reply.md` / `errors.md`，不照搬全局安装旧skill的旧柄格式。

回信优先完整照本次来信的程序生成 hint，保留 `--conversation` 与 `--tool`，通过 stdin 发正文并显式 `--delivery steer`。入口使用双方已约定的仓库node入口，不删除tool。只有短柄明确报未知/过期，才读一次 `node dist/cli.js status --codex --name 多工具适配 --json` 核实原桌面会话唯一，再用 `send --to 多工具适配 --tool codex-desktop --delivery steer` 接续；别猜cXXX。queued/parked/uncertain不盲目重发，不轮询或互相发纯确认。

root发信使用PowerShell，你的实际shell可能是bash；先核对自己的shell，不把PowerShell here-string标记写进Git消息或命令。单行commit可直接用正确引号的 `-m`，不要再把 `@` 加进message。不amend已有缺陷消息。

## 白名单

仅以下既有文件：

- `src/application/maintenance/operations.ts`：外部目标根/祖先验证。
- `src/application/maintenance/skills.ts`：同一Windows路径去重。
- `src/cli.ts`：install-skills/uninstall现有help范围；不改发送/来源/原生通道。
- `test/install-skills.test.ts`、`test/maintenance.test.ts`、`test/maintenance-boundaries.test.ts`、`test/cli-args.test.ts`：必要反例/回归，不镜像实现或加新skip。
- 本目录 `I01-review-input.md`：订正首轮根/祖先保证与RED证据口径，追加R1执行证据。

可新增本目录 `I01-R1-check.txt` 留完整检查日志。其它代码/测试/技能/包/指南/root审查/任务/总表/调度/旧check与用户文档不动。不得新增helper、源码文件、依赖、参数或账本；确需新路径先具体报告理由。

## 三项修复

1. **外部根及祖先不可跳过。** 当前 `verifySkillTarget` 从 `target.root` 开始，`verifyDirectoryPath` 没有lstat根自己，故外部DSH_HOME本身或祖先为junction/symlink时预览仍enabled。补足该明确根与必要祖先检查；保持删除授权只限当前计划的 `skills/crosschat`，不要把文件系统根或整个DSH_HOME当删除范围。覆盖根链接、祖先链接、原skills/crosschat子链接，install/uninstall预览拒绝且execute不触发effects；合法外部home仍可用。跨平台fixture可使用真实系统临时根，避免OS临时目录别名造成环境噪声，不能通过skip/降低链接边界过关。
2. **同一路径去重。** Windows `.claude` 与 `.CLAUDE`可指向同一目录，当前仅resolve字符串仍返回两个副本。按实际平台目录语义/已核实身份去重，不给POSIX不同大小写目录误去重；计划、安装和卸载保留一致标签/顺序。新增有行为意义反例，证明同一目录只计划/处理一次；保留原相同字符串去重与默认三目标。
3. **现有help准确。** 更新CLI现有install-skills、uninstall说明为Claude/Codex/Harness，写清默认Harness home/DSH_HOME和--dir隔离根的实际范围；不增参数/必需操作，不教自动桥管理。不能只更新注释或指南而保留可执行help旧范围。

不扩查其它权限/安全策略，不改原顺序覆盖/首错停止/不清额外旧文件、serve保护、确认、npm收尾或普通clean规则。用户skill/chat/config不触碰；不实际运行用户install/uninstall，不安装/启停原生工具、daemon、模型或远端，不试发。

## 验证与交付

先用新增真实业务反例执行RED并保存测试checkpoint，之后实现、同组GREEN并保存实现checkpoint；明确失败是根链接/重复计划/帮助范围，而非依赖字段迁移崩溃。原卸载RED只因接口字段改名TypeError，订正为证据限制，不改写原日志或虚称已证业务缺陷。

只提交本单显式路径，`git commit --only -- <paths>`，新日志先单独add；在本分支保留RED/GREEN，不squash/amend。定向install/uninstall/maintenance/maintenance-boundaries/tui-composition/tui-maintenance及相关lint/build；产品变动后最终一次完整 `npm run check`，环境 `VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`。完整stdout/stderr与真实退出码保存新日志，首败保留，不用tail/过滤摘要替代，不靠重跑抹首败。无固定覆盖率/新增数指标，不加工具依赖。

fixture全部为本次独占临时目录，删除前核对解析后的绝对根和归属，只清自己的资源。报告真实基线/父提交/RED/GREEN/结果/文件/未测/清理，按当前hint回root，完成停写。C08父项和真实Harness技能加载/正式Desktop/三平台CI仍不算完成。
