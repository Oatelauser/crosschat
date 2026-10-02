# crosschat 底层原理

> 本文讲清楚一条消息从发送到被处理的完整路径，以及每个设计决策背后的机制事实。
> 全部结论来自真机实测（见 [research/](research/) 与 [drill-reports/](drill-reports/)）。

## 1. 总览

```
                 ┌─────────────────── crosschat CLI（无状态） ───────────────────┐
                 │  身份反查 → 目标解析 → 限流/限额 → 信封组装 → 投递 → outbox  │
                 └──────────────┬─────────────────────────────┬────────────────┘
                                │ Claude 侧                    │ Codex 侧
                                ▼                              ▼
                    ~/.claude/sessions 注册表      codex app-server daemon (0.160+)
                    named pipe + peerToken 鉴权    proxy 桥接（ws-over-stdio）
                                │                              │
                                ▼                              ▼
                     Claude Code 会话进程            daemon 托管的线程（headless turn）
                    （消息注入为用户消息）           （模型直接被驱动干活）
```

没有守护进程：每次 `crosschat send` 都独立完成发现、鉴权、投递全过程；对话状态（引用、轮次）**编码在消息本身**里，不落在任何服务端。

## 2. Claude 侧通道（named pipe + peer 协议）

1. **发现**：Claude Code 每个运行中会话在 `~/.claude/sessions/<pid>.json` 注册，含 `messagingSocketPath`（`\\.\pipe\LOCAL\cc-msg-<随机hex>`，每次启动随机）、`sessionId`（稳定 UUID）、`name`、`kind`、`status`。管道名无规律，**必须读注册表**。
2. **鉴权**：Windows 上 peer 管道强制鉴权——连接后必须先写一行 `{"type":"auth","token":"<peerToken>"}\n`。token 在同目录 `<pid>.<sha256(规范化管道路径)>.key` 文件里，按用户隔离。
3. **注入**：随后写一行 peer 协议 v1 用户帧：
   ```json
   {"msgV":1,"msg_id":"<uuid>","type":"user","message":{"role":"user","content":"…"},"priority":"next"}
   ```
   Claude Code 把它当一条用户消息插入会话（transcript 里 `turnOrigin:"peer"`）。
4. **接收许可**：会话必须以 `crossSessionInbound:"accept"` 启动（`crosschat claude` 自动注入），否则消息被权限对等性挂起、永不进入会话。

## 3. Codex 侧通道（App Server daemon）

1. **通道建立**：spawn `codex app-server proxy` 子进程，其 stdin/stdout 作为 WebSocket 传输（虚拟 URL `ws://localhost/rpc`），跑 JSON-RPC。proxy 是 **daemon 的桥接**（不另起服务）。
2. **投递**：`thread/resume`（取写者身份）→ 处置检查 → `turn/start`（携带消息文本开新 turn）→ 确认 `inProgress`。daemon 直接驱动模型执行该 turn——**不需要任何窗口在场**。
3. **写者锁的本质**（最容易误解的点）：锁是**进程级 thread-store 锁**——
   - 跨进程访问被占线程（旧 daemon ≤0.157、`codex --no-daemon` 的 TUI）：`thread/resume` 被拒（`already has an active writer`）
   - **同一 daemon 的多个连接**（0.160+，TUI 附着 daemon）：互相兼容，开窗也能 resume/turn
   - 这就是"daemon 0.160 + TUI 自动附着 ⇒ 开窗可收"的机制根源
4. **TUI 与 daemon 的关系**：TUI 附着后只是 daemon 的一个前端；`codex queue` 特性也仅在该形态下被消费（未附着时是黑洞——实测结论，故 crosschat 不依赖它）。

## 4. 信封与自包含引用

每条消息的正文被包进信封：

