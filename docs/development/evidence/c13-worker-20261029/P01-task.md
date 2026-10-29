# C13-P01：Harness 生命周期方案与现有清理缺口复现

2026-10-29。root 分发、独立审查；本机 Claude `cworker1` 执行。用户要求继续原有派单流程，同时保留“先讨论方案，不直接修改代码”的约束。本单只交付具体、可审阅的开发方案及隔离证据，不实施产品变更。通信问题及 C14/W08 后续归 [Bug修复2](../../communication-handoff-bugfix2-20261029.md)，不在本单重新领取。

## 目标与边界

总表下一项为 C13：Harness skill 与 Host bridge 分开管理，明确安装、更新、禁用、重连、移除及归属，供 C08/C04 消费。现有桥是手工安装，`dsh-bridge-path` 只读，`install-skills` 尚不管理 Harness；这些事实不能被文档写成新功能已实现。

本单必须给出一份短方案，说明现状、建议行为、影响、待用户决定项和下一张实现单的精确文件/验收范围；避免继续扩展来源研究或新造工装框架。现有 `mountDshBridge()` 的 `close()` 在释放 caller contributor 或 dependency scope 抛错时，会跳过后续 socket/登记清理；这是源码发现，须以隔离复现确认，尚不能称原生 Harness 缺陷已重放。

## Git 与文件所有权

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`。正式派单给出 root 任务提交后的完整基线 SHA；开始/结束核对 branch/HEAD，不一致即报告，不 checkout/pull/reset/clean/stash/amend/push。worker 独占本单白名单和 index，只 stage 自己的文件并作独立本地新 commit。原未跟踪 `docs/代码消息投递.md` 保持原样、未 stage。

必读 AGENTS、代码规范、[总表](../../tool-compatibility-ci-tasks.md)、[接入规范](../../tool-integration-standard.md)、[已有 Harness 合同](../../dsh-integration-contract.md)、`docs/deepseek-harness.md`、`integrations/dsh/bridge.js` 及对应测试。只追踪本单需要的原生固定合同，不重复整库研究。

仅允许新增：

- `docs/development/c13-harness-lifecycle-design-20261029.md`：约一页到两页的方案，明确标注草案/未获产品实施批准。
- `docs/development/evidence/c13-worker-20261029/P01-repro.mjs`：必要的最小隔离复现，可省略脚本而保留同等可重放的短命令，但不得修改已有测试。
- 同目录 `P01-result.json`、`P01-review-input.md`：原始结果和交付检查；结果独占新建，不覆盖已有证据。

不改 `src/**`、`integrations/**`、`test/**`、skills、package、用户指南、既有合同/证据、主任务表、调度表及本任务书。无安装、下载、原生 Host/Desktop/daemon 启停、用户配置/状态读取写入、生产远端、模型调用或真实试发。不会新增运行时持久文件或替用户选择默认 home/profile。

## 交付内容

1. **生命周期矩阵。** 分别写 skill 副本与 Host bridge 的安装/加载/更新/禁用/重新启用与重连/移除，区分 crosschat 包、原生插件引用、运行时登记、用户原生工具及其聊天。每格明确由谁操作、作用于哪个 home/profile/project、当前已有能力/缺口、验证证据或未测状态。npm/Web 与正式 Desktop 不互相冒充，Desktop 原生验证留 C04。
2. **具体下一单建议。** 先提出一张可独立实现的最小单：在现有 `close()` 合同内，释放某资源失败仍尝试其它独立资源清理；错误不能伪装成功；重复关闭不能重复释放；仅删除自己的登记，不销毁借用的 Agent。列出初始化失败和原生 scope 销毁是否走同一路径，以及原始错误与清理错误如何保留的推荐。不要在本单实施，也不扩展为新自动安装命令或新的全局生命周期框架。
3. **隔离确认。** 使用现有 bridge 导出和合成 ctx/host，在独占临时 home 中分别注入 contributor release 抛错、dependency scope dispose 拒绝，观察 close 拒绝后自己的 HTTP listener/登记是否仍在。只读一次本次 loopback 服务即可；不投递消息。至少有正常关闭对照。返回并记录真实观察，不用源码推断冒充运行结果，不把 mock 当正式 Harness 验收。
4. **资源收口。** 缺陷复现预计会留下监听器，故实验自身必须保留清理所有权：可捕获自己创建的 server 后在 finally 直接关掉，或用有界自有子进程并等待 close。不得靠再次调用同一个已拒绝的 memoized close 保证收尾；不得全表扫描或按进程名杀。若需要子进程，清除 CROSSCHAT_LIVE，有明确截止、输出上限、error/close 处理。临时根 mkdtemp 独占，删除前核对绝对路径/父目录/前缀；仅删自己的资源，被拒不换机制。
5. **决策与依赖。** 明列新增自动安装/更新/禁用/移除命令、默认目标、卸载调用原生管理器等尚未批准项；推荐与理由要具体，不要求用户批准已经存在的手工流程。C08 消费目标/归属合同，C04 消费正式 Desktop 验证要求；不能因本单方案或 close 修复关闭整个 C13。

## 检查与回报

运行必要 `node --check`、隔离复现、`git diff --check` 即可；本单不改产品与已有测试，无需全量 npm check，不写文案字符串测试，不制造覆盖率指标。已有产品完整基线仍是 W06 的 2503 通过/11 原有跳过，不算本单新验证。

回报起止 SHA、白名单文件、原生/合成范围、正常及两条失败路径的实际观察、资源清理、未决项，并附一段用户能直接审阅的“建议下一单”摘要。完成停写，不自行开始实现、不轮询/等确认。按正式派单给出的完整 typed reply ref，用约定仓库入口 `node dist/cli.js`、收件 `--tool codex-desktop --delivery steer` 报告，让异步回报触发 root 复核。
