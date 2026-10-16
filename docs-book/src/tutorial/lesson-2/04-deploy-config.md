# 2.4 SSH 部署与配置

这一节做完，你得到：两台机器互相认得对方的 ssh 密钥、彼此免密登录、crosschat 出腿自证通过。本质就是配一次双向免密 ssh——crosschat 复用它，自己零额外配置。

演示主线是 **Windows 本机 ↔ Linux 对端**（WSL 与远程 Linux 同理）；Linux 侧的每步在对应位置一行带过。双向场景按下面八步走；单向 NAT 先把八步做完，再补 [单向 NAT 差量](#单向-nat-差量)。

## 双向可达部署

**第一步 · 查本机 hostname 与用户**（登记下来——对端写它的 ssh config 时要用这两个值）

```console
> hostname
win
> whoami
yangsheng
```
（对端同样查：在 Linux 上敲 `hostname`。两台机各自的 hostname 就是两边别名的取值来源）

**第二步 · 开本机 sshd**（收件腿的终点——对端要能 ssh 进来给你投递）

```console
> Get-Service sshd
Status  Name
Running sshd
# Stopped → 管理员 PowerShell 跑 Start-Service sshd
# 服务不存在 → 管理员 PowerShell 跑 Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 然后 Start-Service sshd
```
（Linux 对端：`systemctl enable --now ssh`）
win 收件腿的一个实测定论：codex 不可达（AF_UNIX 跨登录会话隔离），claude 腿可用——要给 win 发消息，选 claude 会话。

**第三步 · 本机密钥**（有则跳过；生成时一路回车，无口令——这是机器通道）

```console
> Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub
True
# False → ssh-keygen -t ed25519 一路回车
```
（Linux：`ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519`）

**第四步 · 公钥交换**——两台机器互装对方的公钥，⚠️ 漏任何一侧必卡认证

```text
第一步 打印            第二步 装入                        效果
win   id_ed25519.pub ─────► Linux ~/.ssh/authorized_keys      （win 免密连 Linux ✓）
Linux id_ed25519.pub ─────► win   administrators_authorized_keys（Linux 免密连 win ✓）
两支方向都要装；漏一支 = 一个方向通、另一个方向卡认证
```

win 的公钥给对端：打印 `Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub`，把整行追加到对端的 authorized_keys：
```bash
echo '<win公钥整行>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
# 对端恰好是本机 WSL 时可不走 ssh 直写（鸡生蛋解法）：
#   wsl -u root sh -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys' < $env:USERPROFILE\.ssh\id_ed25519.pub
```
对端的公钥给 win：管理员组用户必须走专用文件，三条在**终端(管理员)**里跑，无输出 = 成功：
```powershell
> $kf = "$env:ProgramData\ssh\administrators_authorized_keys"
> Add-Content $kf -Value '<对端公钥整行>'
> icacls $kf /inheritance:r /grant "SYSTEM:(F)" /grant "BUILTIN\Administrators:(F)"
```

**第五步 · 认得对端**（写 ssh config；⚠️ **别名必须 = 对端 hostname**，原因见[别名与 hostname](02-terms.md#别名与-hostname)）

```console
> notepad $env:USERPROFILE\.ssh\config
```
文件末尾追加（占位符换成真值；`peer` 是顺手起的短名，主别名用对端系统 hostname）：
```text
Host <对端hostname> peer
  HostName <对端地址>
  Port <对端端口>
  User <对端用户>
```
WSL 注记：镜像网络下 22 端口被 win 占——对端先换非标端口 `sed -i 's/^#*Port .*/Port 2222/' /etc/ssh/sshd_config && systemctl enable --now ssh`，然后本步的 Port 填 2222。
可选提速：同一 Host 块下加 `ControlMaster auto` + `ControlPath ~/.ssh/cm-%r@%h-%p` + `ControlPersist 10m`，复用连接，摊薄每次握手 100-300ms。

**第六步 · 播种对端指纹**（首连自动记指纹，防后续卡密钥确认）

```console
> ssh -o StrictHostKeyChecking=accept-new -p <对端端口> <对端用户>@<对端地址> exit
Warning: Permanently added '<对端地址>' (ED25519) to the list of known hosts.
# 公钥交换已做完 → 密钥直接认证，无提示直接退出 = 正常
# 还没做完 → 提示输一次对端密码，输完即退，也算通过
```
别用 ssh-keyscan 播种：它有算法协商缺陷，输出永远只有 `#` 开头的横幅行，抓不到指纹。

**第七步 · 探活**（输密码能进对端 shell = 网络与账号都通；进去敲 exit 退回）

```console
> ssh peer
```

**第八步 · 出腿自证**（部署完成的判据）

```console
> ssh -o BatchMode=yes peer crosschat --version
1.6.4
```
这一条同时验了四件事：网络通、密钥对、对端找得到 crosschat、版本不过旧。对端反方向再跑一条（`ssh <本机hostname> crosschat --version`），✅ 两边都出版本号 = 部署完成。

装完顺手再补两条望诊（详解见[体检与望诊](05-first-message.md#体检与望诊)）：

```console
> ssh peer crosschat doctor
> ssh peer crosschat status
```

第一条看对端**环境能跑**（Node / codex daemon / skill），第二条看对端**有人能收**（会话名单）。

对端是 Linux 时，它的同侧步骤每步一行（还没装 crosschat 先装：Node ≥22，`npm i -g @oatelauser/crosschat && crosschat install-skills`）：

```bash
hostname                                             # 查 hostname（写进 win 的 config）
systemctl enable --now ssh                           # 开 sshd
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519    # 密钥
echo '<win公钥整行>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys   # 收 win 公钥
# ~/.ssh/config 追加：Host <win的hostname> peer 三行（HostName/Port/User）——别名 = win 系统 hostname
ssh -o StrictHostKeyChecking=accept-new <win地址> exit    # 播种 win 指纹
ssh peer                                             # 探活
ssh -o BatchMode=yes <win的hostname> crosschat --version # 反向自证
```

## 单向 NAT 差量

前提：上面的双向八步已做完。你的机器在 NAT 后能连出去、云端连不回你——回程由本机一条**常驻反向隧道**背过去：

- win 用 Xshell：会话属性 → 连接 → SSH → 隧道 → 添加"远程(传入)"，源 `localhost:2222`，目标 `localhost:22`，保持活动间隔 30s，保持会话开着
- 或 Terminal 跑一条挂着：`ssh -N -R 2222:localhost:22 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes peer`

```text
出站腿（与双向场景完全一样）
  win ─────────────── ssh ──────────────► 云端 Linux

回程腿（云端连不回 NAT 内的 win，改走常驻反向隧道）
  云端 Linux
    │  对端别名 win = localhost:2222
    ▼
  localhost:2222 ══ 隧道（随 Xshell / ssh -R 会话常驻）══► win 的 sshd:22
```

验证隧道口在听（贴到云端会话里跑）：

```console
> ss -tln | grep 2222
LISTEN 0 128 127.0.0.1:2222 0.0.0.0:*
```

然后在**对端**把回程别名写成指向隧道口（双向场景第五步的对端侧在此换成这份）：

```text
Host win
  HostName localhost
  Port 2222
  User <win用户名>
```

⚠️ 三条纪律，每条都是真机实测翻出来的：

1. **User 行必写**——缺了它，ssh 默认拿对端自己的用户名去连你 → `root@localhost: Permission denied`（2026-10-08 实测翻车点）
2. **Port 必须是 2222**——写成 22 等于连到对端自己的 sshd → `Host key verification failed`
3. **隧道随会话活**——会话断了回信就断（出腿不受影响），重连即恢复

一条命令同时完成播种与回程自证（在云端跑；BatchMode = 只走密钥不问密码）：

```console
> ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes win echo ok
Warning: Permanently added '[localhost]:2222' (ED25519) to the list of known hosts.
ok
# 报 Permission denied = win 侧公钥交换还没做完——指纹已存好，做完重跑本条即出 ok
```

✅ 再补一条全环自证（本机上跑，本机→云端→隧道→本机 整圈）：

```console
> ssh -o BatchMode=yes peer "ssh -o BatchMode=yes win crosschat --version"
1.6.4
```

操作细节全流程见指南部[如何使用反向隧道](../../howto/nat-tunnel.md)。

## 远端找得到 crosschat 吗

sshd 起的登录 shell 只见**系统** PATH。对端先跑判别（Linux 上）：

```console
> npm prefix -g
/usr
# 输出以 /usr 开头（发行版/NodeSource 装的 Node）→ 没有坑，本节跳过
# 输出是 ~/.nvm/... 或 /opt/...（nvm/自定义前缀）→ ⚠️ 必须软链：
> ln -s "$(npm prefix -g)/bin/crosschat" /usr/local/bin/crosschat
```

不软链的后果——出腿自证会这样报：

```console
crosschat: REMOTE_FAILED [via peer] 远端异常退出(127): command not found
```

Windows 对端的等价解法：把 npm 全局目录加进系统 PATH。上一步的自证命令，验的正是这件事。

## 一台机器的自环

没有第二台机器，也能把本课全部跑一遍——消息真的走一轮 ssh 管道再回到本机会话（sshd 已在 22 端口）：

```console
> crosschat send --via ssh:localhost --to <本机会话名> --body "自环测试"
delivered to <会话名>@win(3f2a81b0) (turn 1) · 续话 c1
```

[2.6 通信机制](06-mechanism.md)的全部机制在这条命令里照常运转。