```
<cross-session-message from-name="发送方" turn="N">
<crosschat-reply-hint conversation="mc1_<base64url>" reply-as="接收方">
回复请运行: crosschat send --conversation mc1_… --body "<你的回复>"</crosschat-reply-hint>
新话题: crosschat send --to <名字> …；超 16KiB 请写文件后只发路径
<正文（保留字标签已中性化，防伪造信封）>
</cross-session-message>
```

**自包含引用**是"无状态却可对话"的关键：`mc1_` 后是 base64url 的 `{两端身份(native UUID), nonce, 轮次}`。回复时 CLI 解码引用、校验调用方必是两端之一、目标取另一端、轮次 +1——**不查任何持久状态**。native UUID 稳定（跨会话重启），所以引用在会话存活期内一直有效。

## 5. 身份反查（我是谁）

发送方身份不靠传参，靠**环境变量反查**：
- Claude 会话内：`CLAUDE_CODE_MESSAGING_SOCKET` → 按管道路径匹配注册表 → sessionId
- Codex turn 内：`CODEX_THREAD_ID`（优先）/`CODEX_SESSION_ID` → 线程身份
- 都没有 → 身份 `human`（可发送，不能被回复）
- 同时存在两族 → `CALLER_IDENTITY_CONFLICT`（典型根因：daemon 从带 Claude 环境的终端启动，污染了它派生的所有 shell）

## 6. 发件箱（outbox）

对方忙（turn 进行中）或被锁超过等待上限（120s）时，消息不丢弃：完整信封（含 reply-ref）落 `%LOCALAPPDATA%\crosschat\outbox\<threadId>.json`，返回 `parked`。**每次 `send`/`status` 调用入口先排涝**：短等待（5s）逐条补投，成功即出队。活跃对话中 agent 频繁调用 CLI，补投最终必达；每线程 20 条封顶防积压。

## 7. 一次 `send` 的完整流程

```
crosschat send --to X --body "…"
  ├─ 排涝 outbox（存量 parked 消息先试补投）
  ├─ body ≤16KiB？超 → MESSAGE_TOO_LARGE（指引落盘发路径）
  ├─ 身份反查（env）→ 限流检查（30 条/60s/对端点）
  ├─ 解析 X：claude 注册表精确名 / codex thread/list 名（未找到/碰撞 → 错误+候选清单）
  ├─ 组信封（from/turn/reply-ref/教学提示/中性化）
  ├─ 目标是 claude → 读注册表拿管道 → key 文件取 token → auth 行+帧 一次写入
  ├─ 目标是 codex → spawn proxy → resume → 处置：
  │     idle → turn/start → delivered
  │     busy/locked → 等待(3s×N≤120s) → 仍忙 → park 入 outbox → parked
  └─ 输出 delivered/parked + 下轮 reply-ref
```

## 8. 安全模型

- **信任边界 = 同一 Windows 用户**：管道/注册表/key 文件按用户隔离；无任何网络监听
- **接收是显式授权的**：只有 `crosschat claude` 启动的会话开接收许可；跨会话消息在 transcript 中带 `peer` 来源标记，用户可区分自己敲的与外部注入的
- **信封不是签名**：正文是不可信内容（保留字已中性化，防伪造信封结构）；消息是请求不是授权——skill 里明文教 agent 这条纪律
- **审批永不代答**：codex 等人工审批时 crosschat 直接报错退出

## 9. 平台接缝（二期 mac/linux 的扩展点）

| 接口 | Windows 实现 | POSIX 对应 |
|---|---|---|
| `PipeTransport` | named pipe + peerToken auth 行 | Unix domain socket（`/tmp/cc-socks/<pid>.sock`，embassy 原路径） |
| `ProcessInspector` | `process.kill(pid,0)` / CIM | `ps` |
| `PathLayout` | `%LOCALAPPDATA%\crosschat`、`~/.claude`、`~/.codex` | XDG 布局 |

命令面（`send`/`status`）形状稳定承诺：内部架构演进（无状态 → 常驻 broker）不改变 agent 侧用法。
