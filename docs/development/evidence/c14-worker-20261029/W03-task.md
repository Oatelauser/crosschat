# C14-W03：当前构建短柄并发分配诊断

2026-10-29（用户端时间）。用户要求解决本次crosschat协作的等待和回信故障；W02已收口流程/skill修订，本单单独查短柄分配，不把历史实机现象直接归因于推测。root分发和审计，本机Claude `cworker1` 执行。本单交付可重放证据和修复方案，不修改产品实现。

## Git与范围

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，开始SHA由正式派单给出。先核对真实路径/branch/HEAD和dirty归属，不checkout/pull/reset/clean/stash。root派出后交出写入与index，不并行提交；若HEAD意外变化，保存检查点并报告，不自行合并。只stage自己的白名单文件，本地独立commit，不push/amend，保留原未跟踪 `docs/代码消息投递.md`。

只允许新增或修改本目录内：`W03-review-input.md`、`W03-probe.mjs`、必要的 `W03-worker.mjs` 和有界脱敏 `W03-*.json` 证据。不改src、现有测试、package/依赖、skill、全量任务表或用户数据。不要把“期望发生撞号”固化成产品回归测试。探针通过已有构建导出的真实函数运行，独立于产品正常入口。

## 已知事实与必读

- 读AGENTS、代码规范、本目录W02-review与W02-review-input；当前公共C14合同在 `docs/development/c14-explicit-tool-design-20261028.md`。所有send仍显式收件tool，不恢复旧兼容。
- 真实c14曾对应不同nonce，诊断尚未证明哪次分配/刷新导致；全局和仓库构建曾并存，但不设计混版适配，不改写真实分片“修复”。
- 读 `src/conversations.ts` 的loadAllPairs、savePair、refreshHandles、attachHandle、handleForRef、claimHandle、recordConversation和resolveHandle；沿调用点核对，不能只看函数注释。
- 读 `test/conversations.test.ts` 的F2短柄用例及 `test/send-handle.test.ts`。已有claimHandle(file,ref,1)串行测试只模拟一次过时候选，不能证明真实并发或第二次改写安全。

## 独立实施步骤

1. 画出当前分配的实际读写顺序：扫描max、分片写入、写后扫描、单次改写和返回。列出可能碰撞/丢失的位置，区分推论和已重放事实；确认实际运行的是本仓库构建。
2. 使用mkdtemp创建任务独占的临时状态根和合成端点/ref。通过实际导出的handleForRef/claimHandle/resolveHandle验证。禁止访问真实home中的conversations/outbox、发送真实测试消息或安装工具。
3. 优先做确定性时序：两个独立执行者在相同初始扫描后竞争相同候选，以及两者写后扫描完成后同时进入唯一重试。可使用受控worker/子进程、文件系统时序拦截或最小重放屏障；屏障仅控制调度，不能伪造算法返回值、手写重复handle分片冒充分配器结果、替换分配算法。有界压力仅作补充，未撞到不能证明不存在。
4. 保留最小可直接重跑的探针与JSON：运行基线/Node/平台、参与者数、同步步骤、各执行者返回的短柄、结束时各短柄的resolve结果、临时路径归属及清理结果。源码推论、确定性隔离重放和概率压力分别记录。重放新发现并不证明当时真实c14一定由同一路径造成。
5. 诊断流程与所有子进程/worker都有明确owner、超时和finally清理；失败时也退出，不能无限等屏障。只清理已验证位于本单mkdtemp根内的文件；不处理其他任务残留。真实发送结束后不等root确认、不轮询状态。
6. 给下一单最小修复建议，说明文件、内部接口、并发不变量和有意义的RED/GREEN场景。评估分配与刷新是否会相互覆盖、写入失败是否会返回不存在的短柄，以及跨平台原子性/崩溃残留；仅记录与本次路径有关的问题，不扩成全仓持久化重构。不要先引入锁、全局计数文件、改ref或存储格式；需要结构改变时给root具体方案与影响。

若当前构建不能稳定复现，完成结论应是“尚未复现”，列出尝试、限制与下一步，不宣称已修复或没有缺陷。若屏障需要侵入src或超出文件白名单，先报告具体必要性，继续其余只读分析，不先实施。

## 检查、报告与完成

使用仓库npm/Vitest入口；需要刷新dist时允许 `npm run build`，不安装依赖。独立诊断脚本做 `node --check` 和真实隔离重跑，记录命令、退出码、可重复次数和清理结果。纯诊断不重复产品全量check；若最终建议进入产品，由root另派实现并要求正式回归。

报告必须包含W03、路径/branch/开始与完成SHA、文件、精确复现步骤、证据定位、已证实与未确定、下一单修复方案、未测平台、检查、子进程/目录清理和剩余dirty归属。完成后停写，不自行启动W01或实施修复。

回报只发root一次：使用正式派单约定的仓库CLI、原对话完整ref、`--tool codex-desktop --delivery steer`，长正文走stdin。原短柄已撞号，本单不用c14；写入不明不重发。root实际收到报告后才记回报路径通过，不自证已验收。
