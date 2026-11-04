# C14-W04 首轮审计与R1返修

2026-10-29（用户端时间）。root审计范围 `fe1f79ee3c1727fbf5cf0fed4d71d4b7b1c98e77...30607559032cca4fa1d499af7b3200fd82f472b0`，包含主体 `1ffefcf` 与修正 `3060755`。branch `codex/core-refactor-pre-tui`。worker已停写；20个交付文件均在授权范围，原未跟踪 `docs/代码消息投递.md` 保留，未push/amend。

## 已核对与接受的实现选择

共享锁下沉保持原目录规范化、哈希端口、独占及释放算法，依赖方向正确。四个会话写API已纳入同一锁域，本机/SSH/TCP生产调用的await未发现确定遗漏，原测试调整未见弱化。

`3060755`在既有短柄撞号时不给歧义hint，但已核实完整ref继续发送；直接使用歧义cN仍明确拒绝。这一处理符合明确原生身份/收件类型及完整ref恢复合同，root接受其意图，不要求完整ref因可选短柄冲突拒发；必须补真正send路径测试，不能仅以handleForRef返回undefined证明完整发送已验证。

root独立运行定向npm/Vitest：8文件、156项通过，包含新并发6项、内核锁2项、会话/细化/发送及SSH/TCP回归；差异检查通过。worker报告完整check2423通过/11原有跳过，root尚未重复全量，待本单修正后统一验收。

## Standards

独立规范审计2项P2，root复核同意：

1. 新 `test/conversation-state-concurrency.test.ts` 的runChild没有error处理/独立超时，以exit结算早于管道close；holder屏障无限等待；afterAll仅kill不等close即删除目录。失败/超时可能未捕获错误或清理竞争，须有界收束后再删除。新子进程还须清除CROSSCHAT_LIVE以满足隔离规则。
2. `savePair`写tmp后rename失败会遗留本次tmp，新“分片路径是目录”失败场景直接触发。该相关旧缺口在本单触及失败路径时一并收口：只清理本次拥有的临时文件，不扩大清理或覆盖原分片，增加无残留断言。

## Spec

### P1：类型细化覆盖已有外来同号柄

`reconcileRefinement`复制旧记录handles到目标分片时，直接以同名key覆盖已有值，再从旧分片删副本。目标分片若已有另一个nonce的同号柄，会替既有撞号挑赢家，违反“不猜选、不修历史、保留冲突与完整ref恢复”。

root已对当前dist独立重放：合成未知类型原对话和完整类型目标pair，分别放同号c1、不同nonce；细化前resolve c1报INVALID_CONVERSATION_REF，执行continueFromRef后目标外来绑定被当前nonce覆盖，c1不再歧义而指向当前对话。临时实验根已核对归属并清理，未读写真实状态。

R1必须保留外来绑定和原冲突，不能按时间、顺序或当前发送方挑赢家。已核实完整ref的收发仍可继续，必要时使用完整ref或为本次正常发送建立新安全柄；不得靠改写两条旧冲突映射“恢复”。正常类型确认的持续性、旧ref不能回退已知类型、成功会话行不提前推进的既有合同继续成立。加入未知→类型目标同号异nonce的真实send回归及同nonce合法细化副本/类型冲突检查。

### P2：关键接线验收不完整

新测试尚未覆盖同nonce多进程复用、细化与刷新竞争，也没有本机/SSH/TCP真实应用路径“前置失败零投递／已受理后记账失败保持成功且零重发”的完整断言。recordConversation不抛的单函数用例不足以证明接线。R1补这些有意义的行为回归，复用已有fixture，禁止模型/真实聊天/生产远端。

## 清理边界的归类修正

首轮Spec曾将cleanup删除分片未纳锁列为P1；root核对 `src/commands/clean.ts` 已有“无传输时执行，写入中文件可能被删”的明确合同及代码规范保留清理语义要求后，独立Spec审计撤回此项阻断。它是既有维护排除边界，本单不改变clean/force-clean的参数、执行语义、输出或预览合同。

报告必须把“全部写者同锁”收窄为四个会话写API；不能声称覆盖并发维护删除。若未来要改该边界，另列实际影响并按既有批准规则处理，不夹入W04。

## R1范围、检查与续接

沿用W04原白名单，重点修改conversations细化/临时文件失败路径、新测试/helper及本目录W04报告/有界R1证据。完整回归可补原授权send-handle、c14-refinement/explicit-send、via-send/via-tcp测试。不要改维护/CLI/协议/存储结构/skill或W03历史证据。

先保留有意义的RED证据，再GREEN；检查实际进程故障/屏障异常的退出和清理，最终执行对应定向测试与 `npm run check`，完成后停写并报告。root收到后双轴复审，不以投递返回delivered当任务验收。不启动W01。

当前结论：W04未验收，待R1；接受完整ref继续发送的行为选择，保留C14既有显式tool和用户命令合同。产品缺陷尚未完成修复验收。
