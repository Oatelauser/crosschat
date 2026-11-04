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

2026-11-04追加C11：新增[从零手动工作流](../../.github/workflows/dsh-onboarding-compat.yml)，Windows/Node22、独立dsh-onboarding-win32-x64 artifact、保留21天，复用正式包摘要/串行生命周期。六阶段报告与C05八项通信报告分离，默认入口保持通信检查；本地验收见[C11摘要](evidence/c11-dsh-20261104/validation.json)。报告job仍只处理有界JSON、无checkout或执行原生代码，默认分支才有issues:write，独立重核基线/候选/重试、精确scope及完整释放后去重；没有新增定时。文件存在与本地Node25运行不代表GitHub Node22已验收，远端集成及Actions授权沿下述边界。

## 继续C05需要的决定与证据

1. 用户确定可用远端集成分支、范围及负责集成的人；本会话保留当前共享开发线，不自动把整个分支推送或合入main。
2. 授权的集成范围落盘并经审阅后，再取得对应的推送/PR/合入/Actions执行授权。默认分支须有受审阅的调度工作流，目标ref须包含其实际调用的源码与固定元数据。
3. 针对明确ref执行正式Windows首轮，记录commit/run/job身份、工具版本与摘要、原始报告和清理、artifact可读取性。检查报告job确实按当前分支条件执行或跳过，保留未触发Issue的真实原因。
4. 定时触发、报告权限及去重条件分别补证，不把“YAML已写”或“手动首轮通过”扩成整项C05关闭。

2026-11-04后续：C11的Windows npm/Web从零本地切片现已验收，不再作为待开发项目重开。正式Desktop同一原生UI会话→Host自然退出的固定包本地观察切片也已验收，见[自然退出摘要](evidence/c04-natural-exit-20261104/validation.json)；它不替代C2可信runner接线、独立干净runner、可信publisher默认策略或官方卸载。C00/C12的平台范围保持待决定，不自行缩减。

## 最新集成差异与本地虚拟合并预览

2026-11-04 04:49:13 UTC重新通过GitHub连接只读核实：main仍为874461ae9ecdb799d880c28c1db30999c2c51555；返回的11个远端分支中没有codex/core-refactor-pre-tui，main的工作流目录仍只有ci.yml、deploy-book.yml、publish.yml。本次两类DSH工作流均未进入默认分支。精确查询快照、原始合并预览及无外部写入边界见[证据摘要](evidence/dsh-hosted-preflight-20261104/validation.json)。

以本地56f6e76a517acb8c94baaab34fe7ee2c727319d7为新快照，main独有14个提交、开发线独有334个提交，内容差异703个文件。旧becae8e的297/634数字保留为历史，不代表当前差异。本地运行git merge-tree --write-tree预览两条线的合并，得到32个冲突路径，包括公共会话选择/操作、Codex读取、TCP与broker/node、TUI及README/变更记录；完整清单见[原始输出](evidence/dsh-hosted-preflight-20261104/merge-tree.txt)。

这次预览只生成Git对象和证据文件；当前HEAD、分支、工作树与索引未进行合并或切换，未解决冲突、未验证预览树，不能宣称已有可发布的整合分支。当前开发线包含原核心/TUI、其它负责人公共通信与多工具工作；用户须指定由原集成负责人提供可运行ref，或明确移交完整开发线的集成责任后再由本会话准备本地候选。不能把仅授权DSH开发理解为接管上述32处共享冲突。

集成候选可审阅且对应范围确定后，推送/PR/默认分支落地与Actions仍各按既有授权边界进行。本次没有推送、创建PR、合入main、触发Actions或创建Issue；配置存在与虚拟合并预览均不是托管首轮通过。

## 本地集成责任已获决定

2026-11-04用户明确选择“交给你集成，先准备本地审阅候选”。本会话现在负责在独立worktree合并完整开发线与固定main快照，逐项核对32处冲突及自动合并内容，保留两侧已有批准的行为/规格/证据，并运行仓库检查。原共享开发worktree保持在原分支；不以合并为由新增用户交互、命令或crosschat持久数据格式。上述移交只覆盖本地集成责任，未授权推送、PR、合入main、Actions、发布或全局安装；完成后提交准确的候选ref、双父提交、冲突取舍、验证与残余边界供审阅。
