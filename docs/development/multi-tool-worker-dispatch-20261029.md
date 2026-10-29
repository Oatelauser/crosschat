# 多工具适配 worker 调度与验收

2026-10-29（用户端时间）。用户指定 root 分发、跟进、验收和代码审计，本机 Claude 会话 `cworker1` 执行单个可独立完成的任务；允许本地 commit，不 push。

## 当前合同

- 共用仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；逐单同步基线 SHA，开始和结束都核对真实 branch/HEAD。
- root 已建立本地基线：测试隔离修复 `381c5e5`，C14公共整改 `0f146c00db013178069ad41bd8b84222b26045ac`；最终完整检查2417通过/11原有跳过。未获单独领取的原文件保持；共用 Git index 只交一个 owner，禁止全仓 stage 或相互切分支。
- 每单明确文件白名单、研究/实现范围、步骤、验证、结果报告和清理；worker 可以切换任务，但需把续接状态写入本单报告，不能只留在聊天记忆。
- root 按需求与代码规范分别审查任务独立 commit，检查关键证据和适用边界，必要时独立运行检查。worker 自报完成不等于 root 验收。
- 完成后清理测试进程/便携软件/临时 profile；按用户 D 盘统一清理约定处理被拒删除的下载残留，不重试已拒操作。验收后移除活动子单及引用，保存独立任务书、提交和验收证据。

## 活动子单

本会话不再派发通信相关子单。用户明确将全部通信任务交给现有 Codex Desktop 会话 **Bug修复2**，由用户亲自对接；见[完整交接](communication-handoff-bugfix2-20261029.md)。cworker1 和短信封内部 subagent 均已停写，后者确认没有任何代码/测试修改。W08 最新研究交付到 `1066e30`，尚未完成 root 最终验收，按真实状态随证据交接。

已验收子单见[测试隔离审计](evidence/c14-worker-20261029/W00-review.md)、[协作规则审计](evidence/c14-worker-20261029/W02-review.md)、[短柄诊断验收](evidence/c14-worker-20261029/W03-final-review.md)、[短柄产品修复验收](evidence/c14-worker-20261029/W04-final-review.md)、[来源研究验收](evidence/c14-worker-20261029/W01-final-review.md)、[CLI逐调用研究验收](evidence/c14-worker-20261029/W05-final-review.md)、[既有测试等待修复](evidence/c14-worker-20261029/W06-final-review.md)及[短信封恢复研究](evidence/c14-worker-20261029/W07-final-review.md)，活动项不重复保留。root最新完整check为2503通过/11原有跳过，退出0；研究收口不代表生产来源关联或CI门禁已实现。仓库代码/skill未全局部署。历史实机短柄成因未作追认，当前构建的已证实缺陷修复按独立记录收口。

## 后续切分原则

本会话先前将“开始下一个任务”误解为跳过短信封，已被用户纠正：短信封应先讨论“不新增文件”的方案，未经确认不得修改代码。随后用户要求通信任务整体交接 Bug修复2，由用户直接确定后续。W07研究不等于产品恢复；新增独立账本文件已否决，其它字段/LRU/清理变化未自动批准。本页只留事实和交接入口，不继续派通信任务，也不把研究结果记成工具/CI整体完成。

全量25任务及11个CI相关索引继续由[总表](tool-compatibility-ci-tasks.md)维护；本页只管理 worker 活动子单，不重编号、不取消原 CI。
