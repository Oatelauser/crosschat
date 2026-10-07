<div align="center">

<img src="docs/assets/logo.svg" width="128" alt="crosschat logo"/>

# crosschat

**让本机的 Claude Code 与 Codex CLI 互相对话** —— 无守护进程、原生投递、双向实测。

![CI](https://github.com/Oatelauser/crosschat/actions/workflows/ci.yml/badge.svg) ![npm](https://img.shields.io/npm/v/@oatelauser/crosschat) ![license](https://img.shields.io/badge/license-MIT-green) ![node](https://img.shields.io/badge/node-%3E%3D22-339933) ![platform](https://img.shields.io/badge/platform-Win%20%7C%20Linux%20%28experimental%29-blue) ![agents](https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-blueviolet)

</div>

---

## ✨ 为什么用 crosschat

- **🔌 原生投递，零轮询**：消息经 Claude 的 named pipe / unix socket / Codex 的 App Server daemon 直接注入运行中的会话——接收方像收到一条用户消息一样开始工作，不需要任何轮询或常驻服务
- **🪶 无守护进程**：整个工具就是一条无状态 CLI。没有后台进程要看护、没有崩溃丢状态、没有端口要占——`send` 就是发消息，`status` 就是看在线
- **🤖 教学内建，低入侵**：agent 侧装一次 skill，且**每条消息的信封自带回复命令**——照抄即可回话。题词只写角色，不写协议；长对话也不会忘
- **📮 忙时不丢**：对方正在跑长任务？消息自动进本地发件箱（outbox），并由看门狗进程每 0.5–5 分钟自动重投，对方一空闲就送达——不需要你手动重发；滞留内容随时可在 mailbox 镜像文件里读到
- **🔐 同用户信任边界**：全部通道按系统用户隔离（Windows 用户 / unix uid），接收许可只授予 `crosschat claude` 启动的会话——你手敲开的会话不会被外部投递
- **🧪 每个结论都有实证**：通道可行性、写者锁、daemon 版本行为，全部真机联调验证（见 [📚 更多文档](#-更多文档)）

> 灵感与部分模块实现来自 [embassy](https://github.com/YuanpingSong/embassy)（macOS-only，MIT）——crosschat 是它的 Windows 原生、无守护进程重实现（1.3.0 起亦支持 Linux/WSL，experimental）。

## 🧰 环境搭建

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Node.js | ≥ 22 | |
| Claude Code | 任意近期版 | 接收需 `crosschat claude` 启动（工具自动注入许可） |
| Codex CLI | ≥ 0.160 推荐 | 0.160 daemon 支持开窗投递；接收需 app-server daemon |
| OS | Windows（稳定）· Linux/WSL（experimental，1.3.0） | mac 未实测（unix 实现共享，理论可达） |

```bash
npm i -g @oatelauser/crosschat    # 一行安装（提供 crosschat / multichat 双命令）
crosschat install-skills          # 协议教学装到两侧 agent
```

<details><summary>从源码安装（开发者）</summary>

```bash
git clone https://github.com/Oatelauser/crosschat.git
cd crosschat && npm ci && npm run build && npm link
crosschat install-skills
```

开发期反复重装本地目录：`npm run build && npm i -g . --force`——**build 不可省**（包没有 prepare 脚本，npm 不会自动构建，`files` 只打包 dist/ 现状，漏 build 会把旧 dist 装回去）；`--force`（或先 bump 版本）是因为版本号未变时 npm 会报 "up to date" 而**跳过文件更新**。若首次用的是 `npm link`（符号链接直连仓库），则每次只需 `npm run build`，无需重装。
</details>

**Codex daemon**（接收方向必需；从**干净终端**启动——勿在 Claude 会话内启动，否则派生 shell 身份污染）：

```bash
codex app-server daemon start    # 重启电脑后需重新执行
```

**Linux / WSL（experimental，1.3.0）**——**独立部署**：unix 侧自成一套（状态目录 `~/crosschat`、发件箱、投递），与 Windows 侧互不相通，管道/socket 不过系统边界，**agent 必须与 crosschat 同侧运行**：

- 前置：Node ≥ 22、claude / codex CLI 装在**同一侧**（WSL 内用 unix 版）
- claude 安装（受限网络）：claude.ai/install.sh 可能被区域屏蔽（302），改用 npm 直装 `npm i -g @anthropic-ai/claude-code`；仍不可达时按架构直装平台包 tarball（如 `@anthropic-ai/claude-code-linux-x64`，镜像源可拉，解包即含原生 `claude` 二进制）
- 状态目录：unix `~/crosschat`（Windows 侧为 `%LOCALAPPDATA%\crosschat`，两侧各自独立）
- mac：unix 实现共享，理论可达、未实测

## 🚀 快速入门

### 30 秒版：两终端互发一句问候

```bash
# 终端 A（claude，能收）
crosschat claude          # 进入后 /rename alice

# 终端 B（任意终端，人手发）
crosschat status          # 看到 alice
crosschat send --to alice --body "你好 alice！"
# → 终端 A 里几秒后出现这条消息
```

### 完整剧本：codex 当领导派活给 claude（多任务循环的经典形态）

**任务目标**：codex（领导）命 claude（工人）统计当前目录的 `.md` 文件数并报回数字，领导自行复核后验收——**全程信息只经 crosschat 消息流动，不走文件**。

**第 1 步 · 左窗启动 claude（接收方先开机；先启动 ≠ 先说话）**
```
D:\workspace\demo> crosschat claude
```
进入后输入 `/rename worker`，再随便发一条消息（如"收到"）激活一轮——**改名要过一轮才进 `crosschat status`**。待命。

**第 2 步 · 右窗启动 codex（领导）并贴题词**
```
D:\workspace\demo> codex
```
```
你是领导。用 crosschat（先 status 确认名字）给 claude 会话「worker」下发任务：
统计当前目录下有多少个 .md 文件，把数字报回来。
收到报告后，你自己也数一遍复核；数字一致则回复"验收通过，任务结束"并停止；
不一致则把你的数字发回去要求返工。
```

**第 3 步 · 右窗屏幕——任务由 codex 发出**
```
● exec: crosschat status
● exec: crosschat send --to worker --body "任务1：统计当前目录的 .md 文件数，报回数字"
● delivered to worker (turn 1)          ← 任务飞进左窗，发起方是 codex
```

**第 4 步 ·（0.160+ 可跳过）关掉右窗**：旧版 daemon（≤0.157）下收报告需关窗；**0.160+ 开窗也能收**（headless 执行）。

**第 5 步 · 左窗屏幕——claude 收令干活**
```
📨 来自另一会话的消息:
<cross-session-message from-name="codex/01a…" turn="1">
任务1：统计当前目录的 .md 文件数，报回数字
回复请运行: crosschat send --conversation mc2_xxx --body "<你的回复>"
</cross-session-message>

⏺ Bash: ls *.md | wc -l → 7
⏺ Bash: crosschat send --conversation mc2_xxx --body "报告：当前目录共 7 个 .md 文件"
⏺ delivered (turn 2)                     ← 报告发回给 codex
```

**第 6 步 · 自动发生**：报告落进 codex 线程 → codex 自己数一遍（7 个，一致）→ 验收结论又出现在左窗。

**第 7 步 · 左窗收到"验收通过，任务结束"——收工**。任务的下达、汇报、复核、验收全部是 crosschat 消息；想看领导的复核细节：开右窗 `codex resume` 翻历史。

## 📋 命令列表

```
crosschat send --to <名字> --body "<正文>"          # 新消息（名字含空格加引号；未命名 codex 线程可用 id8 或完整 id 寻址，status 可见）
crosschat send --conversation <ref> --body "<正文>" # 回复（ref 照抄收到的信封）
crosschat send --via ssh:<对端hostname> --to <名/id8> --body "…"  # 跨机发送（联邦，见 🌐 节）
echo … | crosschat send --to <名字>                 # 正文走 stdin
crosschat status [--json] [--conversations]        # 双侧总览（名字/目录/时间/状态）
crosschat doctor                                    # 一键环境体检（有 ❌ 时退出码 1）
crosschat install-skills [--dir <根>]               # 安装/更新 agent skill（幂等）
crosschat claude [任意 claude 参数…]                 # 带接收许可启动 claude（透传）
crosschat -v | --version | help                     # 版本 / 帮助
```

发送输出三种状态：`delivered`（已投递）/ `parked`（对方忙，已入发件箱，看门狗自动重投；输出含队列深度与 mailbox 镜像路径）/ 错误码（见排障）。

`status --conversations` 另看对话总览：每对端点的最近方向、相对时间、轮次、末条状态与滞留数（与 `--json` 组合输出同结构数组）。

## 🌐 跨机联邦（ssh v1）

一句话：**跨机 = 单机的一切 + 一个 `--via ssh:<对端系统hostname>` 旗标**。消息经 ssh 到对端机器上执行同一条 crosschat——远端 CLI 全权（名字解析、投递、发件箱、它自己的 send-log），回执带 `@<host>` 后缀，**信封自动携带回程路条，接收方照抄即可回复**，无需知道网络结构。

```bash
crosschat send --via ssh:build01 --to worker2 --body "跑一次构建，产物清单发回来"
# → delivered to worker2@build01 (turn 1)
```

### 使用：题词与命令形态（按场景）

**场景 A · 让本机 agent 发起跨机对话**——给 agent 的题词（角色只写任务，协议靠 skill 与信封自带）：

> 使用 crosschat 发送消息给 beta2 问好，消息要求经过 ssh 管道送到（send 时加 --via ssh:<对端系统hostname>）。需要对方回复并停止。

agent 据此跑出的命令形态：

```bash
crosschat send --via ssh:build01 --to beta2 --body "你好 beta2…"
# → delivered to beta2@build01 (turn 1)
```

**场景 B · 对端接收**——**无需任何题词**。对端会话里自动出现信封：

```
📨 来自另一会话的消息:
<cross-session-message from-name="claude/boss@win-dev" turn="1">
你好 beta2…
回复请运行: crosschat send --via ssh:win-dev --conversation mc2_… --body "<你的回复>"
</cross-session-message>
```

**场景 C · 对端回复**——对 agent 说"照抄来信里的回复命令，替换占位符后执行"即可；命令形态（回程 `--via` 由信封自动携带）：

```bash
crosschat send --via ssh:win-dev --conversation mc2_… --body "收到，任务完成"
# → delivered to claude/boss@win-dev (turn 2)   ← 回到发起机
```

**场景 D · 同机自环测试**（不跨机也要走一遍 ssh 管道时）：

```bash
# win 上（sshd 已跑在 22）：
crosschat send --via ssh:localhost --to <本机会话名> --body "自环测试"
# WSL 上（先给 ~/.ssh/config 加自指别名，一次性）：
cat >> ~/.ssh/config << 'EOF'
Host self
  HostName localhost
  Port 2222
EOF
ssh-keyscan -p 2222 localhost >> ~/.ssh/known_hosts   # 播种 host key
crosschat send --via ssh:self --to <本机会话名> --body "自环测试"
```

要点：

- 名字在**目标机**上解析（本机同名会话不干扰）；跨机对端不在本机 `status` 里，看对端：`ssh <对端> crosschat status`
- 对端忙 → 远端 `queued` / `parked` 语义与单机一致（parked 的 mailbox 路径标注"位于 `<host>`"）；远端业务错误**同码透传**（前缀 `[via <host>]`，自纠指引照常有效）
- ssh 不通/超时报 `SSH_TRANSPORT_FAILED` / `SSH_TRANSPORT_TIMEOUT`——先 `ssh <对端> crosschat --version` 探活（顺带验版本），超时后**勿盲目重发**
- 会话引用（`mc2_`）自带双方机器名+机器指纹（machine-id，同名机器也不混），信封回复命令自动带 `--via` 回程；手敲漏了 CLI 也会按引用自动补全
- 单条上限 16KiB 对跨机同样生效（内容过长落盘发路径）

### 部署：对端 ssh 信息怎么配（win ↔ WSL 完整实例）

前提：**双向可达**（同一 LAN/VPN；对端在 NAT 后、只能单向发起的环境等 broker 堡垒机形态）。以下以 win（hostname `yang`）↔ WSL（hostname `yangwsl`）为例，逐台照抄。

**第 1 步 · 每台机装 crosschat + 生成密钥**：

```bash
npm i -g @oatelauser/crosschat && crosschat install-skills
ssh-keygen -t ed25519          # 无口令（机器通道）；已有密钥则跳过
```

**第 2 步 · 写两端的 ~/.ssh/config（核心）**——每台机写"怎么连对端"：

```bash
# win 侧（%USERPROFILE%\.ssh\config）——认得 WSL：
Host yangwsl wsl               # 一行多名：真实 hostname + 顺手短名，都指向同一配置
  HostName 127.0.0.1
  Port 2222                    # WSL sshd 用非 22 端口（镜像网络下 22 被 win 占）
  User root

# WSL 侧（~/.ssh/config）——认得 win：
Host yang
  HostName localhost
  Port 22
  User yangsheng               # WSL 默认 root，反向连 win 必须显式写 win 用户名
```

规则：**别名推荐直接用"对端系统 hostname"**（信封回程路条自动取它，`--via ssh:yang` / `--via ssh:yangwsl` 天然成立）；别名≠hostname 也能用，但两个名字都要能解析（一行多名 `Host yang wsl` 即可）。hostname 用 `hostname` 命令查（两端各查一次、互抄）。

**第 3 步 · 互推公钥**：

```bash
# 常规（Linux/Mac 对端）：推公钥，输一次现有密码（密码登录共存不受影响）
ssh-copy-id yangwsl            # 或手动追加到对端 ~/.ssh/authorized_keys

# win 对端 + 你是管理员组用户：公钥必须进专用文件并修 ACL（管理员 PowerShell）
$kf = "$env:ProgramData\ssh\administrators_authorized_keys"
Add-Content $kf -Value (Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" -Raw)
icacls $kf /inheritance:r /grant "SYSTEM:(F)" /grant "BUILTIN\Administrators:(F)"

# WSL 对端：不走 ssh 推（鸡生蛋），从 win 直写其文件系统
wsl -u root sh -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys' < $env:USERPROFILE\.ssh\id_ed25519.pub
```

**第 4 步 · 收件侧 sshd 与端口**：

| 收件腿 | 一次性准备 |
|---|---|
| Linux | sshd 开箱即有 |
| win | 管理员装 OpenSSH Server（`Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0` + `Start-Service sshd`）；npm 全局 bin 须在**系统** PATH（sshd 默认 shell 只见 Machine PATH）。**收件腿限制：codex 侧不可用（AF_UNIX 跨登录会话隔离，实测定论），claude 侧实测可用** |
| WSL（镜像网络） | sshd 换非标端口：`sed -i 's/^#*Port .*/Port 2222/' /etc/ssh/sshd_config`，`systemctl enable --now ssh`；host key 播种 `ssh-keyscan -p 2222 localhost >> ~/.ssh/known_hosts`（win 侧同款命令一次） |
| Mac | 系统设置开"远程登录" |

**第 5 步 · 自证（双向各跑一次）**：

```bash
ssh -o BatchMode=yes yangwsl crosschat --version    # win → WSL
ssh -o BatchMode=yes yang crosschat --version       # WSL → win；出版本号 = 通 + 版本一致
```

失败对照：`Host key verification failed` → 第 4 步的 keyscan 没做；`Permission denied (publickey)` → 第 3 步公钥没进对（win 管理员组走专用文件）；`Connection refused` → 对端 sshd 没跑/端口不对。

可选提速：`~/.ssh/config` 加 `ControlMaster auto`（复用连接，摊薄每次握手 100-300ms）。版本偏斜：旧版对端收到新旗标报 `USAGE [via <host>] unknown option …`——对端升级即愈。

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

**已完成（v1.3.0）**
- [x] 🐧 Linux/WSL 平台支持（experimental）：PosixPipeTransport + claude unix 投递（免 auth 行，同 uid 内核凭证）+ CI ubuntu 矩阵；mac 外推未实测

**已完成（v1.3.2）**
- [x] 👀 status 标注 TUI 占用线程（`thread-writer-locks` 锁文件信号源：行尾 `TUI占用` 标记、JSON `held` 字段、锁住未列入线程补行）
- 专用信箱线程机制化 → **评估后不做**：命名由双侧原生 `/rename` 与 id8 寻址承接，crosschat 不拥有会话生命周期（决策记录见 [map 007](docs/wayfinder/map.md)）；headless 建线程用 `codex exec`（见对话生命周期表）

**已完成（v1.3.3）**
- [x] 🌐 跨机联邦 ssh v1：`--via ssh:<对端hostname>`、mc2_ 紧凑会话引用（296→83 字符）、信封自动回程路条、三层错误码同码透传、发起侧审计补记账；localhost 与 win↔WSL 真机验证（win 收件腿 codex 侧受 AF_UNIX 限制，见联邦节）；tcp/broker 传输见路线图

**计划中**
- [ ] 🐧 mac 平台适配（unix 代码路径已共享，待实机验证；CI mac 观察位已挂）
- [ ] 📦 常驻 broker（忙时持久队列、异步回执、投递状态机——embassy 完整集对齐；堡垒机形态）；tcp 直连传输（局域网 + 极简预共享鉴权）
- [ ] 🖼️ TUI 看板与服务安装（开机自启）
- [ ] 🤖 新 agent 适配器（GLM 等；有原生唤醒通道则原生，否则论证降级）

## 🧯 错误码排障

**使用类**：`NAME_NOT_FOUND`（错误信息列出全部可用名）· `NAME_COLLISION`（重名，`status --json` 看 id）· `MESSAGE_TOO_LARGE`（>16KiB → 落盘发路径）· `RATE_LIMITED`（等待或收尾）· `TARGET_*`/`BODY_*`/`USAGE`（参数错误）

**身份类**：`CALLER_IDENTITY_CONFLICT`（环境双身份残留。临时：命令前缀 `env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID`；根治：干净终端重启 daemon）· `CALLER_NOT_IN_CONVERSATION` · `CANNOT_REPLY_TO_HUMAN`（对话由人发起）

**通道类**：`CODEX_PROXY_SPAWN_FAILED`（看 stderr 摘录；通常 daemon 未跑）· `CODEX_THREAD_LOCKED`/`CODEX_THREAD_BUSY_TIMEOUT`（已自动转 `parked` 入发件箱，无需重发）· `OUTBOX_FULL`（每线程 200 条积压上限，读 mailbox 镜像取回内容）· `CODEX_APPROVAL_REQUIRED`（**工具永不代答审批**）· `CLAUDE_PIPE_*`/`CODEX_*UNCERTAIN`（写入中途失败状态不明——**勿盲目重发**，先 `status` 核实）

**发送审计**：每次发送的最终结果（delivered/queued/parked/failed、时间、对端、发送方显示名 fromName、回执）追加记录在状态目录的 `send-log.jsonl`（Windows `%LOCALAPPDATA%\crosschat\`；unix `~/crosschat/`）；codex 投递附 rollout 回执（消息已确认落入对方会话历史 = `receipt: confirmed`）。命令超时转后台后结果同样在案，事后可查。

## ⚠️ 边界与限制

单条 ≤16KiB；每对端点 30 条/60s；发件箱每线程 200 条（满时读状态目录 `mailbox\<线程ID>.md` 镜像取回内容：Windows `%LOCALAPPDATA%\crosschat\mailbox\`、unix `~/crosschat/mailbox/`）；信任边界=同一系统用户（Windows 用户 / unix uid）；接收许可仅 `crosschat claude` 启动的会话。

**daemon 依赖（重要）**：向 codex 会话投递走 `codex app-server proxy`，它连接**运行中的 app-server daemon** control socket。要获得完整能力（TUI 开窗可投、忙时入队），需要 `codex app-server daemon start` 且 daemon ≥0.160，TUI 用同版本 CLI 打开（0.160 起 TUI 自动附着 daemon）。daemon 未运行时投递会报 `CODEX_PROXY_SPAWN_FAILED` 并提示启动命令；旧版本 daemon 下开窗投递与忙时入队退化为「关窗投递 + 发件箱」。重启电脑后需重新 `codex app-server daemon start`。

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
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |
| [docs/wayfinder/map.md](docs/wayfinder/map.md) | 设计决策地图（全部拍板过程与依据） |
| [docs/research/](docs/research/) | 实测研究报告（embassy 源码分析、两侧通道验证、0.160 inject_items 实验） |
| [docs/drill-reports/](docs/drill-reports/) | 联调实证记录 |

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
