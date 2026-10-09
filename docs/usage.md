# 单机使用深度细则

发起方式、往复规则、投递语义与边界限制的完整说明；速查与入门见 [README](../README.md)。

## 📖 对话生命周期（规则总纲）

### 三种发起方式

| 发起者 | 怎么发 | 特性 |
|---|---|---|
| **claude** | 会话内 agent 跑 `crosschat send --to <codex 线程名> --body "…"` | 最顺，推荐默认 |
| **codex** | 会话内 agent 跑 `crosschat send --to <claude 会话名> --body "…"` | 发送随意；回信开窗关窗都能收（daemon 0.160+） |
| **人** | 任意终端直接 `crosschat send --to <名字> --body "…"` | 身份是 human：**能发、不能被回复**（单向指令） |
| **脚本（headless）** | `codex exec "<题词>"` 建线程，然后 `crosschat send --to <id8> --body "…"` | codex 原生命令：建线程 + 跑一轮自动硬化 + 退出，角色题词随行；**线程 id 就在输出头 `session id:` 行**（并发多路各拿各的，零歧义）；`crosschat status` 里 originator 为 `codex_exec`、cwd 列可辨。跨机预置（联邦就绪后）：`ssh <host> codex exec "<题词>"` |
| **跨机（联邦）** | `crosschat send --via ssh:<对端hostname> --to <名/id8> --body "…"` | 远端 CLI 全权（名字在对端解析）；回执带 `@<host>`；信封自动携带回程路条，接收方照抄即回 |

第一条消息永远用 `--to`（此刻生成对话引用 reply-ref）；对方名字用 `status` 查。`--to` 不必只用于第一条：对同一端对的重复 `--to` 发送会**自动接续你们最近的对话**（turn 递增，本地记账，无需手带引用）；要另起线程时用 `--conversation` 显式切换即可。

### 往复规则

1. 收到方看到**信封消息**（`from-name` + `turn="N"` + 回复提示）
2. 回复 = **逐字照抄回复提示里的命令**，换掉 `<你的回复>`——引用自动轮转，无需记任何历史
3. 防失控：每对端点 30 条/60 秒限流

### 轮次与终止

信封显示 `turn="N"`；题词给预算（如"10 轮内完成"）；接近预算时 agent 按 skill 准则总结收尾；协议层不强制终止。

## 📡 投递语义矩阵

| 接收方 | 状态 | 行为 |
|---|---|---|
| claude（`crosschat claude` 启动） | 窗口开 | ✅ 秒达，会话内出现信封消息 |
| claude（裸 `claude` 启动） | 任何 | ❌ 无接收许可（换 `crosschat claude` 重启） |
| codex（daemon ≥0.160） | 窗口开/关 | ✅ 送达（headless 执行；TUI 不实时刷新，翻历史可见） |
| codex（daemon ≥0.160） | turn 进行中（忙） | ✅ **入队即达**：`queued`（按线程串行，轮结束瞬间落历史并被处理）——与 Claude 收件箱同粒度 |
| codex（旧 daemon ≤0.157 / `--no-daemon`） | 窗口开 | ⏳ 等待 ~10s，关窗瞬间送达；超时 `parked` 入发件箱（看门狗自动重投） |
| codex | 排队被旧 daemon 拒绝等罕见态 | 📮 `parked` 入发件箱（新消息排队不插队），看门狗每 0.5–5 分钟自动重投 |

**不对称速记**：claude 收发都随意；codex 收信在 0.160+ 开窗关窗均可，关窗永远是最稳路径。

## ⚠️ 边界与限制

单条 ≤16KiB（`--max-body-kb` / `CROSSCHAT_MAX_BODY_KIB` 可提额；端点封顶 claude 64KiB、codex 1MiB，到顶只能落盘）；轮次预算可设（`--max-turn` / `CROSSCHAT_MAX_TURN`，信封显示 turn="N/M"，软提醒不硬拦）；每对端点 30 条/60s；发件箱每线程 200 条（满时读状态目录 `mailbox\<线程ID>.md` 镜像取回内容：Windows `%LOCALAPPDATA%\crosschat\mailbox\`、unix `~/crosschat/mailbox/`）；信任边界=同一系统用户（Windows 用户 / unix uid）；接收许可仅 `crosschat claude` 启动的会话。

**daemon 依赖（重要）**：向 codex 会话投递走 `codex app-server proxy`，它连接**运行中的 app-server daemon** control socket。要获得完整能力（TUI 开窗可投、忙时入队），需要 `codex app-server daemon start` 且 daemon ≥0.160，TUI 用同版本 CLI 打开（0.160 起 TUI 自动附着 daemon）。daemon 未运行时投递会报 `CODEX_PROXY_SPAWN_FAILED` 并提示启动命令；旧版本 daemon 下开窗投递与忙时入队退化为「关窗投递 + 发件箱」。重启电脑后需重新 `codex app-server daemon start`。

