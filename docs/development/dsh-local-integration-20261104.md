# DSH 托管前的本地集成候选

2026-11-04。用户明确选择“交给你集成，先准备本地审阅候选”。root在独立worktree完成本地合并、自审和验证；未派worker，未进行独立复审。候选分支为`codex/dsh-hosted-integration-20261104`，工作区为`D:/workspace/CC/cc-int-20261104`。本记录只交付本地候选，不作为DSH托管验收或发布记录。

## 输入与取舍

| 输入 | 固定提交 |
| --- | --- |
| 完整开发线（第一父提交） | `1b49d7eccd916dc53658aef4a6672f022db9a0ec` |
| GitHub main（第二父提交） | `874461ae9ecdb799d880c28c1db30999c2c51555` |
| 共同基线 | `de791a90e1e1c7503aa9561d5fc2d0e8d6ea1d20` |

main已通过GitHub连接只读重新核实，使用本地已有提交对象，没有fetch/pull、切换原工作区或重写历史。初始合并出现32个冲突，分别为16个产品源码、10个测试/工装和6个文档路径；[逐文件取舍](evidence/dsh-local-integration-20261104/conflict-decisions.json)、[原版本历史核对](evidence/dsh-local-integration-20261104/conflict-history.json)及[原始冲突](evidence/dsh-local-integration-20261104/merge-conflicts.patch)保留。

- 开发线已在main较早版本之上完成C14显式工具与端点身份隔离，保留其16个冲突源码文件的准确版本。main发布整理中暂未纳入的OpenCode/DSH接线现在属于本次完整开发线范围，不能借合并删除。Codex client的重复函数冲突也按当前完整开发版本消解。
- main的POSIX自有进程组回收修复完整保留，仓库规范化后的blob与main相同。相对开发线，这是唯一产品源码变化；CLI、TUI、DSH桥、短柄/ref、两套DSH工装和workflow均保持开发线原内容，见[范围核对](evidence/dsh-local-integration-20261104/scope-audit.json)。没有增加用户命令、必需操作或crosschat持久数据格式。
- main的macOS短临时路径、Unix socket路径预算、TCP夹具realpath和双星joiner的finally清理与开发线的typed收发/完整回执断言合并保留。维护枚举边界夹具和7项POSIX回归也纳入，未新增skip或延长产品超时。
- 历史1.11—1.13.1发布记录、技能成员恢复教学和本轮Unreleased短柄说明同时保留；待评估TUI反馈、组合开发与历史限范围发布的证据分别保留。历史被拒删除仅保存其当时状态，不重试。
- package及lock继承main已有的`1.13.1`元数据，没有决定下次发布版本；此候选含Unreleased工作，不可据该版本号认定为新的1.13.1发布包。

## 验证

独立工作区使用`npm ci --ignore-scripts --no-audit --fund=false`及其自有缓存；本地Windows、Node25.0.0、npm11.6.2。先构建，再运行13文件149项定向回归，全部通过。普通检查未启用CROSSCHAT_LIVE，最多2/最少1 worker。

首个完整检查为2759通过、1失败、11原有跳过，失败来自Claude兼容workflow测试的LF专用权限正则，真实YAML在新Windows工作区按CRLF检出，workflow内容和权限本身未改变。加入LF/CRLF两组输入后，旧断言实际表现为1通过/1失败；只将换行匹配改成可选CR，保留`contents: read`及禁止probe写权限的全部断言，20项定向通过。首败、RED patch及GREEN原始输出均保留，没有改YAML或其运行权限。

最终`npm run check`退出0：**2761通过、11原有跳过，235文件通过、3跳过；lint/build及204模块688边导入检查通过**，见[完整raw](evidence/dsh-local-integration-20261104/check-final.txt)和[摘要](evidence/dsh-local-integration-20261104/validation.json)。这是本地Windows结果；原main历史macOS修复证据保留，不扩大为当前候选的三平台实跑。

证据目录单独声明`-text`以保留逐文件原始字节和摘要；diff/context中的空白行前缀、Vitest错误显示的行尾空格均保持原样。源码/教学文档的`git diff --check`排除这个明确的raw目录，raw另外逐项核对Git索引字节与SHA-256，不修改输出来消除格式告警。

`npm pack --dry-run --json --ignore-scripts --offline`共427项，全部15项skill/bridge资产存在，未生成tgz或进行全局安装。此前C10预览的433项另含三个已删除源码留下的六个旧dist文件，本次新工作区构建不含这些文件；旧证据保持，差异见[包核对](evidence/dsh-local-integration-20261104/pack-audit.json)。首次手工资产清单误写成不存在的mjs文件名已记为审计工装错误，不当作真实资源缺失或产品修复。

## 交付边界与继续入口

原开发worktree仍在`codex/core-refactor-pre-tui`，用户未跟踪文档保持原状。C04测试根已由用户手动删除并只读核实，用户的`D:/soft/DeepSeek Harness`保留；本次没有启动原生DSH或进行安装/卸载。独立集成工作区及其依赖保留供审阅。

本次未推送、创建PR、合入main、触发Actions、创建Issue或发布。相对main，候选还包含Claude/OpenCode/DSH三份定时兼容workflow和DSH从零手动workflow；将来合入默认分支会引入这些调度与报告job，必须在外部操作审阅时一并核对。创建PR也会触发仓库既有的三平台普通CI，不能把它当成纯文档操作。

下一步先审阅此候选，再按具体授权执行推送/PR与默认分支集成；C05/C11专用托管首轮、定时/artifact/报告权限证据继续按[托管前置核实](dsh-hosted-preflight-20261104.md)收口。C04可信runner与官方安装/卸载、独立环境/publisher默认策略、C00/C12平台范围及DSH增强均保持原任务，不由本次本地合并关闭。
