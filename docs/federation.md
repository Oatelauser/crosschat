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

#### NAT 单向（按操作系统分步实录）——你能连它、它连不回你

适用：本机（win 或 macOS）在 NAT 后，能出站 ssh 到云端 Linux；云端连不回本机。回程由本机常驻的**反向隧道**背过去，crosschat 零改动。双向可达的环境直接用上方五步，不必进本节。（2026-10-08 win↔云端真机闭环实测：`../drill-reports/federation-nat-tunnel-20261008.md`）

**先填替换表**（全文用示例值书写；"在哪查"告诉你去哪节取真值）：

| 值 | 示例 | 你的值 | 在哪查 |
|---|---|---|---|
| 云端地址 | `203.0.113.10` | ＿＿ | 服务商控制台的公网 IP |
| 云端 ssh 端口 | `22` | ＿＿ | Linux 节 L1 |
| 云端用户 | `deploy` | ＿＿ | 你登录云端用的用户名 |
| 云端 hostname | `host-b` | ＿＿ | Linux 节 L1 |
| 本机用户（win） | `yangsheng` | ＿＿ | 你登录 Windows 的账户 |
| 本机 hostname（win） | `yang` | ＿＿ | Windows 节 W1 |
| 本机用户/hostname（mac） | `me` / `mac` | ＿＿ | macOS 节 M1 |

---

##### Windows 节（本机是 win 时，从上往下做）

**W1 · 查本机 hostname**（此值 Linux 节 L5 要用）：
```powershell
hostname
```
```
yang
```

**W2 · 确认本机 sshd 在跑（回程终点，必须 Running）**：
```powershell
Get-Service sshd
```
```
Status   Name
Running  sshd
```
`Stopped` → 管理员 PowerShell 跑 `Start-Service sshd`；提示服务不存在 → 管理员 PowerShell 跑 `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0` 再 `Start-Service sshd`。

**W3 · 本机密钥（有则跳过）**：
```powershell
Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub
```
```
True
```
`False` → `ssh-keygen -t ed25519` 一路回车（无口令）。

**W4 · 打印本机公钥**（复制输出整行，Linux 节 L4 要粘贴它）：
```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA...本机标识 yang
```

**W5 · 认得云端（写 ssh config）**：
```powershell
notepad $env:USERPROFILE\.ssh\config
```
文件末尾追加（四个值来自替换表）后保存：
```
Host host-b b
  HostName 203.0.113.10
  Port 22
  User deploy
```

**W6 · 播种云端 host key**：
```powershell
ssh-keyscan -p 22 203.0.113.10 >> $env:USERPROFILE\.ssh\known_hosts
```
```
203.0.113.10 ssh-ed25519 AAAA...
203.0.113.10 ecdsa-sha2-nistp256 AAAA...
```

**W7 · 探活（输密码，能进云端 shell = 网络与账号都通；进去就 exit）**：
```powershell
ssh host-b
```

**W8 · Xshell 开反向隧道（隧道随这个会话活，别关）**：
Xshell 选中该会话 → 右键属性 → 连接 → SSH → **隧道** → 添加：
类型 **远程（传入）**｜源 主机 `localhost` 端口 `2222`｜目标 主机 `localhost` 端口 `22`
属性 → 连接 → **保持活动** 间隔 30 秒 → **连接此会话**。
验证（贴到云端的 Xshell 标签页里跑）：
```bash
ss -tln | grep 2222
```
```
LISTEN 0  128  127.0.0.1:2222  0.0.0.0:*
```

**W9 · 收云端公钥（用 Linux 节 L4 打印的云端公钥整行）**——右键开始菜单 → **终端(管理员)**：
```powershell
$kf = "$env:ProgramData\ssh\administrators_authorized_keys"
Add-Content $kf -Value 'ssh-ed25519 AAAA...host-b 的公钥整行'
icacls $kf /inheritance:r /grant "SYSTEM:(F)" /grant "BUILTIN\Administrators:(F)"
```
（无输出 = 成功。管理员组用户必须走这个专用文件，普通 `authorized_keys` 无效。）

**W10 · 出腿自证（需 Linux 节 L1–L4 已完成）**：
```powershell
ssh -o BatchMode=yes host-b crosschat --version
```
```
1.3.3
```

**W11 · 全环自证（需 Linux 节全部完成；一条命令穿完 win→云端→隧道→win 整圈）**：
```powershell
ssh -o BatchMode=yes host-b "ssh -o BatchMode=yes yang crosschat --version"
```
```
1.3.3
```

---

##### Linux 节（云端服务器；Xshell 或任意终端里从上往下做）

**L1 · 查本机 hostname 与 ssh 端口**（两个值填进替换表，win/mac 侧要用）：
```bash
hostname; ss -tlnp | grep sshd
```
```
host-b
LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",...))
```

