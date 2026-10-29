# C14 短信封恢复：歧义短柄的最小方案与隔离验证

2026-10-29（UTC+8）。C14-W07 研究单。基线 `58508d6a78865e884df684092da9979351683f68`，branch `codex/core-refactor-pre-tui`。本单不改产品、不碰用户状态、不试发；结论只针对短柄（`c<数字>`）恢复，不追认真实历史 c14 究竟由哪次竞争产生。

## 一、结论先行

1. 用户看到的“hint 又变成长 mc2”已复现：历史 c14 在两个分片里各绑一个不同 nonce 时，`handleForRef` 返回 `undefined`，`composeEnvelope` 按设计回退完整 ref。
2. “直接补分配一个新号”不是修复：真实 API `claimHandle(file, ref, 15)` 会把本分片同 nonce 的旧 c14 顶掉，另一方的 c14 随即从歧义变成唯一——旧信封里已经发出去的 `c14` 会静默改投另一段对话。实验 E3 实测到这一翻转。
3. 只是“把新号加进分片”也不够：普通记账刷新（`recordConversation → refreshHandles`）会把同一 nonce 的多个柄收敛成最后一个，旧 c14 照样在一轮之后被丢掉（E4）。所以恢复必须同时改“分配”和“刷新”两条腿，否则是假修复。
4. 推荐的最小闭环：**别名式恢复**——撞号对话新分一个号、保留旧号、刷新时保留全部同 nonce 别名；旧的歧义号继续拒绝解析，不挑赢家。不动 LRU8、持久格式、wire、用户命令。
5. “旧柄永不误指”与“零新增持久信息 + 有界 LRU”不可同时满足：需要墓碑/单调号/冲突不淘汰中的至少两项，属新持久信息或新文件，须 user 拍板，本单不实施、不视为批准。
6. 写失败原子性现状成立：分配是单次写 + 写后校验，失败后分片字节不变、无幽灵柄、无 tmp 残留（E5）。W08 的补分配必须沿用这条单写路径，且恢复腿的失败不得把今天能发出去的发送变成失败。

## 二、事实（源码 + 隔离实测）

实验脚本 `docs/development/evidence/c14-worker-20261029/W07-probe.mjs`，结果 `W07-result.json`；只调用构建后的 `dist/conversations.js|ref.js|envelope.js`，状态根为本单独占的 `node_modules/.cache/w07-probe-*`。所有 ref、nonce、分片均为合成；撞号初态（API 已无法再产生）用直接写分片表达，之后每一步都走真实导出函数。

### 2.1 为什么没有柄

`handleForRefLocked`（`src/conversations.ts:602-611`）只在“同 pair 同 nonce 的现存柄全部安全”时返回柄；`resolvesToNonce`（`:613-619`）把“解析成功且 nonce 一致”当安全，`resolveHandle`（`:649-662`）遇到跨 nonce 撞号直接抛 `INVALID_CONVERSATION_REF`，所以该函数吞掉异常返回 false，整个 `mine` 全不安全时就返回 `undefined`。信封侧 `conversationArg = handle ?? ref`（`src/envelope.ts:87`）、hint 用完整 ref（`:98-100`），于是长 mc2 出现在 agent 手边。E1 实测：`handleForRef` 为 `null`，hint 为 `--conversation mc2_…`。

这里要区分三类“多条记录”，本单只处理第一类：

- **历史歧义**：跨分片两个不同 nonce 共用同一号（用户这次遇到的），API 已不会再产生（W04 的 max+1 + CAS + 锁），但旧状态还在。
- **类型细化副本**：同 nonce 的 untyped/typed 两份，`resolveRefinementCopies`（`:665-677`）会把它们合成一个可解析结果，属于已验收的容错，不是本次歧义。
- **新并发撞号**：W04 已修，锁 + CAS 保证新分配唯一，本单不重开。

### 2.2 为什么不能“直接 claim 一个新号”

`claimHandleLocked`（`:632-642`）→ `attachHandle`（`:552-564`）→ `refreshHandles(existing, ref, newHandle)`（`:519-545`）。带 `newHandle` 时，循环里遇到同 nonce 的旧条目走 `continue` 且不写回 `next`——注释写明“superseded by newHandle — dropped”。这正是“同 nonce 换号”本来的去重语义，但用在撞号恢复上就变成：**删掉的是本对话的旧号，留下的另一份旧号独占该数字**。

