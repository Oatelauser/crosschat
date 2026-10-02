# codex 开窗注入通道探测报告

- 日期：2026-10-02
- 环境：Windows 11 Pro for Workstations，codex-cli 0.160.0（npm 包装，真实二进制 `C:\Users\yangsheng\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`），共享 daemon 0.157.1 运行中
- 方法：help 树全扫 + schema 生成分析 + 自有探针线程端到端活体实验（所有写操作仅针对自己 spawn 的线程）

## 结论：✅ 找到开窗注入通道 —— `codex queue`

```
codex queue --thread <SESSION-UUID> --message <TEXT>
```

**TUI 开着的会话照收不误，约 2 秒内自动以该消息开 turn。** 实测证据链：

1. `codex exec --json "Reply with exactly: BASELINE-OK"` 建探针线程 `01a0fa9d-227e-7ee1-99b6-9be829cb946b`（exec 退出 = 关窗态）。
2. 关窗态 queue：`Queued message 01a0fa9d-58d9-… for thread 01a0fa9d-…`（成功，消息落 `~/.codex/queue_1.sqlite`，daemon 持锁）。
3. 隐藏窗口 spawn `codex resume <id>`（TUI 持写者锁），`codex exec resume` 试探确认 `already has an active writer`（窗确系开着）。
4. **开窗态 queue**：CLI 返回成功；rollout 2 秒内出现该 user 消息并自动开 turn，模型回复 `OPEN-WINDOW-RECEIVED`：

```
{"timestamp":"2026-10-02T03:18:16.093Z",…,"role":"user","content":[{"type":"input_text","text":"QUEUE-OPEN-WINDOW-TEST: if you see this, reply OPEN-WINDOW-RECEIVED"}]}
{"timestamp":"2026-10-02T03:18:28.333Z",…,"role":"assistant","content":[{"type":"output_text","text":"OPEN-WINDOW-RECEIVED","phase":"final_answer"}]}
```

5. **边界加宽**：TUI 用 `--no-daemon` 启动同样照收（`QUEUE-NODAEMON-TEST` → 2 秒内开 turn → 回复 `NODAEMON-RECEIVED`）。
6. 关窗时投的消息在下次开窗 resume 时被消费（第 1 步的 QUEUE-CLOSED-WINDOW-TEST 在第 3 步 resume 后立即触发 turn）。

即：`codex queue` 是**开窗/关窗通吃的正式投递通道**——关窗=存件待取，开窗=实时送达并自动触发模型 turn。写者锁只拦 `thread/resume`（抢写者），不拦队列投递。这直接取代 multichat 现有"关窗可投"headless 信箱模型的开窗短板：**开窗投递只需一条 CLI**。

### 机制

- 底层走 app-server 方法 `thread/queue/add`（向伪 UUID 投递时报错 `failed to queue session message: thread/queue/add failed: failed to read thread: …` 可见方法名）。**该方法不在公开 schema 里**（隐藏/内部方法，CLI 专用）。
- 消息持久化在 `~/.codex/queue_1.sqlite`（+wal/shm，daemon 进程持锁）。
- TUI 侧通过订阅 `thread/queue/changed` 通知（v2 协议）实时感知队列变化并消费。`--no-daemon` TUI 仍能收到，说明队列订阅路径与模型会话连接相互独立。
- 支持 `--remote <ADDR>` 参数，可向远程 app-server 的线程投递。

## 线索 1：`codex remote-control`

```
Commands:
  start  Start the app-server daemon with remote control enabled
  stop   Stop the app-server daemon
  pair   Create and print a short-lived manual pairing code
```

实测（`CODEX_HOME=D:\tmp\codex-probe\home2` 隔离实例，未触碰真 daemon）：

- `remote-control start`：先安装 daemon 包到 `<CODEX_HOME>\packages\app-server-daemon\`（0.160.0），拉起 daemon，然后报 `Error: Remote control is enabled on yang but the connection is errored.`——**"yang" 是本机设备名**，说明 remote-control 是向 OpenAI 云端中继注册本机设备（供 ChatGPT 网页/移动端反过来控制本机 codex），出站连接需登录态，临时 home 无 auth 故失败。
- `remote-control pair`：`Error: remoteControl/pairing/start failed: remote control pairing is unavailable until enrollment completes`——配对码必须先完成设备 enrollment（云端注册，需登录）。底层方法 `remoteControl/pairing/start` 同样不在公开 schema。
- `remote-control stop`（对临时实例）：返回 JSON 确认按 pid 停止，控制 socket 路径 `<CODEX_HOME>\app-server-control\app-server-control.sock` ——**daemon 按 CODEX_HOME 完全隔离**。

判定：remote-control 是"云端遥控本机"的方向（ outward ），不是本机进程间注入通道；且需登录 enrollment，不适合作为 multichat 通道。对 multichat 有用的是它的启示：daemon 控制 socket 按 CODEX_HOME 隔离、可安全起旁路实例。

## 线索 2：`codex app-server daemon bootstrap`

```
Install durable local app-server management for SSH-driven use
Options: --remote-control  Launch the managed app-server with remote control enabled
```

- 自述 SSH 场景：在远端机器上装常驻 daemon 管理（包落 `<CODEX_HOME>\packages\app-server-daemon\releases\<ver>\`），本地经 `codex --remote ws://host:port`（或 `codex agents --remote`）把 TUI 当**前端**连上去。`app-server --listen` 支持 `ws://IP:PORT` + `--ws-auth capability-token|signed-bearer-token`。
- 同族子命令：`daemon start/restart/update/enable-remote-control/disable-remote-control/stop/version`。
- 活体实验里 `remote-control start`（home2）已实际演示了 bootstrap 形态：独立 CODEX_HOME → 自动装 daemon 包 → 拉起进程对 → control socket 就位。写者归属：remote 形态下线程归 daemon 侧持有，TUI 前端可轮替接入（未做 ws 全链路活测，socket/参数证据来自 help 与 home2 实跑）。
- 与 wayfinder 二期"embassy 同墙不同安装要求"调研互证：受管会话 = daemon 持线程 + 前端连 `--remote`。

