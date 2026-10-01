# Claude Windows named pipe 实测验证

label: wayfinder:research
status: closed
blocked-by: （无）
claimed-by: 研究子代理（2026-10-01 制图会话派发）

## Question

Windows 版 Claude Code 的消息插座（named pipe）是否与 embassy 记录的 macOS peer protocol 1 逐字节兼容？

- 注册表字段核实（已知样例：`peerProtocol:1`、`messagingSocketPath:"\\.\pipe\LOCAL\cc-msg-<hash>"`、`kind:interactive|bg`、`status`）
- 会话内进程是否注入 `CLAUDE_CODE_MESSAGING_SOCKET` 环境变量（发送方身份反查依赖它）
- `<pid>.key` 文件（108 字节）的作用：管道鉴权？如何使用？
- 管道名 `cc-msg-<hash>` 的派生规则（sessionId？）
- **实测注入**：spawn 一个一次性 claude 会话（只许用自己 spawn 的会话，严禁碰用户在跑的其它会话），用 Node `net.connect(pipe)` 或 PowerShell `NamedPipeClientStream` 写入帧
  `{"msgV":1,"msg_id":"<uuid>","type":"user","message":{"role":"user","content":"..."},"priority":"next"}\n`
  验证会话是否把它当用户消息处理（观察会话输出 / transcript）
- `notify_idle` 等 peerFeatures 在 Windows 的行为（可观测则记录）

结论决定：Claude 半边是"改路径直接用"还是"换通道重设计"。
产出：`research/claude-windows-pipe.md`（中文，含实测代码片段与结果）。

## Resolution

实测结论：**需要适配，但适配面小且全部明确**。peer protocol 1 用户帧与 embassy 的 `encodeClaudePeerUserFrame` 产出逐字节兼容，在自建 stream-json 保活会话上完成了端到端注入（会话回复 OK，transcript 落盘）。Windows 差异共四项：管道名 `\\.\pipe\LOCAL\cc-msg-<随机128位hex>` 只能读注册表获得；连接后必须先写 `{"type":"auth","token":"<peerToken>"}\n`（peerToken 在 `<pid>.<sha256(规范化管道路径)>.key` 文件里，Windows 上 auth 强制、无凭证可绕）；接收会话需 `crossSessionInbound:"accept"`（`--settings` 实测有效）否则消息被 permission-mode parity 挂起直至过期；目标会话生命周期需网关自管（`-p` 单发会话不消费排队消息）。`CLAUDE_CODE_MESSAGING_SOCKET` 与新增的 `CLAUDE_CODE_MESSAGING_TOKEN`（childToken）均确认注入子进程。详见 `research/claude-windows-pipe.md`。
