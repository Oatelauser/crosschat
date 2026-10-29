# C13-I01：桥关闭及挂载失败的资源清理

2026-10-29（UTC+8）。root 派单/独立审查，本机 Claude `cworker1` 实施。用户已明确要求开始下一项，完成一项后继续派发，直到用户喊停或出现必须拍板事项；同时新增硬边界：**涉及用户操作必须变更，或功能实现需要新增文件，必须先等用户决定。** 本单是已讨论的现有桥异常清理修复，只修改已有产品和已有测试，不改变用户步骤，不新增功能/运行时文件。

## Git、归属、白名单

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；正式派单给出 root 任务提交后的完整基线。开始/结束核对 branch/HEAD，一致直接执行；不一致即报告，不 checkout/pull/reset/clean/stash/amend/push。worker 独占本单白名单/index，仅 stage 自己的文件，本地新 commit。原未跟踪 `docs/代码消息投递.md` 不动不 stage。

必读 AGENTS、代码规范、[方案/诊断验收](P01-final-review.md)、[生命周期设计](../../c13-harness-lifecycle-design-20261029.md)、现有桥及测试。只允许修改：

- `integrations/dsh/bridge.js`：现有 close、mount catch 及必要的相关错误保留逻辑。
- `test/dsh-bridge.test.ts`：复用/扩展既有 fixture 和行为回归。
- 本目录 `I01-review-input.md`、`I01-check.txt`：开发交付/完整检查记录，可按需新建，不参与功能。

不得新增功能源码/helper/运行时持久文件；不改 src、其它测试、package、skills、用户指南、原始 P01 证据、root任务/调度/总表。若发现本单功能必须跨出该范围或改变用户操作，先报告具体原因和最小方案，不自行实施。不安装软件，不启原生 Harness/Desktop/daemon，不碰用户 profile/config/auth/状态，不访问生产远端或模型，不试发通信。

## 批准的行为

1. **首次关闭尝试所有独立清理。** 同一个 closing Promise 内先使 closed 生效，再尝试撤 caller contributor、dispose 原生依赖子 scope、关闭自己的 HTTP listener/连接、撤销自己的登记。某一释放失败不能跳过其它独立清理。保持重复/并发 close 共享结果、不重复执行；不增加失败重试或逐资源状态机。
2. **所有权不变。** 登记撤销仍在关闭 listener 的步骤之后；保留 instanceId/token/pid 核对及现有替换文件/符号链接等边界。保护其它实例、同路径替换登记及借用的原生 Agent。closed 后旧身份贡献不可再返回可用 marker；不改变来源分类、身份协议或消息路由。
3. **错误保真。** 清理有错误时 close 拒绝；同时存在的清理错误须保留，不能静默成功。优先保留原始错误对象/原因，追加清理错误时不要覆盖其已有 cause；可以用小范围、明确的聚合结构，不造全局错误框架。mount 失败必须始终尝试自己的临时文件清理，并以原始挂载失败为主因，清理失败不能顶替或丢失原因。不得因处理 catch 删除外来文件。
4. **作用域边界。** 插件作用域销毁通过已注册 effect 走 close；shellEnv 子作用域单独撤销仍只撤 caller contribution，HTTP 保持可用。重启/禁用的用户操作和外部管理行为不改。

## 实施与验证

- 先用现有 fixture 加有意义的失败回归，确认原实现 RED，再修改。不要只证明类型失败，不为测试添加产品测试开关或新外部依赖。不要求固定新增测试数量。
- 必须覆盖 release 抛错和 scope dispose 拒绝时其它资源仍获清理、错误被保留；重复/并发 close 同一 Promise 且不重复释放；插件 effect 入口；同路径登记被替换后保留对方、其它实例和 Agent 不受影响。现有子scope卸载/重装行为继续通过。
- mount 失败与 close 失败并存时保留原始错误及清理错误；至少有实际遗留临时文件的路径验证最终被清掉，不能把“临时文件本来不存在”作为 tmp 清理证明。无需重放原生工具；在本文件内用受控文件/原生能力 mock 注入即可，不另造大型探针/进程运行器。
- 失败用例的 fixture 自身不能依赖已拒绝的 memoized close 兜底。afterEach/finally 应尝试所有本次清理并报告非预期失败，不能因预期的注入错误跳过临时根/监听器回收。必要时保留本次实际 server 的测试所有权；不扫描/终止用户进程。
- 跑受影响 bridge/caller-source 的定向 Vitest、必要 JS 语法检查和 ESLint，然后一次最终 `npm run check`，完整输出留 `I01-check.txt`。已有记录最近完整基线2503通过/11原有跳过，新用例自然增加数量，不跳过/弱化旧断言。出现失败保留原文、限定定责，不扩白名单或靠重复运行抹掉首次失败；正常通过后不反复跑全量。

## 清理与回报

fixture 使用独占临时 home、受控 loopback，清 CROSSCHAT_LIVE；所有 timer/listener/socket 有 finally。删除临时根前核对解析绝对路径、父目录和前缀，只清自己资源；此前被拒删除的缓存/日志保留，不换机制重试。原始 P01 两份 JSON 字节不动；产品修复后其“旧实现形状”诊断不要求继续复现，GREEN 使用新增行为回归，不改历史证据。

回报 branch/起止 SHA、独立 commit/文件、实际行为、RED/GREEN、定向/全量检查及失败原文、资源清理、未测边界。完成停写，按正式派单 typed reply ref，用约定 `node dist/cli.js`、收件 `--tool codex-desktop --delivery steer` 报告。root 验收后自行派下一单；worker 不自行扩大任务、不轮询/空等。
