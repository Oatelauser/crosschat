# DSH托管首轮前置核实

2026-11-04，root只读调查。C05没有运行、推送、建远端分支或创建PR；本记录供后续授权和集成使用。

GitHub Oatelauser/crosschat的main仍为874461ae9ecdb799d880c28c1db30999c2c51555。分支列表与当前开发分支的精确查询均未找到远端codex/core-refactor-pre-tui；默认工作流目录只有ci.yml、deploy-book.yml、publish.yml，尚无dsh-compat.yml。以本地becae8e为比较快照，main独有14个提交、开发线独有297个提交，内容差异634文件；之后的C09本地提交不改变“需要先集成”的事实。这不是仅提交一个workflow就能运行的状态，也不授权本会话接管其它负责人的提交。

GitHub要求workflow_dispatch对应的工作流文件先存在于默认分支，之后才能选择具体分支运行；仅把完整工作流放在开发分支不能满足注册前置条件。依据：[GitHub手动运行文档](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。当前GitHub连接提供分支和文件能力，没有Actions执行接口；取得授权并满足前置条件后，可用官方CLI或API执行，不用界面点击来绕过缺失的默认分支文件。

## 当前可审阅的Windows工作流

- [.github/workflows/dsh-compat.yml](../../.github/workflows/dsh-compat.yml)：周二/五03:47 UTC与手动事件，串行、不取消在途任务；Windows runner 75分钟、Node22、npm ci/build、正式工具与runner本机模型桩。
- 固定正式基线及pnpm摘要来自[baseline](../../scripts/dsh-compat-baseline.json)，候选及重复失败使用相同候选元数据；[串行工装](../../scripts/dsh-compat-ci.mjs)只在资源释放有证明后进入下一安装/删除。
- artifact为dsh-compat-win32-x64，保留21天。Ubuntu报告job只处理JSON，不计为Linux工具验收。
- Issue写权限只在默认分支报告job；必须良好基线通过、同一候选同一兼容项重复失败、报告身份与清理均通过，再按marker去重。下载/环境/工装问题不发兼容Issue，不制造真实失败Issue来验收。

这些配置和本机正式序列已存在；托管run、权限实际效果、artifact下载、定时事件和报告链尚未留证。一次手动成功也不等于已经观察到定时触发。C09的74项Desktop证据以及本地完整check均不能填充C05托管成绩。

## 继续C05需要的决定与证据

1. 用户确定可用远端集成分支、范围及负责集成的人；本会话保留当前共享开发线，不自动把整个分支推送或合入main。
2. 授权的集成范围落盘并经审阅后，再取得对应的推送/PR/合入/Actions执行授权。默认分支须有受审阅的调度工作流，目标ref须包含其实际调用的源码与固定元数据。
3. 针对明确ref执行正式Windows首轮，记录commit/run/job身份、工具版本与摘要、原始报告和清理、artifact可读取性。检查报告job确实按当前分支条件执行或跳过，保留未触发Issue的真实原因。
4. 定时触发、报告权限及去重条件分别补证，不把“YAML已写”或“手动首轮通过”扩成整项C05关闭。

集成条件未就绪时继续C11的Windows npm/Web从零接入开发；不以C05外部条件冻结本地代码，也不自行缩减C00/C12的平台范围。正式Desktop独立runner、可信publisher默认策略、自然Host退出及官方卸载仍沿C04合同。
