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
npm i -g @oatelauser/crosschat --registry=https://registry.npmjs.org    # 一行安装（提供 crosschat / multichat 双命令；显式官方源，防镜像滞后装旧版）
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

- **两侧独立**：状态目录全平台统一 `~/.crosschat`（Windows 侧同名点目录），两侧互不相通，管道/socket 不过系统边界
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
                          回复请运行: crosschat send --conversation c3 --body "<你的回复>"
🤖 worker[worker -> boss] 你好
🤖 boss 收到              📨 你好（turn 2）
```

worker 零配置、没学过任何协议——信封说怎么回就怎么回。

### 跨机：和单机一样，只是对端在另一台机器上

准备（一次性）：对端（本例 WSL）装好 crosschat、双机互配 ssh 密钥（→ [📡 通信方式](#-通信方式) 表的联邦手册，五步配完）。然后整个过程：

```
👤 用户[boss -> beta2]    用 crosschat 走 ssh 跨机给 yangwsl 机器的会话「beta2」问好，要求对方回复。
🤖 beta2 收到             📨 来自另一会话的消息:
                          <cross-session-message from-name="codex/boss@win" turn="1">
                          你好 beta2，这是跨机问候
                          回复请运行: crosschat send --conversation c3 --body "<你的回复>"
🤖 beta2[beta2 -> boss]   收到！跨机闭环成立
🤖 boss 收到              📨 收到！跨机闭环成立（turn 2，自动经 ssh 回到 win）
```

与单机的全部差别：题词里多了「走 ssh 跨机」四个字——命令由 agent 自己组装，消息与回复自动走 ssh 往返，双方谁都没敲过一次完整命令。

### 跨机 tcp：常驻转发器（broker 星型）

准备（一次性，管理员动作）：选一台机器 `crosschat serve --detach` 启动星（broker），`--gen-key` 发钥匙、其余机器贴好 node.json 后 `crosschat serve --connect <星> --detach` 常驻在线（1.6.0 起兼任聚合器），会话用 `crosschat claude -n <名> --connect <星>` 入星（→ [跨机通信：tcp](docs/broker.md)：环境搭建 / 日常使用 / 底层实现 / 协议参考）。然后整个过程：

```
👤 用户[boss -> worker2]  用 crosschat 走 tcp 跨机给 host-b 机器的 claude 会话「worker2」发任务，要求它跑一次构建并回报结果。
🤖 worker2 收到            📨 来自另一会话的消息:
                          <cross-session-message from-name="boss" turn="1">
                          …跑一次构建并回报结果…
                          回复请运行: crosschat send --conversation c3 --body "<你的回复>"
🤖 worker2[worker2 -> boss] 构建完成，产物清单见下一条
🤖 boss 收到               📨 构建完成，产物清单见下一条（turn 2，自动经 broker 跨机回来）
```

与 ssh 跨机同构：题词里多了「走 tcp 跨机」四个字；agent 组装三段寻址（`tcp:<星>:<机器>:<会话>`），回信命令由引用自动路由（不带 `--via`），worker2 零配置照抄即回；另支持 `--file` 文件通道与 CI 零进程直发（见跨机通信手册）。

## ⭐ 会话入星与三段寻址（tcp 星成员 · proto:3）

> 前提：机器已按[跨机通信：tcp](docs/broker.md)第一章入网（星在跑、本机有 `~/.crosschat/tcp/node.json`）。本章是**操作速览**；验证阶梯与协议机制见手册第二/四章。

投递粒度是**会话**：会话经启动器声明入星后，星内任何人按 `<星>:<机器>:<会话>` 直达该会话；没入星的会话名在三段寻址下报错指路。**两段式会话寻址（`--via tcp:<机器> --to <会话名>`）已废弃**（wayfinder [019](docs/wayfinder/tickets/019-ambient-session-delivery-retirement.md)）——机器级操作（远程枚举、文件通道）不受影响。

### 入星启动（全部形态，复制即用）

```bash
# 新 claude 会话入星（-n 给会话名；聚合器不在会自动拉起，退出会话自动退星）
crosschat claude -n <名> --connect <星>

# codex 形态（无 -n：进去 /rename <名>，聚合器扫描自动跟随）
crosschat codex --connect <星>

# 多星并存（--connect 可重复）
crosschat claude -n <名> --connect <星> --connect <另一星>

# 新会话接任退休旧会话的名字血统（换轨）
crosschat claude -n <新名> --connect <星> --extend-session <旧名>
```

启动器存活期间守连接（聚合器重启会自动重声明，含 extends）；会话退出即退星。`--extend-session` 四级校验失败方向不锁死：旧名仍是活成员 → 拒绝并指路（退旧会话或去旗标）；本机有旧名对话史 → 放行并提示；都无 → 静默放行；broker 侧同旧名先声明先得（后者收 `EXTENDS_CONFLICT` 指路，不影响入星）。

### 三段寻址（直达星成员）

```
crosschat send --via tcp:<星>:<机器>:<会话> --body "构建跑了吗"
                      │     │      │      └ 会话名（星成员名，禁冒号）
                      │     │      └──────── 机器名或 mid8
                      │     └─────────────── 星名
                      └───────────────────── tcp 通道