E3 实测（两分片各持 `c14`，nonce 不同）：

- `claimHandle(file, refA(下一轮), 15)` 返回 `c15`，本分片 handles 从 `{c14}` 变为 `{c15}`；
- 本分片会话行 `ref/updatedAt` 未变，对方分片字节完全未动（单写只触本分片）；
- `resolveHandle('c14')` 从抛“撞号”变为返回**对方**的 ref（`isForeign: true`）。

也就是说，“恢复一个新柄”顺手把旧 `c14` 判给了另一方——正是任务禁止的静默选赢家。任何“改写其中一侧”的做法（例如把对方的 c14 迁到新号）都只是换一边选赢家，同样否掉。

### 2.3 双柄为什么不自动稳

就算把新号以追加方式写进分片（`{c14, c15}` 同 nonce），下一次普通记账就会收敛：`refreshHandles` 在无 `newHandle` 的刷新腿里，对每个同 nonce 条目只记 `touched = handle`（后者覆盖前者）并 `continue`，循环结束只把**最后一个**写回。E4 实测：`recordConversation(file, 下一轮)` 之后 handles 只剩 `{c15}`，`resolveHandle('c14')` 又回到对方对话。

结论：W08 若只改分配腿，翻转会推迟到“这一发投递成功后的一瞬间”，比立即翻转更隐蔽，同样不可接受。刷新腿必须同时改为“同 nonce 的每个别名都就地换成本轮 ref”。

### 2.4 写失败、并发与“幽灵柄”

- `attachHandle` 是单次 `savePair`（tmp + rename）后回读校验，校验不过返回 false，`claimHandle` 抛 `CONVERSATION_STATE_WRITE_FAILED`；发送在投递前失败，不发消息。
- E5：把本分片设为只读后 `claimHandle` 抛写失败，分片字节与初态**逐字节相同**（旧 c14 保留、仍撞号），目录内无 `.tmp` 残留。
- 并发由 `withConversationLock`（`:576-580`，目录级真实锁）串行化；`claimHandleLocked` 的 CAS 重试在“候选号已属他处”时改用 `max+2` 再写一次。
- 有一个需要 W08 注意的顺序问题：CAS 第二次 `attachHandle` 会沿用“同 nonce 即顶替”的规则。若恢复腿在两次写之间中断，第一次写入的号会残留在分片里（它是我们自己的同 nonce，不会误指，但会占一个 LRU 槽）。补分配必须让“重试只替换本次刚写的号，不碰既有别名”。

### 2.5 全部会话写者与只读边界

生产里只有五处写入口，`claimHandle` 在 `src/` 内不被直接调用（测试用）：

| 入口 | 位置 | 与恢复的关系 |
| --- | --- | --- |
| `handleForRef` | `conversations.ts:596-611`；`send/index.ts:473-475`、`federation.ts:363-364`、`serve/via-tcp.ts:536-537` | 分配/复用柄，撞号时返回 undefined —— 恢复点 |
| `claimHandle` | `conversations.ts:626-642` | 分配原语，恢复必须走它或同构单写 |
| `recordConversation` | `conversations.ts:424-456` | 刷新腿，别名收敛问题的来源；失败吞掉不影响已投递 |
| `continueFromRef` → `reconcileRefinement` | `:259-364` | 迁移柄：目标号已属他人则跳过不迁移（不选赢家），迁移后按 `HANDLE_MAX` 修剪（`:337`） |
| `continueConversation` | `:222-241` | 只读（不写状态） |
| 只读：`resolveHandle`、`latestKnownConversationRef`、`machineNameOfPair`、`loadAllPairs` 及 `queries/files.ts` 展示 | — | 不写；恢复方案不改解析语义 |
| 维护删除：`clean/force-clean` | `application/maintenance/operations.ts:62-72` | 无锁删 `conversations/*.json`，既有合同“无传输时执行、写入中文件可能被删” |

### 2.6 与既有测试的关系

- `test/conversations.test.ts:196-271` 覆盖复用/分配/LRU8/CAS/“分配不推进会话行”。
- `test/conversation-state-concurrency.test.ts:292-313` 已锚定“既有撞号不出 hint、完整 ref 照发、两个分片字节不动”；`:315-325` 锚定“写失败无幽灵柄、无 tmp”。
- `test/c14-conversation-refinement.test.ts:216-242` 已锚定“细化跳过外来同号柄、两侧字节不动”，并在**新 pair** 上拿到安全新柄（`c2`）。
- `:244-269` 锚定“完整 ref 经外来撞号仍只投递一次，hint 是新安全柄”。

