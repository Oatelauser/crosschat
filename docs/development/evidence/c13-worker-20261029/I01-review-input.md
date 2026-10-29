# C13-I01 交付与检查

2026-10-29。执行者 `cworker1`，root 派单/独立审查。仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，起始基线 `194397952dbc02d5a6193a2e237a607578f5fc12`。无 checkout/pull/reset/clean/stash/amend/push；原未跟踪 `docs/代码消息投递.md` 未改、未 stage。

## 1. 交付文件

| 文件 | 变更 |
| --- | --- |
| `integrations/dsh/bridge.js` | `close()` 逐项独立清理；mount catch 保留原始错误 |
| `test/dsh-bridge.test.ts` | fixture 拆出 `environment()`，加受控失败注入，新增 6 条回归 |
| `docs/development/evidence/c13-worker-20261029/I01-check.txt` | 最终 `npm run check` 完整输出（含首败原文） |
| `docs/development/evidence/c13-worker-20261029/I01-review-input.md` | 本文件 |

未改 `src/**`、其它测试、package、skills、用户指南、P01 两份结果 JSON、root 任务/调度/总表。未新增功能源码、helper 或运行时持久文件。

## 2. 实际行为

1. **首次关闭尝试所有独立清理。** 同一个 closing Promise 内依次 `closed = true` → 撤 caller contributor → dispose 原生依赖子 scope → 关自己的 HTTP listener/连接 → 撤销自己的登记。每一步单独 `try`，任一步失败不跳过其余步骤；全部尝试完才以首个错误拒绝，其余错误挂在它的 `cause` 上（若首错已有 `cause`，用 `AggregateError` 包住并把原 `cause` 原样带过去，不覆盖）。close 仍以拒绝结束，不伪装成功。
2. **所有权不变。** 登记撤销仍在 socket 关闭之后，仍是 instanceId + token + pid 三字段核对，仍拒绝替换记录与符号链接；不触碰 `ctx.agents`，不销毁借用 Agent。
3. **重复/并发关闭** 返回同一个 closing Promise，不重复释放；不引入失败重试或逐资源状态机。
4. **mount catch** 把原始挂载错误留作主因：close 与临时文件清理都仍被尝试，两者失败挂到原始错误的 `cause`；不再出现 close 错误顶替原始错误、也不再跳过临时文件清理。
5. shellEnv 子 scope 单独撤销仍只撤身份贡献、HTTP 保留（既有用例继续通过，行为未改）。

## 3. RED → GREEN

**RED（只加测试、未改产品时）**：`npx vitest run test/dsh-bridge.test.ts` → 3 failed | 26 passed (29)。

| 场景 | 原实现观察 |
| --- | --- |
| contributor release 抛错 | close 拒绝后 listener 仍答 **503**，登记仍在 |
| dependency scope dispose 拒绝 | close 拒绝后 listener 仍答 **503**，登记仍在 |
| mount 失败 + close 拒绝 | 抛出的主错误是 `contributor release failed`，原始 `link injection failed` 丢失，临时登记文件残留 |

另 3 条（并发共享同一 Promise、插件 effect 入口、同路径替换登记保留）在原实现上即通过，作为回归护栏保留。

**GREEN**：`npx vitest run test/dsh-bridge.test.ts` → 29 passed (29)。

新增用例：

- release 抛错时仍关 listener、删自己登记，错误被保留，Agent 不受影响。
- scope dispose 拒绝时同上。
- 并发两次 close 返回同一 Promise，`stats.releases === 1`（不重复释放）。
- 通过 `ctx.effect` 注册的 disposer 关闭桥。
- 同路径登记被替换后保留对方，另一个实例的登记与 Agent 不受影响。
- mount 失败 + close 失败：抛出的是原始 `link injection failed`，`cause` 是 `contributor release failed`，且确实存在过已写入的临时登记文件（`linkSourceBytes > 0`），事后目录为空。

失败注入方式：`vi.mock('node:fs/promises')` 只包 `link`（受控的原生能力失败，保证临时文件已落盘才失败），以及 fixture 自身的 contributor `unregister` / scope `dispose`。fixture 的 `afterEach` 逐项尝试所有清理、只把**非注入**错误汇总上报；临时根与 listener 回收不因注入错误被跳过，也没有靠再调一次已拒绝的 memoized close 兜底。

