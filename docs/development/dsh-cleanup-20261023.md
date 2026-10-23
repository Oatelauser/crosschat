# Harness 本次测试清理

2026-10-23。功能验收的官方 npm Harness 和局部 pnpm 已正常卸载；第二轮兼容 CI 的安装及其 task root 自动清除。首轮安装超时的部分文件/下载缓存和最初测试根尚未清除。自动审批复核拒绝了针对这两个精确路径的 PowerShell 删除，原因为 `blocked by policy`；代理没有通过其它程序重试同一删除。

已保存安装前 baseline、所有权、正式行为结果、安装锁、卸载和[审批拒绝后只读核对](evidence/dsh-20261023/cleanup-review.json)。相关命令进程和所观察 PID 均不存在；用户 `.dsh`、全局命令与 `dsh` protocol 注册未新增。本记录不处理 OpenCode 此前的独立残留。

用户在 PowerShell 手动执行：

```powershell
Remove-Item -LiteralPath 'C:\Users\yangsheng\AppData\Local\Temp\crosschat-dsh-ci-HQUjru' -Recurse -Force
Remove-Item -LiteralPath 'D:\workspace\CC\multichat\node_modules\.cache\crosschat-dsh-20261023-0975b6b93f724fec95264ad45903f291' -Recurse -Force
```

完成后代理只读核对这两个目录、全局命令及注册状态，再关闭 H06 活动任务。当前状态为待手动清理，不能记作全部卸载验收通过。
