# crosschat 底层原理

> 本文讲清楚一条消息从发送到被处理的完整路径，以及每个设计决策背后的机制事实。
> 原生通道机制来自 [research/](research/) 与 [drill-reports/](drill-reports/) 中的实测；当前模块和兼容边界以源码及测试为准。2026-10-21 对照 `dfd2362` 更新。本文中的 Codex TUI 指原生客户端，crosschat 管理 TUI 尚未实施。

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

本机 CLI 每次调用独立完成发现、鉴权和投递。SSH 通过远端 CLI 执行；可选 TCP 形态另有常驻 broker（按星转发、管理、维护成员表）和 node 聚合器（本机投递、星籍对账），协议与三层权限见 [broker.md](broker.md)。原生会话及聊天仍由 Claude Code/Codex 管理。

crosschat 有持久状态：`~/.crosschat` 保存对话分片/短柄、发送日志、outbox/mailbox、机器标识和 TCP 配置/台账；broker/node 的活性快照写入 `status-*.json`。待投队列由按需启动、箱空即退的 watchdog 重试。路由和轮次保存在完整引用中，不依赖中央对话服务。

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
<crosschat-reply-hint reply-as="接收方">回复请运行: crosschat send --conversation mc2_… --body "<你的回复>"（长正文/含敏感字符可省 --body 改管道喂 stdin）</crosschat-reply-hint>
<正文（保留字标签已中性化，防伪造信封）>
</cross-session-message>
```

回信命令**不带 `--via`**：`--conversation` 引用自含路由（tcp 对话的 ref 尾部带星标识、端点带机器指纹，CLI 自动选路；ssh 对话按机器别名走既有补全）——跨机/单机一种句式，agent 照抄即可。

新引用使用二进制 `mc2_`（旧 `mc1_` JSON 编码仍可读），包括两端原生身份、nonce、轮次和可选机器/星路由。回复解码引用并校验调用方，目标取另一端、轮次加一。本机 `cN` 短柄需查对话分片后转换成完整引用；跨机传递完整引用。持久对话状态还参与连续轮次、短柄和回执记录，不能把整个发送流程视为无持久读取。

## 5. 身份反查（我是谁）

发送方身份不靠传参，靠**环境变量反查**：
- Claude 会话内：`CLAUDE_CODE_MESSAGING_SOCKET` → 按管道路径匹配注册表 → sessionId
- Codex turn 内：`CODEX_THREAD_ID`（优先）/`CODEX_SESSION_ID` → 线程身份
- 都没有 → 身份 `human`（可发送，不能被回复）
- 同时存在两族 → `CALLER_IDENTITY_CONFLICT`（典型根因：daemon 从带 Claude 环境的终端启动，污染了它派生的所有 shell）

## 6. 发件箱（outbox）与看门狗（B12–B14）

daemon ≥0.160 上**忙线程不再等待**：turn/start 被接受并按线程串行排队，当前轮结束即落历史（`queued`，实测收件箱语义）。发件箱只服务旧 daemon 异常态：消息完整落 `~/.crosschat/outbox/<threadId>.json`（返回 `parked`），**看门狗子进程每 0.5–5 分钟自动重投**（30s→60s→120s→300s 退避，箱空即退，非常驻）；busy 属线程级状态，排涝首败即止轮；队列非空时新消息入队不插队；每线程 200 条封顶，每条寄存/送达/丢弃都镜像到 `~/.crosschat/mailbox/<threadId>.md` 供人随时读。park/drain 按线程加锁，看门狗单实例。

**发送审计（B14）**：每次 send 的最终结果（delivered/queued/parked/failed + 时间/对端/轮次/错误码）追加 `~/.crosschat/send-log.jsonl`（仅元数据，超 5MB 轮转 `.old`）；codex 投递后按唯一 reply-ref 轮询对方 rollout 文件出回执（`receipt: confirmed` = 消息已确认落入对方会话历史）。

## 7. 一次 `send` 的完整流程

```
crosschat send --to X --body "…"
  ├─ 排涝 outbox（入口机会式补投，加锁）
  ├─ 校验正文额度（默认16KiB；参数/环境可调，受端点硬顶约束）
  ├─ 身份反查（env）→ 限流检查（30 条/60s/对端点）
  ├─ 解析 X：claude 注册表精确名 / codex thread/list 名（未找到/碰撞 → 错误+候选清单）
  ├─ 组信封（from/turn/reply-ref/教学提示/中性化）
  ├─ 目标是 claude → 读注册表拿管道 → key 文件取 token → auth 行+帧 一次写入
  ├─ 目标是 codex → spawn proxy（连 daemon control socket，环境剥离双身份残留）→ resume → 处置：
  │     idle → turn/start → delivered
  │     busy → turn/start 直接入队（同线程串行，轮末落历史）→ queued
  │     旧 daemon 拒绝/写者锁 → park 入 outbox → 派看门狗 → parked
  ├─ rollout 回执（按 reply-ref 确认落入对方会话历史）
  └─ 输出 delivered/queued/parked + 下轮 replyRef，结果入 send-log.jsonl