## 线索 3：`codex app` 与 `codex agents`

- `codex app [PATH]`：`Launch the Desktop app (opens the app installer if missing)`——纯桌面应用启动器/装器，非终端前端，与注入无关。
- `codex agents`：`Browse all agent sessions on the shared local app-server daemon`——只读浏览器 TUI（列出共享 daemon 上所有 agent 会话），无发送/注入能力。支持 `--remote`、`-C`（为远程新 task 指定目录）。对 multichat 有辅助价值（可视化发现会话），但非通道。

## 线索 4：hooks

- v2 schema 存在 `hooks/list`（params 仅 `cwds: string[]`）及通知 `hook/started`、`hook/completed`；顶层 CLI 另有 `--dangerously-bypass-hook-trust` 旗标。
- 判定：hooks 是**配置侧**生命周期钩子（类似 Claude Code hooks，作用于会话启动/结束等时机），方向是"codex 事件触发外部脚本"，不是"外部向 TUI 送消息"的入口。不能当开窗注入用，但**可反向利用**：multichat 可挂 hook 在会话事件时拉信箱（如果需要 daemon 级事件订阅的话）。

## 附加发现（0.160.0 新证据，修正旧定案）

1. **`thread/inject_items`（v1/v2 schema 均在）**：`ThreadInjectItemsParams{threadId, items[]}`，描述原话 *"Raw Responses API items to append to the thread's model-visible history."*——裸注入方法确实存在于公开协议（"schema 全量方法表无注入方法"的旧定案在 0.160.0 已不成立；当时或为旧版本）。仅追加历史、不触发 turn，TUI 开窗时是否放行未活测成功：`codex app-server proxy` 对 0.157.1 daemon 三种姿势（包装层/裸 exe/保持 stdin）均零输出，疑 daemon 版本不认 proxy，未再深挖（queue 通道已足够）。
2. **`turn/steer`**：`TurnSteerParams{threadId, expectedTurnId(必填,须匹配活动 turn), input[]}`——turn 进行中插入用户输入（转向）。需要先订阅通知拿到活动 turn id，适合"开窗且正忙"场景，复杂度高于 queue，留作后续。
3. `thread/queue/changed` 通知（仅 threadId 字段）——TUI 实时消费队列的机制依托。
4. `codex cloud exec/status/list/apply/diff`——Codex Cloud 任务面，云端方向，非本机通道。
5. `codex exec-server`（`--listen ws://`、`forward` 注册远程执行环境）——远程执行器，非消息通道。

## 复现步骤（约 1 分钟）

```
codex exec --cd <临时目录> --skip-git-repo-check --json "hi"   # 记下 thread_id
# 场景 A 开窗：另开终端跑 codex resume <thread_id> 保持 TUI 开着
codex queue --thread <thread_id> --message "外部消息"          # TUI 2 秒内收到并自动开 turn
# 场景 B 关窗：直接 queue；下次 codex resume <thread_id> 开窗即消费
```

## 清理清单（全部已执行）

- 探针线程 `01a0fa9d-227e-7ee1-99b6-9be829cb946b`：`codex delete --force` 已删（rollout 与 writer-lock 文件均确认消失）
- 两个自 spawn 的隐藏 TUI（pid 22868、30116）：已 Stop-Process
- 临时 CODEX_HOME daemon（home2，pid 22044/30536）：`remote-control stop` + 补刀，确认退出
- `D:\tmp\codex-probe\`（ws、schema、home2、pid/proxy 输出文件）：整目录已删
- 残留检查：`Get-Process codex` 仅剩用户自己的 daemon（11128/11512，0.157.1）与 8:18 起的 node 包装进程（32592），零接触
- `~/.codex` 配置：未改；`queue_1.sqlite` 中探针消息均已消费（队列天然清空）