所以“细化到新 pair 后能恢复”这条路已经存在，缺的只是“柄留在原 pair、数字被他人占用”这一种——也就是用户这次遇到的形状。

## 三、候选与具体反例

| 候选 | 结果 | 反例/代价 |
| --- | --- | --- |
| A 维持现状（无柄，长 ref） | 安全但不满足恢复目标 | 用户每次都要手抄百字符 mc2；本轮问题本身 |
| B 直接 `claimHandle` 新号 | **否** | E3：本分片旧号被顶掉，旧 c14 从歧义变为唯一指向对方 |
| C 追加别名 + 刷新保留全部别名 | **推荐** | 见第四节；代价是撞号对话多占 LRU 槽、旧版降级会回到 E4 行为 |
| D 冲突墓碑 / 号不重用（新持久信息） | 需 user 拍板，本单不实施 | 见 4.3；跨分片墓碑要机器级新文件，退化路径多 |
| E 改写另一方到新号 | 否 | 换一边选赢家，对方旧信封的 c14 改投我们，问题对称搬家 |
| F 给柄加 TTL/上界强制过期 | 否 | 会连带过期所有超过时限的合法柄，用户面退化 |

## 四、推荐方案与下一单

### 4.1 别名式恢复（W08 候选范围）

目标：撞号对话重新拿到安全短柄；旧号一个字节不动、继续拒绝解析；端点/类型/nonce/轮次/路由不变；不补投；写失败不产生幽灵柄，也不新增今天没有的失败。

1. **分配腿**（`handleForRefLocked`）：`mine` 非空但无安全柄时，按 `max+1` 申请一个新号，但以“追加”模式写入——保留本分片已有的同 nonce 条目，只替换/新增本次申请的号。所有失败（写失败、CAS 重试后仍冲突）在**恢复腿**上回落为 `undefined`（即今天的长 ref 行为）；加锁失败仍按现状抛 `CONVERSATION_STATE_BUSY`，避免改变既有失败面。
2. **刷新腿**（`refreshHandles` 无 `newHandle` 分支）：凡同 nonce 条目都就地换成当前 ref 并保持相对顺序，而不是只留最后一个。这样 E4 的收敛不再发生，别名能随轮次自新。
3. **CAS 重试**：第二次写入只顶替本次刚写的号，不得删既有别名（见 2.4 的顺序问题）。
4. **不改**：`HANDLE_MAX=8`、LRU 顺序语义、分片 JSON 形状（仍只有 `pair/ref/updatedAt/handles/machines`）、短柄语法与 hint 文案、`resolveHandle` 的拒绝语义、ref 编码、维护删除合同。
5. **兼容说明**：旧版本读新状态无碍（仍是 `handles` 映射）；但旧版本一旦执行刷新，会按旧规则把别名收敛掉——即**降级到旧版本会退回 E4 的翻转行为**。这是版本回退风险，不是格式不兼容，须在提交说明里写明。

### 4.2 W08 必须的 RED-GREEN（先红后绿，不得只测返回值）

1. **RED（当前）**：跨分片不同 nonce 同号 → `handleForRef` 无柄（E1 已提供现成脚本形态）。
2. **GREEN 恢复**：同一状态 → 返回新号；本分片旧号仍在且仍撞号；对方分片字节不变；新号唯一解析到本对话。
3. **GREEN 刷新不翻转**：恢复后 `recordConversation(下一轮)` → 新旧两个号都指向本对话最新 ref；`resolveHandle(旧号)` 仍抛撞号；`resolveHandle(新号)` 唯一。
4. **LRU8 不回归**：别名计入 8 槽上限，第 9 个仍淘汰最久未触碰；普通对话（无撞号）槽位占用与今天完全一致。
5. **CAS/并发**：两个进程同时对同一撞号对话恢复 → 同一个新号；不同撞号对话并发 → 不同新号、各自唯一；重试不产生孤立别名。
6. **写失败**：恢复腿写失败 → 返回 undefined（长 ref 照发），分片字节不变、无 tmp、无幽灵柄；普通分配写失败仍按 `conversation-state-concurrency.test.ts:315` 抛 `CONVERSATION_STATE_WRITE_FAILED`。
7. **发送路径端到端**：完整 ref 发送经撞号 → 只投递一次、hint 是新号、会话行/轮次/类型/nonce 不变；投递后记账失败仍只投递一次。
8. **细化兼容**：撞号对话带别名做 untyped→typed 细化 → 两个别名一起迁移（目标号被占则跳过那个号），两侧不出现赢家；`HANDLE_MAX` 修剪行为有断言。