## 4. 检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| JS 语法 | `node --check integrations/dsh/bridge.js` | 通过 |
| 定向 Vitest | 9 个 bridge/caller-source 套件 | 159 passed |
| ESLint | `npx eslint test/dsh-bridge.test.ts` | 通过（无输出） |
| 全量 | `npm run check` | 退出 1：49 failed / 2470 passed / 11 skipped（2530） |
| 差异 | `git diff --check` | 通过 |
| P01 原证据 | `sha256sum P01-result.json` | `e7497444…`，未变 |
| P01-R1 证据 | `sha256sum P01-R1-result.json` | `81d383df…`，未变 |

**全量失败的归责（首败原文见 `I01-check.txt`）**：49 条失败分布在 12 个会话短柄/状态汇总相关文件（`c14-conversation-refinement`、`conversations`、`status-conversations`、`status-summary`、`status-filters`、`conversation-summary`、`conversation-state-concurrency`、`send-command`、`dsh-send`、`maintenance`、`core-cleanup`、`core-code-standards`），**没有一个导入 `integrations/dsh/bridge.js`**（全仓只有 `test/dsh-bridge.test.ts` 与 `test/caller-source-providers.test.ts` 导入，二者均通过）。

直接验证：把 `integrations/dsh/bridge.js` 临时还原为 HEAD 版本（只此一个文件，验证后立即恢复），单跑这 12 个套件 → **48 failed / 175 passed**，与修复后一致。差额 1 条是 `test/core-code-standards.test.ts` 在全量并发下 **`Error: Test timed out in 5000ms`**（该文件隔离运行通过），属既有负载敏感用例。

**失败来源**：这 12 个文件正是并行会话短柄实现线在途修改的对象——我开工时（20:57）工作树除未跟踪 `docs/代码消息投递.md` 外干净，`21:03–21:04` 期间这些测试文件与新增的 `test/helpers/conversation-shards.ts` 被该线写入（`git status` 中均为未 stage 的 ` M`/`??`，我未改、未 stage）。所以这 48 条是该线在途状态，既不是本单引入，也不是基线 `1943979` 的既有红灯；本单不认领、不修改、不重复运行抹掉首败。`I01-check.txt` 保留的是 `21:01` 那一刻的原始全量输出。另注：任务书引用的“2503 通过/11 跳过”早于当前基线，当前全量总数为 2530（本次新增 6 条）。

## 5. 资源清理

- fixture 临时 home 每次 `rm`；本次改动后 `%TEMP%` 无 `crosschat-dsh-bridge-*` 残留。
- 归责验证用的 `$TEMP/c13-i01-bridge-new.js` 副本已删；产品文件已恢复为修复版（`git diff` 可见）。
- 清掉上一单遗留的 `%TEMP%/c13-r1-supplement.json`（我自己的 R1 运行输出，非仓库证据）。
- 所有 listener 随 `close()` 或 fixture 清理释放；未扫描/终止任何用户进程。

## 6. 未测边界

- 只在 Windows 本机、合成 ctx/host 上验证；**不是**正式 Harness/Desktop 进程内重放。
- 未验证 Host 崩溃、插件禁用、子 scope 撤销与 close 失败同时发生的组合。
- 未验证跨进程并发 close（只覆盖同进程并发）。
- 未安装/升级/卸载工具，未启停原生 Host/Desktop/daemon，未读写用户 profile/config/auth，未访问远端或模型，未试发消息。

## 7. R1 返修（2026-10-29）

派单基线 `29915a6fd907e701abab61985e24bbdacc8f1abc`；开工时 HEAD 即该提交，期间并行短柄线提交 `9816b45`（`git log 29915a6..9816b45 -- integrations/dsh/bridge.js test/dsh-bridge.test.ts` 为空，未动本单白名单）。本轮独立 commit 的父提交为 `9816b45d706aa0a5aa90ffc7c998a84f7722e6d5`。范围仍只有原桥与原测试，未新增功能文件、未改用户操作。

### 7.1 三处收口

| 处 | 收口方式 |
| --- | --- |
| cause 不可写 | `withCleanup` 改为 `try { error.cause = extra; return error } catch {}`，赋值失败即退回 `new AggregateError([error, extra], String(error?.message ?? error), { cause })`。原始错误对象、它原有的 `cause`、每条清理原因全部保留；不再出现替代 TypeError。 |
| 临时文件归属 | 新增生命周期内布尔 `temporaryOwned`，只在 `open(temporary, 'wx', 0o600)` 成功后置真；mount catch 仅在该标记为真时 unlink。EEXIST 等 open 失败不触碰外来文件。无新文件/格式/迁移/锁。 |
| fixture 独立收尾 | `vi.mock('node:http')` 捕获本次实际创建的每个 server，`cleanup` 里独立关闭仍在监听的 server（产品 close 提前拒绝时的兜底）；effects 清理改为逐项尝试、只汇总非预期错误；`afterEach` 收尾后再断言无 fixture listener 仍在监听。 |

