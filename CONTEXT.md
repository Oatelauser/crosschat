# CONTEXT

本项目的领域术语表。只放术语，不放实现细节。

## 术语

- **原生唤醒 (native wake)**：通过接收方 agent 自带的本地接口，把消息注入其运行中的会话并触发处理；不依赖轮询。本工具的首选投递方式。
- **降级轮询 (fallback polling)**：原生唤醒不可用时，由接收方周期检查收件箱的替代投递方式。只在论证"原生为何不可行"之后才允许采用。
- **Broker**：常驻的本地中转进程，持有全部路由与投递状态；发送方 CLI 与各 provider 适配器都只与它对话。
- **端点 (endpoint)**：一个可路由的运行中 agent 会话的不透明身份 `(id, host, provider)`，跨改名与重启保持。
- **别名 (alias)**：`name@host` 形式的查找标签，仅用于寻址与显示，不是身份。
- **会话引用 (conversation reference)**：绑定一次对话两端端点的不透明凭证，用于回复路由。
- **消息插座 (messaging socket)**：Claude Code 为每个运行中会话暴露的消息通道；macOS 上为 Unix domain socket，Windows 上为 named pipe。
- **Peer 协议 (peer protocol)**：Claude Code 会话间通信的线上协议（v1：单行 JSON 帧 + 换行）。
- **联邦 (federation)**：跨机器的 broker 之间转发消息的机制；信任边界是 SSH 登录。支持异构机器（win ↔ linux）互聊是长期需求。
- **回执 (receipt)**：证明消息已被投递机制接受的凭证；不证明接收方理解了内容。
- **一期 / 完整集 (phase 1 / full set)**：分期术语。一期 = 单机 Windows 最小可用；完整集 = 持久账本、回执、投递状态机、TUI、服务安装、联邦、三平台。
- **异构互聊**：通信两侧的 agent 运行在不同操作系统的不同机器上。
- **无状态 CLI (stateless CLI)**：不依赖任何常驻进程的命令行工具——每次调用自含全部上下文（发现、身份、投递）。一期形态。
- **自包含会话引用 (self-contained conversation reference)**：把对话两端的 native UUID + nonce 编码进引用本身，回复时无需查任何状态即可路由。
- **包装命令 (launcher wrapper)**：替用户拼装启动参数后拉起真实程序的快捷命令（如 `crosschat claude` 注入 `crossSessionInbound:"accept"`），不修改被包装程序。
- **曾用名 multichat**：项目原名。`multichat` 作为过渡别名 bin 保留（与 `crosschat` 指向同一 CLI），待存量会话迁移后移除。
- **乒乓循环 (ping-pong loop)**：两个 agent 互相自动回复形成的失控消息风暴；用每对端点的速率限制防御。
