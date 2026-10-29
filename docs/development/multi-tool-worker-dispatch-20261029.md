# 多工具适配 worker 调度与验收

2026-10-29（用户端时间）。用户指定 root 分发、跟进、验收和代码审计，本机 Claude 会话 `cworker1` 执行单个可独立完成的任务；允许本地 commit，不 push。

## 当前合同

- 共用仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；逐单同步基线 SHA，开始和结束都核对真实 branch/HEAD。
- root 已建立本地基线：测试隔离修复 `381c5e5`，C14公共整改 `0f146c00db013178069ad41bd8b84222b26045ac`；最终完整检查2417通过/11原有跳过。未获单独领取的原文件保持；共用 Git index 只交一个 owner，禁止全仓 stage 或相互切分支。
- 每单明确文件白名单、研究/实现范围、步骤、验证、结果报告和清理；worker 可以切换任务，但需把续接状态写入本单报告，不能只留在聊天记忆。
- root 按需求与代码规范分别审查任务独立 commit，检查关键证据和适用边界，必要时独立运行检查。worker 自报完成不等于 root 验收。
- 完成后清理测试进程/便携软件/临时 profile；按用户 D 盘统一清理约定处理被拒删除的下载残留，不重试已拒操作。验收后移除活动子单及引用，保存独立任务书、提交和验收证据。

## 活动子单

暂无执行中的 worker 子单。W07 研究已验收；下一项短柄恢复按用户“不新增落盘文件”的约束由 root 先收敛具体合同，尚未派发 W08 产品单。

已验收子单见[测试隔离审计](evidence/c14-worker-20261029/W00-review.md)、[协作规则审计](evidence/c14-worker-20261029/W02-review.md)、[短柄诊断验收](evidence/c14-worker-20261029/W03-final-review.md)、[短柄产品修复验收](evidence/c14-worker-20261029/W04-final-review.md)、[来源研究验收](evidence/c14-worker-20261029/W01-final-review.md)、[CLI逐调用研究验收](evidence/c14-worker-20261029/W05-final-review.md)、[既有测试等待修复](evidence/c14-worker-20261029/W06-final-review.md)及[短信封恢复研究](evidence/c14-worker-20261029/W07-final-review.md)，活动项不重复保留。root最新完整check为2503通过/11原有跳过，退出0；研究收口不代表生产来源关联或CI门禁已实现。仓库代码/skill未全局部署。历史实机短柄成因未作追认，当前构建的已证实缺陷修复按独立记录收口。

## 后续切分原则

W07研究通过，产品恢复未实施。用户已否决新增短柄运行状态文件；后续优先在现有分片范围收敛安全短柄恢复及满槽/清理后的边界，不将该决定自动视为批准其它持久字段或LRU变化。新增独立账本文件不再作为待拍板建议。不将 W04/W05/W06 验收误称已解决。再按证据继续入口/owner采证或发独立实现单；涉及用户功能、配置要求或持久格式变动时先列影响并按既有批准边界处理。OpenCode多服务来源核实另分单。C13/C04的Harness生命周期和正式Desktop仍按全量计划推进，不用它们代替C14来源接线。当前不批量派发。

全量25任务及11个CI相关索引继续由[总表](tool-compatibility-ci-tasks.md)维护；本页只管理 worker 活动子单，不重编号、不取消原 CI。
