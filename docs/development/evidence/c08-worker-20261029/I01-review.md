# C08-I01 独立审查与返修结论

2026-10-29（UTC+8）。固定范围 `8ca186f..9df42ba`，RED `fdde712`、GREEN `f6fbaf1`。19 个变更文件均在派单白名单内。**暂不验收，按下列三个直接问题做 R1。**

## Standards

P1：`operations.ts` 的 `verifySkillTarget` 对外部 Harness 目标从 `target.root`（DSH_HOME）开始，只检查其后代，未检查根本身及其祖先。独占临时 fixture 观察：DSH_HOME 本身为 junction、DSH_HOME 祖先为 junction 两场，安装与卸载预览均 `enabled:true`，应拒绝。仅执行 setup/preview，未调用安装、卸载或 execute；fixture 按所有权核对后已清理。违反任务行为6与目录不可核验应拒绝的边界。

判断性/证据限制：卸载 RED 提前将 fixture 从 `skillDirs` 迁移到新 `skills` 接口，旧实现因字段缺失 TypeError，不能记作“缺 Harness 卸载”业务 RED；worker 已如实披露。其它安装缺第三目标、相对环境未拒绝、隔离环境泄漏有真实行为 RED，不因此全部作废。

## Spec

1. P1 根与祖先链接漏检，同上，违反行为6。
2. P2 同目录去重不足：`skills.ts` 仅以 `resolve()` 字符串比较。Windows 独占 fixture 中 `.claude` 与 `.CLAUDE` 的文件系统 dev/ino 相同、可读到同一 sentinel，计划仍生成三个目标，重复写/删，违反行为4。fixture 已清理。
3. P2 帮助范围未同步：CLI help 仍描述 install-skills 两侧及 uninstall both agent skills，未告诉用户新增默认 Harness 写入/删除范围。root 实际运行 `node dist/cli.js --help` 核实。

CLI uninstall 的 `cli.ts` 确实接到共享计划，缺独立主入口测试本身不另判阻断。未发现新增源码、参数、账本、自动桥管理越界；其它默认/空/相对环境、隔离根、worker/TUI 接线总体符合合同。

## root 验证与证据边界

root 独立运行 install-skills、uninstall、maintenance、maintenance-boundaries、tui-composition、tui-maintenance 六套件，**64/64 通过**（max2/min1 worker），说明原有测试未覆盖上述失败边界。worker 完整 check **2537 通过 / 11 原有跳过**、203 模块/682 边、构建/lint通过；完整原始日志 `I01-check.txt` 保留，不用新结果替换。

RED 提交信息多出的 `@` 已披露，不改写历史；R1 使用当前实际 shell 的正确提交方式。R1 只修上述边界、帮助与相应回归/证据，不重做第一轮接线。
