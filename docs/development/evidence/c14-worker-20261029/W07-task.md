# C14-W07：短信封恢复的最小方案与隔离验证

2026-10-29（UTC+8）。root 分发/审计，本机 Claude `cworker1` 执行。用户发现 reply hint 又变成长 mc2；W04 防止新并发撞号，保留的历史 c14 歧义仍令 handleForRef 返回 undefined，信封回退完整 ref。此次先做一个可独立验收的方案/隔离验证单，**不改产品，不动用户状态，不试发**，避免在已有 LRU/会话合同上临时补洞。

## Git、白名单与资料

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，正式派单给新基线。核对一致直接执行；worker 独占本单文件/index，禁止 checkout/pull/reset/clean/stash/amend/push，只提交白名单本地新 commit。原未跟踪 `docs/代码消息投递.md` 原样保留。

必读 AGENTS、代码规范、W04-final-review.md、C14已批准合同、`src/conversations.ts`、`src/envelope.ts`、`src/application/send/index.ts` 及相关短柄/并发/细化测试；不要重新打开已验收 W05 的原生来源研究。

允许新增：

- `docs/research/c14-short-hint-recovery-20261029.md`：研究结果、事实/未决、最小方案与下一实施单。
- `docs/development/evidence/c14-worker-20261029/W07-review-input.md`：基线、具体合成实验及检查。
- 如需要可在同目录新增 `W07-probe.mjs` 与小型结果 JSON；默认只打印，不覆盖证据；不得引入新依赖/大型工装。先纯内存/现有真实 API 的临时 fixture 足够则不新增脚本。

src、test、skill、包文件、root记录、W03/W05历史、调度总表不改。禁止读写真实 ~/.crosschat、原生聊天/配置；不能删除/恢复/重命名真实会话或触发 crosschat send。

## 要回答的问题

1. 用源码与隔离合成两分片复现：两个不同 nonce 共用 c14，完整原会话 ref 可继续但 handleForRef 无安全柄，composeEnvelope 选择完整 ref。区分该历史歧义、C14类型细化产生多条记录和新的并发分配（后者已修），不追认真实历史根因。
2. 明确为什么不能简单调用 claimHandle 分配 c15：refreshHandles 新柄路径丢弃同 nonce 旧柄，可能让旧 c14 从歧义突然变为唯一指向另一会话；recordConversation/refinement/LRU8 后续也可能改变旧副本。按真实 API 做最小反例，不能由手填预期结果冒充实际行为。
3. 给最小实现候选并逐项审计全部会话写者：handleForRef、claimHandle、recordConversation→refreshHandles、continueFromRef→reconcileRefinement，以及只读resolve和清理既有边界。目标是新 hint 恢复安全短柄、原端点/类型/nonce/轮次/路由不变、旧歧义不能静默挑赢家、并发和写失败不返回幽灵柄；投递后记账故障不导致补投。保留已批准满分片 LRU8、无新存储格式/wire/用户命令优先，但不能为了声称零变化隐瞒不可同时满足的约束。
4. 特别分析旧歧义的时间边界：若要求永远记得旧 c14 曾撞号，与既有有界 LRU/删除及零新增持久信息是否冲突？需新字段、冲突墓碑/保留策略或改变过期语义时，列出最小具体变化、用户影响和成本，交 root/user 决定，**本单不实施或视作已批准**。不要循环提出反复扫描就可证明永久唯一。
5. 输出推荐方案、被否候选的具体反例、必须保留的断言/RED-GREEN、下一产品单精确文件/步骤/验收、尚需用户拍板的功能/持久格式变化。若现合同可以内部实现，给闭环论证和最小隔离证据；若不能，明确阻塞点而非给一个“以后研究”空结论。

## 验证、生命周期与回报

仅合成 ref/临时状态，用现有真实会话模块函数，不读用户状态/模型/原生工具。调用当前 dist 时先记对应 src/dist 哈希或 build 后核对，不假定 HEAD 自动等于 dist；只研究代码可以不 build。若新可执行脚本，语法检查及必要失效用例有界；不为纯报告跑全量 npmcheck或做文字包含测试。输出不超过必需大小，不保存全环境/真实ID/正文。

临时根在仓库 node_modules/.cache 下独占创建，排他 ownership、实验根与留存证据分开。无新增常驻进程；清理前核实绝对父路径/任务前缀和本次归属，被拒删除保留报告，不换手段。已有 W05 cache 日志不属本单，不触碰。

报告分支/起止SHA/文件/commit、具体实验命令/实际输出、候选与合同冲突、推荐下一单、检查和清理/未决。独立本地新提交后停写，不接产品实现、不轮询/等回执。使用正式派单完整 ref、约定仓库入口、`--tool codex-desktop --delivery steer` 汇报。
