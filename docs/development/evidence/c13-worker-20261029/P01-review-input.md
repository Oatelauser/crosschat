# C13-P01 交付与检查

2026-10-29。执行者 `cworker1`，root 分发、独立审查。仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，起始与结束基线 `b062c3e450794523c3633ef013481158e057b4d9`。无 checkout/pull/reset/clean/stash/amend/push；原未跟踪 `docs/代码消息投递.md` 未改、未 stage。

**本单未实施产品变更。** `src/**`、`integrations/**`、`test/**`、skills、package、用户指南、既有合同与证据、主任务表、调度表、任务书均未改。生产行为与基线一致。

## 1. 交付文件

| 文件 | 作用 |
| --- | --- |
| `docs/development/c13-harness-lifecycle-design-20261029.md` | 生命周期方案草案（未获实施批准）：现状、矩阵、close 缺口、建议下一单、待决定项、依赖边界 |
| `docs/development/evidence/c13-worker-20261029/P01-repro.mjs` | 最小隔离复现：合成 ctx/host + 独占临时 home + 每场景自有子进程 |
| `docs/development/evidence/c13-worker-20261029/P01-result.json` | 复现原始结果（`wx` 新建） |
| `docs/development/evidence/c13-worker-20261029/P01-review-input.md` | 本文件 |

## 2. 复现怎么做的

`mountDshBridge(ctx, host, { home })` 是现有导出，`integrations/dsh/index.js` 的 `apply()` 就是它的调用者。复现不碰原生 Harness，只合成 ctx/host：

- 合成 `ctx`：`agents`（一个 live root）、`get('profileContext')` 给绝对 profileDir（让 `callerIdentity` 成立）、`inject` 立即回调子 scope、`effect` 承接 close。
- 合成 `host`：`getDshRuntimeVersion()` 与 `createUserMessage()`。
- 场景注入点就是源码里的两个释放口：`shellEnv.register()` 返回的 `unregister`（→ `releaseCallerIdentity`），以及 `ctx.inject()` 返回的 `{ dispose }`（→ `callerIdentityScope`）。

**清理所有权**：close 一旦拒绝，监听器就没有任何 API 能关掉（`server` 是闭包私有）。所以每个场景跑在**自有子进程**里：子进程打印观察后自行退出，监听随进程消失；父进程等 `close` 事件、核对子进程退出后端口确实拒绝连接，再删自己的临时根。**没有**再调一次被拒绝的 memoized close 当兜底，也没有全表扫描或按进程名杀进程。子进程清除 `CROSSCHAT_LIVE`，20s 截止、stdout 上限 64KiB、error/close 都有处理。

**只读一次本机 loopback**：每个场景对本次桥的 `GET /v1/info` 发一次请求，看它是否还答；**未投递任何消息**，未调用 `/v1/sessions*`。

## 3. 实际观察（`P01-result.json`）

| 场景 | mount | close | 进程存活时监听 | 登记（子进程退出后） |
| --- | --- | --- | --- | --- |
| 正常对照 | 成功 | 成功 | 已拒绝连接 | 0 个文件（已删） |
| contributor release 抛错 | 成功 | 拒绝 `contributor release failed` | **仍在，回 503** | 1 个文件 |
| dependency scope dispose 拒绝 | 成功 | 拒绝 `scope dispose failed` | **仍在，回 503** | 1 个文件 |
| mount 阶段失败 + close 拒绝 | 拒绝 `scope dispose failed` | 由 mount 内部调用 | **仍在，回 503** | 1 个文件 |

四条汇总全部为真：`controlClosedCleanly`、`releaseFailureLeaksListener`、`disposeFailureLeaksListener`、`mountCatchReplacesOriginalError`、`closeIsMemoized`、`childExitReclaimsListener`。

要补两句准话：

- **503 表示"占着端口但不服务"**：`closed=true` 在抛错前已置位，所以监听还在、但拒绝一切请求。
- **重复关闭拿回同一个拒绝**：`closing ??=` 记的是已拒绝的 promise（`sameSettledPromise: true`），清理无法重试。
- **原始错误被顶替**：mount 的 catch 里 `await close()` 在 `unlink(temporary)` 之前；实测注入的 `effect registration failed` 被 `scope dispose failed` 覆盖。

## 4. 检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 语法 | `node --check P01-repro.mjs` | 通过 |
| 隔离复现 | `node P01-repro.mjs` | 退出 0；四场景观察如上 |
| 结果落盘 | `node P01-repro.mjs --out P01-result.json` | `wrote:true`；同路径再跑退出 3、不覆盖 |
| 临时残留 | 查 `%TEMP%/c13-p01-*` | none；每次 `cleanup.removed:true` |
| 差异 | `git diff --check` | 通过 |
| 产品基线 | — | 仍为 W06 的 2503 通过/11 原有跳过，**不是本单新验证** |

按任务书未跑全量 `npm run check`，未写文案字符串测试，未造覆盖率指标。

## 5. 范围与边界

- 只覆盖 Windows 本机、合成 ctx/host；**不是**正式 Harness 进程内重放，也不构成原生缺陷已认定的结论。
- 正式 Desktop 包、Linux/macOS 未测；Desktop 原生验收归 C04。
- `mount-catch` 场景里 `temporary` 在发布前已删除，所以**没有观察到 tmp 文件残留**；能确认的是错误顶替 + 监听/登记泄漏。"open temporary 之后、unlink 之前失败"与 close 拒绝同时成立的那一组本轮未构造，标未测。
- 未安装/升级/卸载工具，未改 Hook/配置/注册表，未启停原生 Host/Desktop/daemon，未读写用户 Harness 状态，未调用模型，未真实试发。

