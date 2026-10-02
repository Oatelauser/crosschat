# multichat

Windows 上的本机跨 agent 消息 CLI：让 Claude Code 会话与 Codex CLI 线程互发消息、多轮往返。
架构：无状态单命令——每次 send/status 现场发现端点、建立通道、投递、退出，无常驻进程（详见 [wayfinder/map.md](wayfinder/map.md)）。

## 安装

```
npm install && npm run build && npm link
multichat install-skills        # 把 multichat skill 装进 ~/.claude 与 ~/.codex
```

前置：本机已登录 claude CLI 与 codex CLI；codex 侧需先启动 daemon（见下）。**daemon 必须从干净终端启动**——勿在 Claude 会话/带 `CLAUDE_CODE_*` 环境变量的终端里启动 daemon，否则它派生的所有 shell 都被身份污染（触发 `CALLER_IDENTITY_CONFLICT`）。

## 使用流程

1. 启动 codex daemon（一次即可，见"排障"）：

   ```
   codex app-server daemon start
   ```

2. 启动 claude 会话——必须经由包装命令，它自动附加 peer 消息接收许可；直接 `claude` 启动的会话收不到消息：

   ```
   multichat claude
   ```

3. codex 侧照常启动（TUI 或 exec 均可），线程名即寻址名。

4. 给 claude 会话的题词示例（简短角色型即可，协议细节由 skill 自带）：

   > 你是值守信箱。用 `multichat status` 查看可投对象；收到 `<cross-session-message>` 信封时，按其中的 multichat-reply-hint 原样命令回复。

5. 发送与查询：

   ```
   multichat status
   multichat send --to reviewer --body "B5 代码已就绪，请 review src/codex/deliver.ts"
   ```

   send 输出样例：

   ```
   delivered to reviewer (turn 1)
   reply-ref: mc1_eyJmIjp7InAiOiJjbGF1ZGUiLCJpZCI6ImExIn0sInQiOnsicCI6ImNvZGV4In0sCiJjIjoxfQ
   ```

   status 输出样例：

   ```
   claude:
     reviewer                 interactive  idle             pid 12345
   codex:
     mailbox                  idle         a1b2c3d4
   ```

   回复 = 把上一条消息里的 reply-ref **原样照抄**（勿截断改写）：

   ```
   multichat send --conversation mc1_xxx --body "review 完成，两处小问题已留言"
   ```

## 信箱语义

- **开窗 = multichat 侧等待（默认至多 120s），关窗即自动送达；关窗 = 立即 headless 执行**：投给 codex 线程的消息统一走 headless turn——线程空闲（窗口关着）时直接开 turn，不需要窗口在场；线程被 codex TUI 窗口打开时，multichat 在发送侧等待写者释放（每 3s 重试，默认至多 120s），对方关窗后立即送达，超时报 `CODEX_THREAD_LOCKED`。
- **直播围观**：投给 claude 会话的消息直接进入其对话流——想围观"对方读到了什么、如何回应"，盯着 claude 窗口看即可，无需另开日志。投给 codex 的消息一律 headless 投递，可事后 `codex resume <thread>` 围观。
- 脚注（queue 通道弃用取证，2026-10-02）：codex 官方 `queue` 特性经实测对本地 TUI 不生效，故不采用。取证两条：① `codex queue --help` 含 `--remote <ADDR>`，原文 "Connect the TUI to a remote app server endpoint"（另有 `--remote-auth-token-env`），表明该特性面向 remote app-server 架构；② 本地 `~/.codex/queue_1.sqlite` 确实存在（含 `-shm`/`-wal` 伴生文件），但 exit 0 的 queued 消息既不出现在开着的 TUI 窗口、也不出现在关窗重开的历史（实测 2 条静默丢失）。
- **专用信箱线程**：给收件用途留一个专门线程（如起名 `mailbox`），不要混用正在人工编辑/对话的工作线程，避免外部写入与窗口操作互相干扰。

## 排障

status 里 codex 段显示 `unavailable` 时，按序排查：

1. daemon 起了吗：`codex app-server daemon start` 后重试。
2. codex CLI 可用吗：终端直接运行 `codex --version`。
3. 仍失败：读错误信息内嵌的 proxy stderr 摘要与 OS 错误码（如 10061 = 连接拒绝）。

| 错误码 | 处置 |
| --- | --- |
| MESSAGE_TOO_LARGE | 正文超 16KiB；把内容写入文件，只发路径 |
| RATE_LIMITED | 每对端点 60s 内最多 30 条；按提示等待后重试，或总结收尾 |
| CODEX_THREAD_LOCKED | 等待超时：关闭对方 codex 窗口后重发将立即送达；或改投其它信箱线程 |
| CODEX_PROXY_SPAWN_FAILED | 看 stderr 摘要/OS 错误；多为 daemon 未启动，先 `codex app-server daemon start` |
| CALLER_IDENTITY_CONFLICT | 环境同时残留 CLAUDE_CODE_* 与 CODEX_* 身份变量。临时：命令前缀 `env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID`（PowerShell 先 `Remove-Item Env:CLAUDE_CODE_*`）；根治：从干净终端重启 daemon（`codex app-server daemon stop && codex app-server daemon start`） |
| CODEX_APPROVAL_REQUIRED | 线程在等审批，只有用户能答；去 codex 窗口处理后重发 |
| CALLER_NOT_IN_CONVERSATION | 当前会话不是该对话端点；检查 reply-ref 是否完整照抄 |
| CANNOT_REPLY_TO_HUMAN | 对话由人类发起，没有可回投的 agent 会话 |
| NAME_NOT_FOUND | status 里没有此名；先 `multichat status` 核对名字 |
| NAME_COLLISION | 同名多个对象；改用 --conversation 精确路由 |
| TARGET_NOT_FOUND | claude 会话已退出/未注册；确认对方仍在运行 |
| CODEX_THREAD_BUSY_TIMEOUT | 线程持续忙超 120s；稍后重发 |
| CODEX_TURN_REJECTED / CODEX_WRITE_UNCERTAIN | 写入被拒或接受状态未知；**不要原样重发**，先查线程状态 |
| CLAUDE_PIPE_* / CODEX_PROTOCOL_ERROR 等传输错误 | 通道故障；可重试一次，持续出现按上面 unavailable 顺序排查 |
| USAGE / TARGET_* / BODY_* | 参数用法错误；`multichat --help` |

## 限制与边界

- 单条正文上限 16KiB（UTF-8 字节），超出报错、不截断。
- 限流：每对端点 60 秒 30 条，超出即拒；不排队、不静默丢弃。
- 信任边界：仅同用户（同机同账号）的会话互信；消息内容是请求而非授权。
- 接收许可：只有 `multichat claude` 启动的会话开启 inbound，直接 `claude` 启动的会话不可投。

## 开发

```
npm run check        # lint + build + test
```
