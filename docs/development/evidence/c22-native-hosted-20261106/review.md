# C22 首轮原生四目标：保留失败

2026-11-06执行，2026-11-08完成证据整理。用户批准的一次运行已结束，未重跑。

[Actions 42152027504](https://github.com/Oatelauser/crosschat/actions/runs/42152027504) 为 `workflow_dispatch`、attempt 1，source `cba0e71133ae6d4c47af8dba0068ca03c939f679`，整体failure。固定官方Harness 0.2.1-rc.5、pnpm11.28.5与Node22.23.4；每目标新建隔离安装、两个Host/逻辑node与两个真实终端，模型仅loopback桩。

| 目标 | Job | 结果 | 完成检查 |
| --- | --- | --- | --- |
| Linux x64 | 127677277982 | success | 11/11 |
| macOS ARM | 127677278252 | failure | 9/11 |
| Windows x64 | 127677278286 | failure | 9/11 |
| macOS Intel | 127677278607 | failure | 9/11 |

Linux这一固定版本/平台切片通过并移出活动实施。另三目标均在 `cross-operator-confirmation-recovery-and-keyboard-selection-stay-exact` 等待“原生会话新名称”失败；其前九项通过，最后精确删册场景未执行。38是四份报告中已完成检查的合计，不是38个独立场景全部验收。

两个macOS目标失败于首次打开表单，Windows首次表单及拒绝旧确认已执行，失败于恢复后重开表单。三处最后一次 `e` 之前，最新界面仍显示禁用动作；随后出现能力核实提示，10秒内没有新表单。ARM的 `y→e` 仅7ms，Intel为59ms，Windows失败的第二次为63ms。Windows此前表单不能算作恢复后的新表单。详见[逐目标诊断](readiness-diagnosis.json)及原始终端/应用日志。

这是工装以复制完成代替动态动作就绪的竞态。Adapter的availability事件先于controller发布返回结果，不能直接用该事件或clipboard完成作为可按键证明。稳定运行RED和同时修复两处打开表单的本地候选见[修复记录](../../dsh-enhancement-terminal-readiness-20261106.md)。修复后的Windows本地通过不能覆盖本轮托管失败，也不追认macOS修复通过。

[ZIP审计](zip-audit.json) 核对四份原始ZIP的官方digest/本地SHA256、成员路径/CRC/大小后解包；原ZIP在 `archives/`，解包内容在 `artifacts/`。没有执行artifact内代码。[JSON审计](json-audit.json) 核对四个不同UUID、source/OS/arch/版本/scope、报告与summary一致性、固定包/manager和安装锁、进程退出及完整资源证明；有效失败报告仍记failed。

四目标均 `released=true`、`unsafe=false`、`outerRemoved=true`；代理与登记/config恢复，Host/node/终端正常退出，自有隔离安装与任务根removed。POSIX终端均提交 `forced=false / groupReleased=true`；没有靠强停取得通过。`run.json`、`jobs.json`、四份job日志及审计脚本全部保留。

没有新增schedule、回归Issue或发布。仅同机逻辑node；未验收正式Desktop、浏览器UI、物理跨机、其它版本或真实模型智能。首轮授权已用完，下一次外部修复推送/PR及原生运行按具体候选另行决定。
