# C14-W03-R1 复核输入：短柄并发分配诊断（返修）

2026-10-29。worker `cworker1` 提交 root 审计。本单只修探针可靠性与修复方案，未改产品实现。

## 基线

- 仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`
- R1 开始 SHA：`fc67602a8624bff266b283c35cb5411adce715a1`
- 完成 commit：本文件所在 commit（见回报消息）
- 运行基线：Node `v25.0.0`，`win32 x64`；运行前 `npm run build` 退出 0
- 实际导入模块 SHA-256：`dist/conversations.js` `85307671f28a281a873bcb476ad13410ac89e67875ed92a02aeaf263c29e8b67`（22484 字节），`dist/ref.js` `4e9f77e5e7a88e315edb7e8a33f0a5f8452fe0e5dd12a7527b4e7b8125187819`；源码 `src/conversations.ts` `1d26abf2…`、`src/ref.ts` `a7216d18…`。哈希、大小、mtime 都写进证据的 `baseline.modules`，不再用 git HEAD 声称 dist 对应源码（`8530767…` 与 root 重建结果一致）
- 未测平台：Linux/macOS 未运行本探针

## 按审计项的修改

**Standards-1 探针有效性**：屏障等待超时现在在 hook 里抛错，worker 非零退出，实验中止，不再"超时后继续跑另一条交错"。子进程 spawn error、非零退出、超时被杀、输出超限截断、无合法 JSON 结果、结果缺 handle/ref、分片形状不符、屏障信号缺失、resolve 非撞号失败——任一出现都记入 `problems`，整个探针以退出码 1 结束，不记为"未复现"。`collision` 只有在**分片里确实存在同号不同 ref**且 resolve 抛出 `INVALID_CONVERSATION_REF` 且信息含撞号语义时才计入；其它 resolve 失败单独算 error。

**Standards-2 生命周期**：`mkdtempSync` 成功后立刻进入 try，初始化写入、屏障目录、hook 文件、子进程全部在 try 内；finally 里先 kill 再 `Promise.allSettled` 等自己的子进程全部结束，清 timer 与 listener（close/error 双通道 + settled 闸门，超时后再给 5 秒收束），然后才删根。删除前用 `ownedTempRoot()` 核实解析后的绝对路径位于本机 tmpdir 且目录名以 `crosschat-w03-` 开头，否则拒绝删除并记为问题。子进程 stdout/stderr 各保留末 64 KiB，超出即判为故障。

**Standards-3 证据保护**：默认只打印一行摘要到 stdout，不写任何文件；`--out <path>` 用 `flag:'wx'` 创建，路径已存在时在创建临时根之前就以退出码 2 拒绝。原 `W03-result.json` 未被读取改写（SHA-256 `011ece28…`，`git diff` 为空）。

**建议**：模块哈希与构建步骤已记录；失败路径不再靠"字符串包含"验证，改由 `W03-probe-check.mjs` 跑真实进程并断言退出码与清理结果。

**Spec-1（P1）**：撤回上一版"最多 3 次 scan 重试保证返回时刻机器级唯一"的说法——扫描与写入/返回不是跨进程原子步骤，增加次数只降低概率。方案已重写，见下文。

**Spec-2**：串行对照结论收窄为"空状态首次分配"。另加真实对照 `control-existing`：先让 s1 分配 `c1`，再由不同 nonce 的 s2 以候选 1 调用 `claimHandle`，验证既有 CAS 改写腿。

**Spec-3**：每个执行者自己在进程内 resolve 自己返回的柄，并把自己的**完整 ref** 与 resolve 结果逐字比较（`resolveVerdict` 分 own / other / collision / error 四类），不再用截断前缀，也不再只解析首个柄。

## 探针现在的判定规则

- 并发场景：两个独立 Node 子进程各自调真实 `dist/conversations.js` 的 `claimHandle(file, ref, 1)`；运行时生成的 CJS preload 只拦 `fs.renameSync` 做三道调度屏障（r1：两次首次分片写入都可见后才允许扫描；pre2：两次重试写入都等双方算完 `max+2`；post2：两次重试写入都落盘后才允许返回并 resolve）。算法、返回值、分片内容全部由真实代码产生。
- 有效运行需要：两进程退出 0、结果合法、6 个屏障信号齐全、各自分片写入次数等于屏障步数（2）、两个分片各 1 条柄。
- `reproduced` 需要：分片里确有同号不同 ref，且两个执行者的 resolve 都返回撞号。
- 探针钉死当前"两次分片写入"的分配形状：分配器形状一变，屏障信号缺失会直接报故障，不会静默通过。修复后需要换用不依赖写次数的检查（见下一单方案）。

## 重放结果

| 场景 | 结果 |
|---|---|
| 并发 ×5 | 5/5 两个执行者都返回 `c3`（不同 nonce），两分片各一条 `c3`，两边 resolve 都是 `INVALID_CONVERSATION_REF` 撞号；屏障信号 6/6，超时 0，退出 0 |
| control-empty | 单执行者空状态 → `c1`，resolve 回自己的 ref，1 个分片 |
| control-existing | s1 → `c1`（own），s2 → `c3`（own）；结束后 `c1` 唯一指向 s1 的 ref、`c3` 唯一指向 s2 的 ref，s2 的过期 `c1` 条目已被丢弃；事后 resolve 两条都对 |

证据：`W03-R1-result.json`（`summary`：7 个有效场景、5 次复现、10 次撞号、0 不匹配、0 故障）。

## 失效路径检查（`W03-probe-check.mjs`，全部 PASS，退出 0）

每个用例在独立 TEMP 下跑真实探针，因此残留的 `crosschat-w03-*` 目录必然属于本单。

| 用例 | 期望 | 实测 |
|---|---|---|
| 正常重放（1 次） | 退出 0、1/1 复现、两个对照有效 | 符合 |
| 初始化失败（state 根父路径是普通文件） | 非零退出、根已清理 | 退出 1 |
| 子进程运行失败（`W03_REPO` 指向无 dist 目录） | 非零退出、记故障 | 退出 1，故障 14 条 |
| 子进程启动失败（worker 脚本不存在） | 非零退出、根已清理 | 退出 1 |
| 子进程输出非法（stub 打印非 JSON、退出 0） | 非零退出、不计为有效未复现 | 退出 1，reproduced 0、故障 10 条 |
| 屏障超时（1 ms） | 非零退出、记为超时、不计为复现 | 退出 1，barrierTimeouts 2 |
| `--out` 指向已有文件 | 退出 2、文件字节不变 | 符合 |
| `--out` 指向新文件 | 退出 0、文件可解析 | 符合 |
| 原 `W03-result.json` | SHA-256 不变 | 符合 |

库函数另有 7 条合成输入断言（重复判定按不同 ref、同 ref 两处不算重复、四类 resolve 判定、越界根不可删）。所有用例结束后 TEMP 下 0 个残留根。

## 已证实与未确定

已证实（确定性重放）：当前构建在"双方首次写入都可见后才扫描、且都在对方重试写入前算出重试号"的时序下，两个独立执行者返回同一短柄，两条映射落进不同分片，双方 resolve 都撞号；`control-existing` 证明现有单次改写腿在**串行**下是有效的（会避开已占用号并清掉自己的过期条目）。串行对照的结论仅限这两条路径，不外推到并发安全。

未确定：真实 `c14` 的历史重复是否由本路径造成（真实状态里无类型/部分类型/全类型三种 pair key 形成多条对话线，与本单并发重复可独立发生）；同 pair `savePair` 覆盖与 `attachHandle` 忽略写入失败导致的幽灵柄，仍只有源码推论，未重放；Linux/macOS 的 rename 时序与原子性未测。

## 下一单最小修复方案（未实施，只给方案）

事实基础：短柄唯一性是机器级不变量，但当前实现把它当作"分片里的一行数据"，唯一性只能在写完之后靠扫描发现，扫描与写入/返回之间没有原子步骤。所以任何"多重试几次"都只是降低概率，不能作为保证——上一版的 3 次重试说法作废。

**候选 A（推荐）：让文件系统承担唯一性。** 把"柄 → ref"改成按柄独占的文件 `conversations/handles/c<N>`，内容 `{ref, nonce, updatedAt}`。

- 分配：`writeFileSync(path, json, { flag: 'wx' })`。创建成功即独占该号（CREATE_NEW/O_EXCL 原子）；`EEXIST` 就试下一个号；连续 100 次失败抛 `CONVERSATION_HANDLE_EXHAUSTED`。`scanMax+1` 仍可用，但只当起点提示，不再承担正确性。
- 读取：`resolveHandle` 只读该文件。不存在 = 过期/未知；内容不可解析 = 明确的"柄不可用"错误，不参与歧义判断。
- 刷新（同 nonce 换最新 ref）：对同一路径 tmp+rename 原子替换，并发下只影响 ref 文本，不影响归属。
- 类型细化（`reconcileRefinement`）：不再需要在两个分片之间搬条目，只改柄文件里的 ref；现在"先写新 pair 再删旧 pair"的中间态随之消失。
- 既有状态迁移：首次写之前把各分片 handle 表 backfill 进 handles 目录，同样用 `wx`。`EEXIST` 且 ref 不同就是既有冲突（真实 c14 这种情况），保留最早 `updatedAt` 的一条，其余记诊断，不静默覆盖。
- 失败规则：创建失败（EACCES/ENOSPC/EROFS）→ `CONVERSATION_STATE_WRITE_FAILED`，绝不返回未持久化的柄；`EEXIST` 不算失败。
- 崩溃：创建成功但内容没写完就被杀，留下不可解析的柄文件。规则是"烧号不重用"——该号永久不可用，读者报明确错误，不需要清理任务；缺口不影响唯一性。
- 平台假设：本地 NTFS/ext4/APFS 的 O_EXCL 原子；SMB/NFS 不保证，但短柄本就是机器级，状态目录必须在本机。
- 影响：新增一个子目录；resolve、刷新、细化三条写路径改写；`recordConversation` 仍要更新柄文件里的 ref（每次发送多一次小写）；`HANDLE_MAX` 淘汰需要同步删柄文件；需要一次幂等 backfill。分片里的 `handles` 表可保留一个版本做兼容读取。

**候选 B（更小改动、保证更弱）：全局互斥。** `mkdirSync(conversations/.handle-lock)` 成功者进入"扫描→写入→复核→返回"整段临界区，退出时删锁。锁内记录 `{pid, host, createdAt}`，超过阈值视为过期，同机用 `process.kill(pid, 0)` 探活后才强拆。保证只对遵守锁的写者成立，且以"没有写者停顿超过过期阈值"为前提；误拆后仍可重复。顺带修复同 pair `savePair` 的 last-write-wins（把 `recordConversation` 也纳入锁）。崩溃会留下锁，分配阻塞到超时恢复。选它就必须把"有界假设"写进文档，不能声称证明。

**两个候选都必须覆盖的写路径**：`handleForRef` 分配；`claimHandle`（探针与测试入口）；`recordConversation`→`refreshHandles` 原地刷新；`reconcileRefinement` 的类型细化迁移；`savePair` 的整分片覆盖（同 pair 并发）。

**不变量（写进实现单）**：任一时刻每个短柄最多对应一个 ref，由原子创建保证而非扫描；返回给调用方的柄必须已持久化，写失败不得返回柄；崩溃只允许留下烧号缺口，不允许留下两个同号映射。

**RED/GREEN**：RED 用本 R1 探针（两进程 + 屏障）→ 同号 + 撞号。GREEN 不要硬套本探针——它钉死了两次写入的形状；应改为不依赖写次数的断言：同一时序下两个执行者拿到不同号、各自 resolve 回自己的完整 ref、柄存储里该号唯一；串行对照 s1=`c1`、s2=下一个可用号；再加"同 pair 并发两次 `recordConversation` 不丢柄"。崩溃场景：写入中途杀进程 → 只留烧号缺口，另一次分配仍成功。

不做：不改 ref 编码、不引入全局计数文件、不改分片 JSON 结构（除非 root 批准候选 A 的 handles 目录）。

## 检查与清理

- `npm run build` 退出 0；四个脚本 `node --check` 均退出 0；探针隔离重跑退出 0（5/5 复现 + 2 个对照）；`W03-probe-check.mjs` 退出 0（33 条断言全 PASS）。
- 未跑产品全量 check（本单无 src 变动，按任务书由 root 统一审计）；未安装/升级工具；未读写真实 `~/.crosschat`；未向任何会话发测试消息。
- 所有临时根都在本机 tmpdir 的 `crosschat-w03-*` 下，运行后已删；失效路径同样收束，无残留进程或目录。
- 原 `W03-result.json`、root 的 `W03-review.md` 逐字未变；剩余 dirty 仅原未跟踪 `docs/代码消息投递.md`。
- 提交说明：上一轮的 amend 偏差已知悉，本轮全部为新提交，不改写历史。

## 本单文件

- `W03-probe.mjs`（重写：判定、生命周期、输出保护）
- `W03-worker.mjs`（重写：各自 resolve 并回传完整 ref）
- `W03-probe-lib.mjs`（新增：共享的纯判定/读分片/根归属工具）
- `W03-probe-check.mjs`（新增：失效路径检查）
- `W03-R1-result.json`（新增：本次重放证据）
- 本文件
