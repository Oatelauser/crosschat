# C14-W04：会话短柄并发写入修复

2026-10-29（用户端时间）。root分发与审计，本机Claude `cworker1` 实施。W03已确认真实分配器在受控并发下5/5同号不同nonce，本单交付产品修复及回归，暂不启动W01。用户已要求解决该缺陷，内部修复可直接推进；现有用户命令、协议、存储、成员和投递合同保持。

## Git和实施边界

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；开始SHA由正式派单给出。先核对实际路径/branch/HEAD；一致直接开工，异常报告，不发纯握手。不checkout/pull/reset/clean/stash/amend/push。root派出后交出写入和index，直到你完成停写；执行中HEAD变化则保存检查点，不自行合并。保留原未跟踪 `docs/代码消息投递.md`，仅stage白名单自己的文件，独立本地commit。

先读AGENTS、代码规范、core-refactor-progress、C14批准合同及本目录W03-final-review。W03 worker提出的新柄目录/迁移/按时间挑选既有冲突方案未获采纳；不增加旧版本或混版分支。

## 选定路线与必须处理的写路径

1. **复用内核管理的跨进程互斥。** 读取 `src/application/caller-source/state-lock.ts` 与 `test/caller-source-state-lock.test.ts`：已有loopback listener独占、进程死亡自动释放、有界异步等待。将实现下沉到低层共享模块（建议 `src/state-lock.ts`），保持原调用的目录规范化、哈希和释放语义；应用层可保留薄的域入口或更新唯一消费端，避免底层conversations反向导入application。不要再造TTL文件锁/进程探活强拆，不复制两套锁算法，不改来源确认业务。
2. **同一实际状态根、同一写锁。** `src/conversations.ts` 的handleForRef、公开claimHandle、recordConversation、continueFromRef内的reconcileRefinement均纳入；先准备父目录，再按真实目录统一锁身份，路径别名不能分成两把锁。分配的扫描、候选判断、写入、验证在同一临界区。内部私有已持锁函数复用算法，避免handleForRef调用claimHandle时非重入死锁；不将锁跨原生投递/网络IO持有。
3. **保留现有持久模型。** JSON分片、cN语法、ref编码、pair key、每分片8条LRU及已有可用同nonce柄保持；句柄分配不推进成功会话行。修复并发唯一性，不新增handles目录、计数器、backfill或自动改写用户真实分片。现有未知/部分类型细化及冲突拒绝继续有效。
4. **已存在的撞号不猜选。** handleForRef复用路径也要核实所复用柄可唯一解析到该对话；既有冲突不能继续发歧义hint，也不能按updatedAt、扫描顺序或最早一条挑赢家。保留明确INVALID_CONVERSATION_REF及完整ref恢复途径；不顺手修复历史用户状态。同nonce的合法细化副本沿用原有明确规则，不把正常旧轮次误判为另一对话。
5. **写入失败不造幽灵柄。** attachHandle检查savePair结果及必要持久化结果；未保存/未核实不返回可用柄。分配/细化前置失败使用现有结构化错误并保证尚未投递；不静默退回无tool或跨类型。超时有界，不等待对端聊天、不轮询原生会话。
6. **投递后记账仍是投递后记账。** recordConversation已在原生delivered/queued/parked之后调用；其写失败/锁不可用不能把已受理改成失败、进入补投或诱发重发。保持既有best-effort语义，核对失败与try/catch边界；SSH/TCP已受理后的本地短柄记录失败也不能推翻远端回执。

## 异步接线与文件白名单

异步互斥需要相关写API返回Promise；可在内部改签名并完整await，不改变CLI用户参数。按 `rg` 查全所有调用，至少包含：

- `src/conversations.ts`；新增 `src/state-lock.ts`；原 `src/application/caller-source/state-lock.ts`，确需更新其唯一消费端时仅 `src/application/caller-source/confirmations.ts` 的锁导入/调用。
- `src/application/send/index.ts`：continueFromRef、分配和各投递分支记账；不能遗漏或制造未处理Promise。
- `src/federation.ts` 与 `src/serve/via-tcp.ts`：回执后的recordConversation/handleForRef同样await，错误保持已送达状态。
- 对应测试：`test/conversations.test.ts`、`send-handle.test.ts`、`c14-conversation-refinement.test.ts`、`c14-explicit-send.test.ts`、`conversation-summary.test.ts`、`tool-type-observations.test.ts`、`tool-type-routing-state.test.ts`、`via-send.test.ts`、`via-tcp.test.ts`、`caller-source-state-lock.test.ts`。原断言不弱化；异步fixture也须await完成再读。
- 可新增 `test/conversation-state-concurrency.test.ts`、`test/state-lock.test.ts` 及有明确所有权的 `test/helpers/conversation-state-*.mjs`，只为有意义的并发/失败行为。新增报告本目录 `W04-review-input.md` 和必要有界 `W04-*.json`。

若rg发现白名单外真实调用者，先给root精确文件与必要性，不能漏掉又宣称完整，也不能扩大到TUI/原生工具接入。W03历史脚本/结果和root记录保持，不把产品修复塞进其探针。总表、调度表及最终验收由root更新。

## 必须验证的行为

- 同状态根的独立执行者同时分配不同pair、同pair不同nonce，成功返回的存续柄唯一，逐个resolve回各自完整原生对话；同nonce并发复用遵守原合同。
- 明确验证实际写路径服从同一互斥，而非只靠概率压力。可先在独立holder占住同一锁，再让分配/记账/细化调用进入：holder释放前不得修改状态，释放后完成。避免在已持锁的分片写入里设置必须等另一写者的屏障造成必然死锁。W03原探针是RED证据，不能机械作为新实现GREEN。
- 同pair的分配与recordConversation并发不丢新柄；细化与刷新、源/收件端类型冲突、LRU、未投递分配不推进会话行、路径别名保持相同锁域。既有撞号明确失败，不任取一个；只读查询不取写锁或产生修复。
- 写入失败/锁获取失败前置时没有原生投递、没有返回幽灵柄；成功投递后记账失败仍保留原状态且不补投/重发。覆盖本机及SSH/TCP回执路径。
- 活holder不能被超时强拆；holder退出/被杀后内核锁释放，下一操作能继续；异常、超时清理listener/socket/子进程与目录。复用原有source-lock检查，原来源确认并发行为不退化。

测试使用独占临时根、合成ref和受控loopback/子进程，不访问真实home配置、会话或模型，不安装工具。记录有意义的RED/GREEN，不能仅因同步函数改Promise而出现类型失败就当缺陷RED。受控多进程测试要与串行/同进程Promise测试分开留证。

先跑对应npm/Vitest与ESLint/构建，再 `npm run check`，通过后无新变更不重复全量。不跳过旧测试/弱化断言来掩盖失败。Windows本机检查如实记录，Linux/macOS未实际运行不算通过，平台CI总任务保留。

## 完成与清理

报告W04、路径/branch/开始与完成SHA、修改文件和目的、锁域与所有写路径清单、既有撞号/幽灵柄/投递后失败结果、RED/GREEN及全部检查退出码/数量、独立本地commit、未决限制、临时进程/目录清理和剩余dirty归属。退出自己的holder/child，递归删除前核对绝对路径与所有权；不处理其他任务或已拒删除残留。不安装/卸载用户软件，不接生产远端、不在远端Linux装Codex。

完成后停写，不启动W01，不等确认、不轮询。只用正式派单给出的仓库CLI及完整ref，显式 `--tool codex-desktop --delivery steer` 回报一次，正文走stdin。若实现后仓库CLI需要刷新，先build再回报；写入不明不重发。
