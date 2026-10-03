<div align="center">

<img src="docs/assets/logo.svg" width="128" alt="crosschat logo"/>

# crosschat

**让本机的 Claude Code 与 Codex CLI 互相对话** —— 无守护进程、原生投递、双向实测。

![CI](https://github.com/Oatelauser/crosschat/actions/workflows/ci.yml/badge.svg) ![npm](https://img.shields.io/npm/v/@oatelauser/crosschat) ![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%3E%3D22-339933) ![platform](https://img.shields.io/badge/platform-Windows-blue) ![agents](https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-blueviolet)

</div>

---

## ✨ 为什么用 crosschat

- **🔌 原生投递，零轮询**：消息经 Claude 的 named pipe / Codex 的 App Server daemon 直接注入运行中的会话——接收方像收到一条用户消息一样开始工作，不需要任何轮询或常驻服务
- **🪶 无守护进程**：整个工具就是一条无状态 CLI。没有后台进程要看护、没有崩溃丢状态、没有端口要占——`send` 就是发消息，`status` 就是看在线
- **🤖 教学内建，低入侵**：agent 侧装一次 skill，且**每条消息的信封自带回复命令**——照抄即可回话。题词只写角色，不写协议；长对话也不会忘
- **📮 忙时不丢**：对方正在跑长任务？消息自动进本地发件箱（outbox），并由看门狗进程每 0.5–5 分钟自动重投，对方一空闲就送达——不需要你手动重发；滞留内容随时可在 mailbox 镜像文件里读到
- **🔐 同用户信任边界**：全部通道按 Windows 用户隔离，接收许可只授予 `crosschat claude` 启动的会话——你手敲开的会话不会被外部投递
- **🧪 每个结论都有实证**：通道可行性、写者锁、daemon 版本行为，全部真机联调验证（见 [📚 更多文档](#-更多文档)）

> 灵感与部分模块实现来自 [embassy](https://github.com/YuanpingSong/embassy)（macOS-only，MIT）——crosschat 是它的 Windows 原生、无守护进程重实现。

## 🧰 环境搭建

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Node.js | ≥ 22 | |
| Claude Code | 任意近期版 | 接收需 `crosschat claude` 启动（工具自动注入许可） |
| Codex CLI | ≥ 0.160 推荐 | 0.160 daemon 支持开窗投递；接收需 app-server daemon |
| OS | Windows（一期） | mac/linux 在路线图 |

```powershell
npm i -g @oatelauser/crosschat    # 一行安装（提供 crosschat / multichat 双命令）
crosschat install-skills          # 协议教学装到两侧 agent
```

<details><summary>从源码安装（开发者）</summary>

```powershell
git clone https://github.com/Oatelauser/crosschat.git
cd crosschat && npm ci && npm run build && npm link
crosschat install-skills
```

开发期反复重装本地目录时用 `npm i -g . --force`（或先 bump 版本）：版本号未变时 npm 会报 "up to date" 而**跳过文件更新**，装到的还是旧代码。
</details>

**Codex daemon**（接收方向必需；从**干净终端**启动——勿在 Claude 会话内启动，否则派生 shell 身份污染）：

```powershell
codex app-server daemon start    # 重启电脑后需重新执行
```

## 🚀 快速入门

### 30 秒版：两终端互发一句问候

```powershell
# 终端 A（claude，能收）
crosschat claude          # 进入后 /rename alice

# 终端 B（任意终端，人手发）
crosschat status          # 看到 alice
crosschat send --to alice --body "你好 alice！"
# → 终端 A 里几秒后出现这条消息
```

### 完整剧本：codex 当领导派活给 claude（多任务循环的经典形态）

**任务目标**：codex（领导）命令 claude（工人）在 `D:\workspace\demo` 创建 `notes.txt` 写三行待办，并验收。

**第 1 步 · 左窗启动 claude（接收方先开机；先启动 ≠ 先说话）**
```
D:\workspace\demo> crosschat claude
```
进入后输入 `/rename worker`，待命。

**第 2 步 · 右窗启动 codex（领导）并贴题词**
```
D:\workspace\demo> codex
```
```
你是领导。用 crosschat（先 status 确认名字）给 claude 会话「worker」下发任务：
在当前目录创建 notes.txt，内容三行：买牛奶、交电费、给妈妈打电话。
收到完成报告后，亲自打开文件验证内容；通过则回复"验收通过，任务结束"并停止；
不通过则下发返工任务。
```

**第 3 步 · 右窗屏幕——任务由 codex 发出**
```
● exec: crosschat status
● exec: crosschat send --to worker --body "任务1：在当前目录创建 notes.txt…"
● delivered to worker (turn 1)          ← 任务飞进左窗，发起方是 codex
```

**第 4 步 ·（0.160+ 可跳过）关掉右窗**：旧版 daemon（≤0.157）下收报告需关窗；**0.160+ 开窗也能收**（headless 执行）。

**第 5 步 · 左窗屏幕——claude 收令干活**
```
📨 来自另一会话的消息:
<cross-session-message from-name="codex/01a…" turn="1">
任务1：在当前目录创建 notes.txt，内容三行…
回复请运行: crosschat send --conversation mc1_xxx --body "<你的回复>"
</cross-session-message>

⏺ Write: notes.txt（三行待办）
⏺ Bash: crosschat send --conversation mc1_xxx --body "已完成：notes.txt 已创建…"
⏺ delivered (turn 2)                     ← 报告发回给 codex
```

**第 6 步 · 自动发生**：报告落进 codex 线程 → codex 验证 → 下发下一个/验收结论 → 又出现在左窗。

**第 7 步 · 左窗收到"验收通过，任务结束"——收工**。全程在左窗直播；想看领导的验收细节：开右窗 `codex resume` 翻历史。

## 📋 命令列表

```
crosschat send --to <名字> --body "<正文>"          # 新消息（名字含空格加引号）
crosschat send --conversation <ref> --body "<正文>" # 回复（ref 照抄收到的信封）
echo … | crosschat send --to <名字>                 # 正文走 stdin
crosschat status [--json]                           # 双侧总览（名字/目录/时间/状态）
crosschat doctor                                    # 一键环境体检（有 ❌ 时退出码 1）
crosschat install-skills [--dir <根>]               # 安装/更新 agent skill（幂等）
crosschat claude [任意 claude 参数…]                 # 带接收许可启动 claude（透传）
crosschat -v | --version | help                     # 版本 / 帮助
```

发送输出三种状态：`delivered`（已投递）/ `parked`（对方忙，已入发件箱，看门狗自动重投；输出含队列深度与 mailbox 镜像路径）/ 错误码（见排障）。

## 📖 对话生命周期（规则总纲）

### 三种发起方式

| 发起者 | 怎么发 | 特性 |
|---|---|---|
| **claude** | 会话内 agent 跑 `crosschat send --to <codex 线程名> --body "…"` | 最顺，推荐默认 |
| **codex** | 会话内 agent 跑 `crosschat send --to <claude 会话名> --body "…"` | 发送随意；回信开窗关窗都能收（daemon 0.160+） |
| **人** | 任意终端直接 `crosschat send --to <名字> --body "…"` | 身份是 human：**能发、不能被回复**（单向指令） |

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
| codex（旧 daemon ≤0.157 / `--no-daemon`） | 窗口开 | ⏳ 等待 120s，关窗瞬间送达；超时 `parked` 入发件箱（看门狗自动重投） |
| codex | 排队被旧 daemon 拒绝等罕见态 | 📮 `parked` 入发件箱（新消息排队不插队），看门狗每 0.5–5 分钟自动重投 |

**不对称速记**：claude 收发都随意；codex 收信在 0.160+ 开窗关窗均可，关窗永远是最稳路径。

## 🤝 Agent 兼容性

| Agent | 发送 | 接收 | 实测版本 |
|---|---|---|---|
| Claude Code | ✅ | ✅（需 `crosschat claude` 启动） | 2.1.287 |
| Codex CLI | ✅ | ✅（需 daemon；0.160+ 开窗可收） | 0.159.3 / 0.160.0 |
| 任意有 shell 的 agent | ✅（装 skill 后） | 🔜 按适配器扩展（GLM 等） | 路线图 |

## 🗺️ 路线图

**已完成（v1.0.0）**
- [x] Claude ↔ Codex / Claude ↔ Claude / Codex ↔ Codex 双向消息（真机联调验证）
- [x] 无状态 CLI 四命令 + 自包含会话引用 + 轮次计数
- [x] 双侧自动发现（含目录/时间标注）、信封自带教学 skill
- [x] 16KiB 上限、30 条/60s 防乒乓限流、身份冲突自纠指引
- [x] 忙/锁超时 → 本地发件箱 + 看门狗自动重投（outbox，FIFO 不插队，mailbox 镜像可读）
- [x] daemon 0.160 开窗投递（实证：同 daemon 多连接绕过写者锁）

**计划中**
- [ ] 🌐 跨机联邦（SSH，异构 win ↔ linux 互聊）
- [ ] 🐧 mac / linux 平台适配（平台接缝已预留：PipeTransport / ProcessInspector / PathLayout）
- [ ] 📦 常驻 broker（忙时持久队列、异步回执、投递状态机——embassy 完整集对齐）
- [ ] 🖼️ TUI 看板与服务安装（开机自启）
- [ ] 🤖 新 agent 适配器（GLM 等；有原生唤醒通道则原生，否则论证降级）
- [ ] 👀 status 标注 TUI 占用线程；专用信箱线程机制化

## 🧯 错误码排障

**使用类**：`NAME_NOT_FOUND`（错误信息列出全部可用名）· `NAME_COLLISION`（重名，`status --json` 看 id）· `MESSAGE_TOO_LARGE`（>16KiB → 落盘发路径）· `RATE_LIMITED`（等待或收尾）· `TARGET_*`/`BODY_*`/`USAGE`（参数错误）

**身份类**：`CALLER_IDENTITY_CONFLICT`（环境双身份残留。临时：命令前缀 `env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID`；根治：干净终端重启 daemon）· `CALLER_NOT_IN_CONVERSATION` · `CANNOT_REPLY_TO_HUMAN`（对话由人发起）

**通道类**：`CODEX_PROXY_SPAWN_FAILED`（看 stderr 摘录；通常 daemon 未跑）· `CODEX_THREAD_LOCKED`/`CODEX_THREAD_BUSY_TIMEOUT`（已自动转 `parked` 入发件箱，无需重发）· `OUTBOX_FULL`（每线程 200 条积压上限，读 mailbox 镜像取回内容）· `CODEX_APPROVAL_REQUIRED`（**工具永不代答审批**）· `CLAUDE_PIPE_*`/`CODEX_*UNCERTAIN`（写入中途失败状态不明——**勿盲目重发**，先 `status` 核实）

**发送审计**：每次发送的最终结果（delivered/queued/parked/failed、时间、对端、回执）追加记录在 `%LOCALAPPDATA%\crosschat\send-log.jsonl`；codex 投递附 rollout 回执（消息已确认落入对方会话历史 = `receipt: confirmed`）。命令超时转后台后结果同样在案，事后可查。

## ⚠️ 边界与限制

单条 ≤16KiB；每对端点 30 条/60s；发件箱每线程 200 条（满时读 `%LOCALAPPDATA%\crosschat\mailbox\<线程ID>.md` 取回内容）；信任边界=同一 Windows 用户；接收许可仅 `crosschat claude` 启动的会话。

**daemon 依赖（重要）**：向 codex 会话投递走 `codex app-server proxy`，它连接**运行中的 app-server daemon** control socket。要获得完整能力（TUI 开窗可投、忙时入队），需要 `codex app-server daemon start` 且 daemon ≥0.160，TUI 用同版本 CLI 打开（0.160 起 TUI 自动附着 daemon）。daemon 未运行时投递会报 `CODEX_PROXY_SPAWN_FAILED` 并提示启动命令；旧版本 daemon 下开窗投递与忙时入队退化为「关窗投递 + 发件箱」。重启电脑后需重新 `codex app-server daemon start`。

## ❓ FAQ

**Q：codex 窗口开着收不到？** daemon ≥0.160 开窗也能收（headless，界面不实时刷新）；旧 daemon/`--no-daemon` 下等待或已入发件箱，关窗后自动送达。

**Q：为什么必须 `crosschat claude`？** 它注入跨会话接收许可；裸 `claude` 的会话收不到。

**Q：`codex queue` 能用吗？** 仅当 TUI 附着 daemon（0.160+）时会被消费；旧形态下是黑洞，故 crosschat 不依赖它。

**Q：人能发消息吗？** 能（`--to`），身份 human，单向不能被回复。

**Q：消息历史在哪看？** claude 侧=会话 transcript；codex 侧=开窗 resume 线程。

## 🔧 故障恢复

| 症状 | 动作 |
|---|---|
| 任何异常 | 先跑 `crosschat doctor` 一键体检（逐项 ✅/⚠️/❌ 定位） |
| status 的 codex 段 unavailable | 干净终端 `codex app-server daemon start` |
| codex 回信撞身份冲突 | 同上（重启 daemon 即根治） |
| skill 误删/过期 | `crosschat install-skills` |
| 升级 crosschat 代码后 | `npm run build`（skill 有变再 install-skills） |
| 消息发出对方没反应 | 先 `status` 确认在线；`parked` 的等对方空闲自动补投；UNCERTAIN 类勿重发先核实 |

## 📚 更多文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | **底层原理**：注册表/命名管道/daemon 通道、写者锁本质、信封与自包含引用、完整投递流程图 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [docs/wayfinder/map.md](docs/wayfinder/map.md) | 设计决策地图（全部拍板过程与依据） |
| [docs/research/](docs/research/) | 实测研究报告（embassy 源码分析、两侧通道验证、0.160 inject_items 实验） |
| [docs/drill-reports/](docs/drill-reports/) | 联调实证记录 |

## 🛠️ 开发说明

```powershell
npm run check                              # lint + build + test
$env:CROSSCHAT_LIVE='1'; npx vitest run --dir test   # 真机 live 测试
```

- 目录：`src/claude`（注册表/管道/鉴权）· `src/codex`（proxy/RPC/投递）· `src/commands`（CLI）· `src/platform`（平台接缝）· `src/outbox.ts`（发件箱）· `skills/`（agent 教学）
- 铭谢：[embassy](https://github.com/YuanpingSong/embassy)（MIT）的信封格式与 codex 传输模式
- License：[MIT](LICENSE)

---

<div align="center">Made with 🤝 between agents — crosschat 让它们自己对话</div>
