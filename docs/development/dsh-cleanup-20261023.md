# Harness 本次测试清理

最新复核：2026-10-23 17:01（Asia/Shanghai）[本机只读检查](evidence/tool-integration-cleanup-20261023.json)确认，先前按用户决定保留的 D盘总根现已不存在，其下 Harness 缓存、Claude 便携副本及 ZCode 研究副本也随父目录不存在；两个 C盘 CI 根仍不存在。没有在本次执行删除或重建总根。下文保留先前决定及检查事实，不能再将其描述为当前残留。

2026-10-23。功能验收的官方 npm Harness 和局部 pnpm 已正常卸载；第二轮兼容 CI 的安装及其 task root 自动清除。自动审批复核曾拒绝两个精确测试根的 PowerShell 删除，原因为 `blocked by policy`；代理没有通过其它程序重试同一删除。

已保存安装前 baseline、所有权、正式行为结果、安装锁、卸载和[审批拒绝后只读核对](evidence/dsh-20261023/cleanup-review.json)。相关命令进程和所观察 PID 均不存在；用户 `.dsh`、全局命令与 `dsh` protocol 注册未新增。本记录不处理 OpenCode 此前的独立残留。

用户随后手动删除 C盘首轮超时现场。初次只读复核发现 D盘根仍在，用户明确调整清理约定：

> D盘这个我最后统一删除，你后面就可以放在这里来

因此保留 `D:\workspace\CC\multichat\node_modules\.cache\crosschat-dsh-20261023-0975b6b93f724fec95264ad45903f291`，后续测试在该根下按工具新建独占子目录、保存各自 ownership，配置/cache/temp 也放入各自目录；正常卸载测试软件并退出进程，旧残留不混入新任务删除集合。最终由用户统一删除这个根，不再反复请求本批 D盘清理。

[最终只读核对](evidence/dsh-20261023/cleanup.json)确认：两个 C盘 CI 根不存在；D盘根按决定保留；正常 Harness/pnpm 包、相关命令进程、用户 `.dsh`、全局 `dsh` 命令和 protocol 注册均不存在；预先存在的 `.agents` 保留。H06 按用户批准的最终清理范围关闭，历史审批和部分核对证据继续保留。
