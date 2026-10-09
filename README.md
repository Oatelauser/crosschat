<div align="center">

<img src="docs/assets/logo.svg" width="128" alt="crosschat logo"/>

# crosschat

**让本机的 Claude Code 与 Codex CLI 互相对话** —— 无守护进程、原生投递、双向实测。

![CI](https://github.com/Oatelauser/crosschat/actions/workflows/ci.yml/badge.svg) ![npm](https://img.shields.io/npm/v/@oatelauser/crosschat) ![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%3E%3D22-339933) ![platform](https://img.shields.io/badge/platform-Win%20%7C%20Linux%20%28experimental%29-blue) ![agents](https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-blueviolet)

</div>

---

## ✨ 为什么用 crosschat

装完即用：让 agent 会话像同事一样互发消息——同机直连、跨机走 ssh。

- **原生消息投递** —— 消息直注运行中的会话，像收到一条用户消息；零轮询
- **跨机聊天** —— `--via ssh:对端` 直发另一台机器（win ↔ linux 互聊），回复自动回来；不装服务，密钥即全部配置
- **无感式回复** —— 每条消息信封自带回复命令，对方 agent 照抄即回；协议教学随 skill 内建，题词只写任务
- **忙时不丢** —— 对方忙就进发件箱，看门狗自动重投，你不用重发
- **无守护进程** —— 整条工具是一支无状态 CLI，没有后台进程和端口要看护
- **同用户信任边界** —— 通道按系统用户隔离，只授予你启动的会话

> 灵感与部分模块实现来自 [embassy](https://github.com/YuanpingSong/embassy)（macOS-only，MIT）——crosschat 是它的 Windows 原生、无守护进程重实现（1.3.0 起亦支持 Linux/WSL，experimental）。

## 🧰 安装

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Node.js | ≥ 22 | |
| Claude Code | 任意近期版 | 接收需 `crosschat claude` 启动（工具自动注入许可） |
| Codex CLI | ≥ 0.160 推荐 | 0.160 daemon 支持开窗投递；接收需 app-server daemon |
| OS | Windows（稳定）· Linux/WSL（experimental，1.3.0） | mac 未实测（unix 实现共享，理论可达） |

```bash
npm i -g @oatelauser/crosschat    # 一行安装（提供 crosschat / multichat 双命令）
crosschat install-skills          # 协议教学装到两侧 agent
codex app-server daemon start     # 仅 codex 会话参与时需要，纯 claude 互聊可跳过（干净终端启动，勿在 Claude 会话内）
```

<details><summary>从源码安装（开发者）</summary>

```bash
git clone https://github.com/Oatelauser/crosschat.git
cd crosschat && npm ci && npm run build && npm link
crosschat install-skills
```

开发期反复重装本地目录：`npm run build && npm i -g . --force`——**build 不可省**（包没有 prepare 脚本，npm 不会自动构建，`files` 只打包 dist/ 现状，漏 build 会把旧 dist 装回去）；`--force`（或先 bump 版本）是因为版本号未变时 npm 会报 "up to date" 而**跳过文件更新**。若首次用的是 `npm link`（符号链接直连仓库），则每次只需 `npm run build`，无需重装。
</details>

<details><summary>Linux / WSL（experimental）</summary>

三条安装命令照常执行——装在 WSL 里、agent 也装在 WSL 里（同一侧）即可，源码安装同样适用。例外只有两条：

- **两侧独立**：unix 状态目录 `~/crosschat`（Windows 侧为 `%LOCALAPPDATA%\crosschat`），互不相通，管道/socket 不过系统边界
- **agent 同侧**：WSL 内用 unix 版 claude / codex CLI（Node ≥ 22 同侧装）

<details><summary>claude 安装受阻时（受限网络）</summary>

claude.ai/install.sh 可能被区域屏蔽（302），改用 npm 直装 `npm i -g @anthropic-ai/claude-code`；仍不可达时按架构直装平台包 tarball（如 `@anthropic-ai/claude-code-linux-x64`，镜像源可拉，解包即含原生 `claude` 二进制）。
</details>

mac：unix 实现共享，理论可达、未实测。
</details>

## 🚀 快速入门

两段对话实录：你只说一句话（👤），两个 agent 自动对话到闭环（🤖 / 📨）。全部命令见[📋 命令列表](#-命令列表)。

图例：**👤 用户[发送 -> 接收]** 你说的指令 · **🤖 agent[发送 -> 接收]** agent 的回复 · **📨** 收到的消息

### 单机：boss 给 worker 派一句活

准备：终端 A 跑 `crosschat claude`，进去后 `/rename worker`；终端 B 开一个 codex 窗口当 boss。然后整个过程：

```
👤 用户[boss -> worker]   用 crosschat（先 status 确认名字）给 claude 会话「worker」下发任务：给我回复你好的消息。
🤖 worker 收到            📨 来自另一会话的消息:
                          <cross-session-message from-name="codex/01a…" turn="1">
                          给我回复你好的消息
                          回复请运行: crosschat send --conversation mc2_… --body "<你的回复>"
🤖 worker[worker -> boss] 你好
🤖 boss 收到              📨 你好（turn 2）
```

worker 零配置、没学过任何协议——信封说怎么回就怎么回。

### 跨机：和单机一样，只是对端在另一台机器上

准备（一次性）：对端（本例 WSL）装好 crosschat、双机互配 ssh 密钥（→ [📡 通信方式](#-通信方式) 表的 ssh 手册，五步配完）。然后整个过程：

```
👤 用户[boss -> beta2]    使用 crosschat 发送消息给 beta2 问好，消息要求经过 ssh 管道送到（send 时加 --via ssh:yangwsl）。需要对方回复并停止。
🤖 beta2 收到             📨 来自另一会话的消息:
                          <cross-session-message from-name="codex/boss@win" turn="1">
                          你好 beta2，这是跨机问候
                          回复请运行: crosschat send --via ssh:win --conversation mc2_… --body "<你的回复>"
🤖 beta2[beta2 -> boss]   收到！跨机闭环成立
🤖 boss 收到              📨 收到！跨机闭环成立（turn 2，自动经 ssh 回到 win）
```

与单机的全部差别：题词里多了 `--via ssh:yangwsl`——消息与回复自动走 ssh 往返，双方谁都没敲过一次完整命令。

## 📡 通信方式

| 方式 | 一句话 | 状态 | 深入 |
|---|---|---|---|
| **单机会话** | 同机 agent 互发，`--to <名字>` 即起对话，忙时自动入队/发件箱 | ✅ v1.0 | [docs/usage.md](docs/usage.md)：发起方式 / 投递语义 / 底层命令 / 边界 |
| **跨机联邦 · ssh** | 加 `--via ssh:<对端hostname>`，消息经 ssh 落到对端机器，回复自动回来 | ✅ v1.3.3 | [docs/federation.md](docs/federation.md)：按操作系统配置（Win/Linux/macOS）/ 单向 NAT / 命令形态 / 大内容 / 自环测试 |
| 跨机联邦 · tcp | 局域网直连 + 极简预共享鉴权 | 🚧 规划中 | — |
| 跨机联邦 · broker | 常驻 broker：忙时持久队列、异步回执、投递状态机、堡垒机形态 | 🚧 规划中 | — |

ssh 配置方向一句话：**每台机写自己的 `~/.ssh/config`，内容是"怎么连对端"**（别名推荐=对端 hostname）——完整五步与命令样例见上表手册。

## 📋 命令列表

```
crosschat send --to <名字> --body "<正文>"          # 新消息（名字含空格加引号；未命名 codex 线程可用 id8 或完整 id 寻址，status 可见）
crosschat send --conversation <ref> --body "<正文>" # 回复（ref 照抄收到的信封）
crosschat send --via ssh:<对端hostname> --to <名/id8> --body "…"  # 跨机发送（见 📡 通信方式）
echo … | crosschat send --to <名字>                 # 正文走 stdin
crosschat status [--json] [--conversations]        # 双侧总览（名字/目录/时间/状态）
crosschat doctor                                    # 一键环境体检（有 ❌ 时退出码 1）
crosschat install-skills [--dir <根>]               # 安装/更新 agent skill（幂等）
crosschat claude [任意 claude 参数…]                 # 带接收许可启动 claude（透传；--max-body-kb/--max-turn N 可预置本会话发送上限/轮次预算，并剥离 codex 侧身份变量）
crosschat codex [任意 codex 参数…]                  # crosschat 增强启动 codex（透传；同上旋钮预置，并剥离 claude 侧身份变量）
crosschat -v | --version | help                     # 版本 / 帮助
```

完整参数、启动器与环境变量说明见 [docs/commands.md](docs/commands.md)。

发送输出三种状态：`delivered`（已投递）/ `parked`（对方忙，已入发件箱，看门狗自动重投；输出含队列深度与 mailbox 镜像路径）/ 错误码（见排障）。

`status --conversations` 另看对话总览：每对端点的最近方向、相对时间、轮次、末条状态与滞留数（与 `--json` 组合输出同结构数组）。

## 🧯 错误码排障

报错输出自带完整自纠指引，这张表只当速查索引：

| 错误码 | 含义与动作 |
|---|---|
| `NAME_NOT_FOUND` / `NAME_COLLISION` | 名字不对/重名——错误信息已列可用名；重名改用 id8 寻址 |
| `MESSAGE_TOO_LARGE` | 单条超上限（默认 16KiB；`--max-body-kb` / `CROSSCHAT_MAX_BODY_KIB` 可提额，claude 端点封顶 64KiB、codex 1MiB，到顶只能落盘）——按提示走落盘路径（跨机 scp 见 ssh 手册） |
| `RATE_LIMITED` | 30 条/60s 限流——等待或收尾 |
| `TARGET_*` / `BODY_*` / `USAGE` | 参数错误——按提示改 |
| `CALLER_IDENTITY_CONFLICT` | 环境双身份残留——临时解法在报错里（`env -u` 前缀）；根治：干净终端重启 daemon |
| `CALLER_NOT_IN_CONVERSATION` | 不在对话内——照抄信封里的引用回复 |
| `CANNOT_REPLY_TO_HUMAN` | 人发起的对话，单向不可回 |
| `CODEX_PROXY_SPAWN_FAILED` | daemon 未跑——干净终端 `codex app-server daemon start` |
| `CODEX_THREAD_LOCKED` / `CODEX_THREAD_BUSY_TIMEOUT` | 已自动转 `parked` 入发件箱，无需重发 |
| `OUTBOX_FULL` | 发件箱满（每线程 200 条）——读 mailbox 镜像取回 |
| `CODEX_APPROVAL_REQUIRED` | 对方在等审批——工具永不代答，去对方窗口处理 |
| `CLAUDE_PIPE_*` / `CODEX_*UNCERTAIN` | 状态不明——**勿盲目重发**，先 `status` 核实 |

**发送审计**：每次发送的最终结果（delivered/queued/parked/failed、时间、对端、发送方显示名 fromName、回执）追加记录在状态目录的 `send-log.jsonl`（Windows `%LOCALAPPDATA%\crosschat\`；unix `~/crosschat/`）；codex 投递附 rollout 回执（消息已确认落入对方会话历史 = `receipt: confirmed`）。命令超时转后台后结果同样在案，事后可查。

边界与限制（16KiB / 限流 / 发件箱 / 信任边界 / daemon 依赖）→ [docs/usage.md](docs/usage.md)

## ❓ FAQ

**Q：codex 窗口开着收不到？** daemon ≥0.160 开窗也能收（headless，界面不实时刷新）；旧 daemon/`--no-daemon` 下等待或已入发件箱，关窗后自动送达。

**Q：为什么必须 `crosschat claude`？** 它注入跨会话接收许可；裸 `claude` 的会话收不到。

**Q：`codex queue` 能用吗？** 仅当 TUI 附着 daemon（0.160+）时会被消费；旧形态下是黑洞，故 crosschat 不依赖它。

**Q：人能发消息吗？** 能（`--to`），身份 human，单向不能被回复。

**Q：消息历史在哪看？** claude 侧=会话 transcript；codex 侧=开窗 resume 线程。

**Q：跨机怎么看不到对端的会话？** `status` 只列**本机**会话；跨机看对端用 `ssh <对端> crosschat status`。

**Q：会话经常重启，名字对不上？** claude 重启后自动编号会漂移；常重启的会话进去先 `/rename` 固定一个稳定名字——名字稳定，`--to` 自动接续就不会断。

**Q：`/rename` 改名后 status 里还是旧名/没有它？** 改名（claude 与 codex TUI 同理）要**再发送一条消息激活一轮**，crosschat 才看得到新名——codex 新建线程同理（零轮次不入列表）。操作顺序：`/rename 名字` → 随便发一条 → 再 `crosschat status`。

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
| [docs/usage.md](docs/usage.md) | **单机深度细则**：发起方式 / 往复规则 / 投递语义矩阵 / 边界与限制 |
| [docs/federation.md](docs/federation.md) | **跨机联邦手册**：按操作系统配置 / 单向 NAT / 使用细则 / 大内容 scp / 自环测试 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [docs/wayfinder/map.md](docs/wayfinder/map.md) | 设计决策地图（全部拍板过程与依据） |
| [docs/research/](docs/research/) | 实测研究报告（embassy 源码分析、两侧通道验证、0.160 inject_items 实验） |
| [docs/drill-reports/](docs/drill-reports/) | 联调实证记录 |

## 🤝 Agent 兼容性

| Agent | 发送 | 接收 | 实测版本 |
|---|---|---|---|
| Claude Code | ✅ | ✅（需 `crosschat claude` 启动） | 2.1.287 |
| Codex CLI | ✅ | ✅（需 daemon；0.160+ 开窗可收） | 0.159.3 / 0.160.0 |
| 任意有 shell 的 agent | ✅（装 skill 后） | 🔜 按适配器扩展（GLM 等） | 路线图 |

## 🗺️ 路线图

**计划中**
- [ ] 🐧 mac 平台适配（unix 代码路径已共享，待实机验证；CI mac 观察位已挂）
- [ ] 📦 常驻 broker（忙时持久队列、异步回执、投递状态机——embassy 完整集对齐；堡垒机形态）；tcp 直连传输（局域网 + 极简预共享鉴权）
- [ ] 🖼️ TUI 看板与服务安装（开机自启）
- [ ] 🤖 新 agent 适配器（GLM 等；有原生唤醒通道则原生，否则论证降级）

<details><summary>已完成（v1.0.0 – v1.3.3）</summary>

**v1.0.0**
- [x] Claude ↔ Codex / Claude ↔ Claude / Codex ↔ Codex 双向消息（真机联调验证）
- [x] 无状态 CLI 四命令 + 自包含会话引用 + 轮次计数
- [x] 双侧自动发现（含目录/时间标注）、信封自带教学 skill
- [x] 16KiB 上限、30 条/60s 防乒乓限流、身份冲突自纠指引
- [x] 忙/锁超时 → 本地发件箱 + 看门狗自动重投（outbox，FIFO 不插队，mailbox 镜像可读）
- [x] daemon 0.160 开窗投递（实证：同 daemon 多连接绕过写者锁）

**v1.3.0**
- [x] 🐧 Linux/WSL 平台支持（experimental）：PosixPipeTransport + claude unix 投递（免 auth 行，同 uid 内核凭证）+ CI ubuntu 矩阵；mac 外推未实测

**v1.3.2**
- [x] 👀 status 标注 TUI 占用线程（`thread-writer-locks` 锁文件信号源：行尾 `TUI占用` 标记、JSON `held` 字段、锁住未列入线程补行）
- 专用信箱线程机制化 → **评估后不做**：命名由双侧原生 `/rename` 与 id8 寻址承接，crosschat 不拥有会话生命周期（决策记录见 [map 007](docs/wayfinder/map.md)）；headless 建线程用 `codex exec`（见对话生命周期表）

**v1.3.3**
- [x] 🌐 跨机联邦 ssh v1：`--via ssh:<对端hostname>`、mc2_ 紧凑会话引用（296→83 字符）、信封自动回程路条、三层错误码同码透传、发起侧审计补记账；localhost 与 win↔WSL 真机验证（win 收件腿 codex 侧受 AF_UNIX 限制，见联邦手册）；tcp/broker 传输见路线图
</details>

## 🛠️ 开发说明

```bash
npm run check                                        # lint + build + test
CROSSCHAT_LIVE=1 npx vitest run --dir test           # 真机 live 测试（unix）
# PowerShell: $env:CROSSCHAT_LIVE='1'; npx vitest run --dir test
```

- 目录：`src/claude`（注册表/管道/鉴权）· `src/codex`（proxy/RPC/投递）· `src/commands`（CLI）· `src/platform`（平台接缝）· `src/outbox.ts`（发件箱）· `skills/`（agent 教学）
- 铭谢：[embassy](https://github.com/YuanpingSong/embassy)（MIT）的信封格式与 codex 传输模式
- License：[MIT](LICENSE)

---

<div align="center">Made with 🤝 between agents — crosschat 让它们自己对话</div>
