# 2.3 SSH 部署与配置

这一节做完，你得到：两台机器互相认得对方的 ssh 密钥、彼此免密登录、crosschat 出腿自证通过。本质就是配一次双向免密 ssh——crosschat 复用它，自己零额外配置。

演示主线是 **Windows 本机 ↔ Linux 对端**（WSL 与远程 Linux 同理）；Linux 侧的每步在对应位置一行带过。双向场景按下面六步走；单向 NAT 先把六步做完，再补末尾的差量块。

## 双向可达部署

**第一步 · 开本机 sshd**（收件腿的终点——对端要能 ssh 进来给你投递）

```
> Get-Service sshd
Status  Name
Running sshd
# Stopped → 管理员 PowerShell：Start-Service sshd
# 服务不存在 → 管理员 PowerShell：Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0，然后 Start-Service sshd
```
（Linux 对端：`systemctl enable --now ssh`）

**第二步 · 本机密钥**（有则跳过；生成时一路回车，无口令——这是机器通道）

```
> Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub
True
# False → ssh-keygen -t ed25519 一路回车
```
（Linux：`ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519`）

**第三步 · 公钥交换**——两台机器互装对方的公钥，漏任何一侧必卡认证

win 的公钥给对端：打印 `Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub`，把整行追加到对端的 authorized_keys：
```
# 在 Linux 对端上：
echo '<win公钥整行>' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```
对端的公钥给 win：管理员组用户必须走专用文件，三条在**终端(管理员)**里跑，无输出 = 成功：
```
> $kf = "$env:ProgramData\ssh\administrators_authorized_keys"
> Add-Content $kf -Value '<对端公钥整行>'
> icacls $kf /inheritance:r /grant "SYSTEM:(F)" /grant "BUILTIN\Administrators:(F)"
```

**第四步 · 认得对端**（写 ssh config；**别名必须 = 对端 hostname**，原因见 2.2）

```
> notepad $env:USERPROFILE\.ssh\config
```
文件末尾追加（占位符换成真值）：
```
Host yangwsl peer
  HostName <对端地址>
  Port <对端端口>
  User <对端用户>
```
`peer` 是顺手起的短名；`yangwsl` 是对端系统 hostname，别写别的。对端侧对称写一份 `Host win …` 指回你。
可选提速：同一 Host 块下加 `ControlMaster auto` + `ControlPath ~/.ssh/cm-%r@%h-%p` + `ControlPersist 10m`，复用连接，摊薄每次握手的一两百毫秒。

**第五步 · 播种对端指纹**（首连自动记指纹，防后续卡密钥确认）

```
> ssh -o StrictHostKeyChecking=accept-new peer exit
Warning: Permanently added '<对端地址>' (ED25519) to the list of known hosts.
```
别用 ssh-keyscan 播种：它对部分服务端抓不到指纹。

**第六步 · 出腿自证**（部署完成的判据）

```
> ssh -o BatchMode=yes peer crosschat --version
1.6.4
```
这一条同时验了四件事：网络通、密钥对、对端找得到 crosschat、版本不过旧。对端反方向再跑一条（`ssh win crosschat --version`），两边都出版本号 = 部署完成。

## 单向 NAT 差量

前提：上面的双向六步已做完。你的机器在 NAT 后能连出去、云端连不回你——回程由本机一条**常驻反向隧道**背过去：

- win 用 Xshell：会话属性 → 连接 → SSH → 隧道 → 添加"远程(传入)"，源 `localhost:2222`，目标 `localhost:22`，保持会话开着
- 或 Terminal 跑一条挂着：`ssh -N -R 2222:localhost:22 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes peer`

然后在**对端**把回程别名写成指向隧道口（双向场景第四步的对端侧在此换成这份）：

```
Host win
  HostName localhost
  Port 2222
  User <win用户名>
```

三条纪律，每条都是真机实测翻出来的：

1. **User 行必写**——缺了它，ssh 默认拿对端自己的用户名去连你 → `root@localhost: Permission denied`（2026-10-08 实测翻车点）
2. **Port 必须是 2222**——写成 22 等于连到对端自己的 sshd → `Host key verification failed`
3. **隧道随会话活**——会话断了回信就断（出腿不受影响），重连即恢复

对端回程自证（走的就是隧道，穿回你的机器）：

```
> ssh -o BatchMode=yes win crosschat --version
1.6.4
```

操作细节全流程见指南部「如何使用反向隧道」。

## 远端找得到 crosschat 吗

sshd 起的登录 shell 只见**系统** PATH。npm 装的 crosschat 若落在用户级前缀（nvm、自定义目录），自证会这样报：

```
crosschat: REMOTE_FAILED [via peer] 远端异常退出(127): command not found
```

解法：Linux 对端软链 `ln -s "$(npm prefix -g)/bin/crosschat" /usr/local/bin/crosschat`；Windows 对端把 npm 全局目录加进系统 PATH。标准系统前缀（如 /usr）没有这个坑。上一步的自证命令，验的正是这件事。

## 一台机器的自环

没有第二台机器，也能把本课全部跑一遍——消息真的走一轮 ssh 管道再回到本机会话（sshd 已在 22 端口）：

```
> crosschat send --via ssh:localhost --to <本机会话名> --body "自环测试"
delivered to <会话名>@win(3f2a81b0) (turn 1) · 续话 c1
```

2.5 的全部机制在这条命令里照常运转。