涉及文件：`src/conversations.ts`（`refreshHandles`/`attachHandle`/`claimHandleLocked`/`handleForRefLocked`），测试 `test/conversations.test.ts`、`test/conversation-state-concurrency.test.ts`、`test/c14-conversation-refinement.test.ts`（或同目录新测试文件）。`src/application/send/index.ts`、`src/envelope.ts`、`src/ref.ts` 预期不需要改；若需要，说明为什么。

### 4.3 “本次恢复暂不选边”与“旧柄永不误指”不是一回事

- **本次恢复暂不选边**（本单可给出的保证）：恢复动作不删除、不改写任何旧号，旧号在解析侧保持歧义拒绝；新号唯一指向本对话。
- **旧柄永不误指**（本单无法给出）：任何发出过的 cN，将来要么指向原对话、要么明确过期/歧义，绝不指向另一段对话。

后者与现状约束冲突，原因是三条各自独立：

1. **有界淘汰**：`HANDLE_MAX=8` 的 LRU 会单边淘汰撞号两侧之一（`test/conversations.test.ts:231-244` 已验证淘汰发生）。幸存的一份让旧号“唯一”指向另一个对话——今天的 W07 修复不改变这一点。
2. **零新增持久信息**：没有任何字段记录“c14 曾经歧义”。一旦两侧都被淘汰，`max+1` 分配器（以现存柄最大值计）可能重新发出 c14，旧信封的 c14 便改投新对话。这是今天已有的历史柄复用风险，与撞号无关。
3. **清理删除**：`clean/force-clean` 无锁删分片，删掉的可能是撞号任一侧，效果同上。

要达到“永不误指”，至少需要下列组合之一，全部触碰既有合同：

| 需要的变化 | 具体成本 | 用户影响 | 需拍板 |
| --- | --- | --- | --- |
| 冲突墓碑：机器级记录“该号曾歧义”，解析时直接拒绝，分配时跳过 | 新增持久文件或跨分片字段；需并入同一把会话锁；`clean` 删除后墓碑丢失即退化；旧版本重写分片会忽略未知字段 | 撞号另一方的合法旧柄在该号孪生被淘汰后开始报“歧义”，不再“恰好还能用” | 是 |
| 号永不重用：持久单调计数器 | 机器级计数器（同样落成新文件或跨分片扫描不可靠） | 号数字单调增长，无直接可见变化 | 是 |
| 冲突号不淘汰（pin） | 打破 `HANDLE_MAX=8` 的有界性；需要记录 pin 集 | 每机器状态量不再有硬上界 | 是 |

任何“上界/TTL 强制过期”的折中都会连带过期所有超龄的合法柄（候选 F），用户面退化，不推荐。

**推荐给 user 的拍板项**只有一句：接受“恢复不选边 + 残留误指窗口（仅由 LRU/清理触发，与现状同类）”，还是为“永不误指”支付上表的持久化成本。W08 只做前者即可独立验收，不被后者阻塞。

## 五、本单不做的事

- 不实施产品改动，不创建 W08 票，不替 root 决定持久化。
- 不追认真实历史 c14 的根因（W04 已明确不作追认），不重开 W05 原生来源研究。
- 不读写真机 `~/.crosschat`、不触发跨机 send、不安装工具、不留常驻进程。
- 不重跑已修 W03 并发缺陷当作新成果。

## 六、事实与未决清单

事实：E1-E5 均已用真实 API 复现/证伪（见 `W07-review-input.md`）；`claimHandle` 在 `src/` 无生产调用；细化迁移已跳过外来同号柄；写失败单写原子、无幽灵柄；清理删除在既有合同内无锁。

未决：是否支付 4.3 的持久化成本（user 拍板）；降级到旧版本会退回别名收敛（需在 W08 提交说明）；LRU 槽位被别名占用后的具体淘汰次序（W08 用测试锚定即可，不需要新策略）。
