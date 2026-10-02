# Codex 在 Windows 的原生通道可行性研究

- 票：`wayfinder/tickets/001-codex-windows-feasibility.md`
- 日期：2026-10-01
- 实测机器：Windows 11 Pro for Workstations（10.0.26200），本机用户 `<user>`
- 对照基准：embassy v4.7.0 源码研究报告 `research/embassy-architecture.md` §2.2（macOS 上 spawn `codex app-server proxy`、stdin/stdout 当 WebSocket 传输、`thread/resume` + `turn/start` / `turn/steer`）
- 所有实测均为只读或一次性临时调用（用完即杀），未修改任何用户配置

## 结论（三选一）

**原生可行。** Codex 半边在 Windows 上可以走原生通道（App Server JSON-RPC），无需降级轮询。核心链路已在本机活体验证：`codex app-server proxy` 子进程存在且行为与 macOS 一致（stdin/stdout 即字节管道）、WebSocket 握手成功、`initialize` / `thread/list` JSON-RPC 往返成功、协议 schema 中 `thread/resume` / `turn/start` / `turn/steer` 及参数形状（`threadId` / `expectedTurnId` / `turnTrigger` / `input`）与 embassy 所用完全一致。本机 App Server 版本 0.157.1 高于 embassy 集成基线 0.153.4。

唯一未活体执行的是 `turn/start` / `turn/steer`（会在用户的 live daemon 里创建真实 turn，超出只读研究边界）——由同一通道上 `initialize`/`thread/list` 成功 + 官方 schema 佐证，风险很低，实施时首日即可补验。

---

## 1. 本机实测

### 1.1 安装形态

```
$ codex --version
codex-cli 0.159.3

$ where codex
C:\Users\<user>\AppData\Roaming\npm\codex
C:\Users\<user>\AppData\Roaming\npm\codex.cmd
```

npm 全局安装（`@openai/codex`），shim 指向 `codex.js`，真实二进制在：

```
C:\Users\<user>\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe
```

即 Windows 原生 Rust 二进制（三元组 `x86_64-pc-windows-msvc`），非 WSL、非 node 实现。

### 1.2 `~/.codex`（CODEX_HOME）目录布局

与 embassy 在 macOS 上依赖的布局同构，关键项全部存在：

| 条目 | 状态 | 说明 |
|---|---|---|
| `app-server-control/app-server-control.sock` | 存在 | 控制 socket，Windows AF_UNIX（文件系统路径形态） |
| `app-server-control/app-server-startup.lock` | 存在 | 启动锁 |
| `app-server-daemon/daemon.pid` | 存在 | 内容含 pid、processStartTime、executableIdentity 摘要 |
| `app-server-daemon/daemon.stderr.log` | 存在 | 守护进程日志（本机只有 MCP/config 警告，无崩溃） |
| `packages/app-server-daemon/releases/0.157.1-x86_64-pc-windows-msvc/` | 存在 | **Windows 的管安装等价物**（macOS 是 `packages/standalone`，目录名与三元组不同） |
| `packages/app-server-daemon/current` | symlink | 指向上面的 release 目录 |
| `sessions/YYYY/MM/DD/rollout-*.jsonl` | 存在 | 会话存储（thread 的 rollout 文件） |
| `session_index.jsonl`、`state_5.sqlite`、`thread_history_1.sqlite` 等 | 存在 | 线程索引与分页线程历史 |

### 1.3 `codex --help` 子命令

```
  agents            Browse all agent sessions on the shared local app-server daemon
  app-server        [experimental] Run the app server or related tooling
  remote-control    [experimental] Manage the app-server daemon with remote control enabled
  app               Launch the Desktop app (opens the app installer if missing)
```

`codex app-server --help` 进一步确认子命令与传输选项：

```
Commands:
  daemon                Manage the local app-server daemon
  proxy                 Proxy stdio bytes to the running app-server control socket
  generate-ts           [experimental] Generate TypeScript bindings for the app server protocol
  generate-json-schema  [experimental] Generate JSON Schema for the app server protocol

      --listen <URL>
          Transport endpoint URL. Supported values: `stdio://` (default), `unix://`,
          `unix://PATH`, `ws://IP:PORT`, `off`
