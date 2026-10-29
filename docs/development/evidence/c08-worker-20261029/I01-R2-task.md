# C08-I01-R2：首次安装的同目录去重

2026-10-29（UTC+8）。执行会话 cworker1，root 为 Codex Desktop **多工具适配**。本单独立可读，不依赖旧聊天；只执行本单，报告后停写。

## 当前事实与授权

用户授权持续派单至喊停/必须拍板，并允许新增skill；当前实现使用现有命令统一 Claude/Codex/Harness 技能安装、覆盖更新与当前目标卸载。新增非skill功能文件/账本/参数/用户必需操作仍未获批。

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；派单基线以本次消息明确 SHA 为准。I01首交付 `9df42ba`，R1 RED `ede6ed3` / GREEN `b4d6a75`，完整2541/11、root七套件84通过。根/祖先链接与help已复审接受；本轮**只剩一个原合同未完成项**，不是新增需求。读 AGENTS.md、代码规范、本文件和 [R1复审](I01-R1-review.md)，再读相关源码/测试即可。

开始/结束核对branch/真实HEAD/dirty。共享无关提交推进只核对祖先与白名单后继续。不 checkout/pull/reset/clean/stash/amend/push，不回退他方文件归责，不夹带index；原未跟踪 `docs/代码消息投递.md` 不动。

## 缺陷与修复要求

Windows 新home还没有 `.claude`，设置 `DSH_HOME=<home>/.CLAUDE`：现有 `targetKey` 因缺失后缀保留拼写，`skillPlan` 返回三目标，首次安装复制同一目录两次；安装后inode一致，重算才变两项。代码中的shortcut是披露，不是批准的合同例外。

1. 修复**未创建目录**的同一Windows路径去重，计划与首次安装即只处理一次，不等第二次调用/安装完成。保留首现Claude标签与顺序；常规默认三目标、已存在同目录的身份去重不回退。
2. POSIX大小写不同目录不得误合并；已能核实为不同实例的目录不得仅因拼写类似被合并。不要为这处修复新建平台服务、原生探针、持久信息、框架或依赖。
3. 使用全新fixture补真实RED，断言安装前计划、安装返回/实际副本、对应TUI计划及匹配卸载目标不重复。不得先创建 `.claude/skills` 再声称覆盖首次安装；不能只把“现有目录”测试改名。
4. 证据收窄：订正上一轮“缺失路径只按拼写”的剩余限制已修或实际仍未支持，不把加注释当验收。R1 help用例可按两个命令段分别检查已有实际范围，提高辨别力；不追加无关文案测试或变更已通过help。

## 白名单与禁止范围

仅既有 `src/application/maintenance/skills.ts`、`test/install-skills.test.ts`、`test/maintenance.test.ts`、`test/cli-args.test.ts`（若收窄help用例）及本目录 `I01-review-input.md`。可新增 `I01-R2-check.txt` 留完整检查日志。其它代码/测试/指南/skill源/包/root任务审查总表调度/旧原始证据都不动；确需其它路径先报理由。

不改复制顺序、首错停止、不清额外旧文件、服务保护、确认、npm收尾、普通clean、DSH_HOME与--dir/TUI隔离合同。不实际写用户技能，不实际跑用户install/uninstall，不安装/启停原生工具、读用户config/auth、调用模型远端或试发。

## 验证与回报

先新增业务RED并执行、保存测试checkpoint；后修最小实现，同组GREEN保存实现checkpoint。使用本机实际shell的正确引号，不把PowerShell @标记写进bash提交；只commit本单显式路径，不squash/amend。

先定向相关Vitest/lint/build，再最终一次完整 `npm run check`（`VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`），完整stdout/stderr+真实退出码落新日志，不tail/过滤、不覆写旧首败或重复跑抹掉失败。无覆盖率数值指标，不加skip/放宽行为断言。所有fixture独占临时根，删除前核对绝对路径与归属。

回信固定仓库 `node dist/cli.js`，优先保留本条程序hint的conversation与tool，正文stdin，显式delivery steer。**不要用Claude ListAgents/SendMessage联系Codex**。hint缺tool时保留引用，按repo skill核实桌面收件类型再补；只有明确短柄失败才核实原目标后按名称/完整ID+codex-desktop接续，不猜cXXX、不因queued/parked/uncertain盲重发、不轮询。

报告真实基线/父提交/RED/GREEN/每项保证及命令结果、文件、未测与清理，完成停写；root两轴复审后再决定下一单，不能自行关闭C08父项。
