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
| **跨机（联邦）** | `crosschat send --via ssh:<对端hostname> --to <名/id8> --body "…"` | 远端 CLI 全权（名字在对端解析）；回执带 `@<机器名>(<mid8>)`；信封自动携带回程路条，接收方照抄即回 |

第一条消息永远用 `--to`（此刻生成对话引用 reply-ref）；对方名字用 `status` 查。`--to` 不必只用于第一条：对同一端对的重复 `--to` 发送会**自动接续你们最近的对话**（turn 递增，本地记账，无需手带引用）；要另起线程时用 `--conversation` 显式切换即可。

### 往复规则

1. 收到方看到**信封消息**（`from-name` + `turn="N"` + 回复提示）
2. 回复保留提示中的命令名和路由，换掉 `<你的回复>`；正文可改走 stdin，需要即时追加时显式增加 `--delivery steer`
3. 防失控：每对端点 30 条/60 秒限流

### 轮次与终止

信封显示 `turn="N"`；题词给预算（如"10 轮内完成"）；接近预算时 agent 按 skill 准则总结收尾；协议层不强制终止。

## 📡 投递语义矩阵

每条消息支持 `--delivery queue|steer`，默认 queue；回复独立选择，不继承来信。用户明确让当前代理用 crosschat 与指定会话聊天、转达或代发时，代理必须显式用 steer。该规则也写在安装到两侧的 skill 入口。

| 接收方 | 忙时 queue | 忙时 steer | 空闲时两种模式 |
|---|---|---|---|
| Claude（已启用接收许可） | 原生轮后队列 | 追加当前轮，保留在途工具 | 唤醒新轮 |
| Codex Desktop（原生 owner 可达） | 本机 outbox，等原轮结束补投 | 向当前桌面任务追加 | 原生通道启动新轮 |
| Codex CLI（同宿主 app-server 可达） | 本机 outbox，等原轮结束补投 | 用真实 activeTurnId 追加 | 同宿主启动新轮 |

Codex 忙时 `turn/start` 在实测 CLI 0.163.0 会合并进当前任务，不能当作轮后排队证据，因此 queue 在写入前寄存。显式 queue 的 worker 每秒重新检查；旧寄存记录仍沿用既有退避。写入不明的队首暂停自动补投，避免重复；正文保留在 mailbox 待核实。

## ⚠️ 边界与限制

单条 ≤16KiB（`--max-body-kb` / `CROSSCHAT_MAX_BODY_KIB` 可提额；端点封顶 claude 64KiB、codex 1MiB，到顶只能落盘；tcp 形态单条同按 1MiB 预检，大内容走 `--file`——细节见[转发器手册](broker.md)）；轮次预算可设（`--max-turn` / `CROSSCHAT_MAX_TURN`，信封显示 turn="N/M"，软提醒不硬拦）；每对端点 30 条/60s；发件箱每线程 200 条（满时读 `~/.crosschat/mailbox/<线程ID>.md` 镜像取回内容，全平台同路径）；信任边界=同一系统用户（Windows 用户 / unix uid）；接收许可仅 `crosschat claude` 启动的会话。

**原生宿主**：Desktop 使用桌面应用自己的 IPC 与 owner，不依赖 CLI daemon；另开一个 CLI daemon 不能替代当前桌面 owner。CLI 走 `codex app-server proxy`，须连接目标 CLI 所在的 app-server；默认 daemon 未运行会报 `CODEX_PROXY_SPAWN_FAILED`。已绑定 Desktop owner 后发生错误，不改投 CLI。会话等待批准时由用户处理，crosschat 不代答。

