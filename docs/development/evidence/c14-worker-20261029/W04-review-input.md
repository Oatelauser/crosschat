# C14-W04 交付：会话短柄并发写入修复

2026-10-29。branch `codex/core-refactor-pre-tui`，开始/完成 SHA 均为 `fe1f79ee3c1727fbf5cf0fed4d71d4b7b1c98e77`（本单全程无 HEAD 变化）。实施按 `W04-task.md` 选定路线：复用已有内核 listener 互斥，统一当前会话状态写路径，不新增目录/迁移/旧版分支。检查明细见 `W04-checks.json`。

## 一、做法

把 `src/application/caller-source/state-lock.ts` 的实现原样下沉到低层 `src/state-lock.ts`（改名 `withStateLock`/`StateLockResult`），目录规范化、哈希取端口、独占 listener、进程死亡自动释放、有界轮询全部保留；原文件删除，唯一消费端 `confirmations.ts` 改为从新路径导入，业务与 `SOURCE_STATE_BUSY` 语义不变。应用层没有反向导入 conversations，底层 conversations 也没有导入 application。

`src/conversations.ts` 用一把**按真实状态根**的锁（key `conversation-state`，锁身份 = `realpath(<stateDir>/conversations)`，win32 下小写归一）覆盖四个公开写入口：`handleForRef`、`claimHandle`、`continueFromRef`（内含 `reconcileRefinement`）、`recordConversation`。扫描、候选判断、写入、复核都在同一临界区内；内部 `*Locked` 私有函数复用原算法，`handleForRef` 调用 `claimHandleLocked` 不走公开入口，因此没有非重入死锁。锁只在本地读改写期间持有，不跨原生投递、不跨网络 IO。

四处行为细节：

1. **复用路径也核实，但不猜选也不修历史**。`handleForRef` 只复用能唯一解析回本对话的既有柄；已与别的 nonce 撞号的柄绝不作为 hint 返回，也**不重写**（重写等于替两个真实对话挑赢家）。此时本次发送照常进行、只是不带短柄，`--conversation cN` 仍以 `INVALID_CONVERSATION_REF` 明确列出候选——「完整 ref 恢复途径」保留。同 nonce 的合法细化副本仍走原 `resolveRefinementCopies` 合并规则，正常旧轮次不会被判成另一对话。

   > 实测触发：本单第一次回报时，真实本机状态里该会话的柄 c14 已与另一对话撞号，最初的实现（复用即 `resolveHandle` 报错）把这次发送直接打成了失败——这正是「不得破坏既有功能」。因此改为「不发 hint、不改历史、照常投递」，`--conversation` 用完整 ref 时不再因历史撞号拒发。
2. **不造幽灵柄**。`attachHandle` 在 `savePair` 返回真之后回读分片核对绑定，未落盘或未核实一律 `CONVERSATION_STATE_WRITE_FAILED`，不返回可用柄；失败发生在投递之前。
3. **锁不可用即结构化失败**。分配/细化在 1 秒内拿不到锁抛新增的 `CONVERSATION_STATE_BUSY`（措辞沿用「no message was sent. Retry the send.」范式），不静默降级。
4. **投递后记账仍是 best-effort**。`recordConversation` 捕获全部失败（锁忙、写失败）后正常 resolve；`federation.ts`、`serve/via-tcp.ts` 的 await 都在既有 try/catch 内，已受理/已送达状态不会被记账失败推翻，也不触发补投。

公开签名由同步改为 Promise：`handleForRef`（返回 `Promise<string | undefined>`，历史撞号时不给 hint）、`claimHandle`、`continueFromRef`、`recordConversation`。`latestKnownConversationRef`、`resolveHandle`、`loadAllPairs` 等只读查询保持同步且不取写锁。所有调用点（`src/application/send/index.ts` 5 处记账 + 接续/分配、`federation.ts`、`via-tcp.ts`）与测试调用已完整 await；`rg` 复查 `src/`、`test/` 无遗漏的裸调用。投递侧 `handle` 本就是可缺省字段，无需改投递逻辑。

## 二、锁域与写路径清单

| 写路径 | 位置 | 是否持锁 |
|---|---|---|
| 分配 `handleForRef` | `src/conversations.ts` | 是 |
| 注入式分配 `claimHandle` | 同上 | 是 |
| 接续+类型细化 `continueFromRef` / `reconcileRefinement` | 同上 | 是 |
| 记账 `recordConversation` | 同上 | 是（失败吞掉） |
| `savePair` / `attachHandle` | 同上（私有） | 只在上述临界区内被调用 |