### 7.2 新反例先失败、修复后通过

`npx vitest run test/dsh-bridge.test.ts`，产品临时还原为派单基线版本（仅此一个文件，验证后立即恢复）：

| 新用例 | 基线产品观察 |
| --- | --- |
| 只读 cause（可扩展、`cause` 值 undefined 但不可写） | 抛 `TypeError: Cannot assign to read only property 'cause'`，原始 `link injection failed` 与清理原因全丢 |
| EEXIST 已有 tmp | 目录从 1 个文件变 0 个：外来 tmp 被删，原字节丢失 |
| 主因 + 自有 cause + 多条清理原因 | 基线产品上即通过（既有 cause 不覆盖逻辑本就成立），作为护栏保留 |

修复后：`32 passed (32)`。期间发现并修正 fixture 自身记账：产品 close 按用例预期拒绝时，`ctx.effect` 的 disposer 会重放同一拒绝，fixture 需把它计入 `expected` 而不是当成收尾失败上报（已加一行显式登记，不靠再调一次已拒绝的 Promise 兜底，重放是产品自己注册的 disposer 行为）。

### 7.3 fixture 独立 server 兜底的实际观察

用 I01 之前的桥（`b1d7a4d:integrations/dsh/bridge.js`，close 首错即停）跑 release 抛错用例：

- **去掉兜底**（临时环境变量开关，观察后已删，`grep -c C13_DROP_SERVER_FALLBACK` = 0）：`fixture cleanup failed: fixture left a listener bound`，且 listener 仍以 **503** 应答。
- **保留兜底**：只剩产品行为断言失败（503 不拒绝），**没有**任何 fixture 泄漏报告——listener 由 fixture 自己关掉。

两轮均即时恢复产品为修复版，最终 `32 passed (32)`。

### 7.4 检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| JS 语法 | `node --check integrations/dsh/bridge.js` | 通过 |
| 桥套件 | `npx vitest run test/dsh-bridge.test.ts` | 32 passed |
| caller-source 主套件 | `npx vitest run test/caller-source-providers.test.ts` | 14 passed |
| 其余 caller-source 回归 | confirmations / service / state-lock / codex-probe / tui-context-source | 55 passed |
| ESLint | `npx eslint test/dsh-bridge.test.ts integrations/dsh/bridge.js` | 通过（退出 0） |
| 空白 | `git diff --check` | 通过 |
| 全量 | `npm run check` | 退出 1：4 failed / 2523 passed / 11 skipped（2538），首败原文见 `I01-R1-check.txt` |
| 原证据 | `sha256sum` P01 / P01-R1 / I01-check.txt | `e7497444…` / `81d383df…` / `e5b14efe…`，均未变 |

**全量 4 项失败归责**：`dsh-send`（`expected 'cA000' to match /^c\d+$/`）、`maintenance` 两条（保留规则预览数量不符、默认 worker 预览失败）、`core-code-standards`（`Test timed out in 5000ms`，本次耗时 6470ms）。全仓只有 `test/dsh-bridge.test.ts` 与 `test/caller-source-providers.test.ts` 导入 `integrations/dsh/bridge.js`，两者均通过。隔离重跑这三个文件：core-code-standards 通过（负载敏感，非产品问题），另 3 条稳定失败，属并行短柄线在途的会话别名/状态改动（工作树仍有其未 stage 的 `test/conversation-state-concurrency.test.ts`、`test/send-handle.test.ts`），本单不认领、不修改、不靠重跑抹掉首败。

### 7.5 资源清理

- 归责/兜底实验用的 `$TEMP/c13-i01r1-bridge-new.js` 与产品还原均已收尾，产品文件为修复版。
- fixture 临时 home 随用例 `rm`；`%TEMP%` 无 `crosschat-dsh-bridge-*` 残留；无残留 listener（`afterEach` 断言）。
- 未改并行线的任何文件，未 stage 其改动；未跟踪的 `docs/代码消息投递.md` 未动。

### 7.6 未测边界（相对 7.1 收口）

- 只读 `cause` 用 `Object.defineProperty` 合成；未覆盖 Proxy/getter 抛错等更极端的 Error 形状。
- 未验证 EEXIST 与 `link` 失败同时发生、以及外部进程在窗口内替换 tmp 的竞态。
- 其余同第 6 节。