## 6. 建议下一单（用户可直接审阅）

**只修 close 的清理次序，不新增任何命令。** 范围锁定 `integrations/dsh/bridge.js` 的 `close()` 与 mount 的 catch，外加 `test/dsh-bridge.test.ts` 四条用例：

1. 释放 contributor、dispose scope、关 socket 三件事各自独立，一件失败不拦其余两件。
2. 登记删除放在 socket 关闭之后，仍只删 instanceId+token+pid 三项都对得上的自己那条。
3. close 仍以拒绝结束，首个错误当主错误，其余挂 `cause`，不伪装成功。
4. 成功后重复关闭幂等；**失败后允许重试**，已释放的资源不再释放第二次。
5. mount 失败时先留住原始错误，清理完再抛原始错误（清理错误挂 `cause`），不再被 close 错误顶替。

验收用现有 `fixture()` 扩展，跑 `npx vitest run test/dsh-bridge.test.ts` 与 caller-source 用例，产品基线不变。**不做**：自动安装/更新/禁用/移除命令、默认 profile、卸载时调用原生管理器、Desktop 正式包验证——这几项要么属 C08/C10/C04，要么需用户拍板（见方案 §五）。

## 7. R1 返修（基线 `2c4d48d0e31f0958b51a3a8b18fc41bcf261a779`）

按 root 审查（`P01-review.md`）只收口草案事实、下一单范围、复现采证有效性三件事。不改产品、不改已有测试、不改原 `P01-result.json`（SHA256 仍为 `e7497444e6dff4cef9cfb07c188ff0851216e84d43e854bafddc9a31a7100b97`）。

### 7.1 草案事实修订

| 原表述 | 修订后 |
| --- | --- |
| 升级 crosschat 会换掉 bridge 绝对路径 | **可能**改变，取决于安装方式；指南措辞是"升级改变了安装路径时" |
| 手工 skill 更新沿用 `cpSync` 行为 | 手工复制没有脚本；`install-skills` 的 `cpSync` 只写 `.claude`/`.codex`，不能当作该流程的执行证据；手工复制是否残留源已删文件未核实 |
| 禁用插件 / Host 重启 → 旧登记变 dead pid | 拆成三种生命周期：同 Host 内禁用 → disposer → `close()` 释放自身登记；子 scope 撤销 → 只撤身份贡献、HTTP 保留；Host 退出/崩溃 → 无 disposer 才留 dead pid 登记 |
| `dsh plugin remove` + 先移除再添加 | 准确 remove 语法与顺序无固定依据，标**待核验**；退出 Host 后的 CLI 操作不会回头触发运行中进程的 close |
| 卸载时自动调原生管理器"无法可靠实现" | 降级：没有固定依据，不作为结论，由用户决定 |

### 7.2 下一单范围

- 删除"失败后重试"和逐资源 done 状态；保留同一 closing Promise：首次逐项独立清理、全部尝试完再报告错误；重复/并发 close 返回同一 promise、不重复释放。
- 明确"同一 Host 内释放失败"与子 scope 撤销、Host 重启是不同生命周期，后者不在本单行为内。
- 验收改为"既有用例无回归 + 新增四条通过"；旧的 2503 不是"必须不变"的门槛。

### 7.3 复现工具采证门禁

- 每场只接受：子进程退出 0、未超时、未截断、RESULT 可解析且字段齐全、场景名匹配、退出后端口被拒。**只有 `ECONNREFUSED` 算确认关闭**；缺 URL 或未探测记 `confirmedClosed:false`，超时/其它网络错误保留未核实。
- 采证失败写入 `problems`，与"无复现"（`notReproduced`）分开；任一非空退出 1。
- 子进程输出按字节封顶（stdout 64KiB / stderr 16KiB）并记录超限；`error` 只记录，收束仍等 `close`；超时/超限 kill 后给 5s close 截止，未确认就停止后续场景、保留临时根，在 `cleanup.retained/root` 报告，父 finally 不删根。
- 只管理本次直接启动、不生后代的 node 子进程；继续清 `CROSSCHAT_LIVE`，不做宿主扫描/杀树，不引入 W05 框架。

### 7.4 本轮运行

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 语法 | `node --check P01-repro.mjs` | 通过 |
| 默认正常复现 | `node P01-repro.mjs` | 退出 0；四场 `reproduced`，`problems:[]`、`notReproduced:[]`、`cleanup.removed:true` |
| 结果落盘 | `node P01-repro.mjs --out P01-R1-result.json` | 退出 0，`wrote:true` |
| 覆盖保护 | 同路径再跑 | 退出 3，字节未变 |
| 采证失败反例 | 自有副本（子进程 import 缺失） | 退出 1；四场 `evidence-failure`；`problems` 12 条；`notReproduced:[]` |
| 原证据 | `sha256sum P01-result.json` | `e7497444…`，未变 |
| 新结果 | `sha256sum P01-R1-result.json` | `81d383dfdc91fa188f32c8fd102ea75ce3730950411701a3f2edb9e23911d6f3` |
| 临时残留 | `%TEMP%/c13-p01-*`、反例副本目录 | none（副本目录已删） |
| 差异 | `git diff --check` | 通过 |

采证失败反例的做法：把脚本复制到自己的临时目录（`%TEMP%/c13-p01-r1-negative/`），子进程的相对 import 因路径变化找不到 `integrations/dsh/bridge.js`，四个子进程都以退出码 1 结束且没有 RESULT。工具没有把它当成功：`verdicts` 四场全是 `evidence-failure`，`problems` 逐条列出"child exited 1 / no parsable RESULT line / port release not confirmed"，退出 1。反例目录用完即删，`%TEMP%` 无残留。
