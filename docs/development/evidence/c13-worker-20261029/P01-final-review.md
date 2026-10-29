# C13 生命周期方案与隔离复现验收

2026-10-29。root 分发与独立验收，本机 Claude `cworker1` 执行。**方案与隔离诊断产物验收通过；产品修复尚未获用户确认，C13 整项未完成。**

## 固定范围和产物

起点 `b062c3e450794523c3633ef013481158e057b4d9`，worker 交付 `6eb6efe`、返修 `06cbcad`、最后补充 `727cb0ad5ccf60c4d29262ed0cda5ee905e27124`；root 中间审查提交 `2c4d48d`。branch 均为 `codex/core-refactor-pre-tui`，无 push/amend。交付为[生命周期草案](../../c13-harness-lifecycle-design-20261029.md)、本目录 `P01-repro.mjs`、两份结果 JSON 与 worker 检查记录。root 任务和初次审查留作历史证据。

整个范围只含 docs 下的方案、诊断脚本、证据和调度记录；src、integrations、既有 test、skills、package 及用户指南均未改。原未跟踪 `docs/代码消息投递.md` 未改未 stage。没有新运行时持久文件、安装、用户配置/状态修改、原生 Host/Desktop/daemon 启停、模型或消息投递。

## Standards

初次审查的采证失败仍退出0、未探测误算关闭、输出上限和子进程收尾问题已修正。每场要求退出0、未超时/截断、有效匹配 RESULT、退出后明确 ECONNREFUSED；异常采证与未复现分开。直接子进程以 close 收束，杀进程后等待有界；未确认退出时停止后续场景、保留根，释放父侧管道并 unref 子进程，仍报告失败，不声称子进程已退。

独立 Standards agent 对最后补充静态复审通过，已无本单阻断。**无法确认 close 的截止分支本轮未动态触发，仅静态核对；不宣称所有异常退出路径已实测。** 这是一次性诊断工具验收，不提升为通用进程运行器保证。

## Spec

正常对照、contributor release 抛错、dependency scope dispose 拒绝及 mount 原始错误被覆盖，均有合成运行证据。草案已纠正升级路径的条件、Harness skill 手工流程与两侧 install-skills 的区别、同PID插件禁用/子scope撤销/Host进程退出的不同语义。未核实的原生 remove 语法和更新顺序保留为待核验。

下一单取消未要求的失败重试机制，保持同一 closing Promise；未来实现时，“scope 销毁走 close”须指插件作用域，shellEnv 子作用域仍只撤身份贡献、保留 HTTP。独立 Spec agent 对修订版通过。草案通过审阅不代表用户批准其中的新增产品行为或 C08/C04 的范围。

## root 实际验证

- 最终 `727cb0a`：`node --check` 通过，默认不写文件复现退出0；四场均 reproduced，problems/notReproduced 均为空，四个直接子进程退出后端口拒绝连接，临时根 removed=true、retained=false。
- 在 `06cbcad` 上，root 用独占临时副本令 bridge 相对 import 缺失：四个直接子进程均退出1、无 RESULT；四场 evidence-failure、12条 problems、整体退出1，根正常清理。该反例没有改产品或原脚本；root 副本根按绝对路径/父目录/前缀核对后删除。最后补充未改变该判定路径，不重复扩大验证。
- 两份原始结果哈希均未变：`P01-result.json` 为 `e7497444e6dff4cef9cfb07c188ff0851216e84d43e854bafddc9a31a7100b97`；`P01-R1-result.json` 为 `81d383dfdc91fa188f32c8fd102ea75ce3730950411701a3f2edb9e23911d6f3`。
- worker/default 重放和 root 重放均只使用 Windows、合成 ctx/host、独占临时 home、本次 loopback 只读请求，不能冒充正式 Harness 内运行。未复现 tmp 写入/删除与 close 同时失败的组合；正式 Desktop、Linux/macOS 未测。
- diff 检查通过。无产品变更，未跑全量 npm check；W06 的2503通过/11原有跳过仍只是最近产品基线，不算本单新验证。

## 当前待讨论的产品范围

root 已向用户提出：仅修改 `integrations/dsh/bridge.js` 的 close/mount catch 与 `test/dsh-bridge.test.ts` 对应回归。首次关闭逐项独立清理，全部尝试后报告错误；保留原始挂载错误及清理错误；重复/并发关闭共享结果、不增加重试；只删自己登记，保护替换登记和借用 Agent。回归还须覆盖插件 effect 入口与 shellEnv 子scope的原有区别。

**该产品单尚未派发。** 用户此前明确要求先讨论方案，上一条具体范围尚无确认；不将 worker 的报告当作用户批准。cworker1 已停写，不轮询。自动安装/更新/禁用/移除命令、默认 profile、卸载调用原生管理器及技能默认写入范围仍是独立决策。通信问题和 C14/W08 后续继续由 Bug修复2 对接。