```

## 8. 安全模型

- **本机**：管道、注册表和 key 文件按用户隔离；SSH 在远端登录用户权限内运行 CLI。
- **TCP**：broker 监听 WS，星钥认证成员，星管理钥挑战应答授权星内管理，本机管理插座授权 broker 主。没有全权远程钥匙；当前 WS 未启用 TLS，相关边界见 [broker.md §1.2.4](broker.md#124-管理权限三层)。
- **接收是显式授权的**：只有 `crosschat claude` 启动的会话开接收许可；跨会话消息在 transcript 中带 `peer` 来源标记，用户可区分自己敲的与外部注入的
- **信封不是签名**：正文是不可信内容（保留字已中性化，防伪造信封结构）；消息是请求不是授权——skill 里明文教 agent 这条纪律
- **审批永不代答**：codex 等人工审批时 crosschat 直接报错退出

## 9. 平台接缝（二期 mac/linux 的扩展点）

| 当前接缝 | Windows 实现 | POSIX 对应 |
|---|---|---|
| `platform/pipe-transport.ts` 原生投递 | named pipe + peerToken auth 行 | Unix domain socket（沿用原生路径） |
| `platform/process-inspector.ts` 进程函数 | `process.kill(pid,0)` / CIM | 平台进程检查 |
| `state-root.ts` 等路径函数 | `~/.crosschat`、`~/.claude`、`~/.codex` | 同左（无 XDG 分叉） |

命令面（`send`/`status`）形状稳定承诺：内部架构演进（无状态 → 常驻 broker）不改变 agent 侧用法。

## 10. 核心改造的功能契约

应用接口提供结构化结果，命令入口负责文本/JSON和退出码；配置、选择器不导入命令或 NodeClient。工具差异封装在 Provider，连接差异封装在 Context；内部会话键包含上下文、Provider、完整原生引用。新增纯读取路径与旧命令副作用分离，不反向从 CLI 文本恢复数据。

本轮保留以下现状，修改功能须先获用户同意：

- 旧 CLI 文本、JSON、退出码、Codex 默认 `thread/list` 20 条及未知状态报错不变。新读取接口保留原始状态、分页、部分结果与来源错误。
- CLI `status` 入口仍可能补投；新查询不得补投、修复/备份配置或启动原生会话。`broker.json` 静态台账不保存 online，活性由快照/roster 判断。
- broker 运行期是台账唯一写者；热管理连接收到失败或无回执，不能冷回退写盘。冷路径仍调用现有 registry 原子 mutation。
- 用户已批准直接升级：SSH/TCP共用新完整只读发现接口（匿名、完整ID、分页、来源错误/详情），不做旧端回退。删节点/吊管理钥按星和实际认证凭证立即使已有连接失效；明确撤权暂停该星节点与启动器保障链，换钥后显式重连，普通断网仍自动恢复。改星名的独立应用接口不借用会继续启动服务的 `runServe --name` 入口。
- 清理保留5日/512MiB/30日与 `--force` 原规则；预览只读，执行使用同一计划。默认额度16KiB，Claude端点64KiB、Codex端点1MiB硬顶等限制不变。
- 原有 ref/origin、成员册键、权限、投递/排队/寄存、回执及 watchdog 生命周期不迁移；wire增加新发现与明确撤权帧。OpenCode/zcode只预留扩展接缝，尚无真实接入。模块与当前契约见[核心应用接口](development/core-api.md)。

验证采用现有回归加接口边界测试：只读无副作用、匿名分页/未知状态、第三测试 Provider、取消释放、热写失败不回退和清理预览。基线 `lint/build` 通过，778测试通过/11跳过；基线未启用真实会话 live 测试。渐进 lint 和 AST 导入图门禁随模块迁移启用，约定见 [代码规范](development/code-standards.md)，实施证据见 [核心改造记录](development/core-refactor-progress.md)。