```

`codex app-server proxy --help`：`Proxy stdio bytes to the running app-server control socket`，选项 `--sock <SOCKET_PATH>`——与 embassy 在 macOS 上依赖的机制文字完全一致。

### 1.4 守护进程在线证据

```
$ codex app-server daemon version
{"status":"running","backend":"pid","managedCodexPath":"C:\\Users\\<user>\\.codex\\packages/app-server-daemon\\current\\bin\\codex.exe","managedCodexVersion":"0.157.1","socketPath":"C:\\Users\\<user>\\.codex\\app-server-control\\app-server-control.sock","cliVersion":"0.159.3","appServerVersion":"0.157.1"}
```

PowerShell 确认进程：pid 7948，路径 `...packages\app-server-daemon\releases\0.157.1-x86_64-pc-windows-msvc\bin\codex.exe`，启动于 2026-10-01 12:57。即：**Windows 上由 CLI 自管的 app-server 守护进程已作为常驻进程运行**（`codex app-server daemon start/stop/bootstrap/update` 全套管理子命令可用），控制 socket 为文件系统路径上的 AF_UNIX socket，可正常应答。

### 1.5 活通道实测（一次性 probe，用完即杀）

写了一个零依赖 Node 探测脚本，完全复刻 embassy 的传输方式（`codex-local-transport.ts` + `codex-app-server.ts`）：spawn `codex.exe app-server proxy`（stdio 三管道、无 shell），把子进程 stdin/stdout 当作 socket，发起 `ws://localhost/rpc` 的 WebSocket 升级，然后发 JSON-RPC。只发只读请求（`initialize`、`thread/list`）。结果全链路成功：

```
=== HANDSHAKE RESPONSE ===
HTTP/1.1 101 Switching Protocols
connection: Upgrade
upgrade: websocket
sec-websocket-accept: UPKxwzQTfx6VR4D1vK/7Jpurnp8=
x-codex-websocket-max-unfragmented-message-bytes: 16777216

<<< TEXT: {"id":1,"result":{"userAgent":"codex-tui/0.157.1 (Windows 10.0.26200; x86_64)",
           "codexHome":"C:\\Users\\<user>\\.codex","platformFamily":"windows","platformOs":"windows"}}
<<< TEXT: {"method":"configWarning","params":{...}}
<<< TEXT: {"method":"remoteControl/status/changed","params":{"status":"disabled",...}}
<<< TEXT: {"id":2,"result":{"data":[{"id":"01a0f50a-...","sessionId":"01a0f50a-...","status":{"type":"notLoaded"},
           "path":"C:\\Users\\<user>\\.codex\\sessions\\2026\\10\\01\\rollout-...jsonl",
           "cwd":"D:\\workspace\\CC\\<proj>","name":"架构升级整改",...}, ...]}}
=== PROBE SUCCESS ===
```

要点：

1. **proxy 的 stdin/stdout 就是透明字节管道**，WebSocket 帧直接可跑——embassy 的 `ChildProxyDuplex` + `WebSocketDuplexTransport` 模式原样适用于 Windows。
2. `initialize` 响应明确 `platformFamily: "windows"`，服务端自认 Windows 上的一等公民。
3. `thread/list` 返回真实线程，`id` 与 `sessionId` 同值，`status.type: "notLoaded"`（对应 embassy 的 `not_loaded` 空闲前置态）。
4. 注意一个帧格式细节：响应/通知帧**没有 `"jsonrpc":"2.0"` 字段**（就是 `{id,result}` / `{method,params,emittedAtMs}`）——客户端解析器不要硬性校验该字段。

### 1.6 协议方法集验证（schema 生成，只读）

`codex app-server generate-json-schema --out <tmp>` 产出 39 个 schema 文件。`ClientRequest.json` 包含 embassy 白名单全部方法及更多：

```
initialize, thread/resume, thread/unsubscribe, thread/list, thread/loaded/list, thread/read,
turn/start, turn/steer, turn/interrupt, turn/completed(通知), thread/started(通知),
thread/start, thread/fork, thread/archive, ...（另有 fs/*、command/exec 等）
```