其他 `src/` 内引用 conversations 目录的模块（`queries/files.ts`、`observations/communications.ts`、`cli.ts`）为只读展示。**本单锁域只覆盖上表四个会话写 API，不覆盖并发维护删除**：`maintenance/operations.ts` 的 cleanup/force-clean 在既有合同内就明确「无传输时执行，写入中的文件可能被删」（`src/commands/clean.ts` 及代码规范保留该语义），属已裁定的维护排除边界，W04-R1 未改动 clean/force-clean 的参数、执行语义、输出或预览。路径别名同一锁域：锁身份先 `realpath`，junction/symlink 与真实路径落到同一端口。

## 三、验证

新增 `test/conversation-state-concurrency.test.ts`（6 项）与两个受控子进程 helper（`test/helpers/conversation-state-allocate.mjs`、`conversation-state-holder.mjs`，后者由测试运行时生成的 CJS preload 在真实写路径的 `renameSync` 处阻塞，用于确定性地占住锁）：

- **多进程真实竞争**：6 个独立进程（3 个同 pair 不同 nonce，另 3 个各占不同 pair）在屏障后同时分配 → 6 个柄互不相同，逐个 `resolveHandle` 回各自完整 ref，分片合计 6 个柄。
- **写路径服从同一互斥**：holder 在别名路径（junction）的真实分配临界区内被阻塞时，`handleForRef` 与 `continueFromRef` 都得到 `CONVERSATION_STATE_BUSY`，`recordConversation` 正常 resolve 且该 pair 分片始终不存在（未写、无幽灵柄）；期间 `resolveHandle` 只读可用；释放后 holder 的柄可解析、新的分配成功。此项同时证明别名与真实路径共用一把锁。
- **同 pair 分配与记账并发**：两柄都在，记账后各自解析到自己的最新轮次。
- **既有撞号**：两分片各含 c1（不同 nonce）→ `handleForRef` 返回 `undefined`（不给歧义 hint，发送照常），`resolveHandle('c1')` 仍报 `INVALID_CONVERSATION_REF` 并列出候选，两份分片字节前后一致（没有按时间/顺序挑赢家，也没有顺手改写）。
- **写失败无幽灵柄**：分片路径被目录占据 → `CONVERSATION_STATE_WRITE_FAILED`，无 handles 落盘，c1 不可解析。
- **投递后记账**：同一写失败场景下 `recordConversation` 正常 resolve（不把已受理改成失败）。

RED 有意义：把构建产物 `dist/conversations.js` 的 `withConversationLock` 临时替换为直通（仅改 build 产物，`src/` 未动）后，本套件 2 失败 4 通过——竞争项出现子进程以 `CONVERSATION_STATE_WRITE_FAILED` 失败、4 进程手工复现里 4 个分配只落下 3 个柄；互斥项两个调用都变成 `resolved` 而非 BUSY。随即 `npm run build` 复原，产物与探测前逐字节一致。这与 W03 记录的「同号不同 nonce / 撞号」是同一缺陷的另一症状面（本次是丢分配），不是把同步改 Promise 的类型失败当成 RED。

原 `test/caller-source-state-lock.test.ts` 改为直接对 `src/state-lock.ts` 的 `withStateLock` 做同样两项检查（活 holder 不被抢占、被杀进程内核释放锁），内存编译的 data URL 子进程同步改指新模块。其余受影响测试只加 `await` 与必要的 `async`，断言一条未弱化、未跳过。

命令与结果（本机 Windows x64 / Node v25.0.0）：

- `npx vitest run`（9 个受影响文件 + 新文件）：全部通过。
- `npx eslint src test`：0 问题。
- `npm run check:imports`：202 模块 / 678 边，无环、无越界。
- `npm run check`：退出 0；228 文件通过 / 3 跳过，**2423 通过 / 11 跳过**（基线 2417/11，增量即新增 6 项）。

## 四、限制与遗留

