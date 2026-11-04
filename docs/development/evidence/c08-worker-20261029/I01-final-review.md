# C08-I01 默认 Harness 技能维护最终验收

2026-10-29（UTC+8）。root 验收通过，范围限用户批准的默认 Harness skill 安装、覆盖更新与当前目标卸载接线。C08 父项、正式 Harness 加载与三平台 CI 不由本单关闭。

## Standards

独立复审通过，无剩余代码阻断。共享 `skillPlan` 统一 Claude、Codex、Harness 目标与顺序；外部 Harness 根及祖先链接检查在维护 effects 前执行。已存在目录以 dev/ino 识别；Windows 尚未创建的后缀按大小写规则去重，POSIX 保留大小写。全新目录反例与分命令段 help 断言有效，没有新增功能文件、参数、依赖或持久状态。

全量首败的归因表述已在 [交付记录](I01-review-input.md) §十收窄为根因未确认；不修改两次原始日志。

## Spec

独立复审通过。默认第三目标为 `<home>/.dsh/skills/crosschat`，尊重当前绝对 `DSH_HOME`；空值按未设置，非空相对路径拒绝。`--dir` 与显式 TUI 隔离 home 不继承宿主 `DSH_HOME`；普通维护经 worker DTO 保留实际值。CLI/TUI 安装、覆盖更新与卸载共用计划，Windows 首次安装即避免同目录重复处理，保留首现标签与顺序。

完整复制 skill/references、首错停止、保留额外旧文件；卸载只删当前计划的 crosschat skill，保留 Harness home、其它技能、profile、插件配置和聊天。不追踪或扫描历史 DSH_HOME、旧 `--dir` 或项目副本；不自动管理原生插件。

## 提交与验证

- 首轮 RED `fdde712`、GREEN `f6fbaf1`、证据 `9df42ba`；R1 RED `ede6ed3`、GREEN `b4d6a75`；R2 RED `2c35e02`、GREEN `a77a39b5e89cb5315d56db5dec8e4c7ce7d2056f`，R2 基线 `1c9ed3383bd7f12e210f155c513f983d410649b3`。原始问题与返修结论见 [首轮审查](I01-review.md)及 [R1复审](I01-R1-review.md)，不重写历史。
- root 在最终产品提交独立运行 install-skills、uninstall、maintenance、maintenance-boundaries、tui-composition、tui-maintenance、cli-args 七套件，**87/87 通过，退出 0**，maxWorkers=2/minWorkers=1；与 worker 定向结果一致。
- worker 最终完整 `npm run check` 第二次 **退出 0：2544 通过/11 原有跳过，231 文件通过/3 跳过**；lint、203 模块/682 边导入图与 TypeScript 构建通过。环境为 `VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`，未筛套件或加 skip。root 查验 [两次完整原始日志](I01-R2-check.txt)，未重复该次全量。
- 第一次全量退出 1，2543 通过/1 失败/11 跳过；`conversations.test.ts:280` 期望 machines 名称 `cloudleg`，实际 undefined。后续单文件和全量通过不证明失败根因，当前未发现与技能模块的直接依赖关系。未修改通信代码、等待预算或断言，不将首败擦除或宣称已修复。
- R2 产品/测试 diff 的空白检查通过；原始日志中两条 Vitest Expected/Received 行保留终端尾随空格，未为通过空白检查改动证据。首轮 RED 提交消息的多余 `@` 保留，未 amend。

## 适用边界与接续

已测范围为 Windows 独占临时 fixture 与受控维护 worker。POSIX 分支、三平台 CI、真实用户安装/卸载、正式 Harness 加载未执行；CLI uninstall 顶层 run 接线没有独立端到端用例。未写用户技能/config/auth，未安装或启停原生工具、调用模型或试发；fixture 随测试清理。原未跟踪 `docs/代码消息投递.md` 未触碰。

I01/R1/R2 从活动子单移除，原任务书保留为批准与审查证据。当前目标之外的历史/项目副本、覆盖复制的额外文件语义和正式加载边界继续留在 C08 总项；需要改变用户操作或新增功能文件时仍须用户决定。后续按既定顺序核对 C04 正式 Harness Desktop 的独立 runner 工装，不回收 Bug修复2 的通信任务。