**L2 · 装 crosschat（Node ≥22；无 Node 先跑下面两行再回来）**：
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
npm i -g @oatelauser/crosschat@1.3.3 && crosschat --version
```
```
1.3.3
```

**L3 · 生成密钥（一路回车，无口令）**：
```bash
ssh-keygen -t ed25519
```

**L4 · 公钥交换**——打印云端公钥（复制整行，发给 win 侧 W9 / mac 侧 M7）；再收对方公钥（粘贴 W4 / M4 打印的那行）：
```bash
cat ~/.ssh/id_ed25519.pub
echo 'ssh-ed25519 AAAA...win 或 mac 的公钥整行' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && cat ~/.ssh/authorized_keys
```

**L5 · 回程别名（⚠️ `User` 行必写；前提：对端 W8/M6 隧道已连）**：
```bash
ssh-keyscan -p 2222 localhost >> ~/.ssh/known_hosts
cat >> ~/.ssh/config << 'EOF'
Host yang
  HostName localhost
  Port 2222
  User yangsheng
EOF
```
（`yang`/`yangsheng` 换成替换表里对端本机 hostname/用户；别名必须=对端 hostname——信封回程路条自动成立。）

**L6 · PATH 软链（条件步）**——`npm prefix -g` 输出以 `/usr` 开头（发行版/NodeSource 装的）→ 跳过；输出是 `~/.nvm/...` 或 `/opt/...`（nvm/自定义前缀）→ 必须跑：
```bash
npm prefix -g
ln -s "$(npm prefix -g)/bin/crosschat" /usr/local/bin/crosschat
```
不跑的后果：出腿自证报 `REMOTE_FAILED ... 远端异常退出(127): command not found`（sshd 的 shell 看不到 npm 的 bin）。

**L7 · 回程自证（走的就是对端背来的隧道）**：
```bash
ssh -o BatchMode=yes yang crosschat --version
```
```
1.3.3
```

---

<details>
<summary><b>macOS 节（本机是 mac 时，从上往下做；全程 Terminal，无 Xshell）</b></summary>

**M1 · 查本机 hostname 与用户名**（填替换表；Linux 节 L5 要用）：
```bash
hostname; whoami
```
```
mac.local
me
```

**M2 · 开远程登录（= mac 的 sshd）**：系统设置 → 通用 → 共享 → **远程登录** 打开。验证：
```bash
lsof -iTCP:22 -sTCP:LISTEN
```
```
sshd  123  me  3u  IPv6  ...  TCP *:ssh (LISTEN)
```

**M3 · 密钥（有则跳过）+ 打印公钥**（整行发给 Linux 节 L4）：
```bash
ssh-keygen -t ed25519        # 一路回车
cat ~/.ssh/id_ed25519.pub
```

**M4 · 认得云端（写 config + 播种 host key，值来自替换表）**：
```bash
cat >> ~/.ssh/config << 'EOF'
Host host-b b
  HostName 203.0.113.10
  Port 22
  User deploy
EOF
ssh-keyscan -p 22 203.0.113.10 >> ~/.ssh/known_hosts
```

**M5 · 探活（输密码，能进云端 shell = 通，exit 退出）**：
```bash
ssh host-b
```

**M6 · 反向隧道（开一个专用 Terminal 标签跑这条，挂着别关；断线重跑同一条）**：
```bash
ssh -N -R 2222:localhost:22 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes host-b
```
验证（另开标签，贴进云端会话里）：`ss -tln | grep 2222` → 出现 LISTEN 行 = 活。

**M7 · 收云端公钥（用 Linux 节 L4 打印的整行；mac 无专用文件，走普通 authorized_keys）**：
```bash
echo 'ssh-ed25519 AAAA...host-b 的公钥整行' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

**M8 · 出腿自证**：`ssh -o BatchMode=yes host-b crosschat --version` → `1.3.3`
**M9 · 全环自证（需 Linux 节全部完成）**：`ssh -o BatchMode=yes host-b "ssh -o BatchMode=yes mac crosschat --version"` → `1.3.3`（`mac` 换成 M1 的 hostname）

（Linux 桌面当本机时同理：M2 换成 `sudo systemctl enable --now ssh`，其余步骤相同。）

</details>

---

##### 两侧自证全绿后的正式闭环

云端需有一个命名会话（claude 里 `/rename 云端beta`）。本机发起：
```powershell
crosschat send --via ssh:host-b --to 云端beta --body "收到请照信封里的回复命令回一句：闭环成立"
```
```
delivered to 云端beta@host-b (turn 1)
```
对端回信将穿过隧道落回本机发起会话（`turn 2`）——回程全靠那条隧道，**隧道窗口/Xshell 会话关了回信就断**（发起腿不受影响）；持续保活已是"半 broker"形态，堡垒机形态（broker）仍是长期正解。

##### NAT 形态失败对照

| 症状 | 根因 | 解法 |
|---|---|---|
| 探活 `Connection timed out` | 网络不通/端口错/云端防火墙 | 核对替换表地址端口；云端安全组放行该端口 |
| 探活 `Permission denied` | 用户名或密码错 | 核对云端用户；密码登录被禁则改用控制台 |
| `root@localhost: Permission denied`（回程自证） | L5 漏了 `User` 行 | 补 `User <对端本机用户名>` |
| `Connection refused`（连 `localhost:2222`） | 对端隧道没连/断了 | 重连 W8 的 Xshell 会话 / M6 重跑 |
| `REMOTE_FAILED ... (127): command not found`（出腿自证） | 云端 Node 在 nvm/自定义前缀 | L6 软链 |
| 回信突然全断、出腿正常 | 隧道会话断了 | 重连隧道即恢复 |

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