```

- 三段形态**免 `--to`**（会话段就是收件人）；回信照旧走信封 reply-hint，零配置
- 非成员名 → `SESSION_NOT_MEMBER`（教学入星）；死名有接任者 → `SESSION_SUPERSEDED`（报错给出接任者的三段地址，改投即可）；旧名还活着 → alive-wins，照投旧会话本尊

### adopt 收编（会话活着但不在星里）

三种来路：双端重启失忆（broker+聚合器都重启过）、会话是裸起的（没经启动器）、改名后想补旧名接任。**信号**：三段投递报 `SESSION_NOT_MEMBER`，或 `crosschat status --stars` 出诊断行——诊断行**当场打印完整命令**，照抄：

```bash
crosschat status --stars
#   cloud ✓ 可达，2 机器在线
#   守护: cloud: online
#   会话: host-a:boss、host-a:worker2 (extends←boss)
#   建议: crosschat serve --connect cloud --adopt limbo（会话活着但非成员——收编活进程入星）

crosschat serve --connect <星> --adopt <会话名>                       # 收编活进程（按其会话 ID，不新建）
crosschat serve --connect <星> --adopt <名> --extend-session <旧名>   # 已是成员时=补接任声明
```

名字不存在=报错列候选；claude/codex 同名=`NAME_COLLISION` 消歧；已是成员=幂等提示（exit 0）。

### 重启自愈与降级告警

- **恢复链**：聚合器重启 → 向 broker 查回本机最后已知名单 → 本地验活 → 活的自动重新入册（孤儿找回，死名不复活）；broker 也重启过 → 恢复链空 → 走上方 adopt。启动器还活着时最简单——旗标在手原样重声明
- **降级告警**：broker 机 crosschat 是老版本时，启动器/聚合器在命令行打一行 `broker 不支持会话成员（proto:3），已降级机器级——…`。含义：机器级收发不受影响，入星类功能不生效；升级 broker 机并重启 serve 即恢复

> 全链验证阶梯（三段直达 → 错误教学 → extends 接任 → adopt 收编 → 重启自愈，每步带期望输出）：[跨机通信：tcp · 2.7](docs/broker.md)



| 方式 | 一句话 | 状态 | 深入 |
|---|---|---|---|
| **单机会话** | 同机 agent 互发，`--to <名字>` 即起对话，忙时自动入队/发件箱 | ✅ v1.0 | [使用手册](docs/usage.md)：发起方式 / 投递语义 / 底层命令 / 边界 |
| **跨机联邦 · ssh** | 加 `--via ssh:<对端hostname>`，消息经 ssh 落到对端机器，回复自动回来 | ✅ v1.3.3 | [联邦手册](docs/federation.md)：环境搭建（按 OS）/ 跨机聊天 / 底层实现 / CLI 契约 |
| **跨机联邦 · tcp** | `crosschat serve --detach` 启动星（broker），机器 `serve --connect <星> --detach` 连星（1.6.0 起兼任聚合器），会话入星后三段寻址 `--via tcp:<星>:<机器>:<会话>` 直达；`--file` 文件通道 | ✅ v1.6.0 | [跨机通信：tcp](docs/broker.md)：环境搭建 / 日常使用 / 底层实现 / 协议参考 / 排障 |
| **会话级星成员 · proto:3** | 启动器入星（`crosschat claude/codex --connect <星>`）+ 三段寻址（`--via tcp:<星>:<机器>:<会话>`）+ extends 换轨接任 + adopt 收编 | ✅ 018 | 本页[会话入星章](#-会话入星与三段寻址tcp-星成员--proto3)；验证阶梯与全量细则 [跨机通信：tcp](docs/broker.md) |
| 跨机联邦 · broker 增强 | 忙时持久队列、异步回执、投递状态机（tcp 形态之上的 store-and-forward） | 🚧 规划中 | — |

ssh 配置方向一句话：**每台机写自己的 `~/.ssh/config`，内容是"怎么连对端"**（别名推荐=对端 hostname）——完整五步与命令样例见上表手册。

## 📋 命令列表

完整参数、启动器与环境变量说明见 [命令手册](docs/commands.md)。

```
crosschat send --to <名字> --body "<正文>"          # 新消息（名字含空格加引号；未命名 codex 线程可用 id8 或完整 id 寻址，status 可见）
crosschat send --conversation <ref|c柄> --body "<正文>" # 回复（照抄信封里的命令或 delivered 行尾的 cN）
crosschat send --via ssh:<对端hostname> --to <名/id8> --body "…"  # 跨机发送（见 📡 通信方式）
crosschat send --via tcp:<星>:<机器>:<会话> --body "…"   # tcp 三段直达星成员（免 --to；见跨机通信手册）
crosschat send --via tcp:<机器名/mid8> --to <名> --file <路径>  # tcp 文件通道（机器级；正文自动生成"已送达"）
echo … | crosschat send --to <名字>                 # 正文走 stdin
crosschat status [--json] [--conversations] [--stars] [--claude|--codex] [--name <子串>] [--all]   # 裸跑三段式摘要；旗标在场=明细视图（--via tcp|ssh 配 --conversations 按传输滤）
crosschat doctor                                    # 一键环境体检（有 ❌ 时退出码 1）
crosschat serve [--name/--port/--gen-key/--list/--remove/--connect/--detach/--stop]  # tcp 星：broker(--name 星名)/机器连星·聚合器(--connect)/钥匙管理（见跨机通信手册）
crosschat clean [--force]                           # 清 tcp 收件/断点残留（默认懒删除规则；--force 全清）
crosschat uninstall [--yes]                         # 卸载数据面（serve 在跑拒删；结尾 npm uninstall 收尾）
crosschat install-skills [--dir <根>]               # 安装/更新 agent skill（幂等）
crosschat claude [任意 claude 参数…]                 # 带接收许可启动 claude（透传；--max-body-kb/--max-turn N 可预置本会话发送上限/轮次预算，并剥离 codex 侧身份变量）
crosschat codex [任意 codex 参数…]                  # crosschat 增强启动 codex（透传；同上旋钮预置，并剥离 claude 侧身份变量）
crosschat -v | --version | help                     # 版本 / 帮助
```

`status` 裸跑为三段式摘要（任何过滤旗标/json 在场则回到明细视图）：

```
本机会话: claude 2 · codex 3 · 滞留 1（看门狗运行中）
  claude worker      3 分钟前
  codex 调试线程     2 小时前