- 只在 Windows x64 / Node v25.0.0 实跑；Linux/macOS 未执行，平台 CI 总任务仍归 root。
- 锁是**单机**互斥：多机共享同一状态根（网络文件系统）不在本单范围，也未声称覆盖。
- 多进程竞争项是真实进程回归，不是确定性屏障；确定性证据是 holder 项与 W03 的屏障探针。
- 未改动 W03 脚本/结果、root 记录、总表与调度表；未安装/卸载任何软件，未接生产远端，未做真实模型调用或试发。
- 临时进程与目录：两个 helper 子进程由测试自身等待退出并在 `afterAll` 兜底 kill；所有临时根在 `afterAll` 递归删除前核对 `crosschat-conv-lock-` 前缀（`mkdtempSync` 独占创建）；RED 探测用的 `/tmp` 手工脚本与产物备份已删除。
- 剩余 dirty 归属：原未跟踪 `docs/代码消息投递.md` 保持不动，仍属既有工作，未 stage。

## 五、W04-R1 返修（2026-10-29，第二轮）

按 `W04-review.md` 完成 P1/P2 与相关缺口；开始 SHA `be41d98220e48d67f68fc40f57e625f82bcd1618`（root 审计提交），本节由第二轮本地提交交付。首轮内容一至四节保持原样，其中第二节末已按审计裁定把锁域表述收窄为「四个会话写 API + 既有维护排除边界」。

**P1：细化不再替既有撞号挑赢家。** `reconcileRefinement` 迁移柄到目标分片时，目标键若已绑定**别的对话**（不同 nonce），该柄整个不迁移：目标外来绑定与旧分片副本都原样保留，撞号继续以 `INVALID_CONVERSATION_REF` 明确失败；只有键空闲或已属本对话时才迁移。旧副本清理随之只删**实际迁移过**的条目（按记录逐个跟踪），不再无条件删除同 nonce 副本。类型确认持续性、旧 ref 不能回退已知类型、成功会话行不提前推进的既有行为未动。无新存储/迁移/全局兼容方案。root 复放的缺陷我先以测试钉成 RED（细化后目标分片 c1 被当前 nonce 覆盖、两分片字节变化），修复后同测试 GREEN。

**完整 ref 发送回归（root 要求的应用路径）。** 未知→类型目标存在外来同号柄时：`--conversation <完整ref>` + 明确 `--tool` 照常投递**恰好一次**到正确目标，hint 为新分配的安全柄（c2，可唯一解析回本对话）；歧义 `c1` 仍零投递拒绝并列候选。`handleForRef` 返回 `undefined` 的旧行为（3060755）保留。

**tmp 残留。** `savePair` 改为写 tmp 后 `finally` 清理**本次自己**的 tmp（仅当 rename 未消费掉它），不动目标分片、不动他人文件，best-effort/前置失败语义不变。「分片路径被目录占据」用例补无 `*.tmp` 残留断言（本地、SSH、TCP 三处都有）。

**P2：子进程生命周期与接线回归。**

- `runChild`：独立 30s 超时（超时 kill+reject）、`error` 事件 reject、以 `close`（管道排空）结算、输出 64KiB 封顶、env 清 `CROSSCHAT_LIVE`。
- holder 钩子（运行时生成的 preload）自带的等待改为 5s 截止，不再无限自旋；allocate helper 的屏障原本就有界。
- `afterAll` 先 kill 全部未退子进程，再**等 close（5s 上限）**之后才递归删目录；删除前仍核对 tmpdir 直系子目录 + `crosschat-conv-lock-` 前缀。
- 新增异常路径证据：永不释放的 holder 在截止后自行退出并完成分配；加载不到脚本的子进程非零退出不挂起。
- 新增同 nonce 三进程并发复用（同一柄、各自 resolve 回同一完整 ref）。
- 新增细化 vs 同 nonce 刷新竞争（`Promise.all`）：无论加锁顺序，结束态 c1 恰好一条且解析回类型化对话，旧分片无残留副本。
- 新增本机前置锁失败零投递（holder 占锁时 `sendMessage` 报 `CONVERSATION_STATE_BUSY`、`deliverClaude` 零调用；释放后同一发送 delivered 恰好一次）。
- 新增投递后记账失败保持 delivered（delivery 副作用把分片路径换成目录：状态仍 delivered、恰好一次投递、不补投重发、无 tmp 残留）。
- SSH/TCP 已受理回执后本地记账+短柄双失败：`sendViaSsh`/`sendViaTcp` 状态仍 delivered、`handle` undefined、恰好一条远端腿、无 tmp 残留。

**检查**（Windows 11 x64 / Node v25.0.0，最终树）：定向 11 文件 229 项通过；`npx eslint src test` 0 问题；`npm run check` 退出 0，**2433 通过 / 11 跳过**（首轮 2423/11，增量 +10 即新增项）。先 RED 后 GREEN 的记录与数量见 `W04-R1-checks.json`。
