# 如何使用反向隧道

你的机器在 NAT 后：能出站 ssh 连到云端 Linux，云端连不回你。跨机 ssh 联邦的回程（对端给你回信）由一条**常驻反向隧道**背回来——crosschat 零改动，它只认 `~/.ssh/config` 里的别名，隧道被伪装成一个普通别名。2026-10-08 win↔云端真机闭环实测通过。

前置：双向部署的八步已在两边做完（见[2.4 SSH 部署与配置](../tutorial/lesson-2/04-deploy-config.md)——单向场景只把对端的"认得 win"一步换成下文的回程别名）。

## 判定你的场景

症状对号：`ssh <云端>` 能进；在云端 `ssh <你的地址>` 超时或拒绝（NAT/防火墙不放行入站）——就是本页场景。出站方向（你→云端发消息）与双向场景完全一样，**只有回程要隧道**；不满足此特征的去走双向部署。

## 开隧道

win 用 Xshell：会话属性 → 连接 → SSH → 隧道 → 添加——类型"远程(传入)"，源 `localhost:2222`，目标 `localhost:22`；属性里保持活动间隔 30s；连接并**保持这个会话开着**。

或 Terminal（mac/Linux 桌面）开一个专用标签跑下面这条，挂着；断线重跑同一条：

```bash
ssh -N -R 2222:localhost:22 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes peer
```

验证隧道口在听（贴到云端会话里跑）：

```console
> ss -tln | grep 2222
LISTEN 0 128 127.0.0.1:2222 0.0.0.0:*
```

## 对端回程别名

在云端把回程别名写成指向隧道口（这取代双向部署里对端的"认得 win"那步）：

```text
Host win
  HostName localhost
  Port 2222
  User <win用户名>
```

⚠️ 三条纪律，每条都是真机实测翻出来的：

1. **User 行必写**——缺了它，ssh 默认拿云端自己的用户名去连你 → `root@localhost: Permission denied`
2. **Port 必须是 2222**——写成 22 等于连到云端自己的 sshd（绕过隧道）→ `Host key verification failed`
3. **别名仍 = 你的 hostname**——回信自动选路按发起方 hostname 找别名（同[2.2 别名与 hostname](../tutorial/lesson-2/02-terms.md#别名与-hostname)的软依赖规则）

## 播种与回程自证

一条命令同时完成记指纹与回程自证（在云端跑；BatchMode = 只走密钥不问密码）：

```console
> ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes win echo ok
Warning: Permanently added '[localhost]:2222' (ED25519) to the list of known hosts.
ok
```

报 `Permission denied` = win 侧还没装云端的公钥（双向部署第四步的另一半）——指纹已存好，装完重跑本条即出 ok。

再补一条全环自证（本机跑，本机→云端→隧道→本机 整圈）：

```console
> ssh -o BatchMode=yes peer "ssh -o BatchMode=yes win crosschat --version"
1.6.4
```

两条都过 = 单向联邦部署完成，可以发消息了（`crosschat send --via ssh:<云端hostname> --to <会话名> …`，对端照信封回信即穿隧道落回你）。

## 日常运维

| 症状 | 原因 | 解法 |
|---|---|---|
| 回信突然全断、出腿正常 | 隧道会话断了 | 重连 Xshell 会话 / 重跑开隧道那条命令，即恢复 |
| 云端连 `localhost:2222` 报 Connection refused | 隧道没连上或已断 | 同上；先跑 `ss -tln \| grep 2222` 验证口在听 |
| 回程自证报 Permission denied | 公钥交换缺一侧 | 补双向部署第四步的对应侧，重跑自证 |
| 回程自证报 Host key verification failed | 回程别名 Port 写成 22 | 核对 config 四行，Port 必须是 2222 |

运维事实：隧道随会话活——**会话关了回信就断**（发起腿不受影响）。持续保活（Xshell 保持活动 / `ServerAliveInterval=30`）已是"半 broker"的运维形态；消息量大了、或要多个对端共一条回程通道时，长期正解是 tcp 星（堡垒机形态）——见[ssh 与 tcp 星怎么选](../explanation/ssh-vs-tcp.md)。