（全量: --claude|--codex|--name）
tcp: 共 1 星
  cloud ✓ 可达，3 机器在线 · 客户端 online
    hub(a1b2c3d4)、host-b(9f8e7d6c)
（星内明细: --stars）
ssh: 共 2 段对话
  worker2@host-b(9f8e7d6c) turn 5  3 分钟前
（明细: --conversations --via ssh）
```

发送输出三种状态：`delivered`（已投递）/ `queued`（已交对端 codex 队列待消费，轮末处理——**对方回信到来即证明已处理**，勿发消息追问）/ `parked`（对方忙，已入发件箱，看门狗自动重投；输出含队列深度与 mailbox 镜像路径）/ 错误码（见排障）。人眼输出行尾附 `· 续话 cN`——本地会话短柄，`crosschat send --conversation cN` 即接续。`status --conversations` 的末条状态是**本机发送账本视角**（对端回信不产生本机账目），`queued` 为终态。

`status --conversations` 另看对话总览：每对端点的最近方向、相对时间、轮次、末条状态、滞留数与行尾续话柄（与 `--json` 组合输出同结构数组）。

## 🧯 错误码排障

报错输出自带完整自纠指引，这张表只当速查索引：

| 错误码 | 含义与动作 |
|---|---|
| `NAME_NOT_FOUND` / `NAME_COLLISION` | 名字不对/重名——错误信息已列可用名；重名改用 id8 寻址 |
| `MESSAGE_TOO_LARGE` | 单条超上限（默认 16KiB；`--max-body-kb` / `CROSSCHAT_MAX_BODY_KIB` 可提额，claude 端点封顶 64KiB、codex 1MiB，到顶只能落盘）——按提示走落盘路径（跨机 scp 见联邦手册） |
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

**发送审计**：每次发送的最终结果（delivered/queued/parked/failed、时间、对端、发送方显示名 fromName、回执）追加记录在 `~/.crosschat/send-log.jsonl`（全平台同路径；超 5MB 轮转成 `.old`）；codex 投递附 rollout 回执（消息已确认落入对方会话历史 = `receipt: confirmed`）。命令超时转后台后结果同样在案，事后可查。

边界与限制（16KiB / 限流 / 发件箱 / 信任边界 / daemon 依赖）→ [使用手册](docs/usage.md)

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
| 三段寻址报 `SESSION_NOT_MEMBER` | 会话没入星（裸起的）或双端重启失忆 | `crosschat status --stars` 看诊断行 → 照抄 `serve --connect <星> --adopt <名>`；或经启动器重起会话 |

## 📚 更多文档

| 文档 | 内容 |
|---|---|
| [架构手册](docs/architecture.md) | **底层原理**：注册表/命名管道/daemon 通道、写者锁本质、信封与自包含引用、完整投递流程图 |
| [使用手册](docs/usage.md) | **单机深度细则**：发起方式 / 往复规则 / 投递语义矩阵 / 边界与限制 |
| [命令手册](docs/commands.md) | **全量命令**：完整参数 / 启动器 / 环境变量 |
| [联邦手册](docs/federation.md) | **跨机 ssh 联邦**：四章——环境搭建（按 OS）/ 跨机聊天 / 底层实现 / CLI 契约 |
| [跨机通信：tcp](docs/broker.md) | **tcp 星与三段寻址**：环境搭建（当选规则/密钥/升级） / 日常使用（三段寻址/extends/adopt/自愈/验证阶梯） / 底层实现 / 协议参考 / 排障 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [设计决策地图](docs/wayfinder/map.md) | 全部拍板过程与依据 |
| [实测研究报告](docs/research/) | embassy 源码分析、两侧通道验证、0.160 inject_items 实验 |
| [联调实证记录](docs/drill-reports/) | 历次联调与验收实测报告（联邦连通性 / 现场反馈 / 手册冷走） |

## 🤝 Agent 兼容性

| Agent | 发送 | 接收 | 实测版本 |
|---|---|---|---|
| Claude Code | ✅ | ✅（需 `crosschat claude` 启动） | 2.1.287 |
| Codex CLI | ✅ | ✅（需 daemon；0.160+ 开窗可收） | 0.159.3 / 0.160.0 |
| 任意有 shell 的 agent | ✅（装 skill 后） | 🔜 按适配器扩展（GLM 等） | 路线图 |

## 🗺️ 路线图

**计划中**
- [ ] 📡 两段式会话投递退役（[019](docs/wayfinder/tickets/019-ambient-session-delivery-retirement.md)：`--via tcp:<机器> --to <会话名>` 改报错教学，机器级操作保留——文档已先行 proto:3-only 口径）
- [ ] 🐧 mac 平台适配（unix 代码路径已共享，待实机验证；CI mac 观察位已挂）
- [ ] 📦 常驻 broker 增强（忙时持久队列、异步回执、投递状态机——embassy 完整集对齐；tcp 星型直连传输已落地，见跨机通信手册）
- [ ] 🖼️ TUI 看板与服务安装（开机自启）
- [ ] 🤖 新 agent 适配器（GLM、opencode、zcode、deepseek-harness；有原生唤醒通道则原生，否则论证降级）

<details><summary>已完成（v1.0.0 – v1.4.0 + 018）</summary>

**018（proto:3 会话级星成员）**
- [x] ⭐ 会话入星（启动器 `--connect <星>` 可重复多星、聚合器自动拉起、退出即退星）+ 三段寻址 `--via tcp:<星>:<机器>:<会话>`（免 --to、非成员名收紧报错指路）+ `--extend-session` 显式换轨接任（四级校验、alive-wins、先声明先得）+ `serve --adopt` 收编活进程（status --stars 诊断行当场打印命令）+ 重启自愈链（broker lastKnownMembers + members-query 查回验活、双失忆走 adopt）+ /rename 自动跟随 + caps 协商降级显性告警；机器级寻址/roster/状态文件零改动（两段式会话投递后经 019 退役），见[会话入星章](#-会话入星与三段寻址tcp-星成员--proto3)与[跨机通信：tcp](docs/broker.md)


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
- 专用信箱线程机制化 → **评估后不做**：命名由双侧原生 `/rename` 与 id8 寻址承接，crosschat 不拥有会话生命周期（决策记录见 [决策地图 007](docs/wayfinder/map.md)）；headless 建线程用 `codex exec`（见对话生命周期表）

**v1.3.3**
- [x] 🌐 跨机联邦 ssh v1：`--via ssh:<对端hostname>`、mc2_ 紧凑会话引用（296→83 字符）、信封自动回程路条、三层错误码同码透传、发起侧审计补记账；localhost 与 win↔WSL 真机验证（win 收件腿 codex 侧受 AF_UNIX 限制，见联邦手册）；tcp/broker 传输见路线图

**v1.4.0**
- [x] 📡 跨机联邦 tcp（proto:1）：`crosschat serve` 星型转发器（预共享钥匙/心跳/自登记）+ `--via tcp:<机器/mid8>` 瞬态直发（双轨寻址：mid8 权威、名字显示用，改名免疫）+ tcp 回信闭环（reply-hint 自动带 `--via tcp:`）+ `--file` 文件通道（sha256 锚/断点续传/去重/5 天+512MiB 懒删除/64MiB 上限）+ roster 在线表 + `clean`/`uninstall`；机器改名=改本机 node.json `showName` + 重启常驻（节点机重启节点客户端 / broker 机重启 serve——全机种唯一名字来源）；win 真机自环验证，见[跨机通信：tcp](docs/broker.md)
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
