# 跨机联邦手册（ssh v1）

> 本文是 [README · 通信方式](../README.md#-通信方式) 表中"跨机联邦 · ssh"的完整手册：搭建五步、使用细则、大内容 scp、自环测试。


一句话：跨机 = **[单机全部用法](../README.md#-快速入门)** + 一个 `--via` 参数——[快速入门](../README.md#-快速入门)里的一切照旧，只是消息发到另一台机器。对端装好 crosschat、配好密钥，就开始。

```bash
crosschat send --via ssh:build01 --to worker2 --body "跑一次构建，产物清单发回来"
# → delivered to worker2@build01 (turn 1)
```

### 部署：对端 ssh 信息怎么配（win ↔ linux，以 WSL 为例）

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
| Linux | sshd 开箱即有。**PATH 注记（Node 装在 nvm/自定义前缀，如 /opt/node）**：npm 全局 bin 不在 sshd 非交互 shell 的默认 PATH——本地能跑、收件腿却报 `REMOTE_FAILED [via <host>] 远端异常退出(127): command not found`；修复一行（发行版包管理器装的 Node 无此坑）：`sudo ln -s "$(npm prefix -g)/bin/crosschat" /usr/local/bin/crosschat`。**WSL 注记**：镜像网络下 22 端口被 win 占用——sshd 换非标端口（`sed -i 's/^#*Port .*/Port 2222/' /etc/ssh/sshd_config`，`systemctl enable --now ssh`）+ host key 播种 `ssh-keyscan -p 2222 localhost >> ~/.ssh/known_hosts`（win 侧同款命令一次） |
| win | 管理员装 OpenSSH Server（`Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0` + `Start-Service sshd`）；npm 全局 bin 须在**系统** PATH（sshd 默认 shell 只见 Machine PATH）。**收件腿限制：codex 侧不可用（AF_UNIX 跨登录会话隔离，实测定论），claude 侧实测可用** |
| Mac | 系统设置开"远程登录" |

**第 5 步 · 自证（双向各跑一次）**：

```bash
ssh -o BatchMode=yes yangwsl crosschat --version    # win → WSL
ssh -o BatchMode=yes yang crosschat --version       # WSL → win；出版本号 = 通 + 版本一致
```

失败对照：`Host key verification failed` → 第 4 步的 keyscan 没做；`Permission denied (publickey)` → 第 3 步公钥没进对（win 管理员组走专用文件）；`Connection refused` → 对端 sshd 没跑/端口不对；`远端异常退出(127): command not found` → 第 4 步 Linux PATH 注记（npm 前缀软链一刀）。

可选提速：`~/.ssh/config` 加 `ControlMaster auto`（复用连接，摊薄每次握手 100-300ms）。版本偏斜：旧版对端收到新旗标报 `USAGE [via <host>] unknown option …`——对端升级即愈。

#### NAT 单向（你能连它、它连不回你）——反向隧道打通回程

ssh v1 以双向为前提；单向网络下由**能出站的一侧**把"回程门"背过去，crosschat 零改动（2026-10-08 win↔云端真机闭环实测，实录见 `../drill-reports/federation-nat-tunnel-20261008.md`）。以下记出站侧 = **A**（win，hostname `A`、用户 `a`、sshd 跑在 22），对端 = **B**（公网/云端 Linux）。前提：B 已按第 1 步装好 crosschat 并 `ssh-keygen`，A 也已有自己的密钥。

**N1 · A 的公钥推到 B**（出腿认证，输一次密码）：

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh -p <B端口> <B用户>@<B地址> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**N2 · A 的 ssh config 认得 B**（追加到 `%USERPROFILE%\.ssh\config`；别名首选 B 的系统 hostname——信封回程路条天然成立）：

```
Host <B的hostname> b
  HostName <B地址>
  Port <B端口>
  User <B用户>
```

```powershell
ssh-keyscan -p <B端口> <B地址> >> $env:USERPROFILE\.ssh\known_hosts
```

**N3 · A 常驻反向隧道**（Xshell 或命令行二选一，**隧道随会话活**）：

- Xshell：该会话右键属性 → 连接 → SSH → **隧道** → 添加 → 类型 **远程（传入）**、源 `localhost:2222`、目标 `localhost:22`；属性 → 连接 → **保持活动** 间隔 30 秒；**连接并保持会话开着**
- 命令行等价：`ssh -N -R 2222:localhost:22 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes b`

**N4 · B 侧回程别名 + 播种 host key**（⚠️ **`User` 行必写**——缺了 ssh 默认拿 B 的当前用户名去连 A，报 `<B用户>@localhost: Permission denied`）：

```bash
ssh-keyscan -p 2222 localhost >> ~/.ssh/known_hosts   # 扫到的其实是隧道对面 A 的 sshd
cat >> ~/.ssh/config << 'EOF'
Host <A的hostname>
  HostName localhost
  Port 2222
  User <A用户名>
EOF
```

**N5 · B 的公钥进 A**（回程认证）——A 是 win 管理员组用户时必须走专用文件（管理员 PowerShell）：

```powershell
$kf = "$env:ProgramData\ssh\administrators_authorized_keys"
Add-Content $kf -Value '<B的id_ed25519.pub整行>'
icacls $kf /inheritance:r /grant "SYSTEM:(F)" /grant "BUILTIN\Administrators:(F)"
```

A 为普通用户/非 win 时同主手册第 3 步（`~/.ssh/authorized_keys`）。

**N6 · 验证阶梯**（由浅入深三条，全出 `1.3.x` 版本号 = 通）：

```powershell
# 出腿（A→B，不依赖隧道）：
ssh -o BatchMode=yes b crosschat --version
# 全环（A→B→隧道→A，一条命令穿完整圈）：
ssh -o BatchMode=yes b "ssh -o BatchMode=yes <A的hostname> crosschat --version"
# 正式（真投递+回信闭环）：
crosschat send --via ssh:<B的hostname> --to <B上的会话名> --body "回信请照信封里的回复命令执行"
```

**N7 · NAT 形态失败对照**：

| 症状 | 根因 | 解法 |
|---|---|---|
| `<B用户>@localhost: Permission denied`（回程） | N4 漏了 `User` 行 | 补 `User <A用户名>` |
| `Connection refused`（连 `localhost:2222`） | 隧道没连上/断了 | 重连 N3 的 Xshell 会话 |
| `远端异常退出(127): command not found` | B 的 Node 在 nvm/自定义前缀 | 见第 4 步 Linux PATH 注记 |
| 回信突然全断、出腿正常 | Xshell 会话断了（隧道死） | 重连该会话即恢复 |

边界：隧道随会话活——会话断 = 回信断（发起腿不受影响）；持续保活已是"半 broker"运维形态，堡垒机形态（broker）仍是长期正解。

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

**大内容怎么办（>16KiB）**：消息照旧走 crosschat、块数据走 ssh 自己的文件通道——scp 与 `--via` **共用同一份 ssh config/别名/密钥**，配一次全通：

```bash
# 发去对端（引用的是对端本地路径）：
scp big-analysis.txt wsl:/tmp/big-analysis.txt
crosschat send --via ssh:wsl --to beta2 --body "分析 /tmp/big-analysis.txt，结论报回来"

# 对端回传大结果（题词形态）：
#   把结果写入 result.txt，用 scp result.txt yang:/tmp/ 发回，然后用 crosschat 告诉我路径
```

win ↔ WSL 这对还有更省的捷径——文件根本不用过网络：`cp result.txt /mnt/c/Users/<你>/AppData/Local/Temp/`（WSL 直写 win 盘）。大文件用完即删（`/tmp` 卫生，agent 侧纪律）。
