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

其他 `src/` 内引用 conversations 目录的模块（`queries/files.ts`、`observations/communications.ts`、`maintenance/operations.ts`、`cli.ts`）均为只读展示或 cleanup 维护路径，不写分片，未纳入本单。路径别名同一锁域：锁身份先 `realpath`，junction/symlink 与真实路径落到同一端口。

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