参数形状与 embassy 请求一致：schema 中 `expectedTurnId`（仅出现 1 次，即 steer 参数）、`turnTrigger`、`input`、`threadId` 字段齐备。

## 2. 环境变量继承（CODEX_THREAD_ID）

三层证据：

1. **本机历史会话实证（最强）**：用户 2026-09-02 的真实 Windows 会话（codex-tui 0.152.1，cwd `D:\workspace\CC\spec-front-ai`）的 rollout 文件里，记录了会话内 shell 命令输出：

   ```
   CODEX_MANAGED_BY_NPM=<present>
   CODEX_MANAGED_PACKAGE_ROOT=<present>
   CODEX_SESSION_ID=<present>
   CODEX_THREAD_ID=<present>
   ```

   即 **Windows 上会话内 shell 进程同时继承 `CODEX_SESSION_ID` 和 `CODEX_THREAD_ID`**（`embassy register-codex` 回退身份机制可用）。

2. **二进制串表**：0.159.3 的 codex.exe 明文含 `CODEX_SESSION_ID`（上下文为审批/环境注入表）；`CODEX_THREAD_ID` 字符串未能直接 grep 到（Rust 二进制字符串表不保证明文可查，不构成否定）。结合 `thread/list` 的 `id == sessionId`，当前版本主变量应为 `CODEX_SESSION_ID`（thread id 即 session id）。
3. **上游 issue**：[openai/codex#15527](https://github.com/openai/codex/issues/15527)（0.116.0 时代）确认 `CODEX_THREAD_ID`、`CODEX_CONVERSATION_ID`、`CODEX_SESSION_ID` 都会注入会话内命令环境，嵌套 `codex exec` 会继承父会话变量。

**实现建议**：身份发现代码两个变量都读（`CODEX_THREAD_ID` || `CODEX_SESSION_ID`），防版本漂移。

（注：我尝试用 `codex exec` 现场复测 env 注入，但本机 codex 配置的第三方模型中转连续 403 内容拦截，三次均失败——这是供应商问题，与 codex Windows 通道无关，故以上述历史会话证据为准。另一次带 `-s read-only` 的尝试暴露了另一个发现：见 §4 缺口 e。）

## 3. Web 研究：官方支持状态

- **官方文档**（[developers.openai.com/codex/cli](https://developers.openai.com/codex/cli/)）：
  > "Codex CLI is available for macOS and Linux with experimental support for Windows. To set up Codex CLI on Windows, follow the instructions in the Windows setup guide."

  即 Windows 是官方 **experimental** 支持但有一等安装路径与专门设置指南（本机 npm 安装的 README 亦载明官方 Windows 安装器：`powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`）。
- **协议开源与文档**：app-server 实现与协议 README 在仓库内（[codex-rs/app-server/README.md](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)），README 涉及 Windows 沙箱后端（ConPTY 等）选择，说明 Windows 是协议层的活跃支持目标。
- **管安装（桌面版 App Server）在 Windows 的形态**：两条路径并存——
  1. CLI 自管 daemon：`codex app-server daemon start`（本机即是，`packages/app-server-daemon` + `app-server-control.sock`）；
  2. Codex/ChatGPT 桌面版：`codex app` 子命令可启动 Desktop app（未安装时打开安装器）。GitHub 上存在多个 Windows Codex Desktop 与内嵌 app-server 的 issue（如启动卡 splash 直到 app-server 重连、桌面性能回归讨论），证明桌面形态在 Windows 真实存在且在维护。
- 版本基线：本机 daemon `appServerVersion 0.157.1` ≥ embassy 集成基线 0.153.4（`docs/OPERATIONS.md`）。

## 4. 缺口与风险清单（不阻塞原生结论，实施时处理）

| # | 缺口/风险 | 说明与对策 |
|---|---|---|
| a | **macOS 硬编码假设需替换** | embassy 的管安装三元组白名单只有 `*-apple-darwin`、目录名 `packages/standalone`（`codex-local-transport.ts:31-34,220-223`）。Windows 等价物：`packages/app-server-daemon`，三元组 `x86_64-pc-windows-msvc`。发现逻辑按平台分派即可。 |
| b | **socket 见证模型不可移植** | `lstat` 判 socket + `0600` + `stat.uid` 在 Windows 无意义（AF_UNIX socket 文件存在但 mode/uid 不语义化）。embassy 报告 §5 已预告：改用"用户 profile 目录私有路径 + named pipe 默认 ACL（仅创建用户+管理员）"或 NTFS ACL 收敛。endpointGeneration 哈希输入（dev/ino/birthtime/ctime）需换成 Windows 等价物（如文件对象 ID / 创建时间戳）。 |
| c | **进程控制语义差异** | POSIX `detached:true` + 进程组整组终止在 Windows 无直接等价；用 `CREATE_NEW_PROCESS_GROUP` / Job Object / `taskkill /PID <pid> /T /F`。proxy 是短命子进程，本 probe 证实 `child.kill()` 可正常收割。 |
| d | **环境变量名版本漂移** | 见 §2：`CODEX_THREAD_ID`（≤0.152 实证）vs `CODEX_SESSION_ID`（0.159.3 串表）。两个都读。 |
| e | **seclogon 禁用的机器上沙箱 exec 失败** | 本机 `codex exec -s read-only` 的 shell 工具报 `CreateProcessWithLogonW failed: 1058`（Secondary Logon 服务 Disabled；`danger-full-access` 不受影响）。这影响**会话内命令执行可用性**（即被投递消息后 Codex 能否干活），不影响 App Server 通道本身。安装文档/诊断里应提示开启 seclogon 或引导用户用适用的沙箱配置。 |
| f | **`turn/start` / `turn/steer` 未活体发送** | 只读边界内不创建真实 turn。由同一 WebSocket 通道上 initialize/thread/list 成功 + schema 参数形状一致推断可行；实施第一天用 `thread/start`（新线程）做隔离验证。 |
| g | **响应帧无 `jsonrpc` 字段** | 见 §1.5 要点 4，解析器勿硬校验。 |

## 5. 论证总结

原生通道三要素，全部本机验证：

1. **入口存在**：`codex app-server proxy` 在 Windows 上存在、帮助文本与 macOS 一致（stdio 字节管道 → 控制 socket）。
2. **传输可用**：WebSocket over proxy stdin/stdout 握手与 JSON-RPC 往返活体成功（initialize + thread/list，真实数据返回）。
3. **协议匹配**：所需方法（`thread/resume`、`turn/start`、`turn/steer`、`thread/unsubscribe`、发现用的 `thread/list` 族）与参数形状（`expectedTurnId` 等）在官方 schema 中齐备；版本高于 embassy 基线。

因此不需要降级轮询。降级轮询只在如下情形才需重新评估：未来 Codex 版本移除 proxy/控制 socket、或目标部署环境禁止 AF_UNIX。缺口清单（§4）全部是移植工作量与防御性编码问题，无一触及通道可行性本身。

## 6. 来源

本地实测（命令与输出已内联上文）：

- `codex --version` / `where codex` / `codex --help` / `codex app-server --help` / `codex app-server proxy --help` / `codex app-server daemon --help` / `codex app-server daemon version` / `codex app-server generate-json-schema --out`
- `~/.codex` 目录列举；`Get-Process`；`Get-Service seclogon`
- 一次性 Node probe（WebSocket over `codex.exe app-server proxy` stdio，只读请求，用后即删）
- `~/.codex/sessions/2026/09/02/rollout-2026-09-02T11-32-47-01a0602d-*.jsonl`（历史会话 env 实证）
- npm 包 README（本地文件 `@openai/codex/README.md`）

Web：

- 官方 Codex CLI 文档（experimental Windows 支持声明）：https://developers.openai.com/codex/cli/
- openai/codex#15527（会话环境变量继承）：https://github.com/openai/codex/issues/15527
- app-server 协议 README：https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- openai/codex Issues / Discussions（Windows Codex Desktop + app-server 相关）：https://github.com/openai/codex/issues 、https://github.com/openai/codex/discussions/29949
- OpenAI Community（Windows 桌面版 app-server 讨论）：https://community.openai.com/t/codex-crashing-windows-desktop-app-with-one-account-only/1391550
