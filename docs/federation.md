# 跨机联邦手册（ssh v1）

> 本文是 [README · 通信方式](../README.md#-通信方式) 表中"跨机联邦 · ssh"的完整手册。


一句话：跨机 = **[单机全部用法](../README.md#-快速入门)** + 一个 `--via` 参数——[快速入门](../README.md#-快速入门)里的一切照旧，只是消息发到另一台机器。对端装好 crosschat、配好密钥，就开始。

```bash
crosschat send --via ssh:build01 --to worker2 --body "跑一次构建，产物清单发回来"
# → delivered to worker2@build01 (turn 1)
```

### 怎么用这篇手册

- 双向可达（同 LAN/VPN）：本机章（[Win](#win-配置-ssh本机是-windows-时做本章) 或 [MacOS](#macos-配置-ssh本机是-macos-时做本章)）+ [Linux 章](#linux-配置-ssh)各从头做到尾，两个方向自证都出版本号 = 部署完成
- 单向（本机在 NAT 后，能连出去、对端连不回你）：上面两章做完，再做[单向 SSH 章](#单向-sshnat你能连它它连不回你)的两处差量
- 每步一个代码块：`>` 开头的行 = 你要敲的命令，其余行 = 期望输出，`#` 开头 = 条件/备注
- `<XX>` = 占位符，每章开头的小表标了去哪一步查到真值

### Win 配置 SSH（本机是 Windows 时做本章）

| 占位符 | 在哪查 |
|---|---|
| `<本机hostname>` / `<本机用户>` | W1 |
| `<对端地址>` / `<对端端口>` / `<对端用户>` / `<对端hostname>` | Linux 章 L1（MacOS 对端见 M1） |

**W1 · 查本机 hostname 与用户（登记进上表，对端 L5 要用）**
```
> hostname
yang
> whoami
yangsheng
```

**W2 · 确认本机 sshd 在跑（收件腿终点）**
```
> Get-Service sshd
Status  Name
Running sshd
# Stopped → 管理员 PowerShell 跑 Start-Service sshd
# 服务不存在 → 管理员 PowerShell 跑 Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 然后 Start-Service sshd
```
- 收件腿限制（实测定论）：win 侧 codex 不可达（AF_UNIX 跨登录会话隔离），claude 腿可用
- sshd 默认 shell 只见系统 PATH——npm 全局 bin 必须在系统 PATH 里

**W3 · 本机密钥（有则跳过）**
```
> Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub
True
# False → ssh-keygen -t ed25519 一路回车（无口令，机器通道）
```

**W4 · 打印本机公钥（整行复制，发给对端 L4）**
```
> Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
ssh-ed25519 AAAA...yang
```

**W5 · 认得对端（写 ssh config）**
```
> notepad $env:USERPROFILE\.ssh\config
```
文件末尾追加后保存（占位符来自章首表）：
```
Host <对端hostname> peer
  HostName <对端地址>
  Port <对端端口>
  User <对端用户>
```
- 别名必须 = 对端系统 hostname——信封回程路条 `--via ssh:<对端hostname>` 自动成立；`peer` 是顺手短名
- 可选提速：同文件同 Host 块下加 `ControlMaster auto` + `ControlPath ~/.ssh/cm-%r@%h-%p` + `ControlPersist 10m`（复用连接，摊薄每次握手 100-300ms）

**W6 · 播种对端 host key（首连自动记指纹）**
```
> ssh -o StrictHostKeyChecking=accept-new -p <对端端口> <对端用户>@<对端地址> exit
Warning: Permanently added '<对端地址>' (ED25519) to the list of known hosts.
<对端用户>@<对端地址>'s password:   ← 输一次密码，进去即退
# 别用 ssh-keyscan 播种：它有算法协商缺陷（choose_kex: unsupported KEX method sntrup761...），
# 输出永远只有 # 开头的横幅行，抓不到指纹
```

**W7 · 探活（输密码能进对端 shell = 网络与账号都通；进去敲 exit 退回）**
```
> ssh peer
```

**W8 · 收对端公钥（粘贴对端 L4 打印的整行）**
```
> $kf = "$env:ProgramData\ssh\administrators_authorized_keys"
> Add-Content $kf -Value '<对端公钥整行>'
> icacls $kf /inheritance:r /grant "SYSTEM:(F)" /grant "BUILTIN\Administrators:(F)"
```
- 管理员组用户**必须**走这个专用文件（普通 `authorized_keys` 无效）；三条命令在**终端(管理员)**里跑（右键开始菜单）；无输出 = 成功

**W9 · 出腿自证（需对端章 L1–L4 已完成）**
```
> ssh -o BatchMode=yes peer crosschat --version
1.3.3
```

### Linux 配置 SSH

| 占位符 | 在哪查 |
|---|---|
| `<本机hostname>` / `<本机端口>` | L1 现查 |
| `<对端hostname>` / `<对端用户>` / `<对端地址>` | Win 章 W1（MacOS 本机见 M1；地址=本机在内网的 IP） |

**L1 · 查本机 hostname 与 ssh 端口（登记进上表，对端 W5 要用）**
```
> hostname; ss -tlnp | grep sshd
host-b
LISTEN 0 128 0.0.0.0:22 ...sshd...
# WSL 注记：镜像网络下 22 被 win 占——换非标端口：
#   sed -i 's/^#*Port .*/Port 2222/' /etc/ssh/sshd_config && systemctl enable --now ssh
#   并在对端加播种：ssh-keyscan -p 2222 <本机地址> >> 对端 known_hosts
```

**L2 · 装 crosschat（Node ≥22）**
```
> npm i -g @oatelauser/crosschat && crosschat install-skills && crosschat --version
1.3.3
# 没有 Node → 先跑：curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
```

**L3 · 密钥（有则跳过；生成时一路回车，无口令）**
```
> ls ~/.ssh/id_ed25519.pub
ls: cannot access '/root/.ssh/id_ed25519.pub': No such file or directory
> ssh-keygen -t ed25519
```

**L4 · 公钥交换：打印本机公钥发给对端 W8/M6；收对端公钥（粘贴对端 W4/M3 的整行）**
```
> cat ~/.ssh/id_ed25519.pub
ssh-ed25519 AAAA...host-b
> echo '<对端公钥整行>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
> cat ~/.ssh/authorized_keys
ssh-ed25519 AAAA...(对端)
# 对端是本机 WSL 时可从 win 直写（鸡生蛋不走 ssh）：
#   wsl -u root sh -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys' < $env:USERPROFILE\.ssh\id_ed25519.pub
```

**L5 · 认得对端（双向场景；单向 NAT 场景跳过本步，由[单向 SSH 章](#单向-sshnat你能连它它连不回你)接管）**
```
> cat >> ~/.ssh/config << 'EOF'
Host <对端hostname> peer
  HostName <对端地址>
  Port 22
  User <对端用户>
EOF
> ssh-keyscan <对端地址> >> ~/.ssh/known_hosts
# 推荐改用（首连自动记指纹，输对端登录密码后即退；keyscan 对部分服务端抓不到指纹）：
#   ssh -o StrictHostKeyChecking=accept-new peer exit
```

**L6 · PATH 软链（条件步：决定 sshd 的 shell 找不找得到 crosschat）**
```
> npm prefix -g
/usr
# 输出以 /usr 开头（发行版/NodeSource 装的 Node）→ 本步跳过
# 输出是 ~/.nvm/... 或 /opt/...（nvm/自定义前缀）→ 必须跑：
> ln -s "$(npm prefix -g)/bin/crosschat" /usr/local/bin/crosschat
# 不跑的后果：对端自证报 REMOTE_FAILED [via ...] 远端异常退出(127): command not found
```

**L7 · 出腿自证（反方向那条在对端章 W9/M7；两边都出版本号 = 部署完成）**
```
> ssh -o BatchMode=yes peer crosschat --version
1.3.3
```

### MacOS 配置 SSH（本机是 MacOS 时做本章）

| 占位符 | 在哪查 |
|---|---|
| `<本机hostname>` / `<本机用户>` | M1 |
| `<对端地址>` / `<对端端口>` / `<对端用户>` / `<对端hostname>` | Linux 章 L1 |

**M1 · 查本机 hostname 与用户（登记进上表，对端 L5 要用）**
```
> hostname; whoami
mac.local
me
```

**M2 · 开远程登录（= mac 的 sshd）**：系统设置 → 通用 → 共享 → **远程登录** 打开
```
> lsof -iTCP:22 -sTCP:LISTEN
sshd  123  me  3u  IPv6  ...  TCP *:ssh (LISTEN)
```

**M3 · 密钥（有则跳过）+ 打印公钥（发给对端 L4）**
```
> ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519
> cat ~/.ssh/id_ed25519.pub
ssh-ed25519 AAAA...mac
```

**M4 · 认得对端（写 config + 播种 host key）**
```
> cat >> ~/.ssh/config << 'EOF'
Host <对端hostname> peer
  HostName <对端地址>
  Port <对端端口>
  User <对端用户>
EOF
> ssh-keyscan -p <对端端口> <对端地址> >> ~/.ssh/known_hosts
# 推荐改用（首连自动记指纹；keyscan 对部分服务端抓不到指纹）：
#   ssh -o StrictHostKeyChecking=accept-new peer exit
```

**M5 · 探活（输密码能进 = 通；exit 退回）**
```
> ssh peer
```

**M6 · 收对端公钥（粘贴对端 L4 的整行；mac 无专用文件，普通 authorized_keys 即可）**
```
> echo '<对端公钥整行>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

**M7 · 出腿自证**
```
> ssh -o BatchMode=yes peer crosschat --version
1.3.3
```
（Linux 桌面当本机：M2 换成 `systemctl enable --now ssh`，其余步骤全部相同。）

### 单向 SSH（NAT：你能连它、它连不回你）

适用：本机（win/mac）在 NAT 后能出站 ssh 到云端 Linux，云端连不回本机。回程由本机常驻**反向隧道**背过去，crosschat 零改动（2026-10-08 win↔云端真机闭环实测：`../drill-reports/federation-nat-tunnel-20261008.md`）。前提：本机章 + Linux 章已全部做完，本章只改两处。

**N1 · 出站侧开反向隧道（win 用 Xshell / mac 用 Terminal；隧道随这个会话活，别关）**
```
# Xshell：会话属性 → 连接 → SSH → 隧道 → 添加：类型"远程(传入)"，源 localhost:2222，目标 localhost:22；属性里保持活动间隔 30s；连接并保持会话开着
# Terminal（mac/Linux 桌面）：开一个专用标签跑下面这条，挂着；断线重跑同一条：
> ssh -N -R 2222:localhost:22 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes peer
```
验证（贴到云端会话里跑）：
```
> ss -tln | grep 2222
LISTEN 0 128 127.0.0.1:2222 0.0.0.0:*
```

**N2 · Linux 章的 L5 在此换成回程别名（⚠️ `User` 行必写、`Port` 必须是 2222）**
```
> ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes yang echo ok
Warning: Permanently added '[localhost]:2222' (ED25519) to the list of known hosts.
ok
# 这一条同时完成播种 + 回程自证（BatchMode=只走密钥不问密码）
# 若报 Permission denied = 对端还没做 W8 收公钥——指纹也已存好，做完 W8 重跑本条即出 ok
# keyscan 在此场景抓不到指纹（输出全是 # 行），勿用
> cat >> ~/.ssh/config << 'EOF'
Host <对端hostname>
  HostName localhost
  Port 2222
  User <对端用户>
EOF
> cat ~/.ssh/config
Host <对端hostname>
  HostName localhost
  Port 2222
  User <对端用户>
# ⚠️ 缺 User 行 = ssh 默认拿本机当前用户去连对端 → 报 root@localhost: Permission denied
# ⚠️ Port 写成 22 = 连到 Linux 自己的 sshd（绕过隧道）→ 报 Host key verification failed
```

**N3 · 回程自证（Linux 上跑；走的就是隧道，穿回对端本机）**
```
> ssh -o BatchMode=yes <对端hostname> crosschat --version
1.3.3
```

**N4 · 全环一条命令（本机上跑；本机→云端→隧道→本机 整圈）**
```
> ssh -o BatchMode=yes peer "ssh -o BatchMode=yes <本机hostname> crosschat --version"
1.3.3
```

**N5 · 正式闭环（本机发起；云端先备一个命名会话——claude 里 `/rename 云端beta`）**
```
> crosschat send --via ssh:<对端hostname> --to 云端beta --body "收到请照信封里的回复命令回一句：闭环成立"
delivered to 云端beta@host-b (turn 1)
```
对端回信穿隧道落回本机发起会话（`turn 2`）。回程全靠这条隧道：**会话关了回信就断**（发起腿不受影响）；持续保活已是"半 broker"形态，堡垒机形态（broker）仍是长期正解。

**失败对照**

| 症状 | 根因 | 解法 |
|---|---|---|
| 探活 `Connection timed out` | 网络不通/端口错/对端防火墙 | 核对地址端口；云端安全组放行 |
| 探活 `Permission denied` | 用户名或密码错 | 核对用户名；密码登录被禁则走控制台 |
| `root@localhost: Permission denied`（回程自证） | N2 漏了 `User` 行 | 补 `User <对端用户>` |
| `Host key verification failed`（回程自证） | N2 的 Port 写成 22（连到 Linux 自己的 sshd），或指纹没播上 | 核对 `cat ~/.ssh/config` 四行；播种改用 `ssh -o StrictHostKeyChecking=accept-new ...`（keyscan 有缺陷抓不到） |
| keyscan 输出只有 `#` 行 / `choose_kex: unsupported KEX method` | ssh-keyscan 自身的算法协商缺陷 | 弃用 keyscan，用上面 accept-new 的方式首连记指纹 |
| `Connection refused`（连 `localhost:2222`） | 隧道没连/断了 | 重连 Xshell 会话 / 重跑 N1 的 ssh 命令 |
| `REMOTE_FAILED ... (127): command not found` | 云端 Node 在 nvm/自定义前缀 | Linux 章 L6 软链 |
| 回信突然全断、出腿正常 | 隧道会话断了 | 重连隧道即恢复 |
| 出腿 `USAGE [via ...] unknown option` | 对端 crosschat 版本过旧 | 对端升级 `npm i -g @oatelauser/crosschat` |

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
