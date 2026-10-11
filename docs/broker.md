# 转发器手册（tcp broker · proto:1）

> 本文是 [README · 通信方式](../README.md#-通信方式) 表中"跨机联邦 · tcp"的完整手册。


一句话：选一台机器跑 `crosschat serve`（broker），其余机器各拿一把钥匙连上来；之后 `--via tcp:<机器>` 即跨机互发——与 [ssh 联邦](federation.md)同构，回复照抄信封里的命令即可。**寻址权威是 machine-id 前缀（mid8），机器名字只是人读显示**——对端改名不断线，回信永远找得到人。

```bash
crosschat send --via tcp:host-b --to worker2 --body "跑一次构建，产物清单发回来"
# → delivered to worker2@host-b (turn 1)
```

### 怎么用这篇手册

- 形态一（两台机器，服务端放其中一台）：从头做到尾，双向各一轮 + 文件一轮 = 部署完成
- 形态二（跨网络堡垒，公网直连·用户拍板裸奔）：结构已立好，**drill 冷走待补实录**
- 形态三（CI/脚本机单向下达）：零进程直发
- 每步一个代码块：`>` 开头的行 = 你要敲的命令，其余行 = 期望输出，`#` 开头 = 条件/备注
- `<XX>` = 占位符，各章开头的小表标了去哪一步查到真值
- 端口统一默认 **7260**；钥匙 = 一份 `node.json`，是唯一的入网凭证
- **单星边界**：一台机一份 node.json = 一个星形成员身份；换 broker = 换钥匙。同时入两个星是 proto:2 挂账议题（路线已核：客户端档案化、wire 协议不变、旧语法单档案机永续可用——升级不破坏）

### 会话实录（tcp 形态）

部署完成后（形态一 S1–S4 做完），日常用法与 [README 快速入门](../README.md#-快速入门)同款——你只说一句话，两个 agent 跨机对话到闭环。图例同 README：**👤 用户** 你说的指令 · **🤖 agent** 回复/收件 📨。

```
👤 用户[boss -> worker2]  用 crosschat（先 status 确认）给 host-b 机器的 claude 会话「worker2」发消息：
                          要求走 tcp 转发器（send 时加 --via tcp:host-b），让它跑一次构建并回报结果。
🤖 worker2 收到            📨 来自另一会话的消息:
                          <cross-session-message from-name="boss" turn="1">
                          …跑一次构建并回报结果…
                          回复请运行: crosschat send --via tcp:ec542c2c --conversation mc2_… --body "<你的回复>"
🤖 worker2[worker2 -> boss] 构建完成，产物清单见下一条
🤖 boss 收到               📨 构建完成，产物清单见下一条（turn 2，自动经 broker 跨机回到 A 机）
```

与 ssh 跨机的差别只有题词里的 `--via tcp:host-b`——回程路条由信封自动携带（`--via tcp:<A-mid8>`），worker2 零配置照抄即回。

### 形态一 · 两台机器（服务端放其中一台）

| 占位符 | 在哪查 |
|---|---|
| `<A机名>` / `<A-mid8>` | S1 / S4（A 机 = 跑 serve 的机器，本例 win `yang`） |
| `<IP>` | S2 自动探测行（人工核对后定稿） |
| `<B机名>` / `<B-mid8>` | S3 你填的 name / S4 `--list` 输出 |
| `<B机会话名>` | B 机 `crosschat status` |

**S1 · A 机起服务端**

```
> crosschat serve
已自动生成本机 node.json（C:\Users\yang\.crosschat\tcp\node.json，host=127.0.0.1——本机 send --via tcp: 凭证）
broker listening on 0.0.0.0:7260（Ctrl+C 退出）
# win 首启弹防火墙允许提示：勾选专用网络并允许——只给同网段用就不勾公用
# 首行自登记声明只在首次出现（已存在且一致时静默）；node.json 已存在但指向别家/钥匙陈旧时
#   会改为打印相应警告——broker 机与其他节点完全同构，零管理员动作；Ctrl+C 前台跑，--detach 可后台
```

**S2 · A 机生成钥匙（两把：B 机一把、留一把备用）**

```
> crosschat serve --gen-key 2
自动探测 broker 地址：192.168.1.10:7260（多网卡/NAT 常探错——按下述规则人工核对改写 node.json 的 host 与 port）：
  · broker 机自身 → 无需分发（首次 serve 已自动写好 127.0.0.1 的自用 node.json）
  · broker 是云主机/NAT 内网机 → host 填对外公网 IP（探测常拿内网 IP，必核对）
  · 普通局域网 → broker 机的局域网 IP；broker 用非默认端口时 port 一并改
分发前把每份 node.json 的 name 改成目标机器名（人读用，回信不依赖它——寻址走 machine-id 前缀）
--------------------------------
{
  "broker": {
    "host": "192.168.1.10",
    "port": 7260,
    "alias": "yang"
  },
  "key": "a3f0…64位hex…",
  "name": "改成目标机器名"
}
--------------------------------
{ …第二份同构… }
放置路径（目标机器）：~/.crosschat/tcp/node.json（win 写法 C:\Users\<用户>\.crosschat\tcp\node.json）
本命令须在 broker 机上执行（钥匙登记进本机 broker.json）；broker 机自己的 node.json 已由首次 serve 自动写好，勿用上面的钥匙覆盖
钥匙已进入终端回滚缓冲，分发完建议清屏
```
- 规则解读：探测**只取第一个非 internal 网卡**（内网段照返回）——多网卡/VPN/WSL/云主机 NAT 场景常探错，云主机公网 IP 是 NAT 映射**根本不绑网卡**，探测永远找不到，必须人工核对填入。探测错不致命：node.json 在 B 机改 host/port 即可
- 钥匙回滚缓冲安全提示：node.json 含钥匙=入网凭证，贴进过终端/聊天工具的缓冲都可能泄露——分发完 `clear`（win：`cls`），废弃的钥匙在 A 机 `serve --remove <label>` 注销

**S3 · B 机装钥匙（粘贴整段 node.json）**

```
> mkdir -p ~/.crosschat/tcp
> notepad ~/.crosschat/tcp/node.json     # win 写法；linux 用 nano/vi
# 粘贴 S2 的整段 JSON，把 "name" 改成本机 hostname（本例 host-b），保存
> cat ~/.crosschat/tcp/node.json
{
  "broker": { "host": "192.168.1.10", "port": 7260, "alias": "yang" },
  "key": "a3f0…",
  "name": "host-b"
}
# B 机也要装好 crosschat（npm i -g @oatelauser/crosschat && crosschat install-skills）
```

**S4 · B 机连上来（A 机验证）**

B 机：
```
> crosschat serve --connect
节点客户端启动：目标 broker yang（Ctrl+C 退出）
2026-10-11T10:30:01.234Z online（broker yang）
# 断线自动重连永不放弃（1s→60s 退避）；--detach 可后台（日志 ~/.crosschat/tcp/node.log）
```
A 机：
```
> crosschat serve --list
label     name              mid8      added-at
self      yang              ec542c2c  2026-10-11T02:12:00.059Z
node-1    host-b            9f8e7d6c  2026-10-11T02:31:10.402Z
```
- `<B-mid8>` 就在这一行（`9f8e7d6c`）——它是 B 机的**寻址权威**；name 列只是显示名
- 双轨寻址：`--via tcp:9f8e7d6c`（mid 前缀，git 短哈希式最短无歧义）与 `--via tcp:host-b`（名字）都行；两台机器撞名时报错列出双方 mid，改用 mid 前缀即消歧

**S5 · 双向对话（各一轮）**

A 机发起：
```
> crosschat send --via tcp:9f8e7d6c --to worker2 --body "跑一次构建，产物清单发回来"
delivered to worker2@9f8e7d6c (turn 1)
reply-ref: mc2_BPXvvaoBZUeagLVplzA4leUBoRbla6N3A48OwoC8hZFdCKgNWGngDu5eBw
```
B 机会话里自动出现信封（**无需任何题词**）：
```
📨 来自另一会话的消息:
<cross-session-message from-name="boss" turn="1">
<crosschat-reply-hint conversation="mc2_…" reply-as="worker2">回复请运行: crosschat send --via tcp:ec542c2c --conversation mc2_… --body "<你的回复>"</crosschat-reply-hint>
…
跑一次构建，产物清单发回来
</cross-session-message>
```
- 回程路条自动带 `--via tcp:<A-mid8>`——B 机照抄整条命令、只换 `<你的回复>` 即回（tcp 码与 mc2_ 同款照抄纪律：不截断不改写）
B 机回信：
```
> crosschat send --via tcp:ec542c2c --conversation mc2_… --body "构建完成，清单见下一条"
delivered to boss@ec542c2c (turn 2)
reply-ref: mc2_…
```

**S6 · 文件通道一轮**

A 机：
```
> crosschat send --via tcp:host-b --to worker2 --file ./report.md
delivered to worker2@host-b (turn 3)
reply-ref: mc2_…
```
B 机的 worker2 收到的正文是自动生成的（`--body` 缺省时）：`文件 report.md 已送达：C:\Users\<B用户>\.crosschat\tcp\inbox\3f2a1b9c-report.md`（linux 在 `~/.crosschat/tcp/inbox/`）——路径在**对端机器上**，直接可用。断点/去重/回收语义见[文件通道章](#文件通道--file)。

**S7 · 随时看转发器状态**

A 机（broker 机，读本地文件）：
```
> crosschat status
…
转发器: 服务端端口 7260，1 节点在线
在线机器: host-b
```
B 机（成员机，瞬态连 broker 拉在线表，2s 超时静默降级）：
```
> crosschat status
…
转发器: online tcp:yang (since 10-11 10:30)
转发器: broker 可达，2 机器在线
在线机器: yang (ec542c2c)、host-b (9f8e7d6c)
```

**S8 · 收尾**

```
> crosschat serve --stop      # A 机停 broker
stop broker: pid 12732 已终止（端口 7260 双重确认）
> crosschat serve --stop      # B 机停节点客户端（或前台 Ctrl+C）
stop node: pid 8412 已终止
```

### 形态二 · 跨网络堡垒（云端 broker，直连）

> **本章 drill 待补实录**——命令与输出按现行代码推写，未经双机实测（用户将裸奔直连冷走）。

适用：家里机与云端腿（跨公网）。**明文风险声明（用户 2026-10-11 拍板接受）：proto:1 无 TLS——公网直连 = 传输明文，路径环节理论上可截看对话内容；伪造/未授权投递被 PSK 挡死。介意明文可等 TLS 内建（挂账中）。**

**C1 · 云端装好 crosschat 后起服务端**（与 S1 同；`--detach` 后台，日志 `~/.crosschat/tcp/broker.log`）
```
> crosschat serve --detach
已自动生成本机 node.json（/root/.crosschat/tcp/node.json，host=127.0.0.1——本机 send --via tcp: 凭证）
broker 后台运行中 pid=24680 端口 7260（日志：/root/.crosschat/tcp/broker.log）
```
**C2 · 云端放行端口**：云服务商安全组/防火墙放行 7260 入站（TCP）——只给需要的来源 IP 更好
**C3 · 云端发钥匙**（同 S2）：`crosschat serve --gen-key 1`，**核对打印的自动探测地址**——云端多网卡时探测值可能取内网 IP，家里机要用的是**公网 IP**，以人工核对为准
**C4 · 家里机的 node.json：host 写云端公网 IP**
```
> cat ~/.crosschat/tcp/node.json
{
  "broker": { "host": "<云端公网IP>", "port": 7260, "alias": "cloud" },
  "key": "…",
  "name": "home-win"
}
```
**C5 · 连接与验证**：`crosschat serve --connect cloud` → `online（broker cloud）`；`crosschat status` 出现"转发器: broker 可达…"即全链通。云端发到家里机照 S5 反向操作（家里机的 mid8 从 `--list` 或 roster 查）。

### 形态三 · 单向下达（CI/脚本机零进程直发）

CI 机不需要跑任何常驻进程、不需要 agent 会话——装好 crosschat、放一份 node.json，`send` 瞬态连接发完即走。真机实录（2026-10-11，发送腿冒烟）：

```
> crosschat send --via tcp:ec542c2c --to beta12 --body "B2.1 自环验证"
delivered to beta12@ec542c2c (turn 7)
reply-ref: mc2_BPXvvaoBZUeagLVplzA4leUBoRbla6N3A48OwoC8hZFdCKgNWGngDu5eBw
```
- 目标机（broker 机或任一在线节点）上有会话即可收；CI 机自身只当发送方
- 回信需要 CI 机有会话接——纯单向场景无所谓；要回信就给 CI 机一个 claude/codex 会话

### 文件通道（--file）

`--file <路径>` 只能与 `--via tcp:` 同用，语义：

- **sha256 锚**：发送前算摘要；对端收齐校验不过则清残片要求整档重传（重跑同一命令即可）
- **断点续传**：每 256KiB 一块落盘，中断后重跑同一命令从断点续传（对端保留锚点）
- **去重秒回**：对端 inbox 已有同 sha 文件时直接回路径，不重传
- **懒删除回收**：inbox 文件落盘 >5 天删；inbox 总量 >512MiB 从最旧删起；parts 残片同 5 天规则——**附件过期就没了：收到"文件 … 已送达"但路径不存在（>5 天），回对端"附件已过期，请重发 --file"**
- **单文件上限 64MiB**（发送侧读文件与 broker 预拒同额）；超限报 `FILE_TOO_LARGE`，请压缩或分段
- 手动清理：`crosschat clean`（懒删除规则）/ `crosschat clean --force`（全清，跳过确认）——**unix 下建议无传输时执行**（写入中的文件可能被删）

### 协议规范（proto:1，草案期——稳定后对第三方实现承诺兼容）

- **传输**：WebSocket 文本消息，一帧一条 JSON（`maxPayload` 2MiB）；文件分块 `bytes` 为 base64
- **握手**：连接建立服务端即发 `info` → 客户端回 `connect`（带钥匙鉴权）→ 服务端回 `connected`；10s 未握手关闭（4000），协议版本不符 `BAD_PROTO`（4000），钥匙不符 `BAD_AUTH`（恒定延迟 500ms 后 4001）
- **心跳**：服务端每 30s ping，60s 无 pong 判死断开
- **寻址**：hex 目标 = machine-id 前缀（最短无歧义解析，0 命中 `UNKNOWN_MACHINE`，多命中 `MACHINE_NAME_COLLISION` 列 mid 前 12 位教加长）；非 hex = 注册名/label；命中 broker 本机（machineId 相同）走本机投递
- **帧表**（14 型；`?`=可缺省）：

| 帧 | 方向 | 字段 |
|---|---|---|
| `info` | S→C | proto, server, caps |
| `connect` | C→S | proto, role(node/sender), machineId?, auth, name?（≤32 字符显示名，B2.1） |
| `connected` | S→C | machineName? |
| `error` | 双向 | code, message, id? |
| `send` | C→S | id, targetMachine, to?, conversation?, body, origin? |
| `receipt` | S→C | id, status(delivered/queued/parked), turn?, replyRef?, output? |
| `deliver` | S→C | id, fromMachine, payload, to?, conversation?, origin? |
| `result` | C→S | id, status(delivered/queued/parked/error), turn?, replyRef?, code?, message?, output? |
| `file-begin` | C→S | id, targetMachine, sha256, name, size |
| `file-chunk` | C→S | id, seq, bytes(base64) |
| `file-end` | C→S | id |
| `file-result` | S→C | id, ok, path?, error?, resumeFrom?, dedup? |
| `roster` | C→S | （空，B2.1） |
| `roster-result` | S→C | machines:[{name?, mid8, online}]（B2.1） |

- **错误码**：`BAD_AUTH`（钥匙不匹配）/ `BAD_PROTO`（版本不符）/ `UNKNOWN_MACHINE`（目标没注册）/ `PEER_OFFLINE`（注册了但不在线）/ `MACHINE_NAME_COLLISION`（同名/前缀歧义，报错带 mid 消歧）/ `NOT_READY`（broker 侧处理器未接线）/ `FILE_TOO_LARGE`（>64MiB 预拒）；客户端侧另有 `TCP_TRANSPORT_FAILED`（连不上/超时，远端状态不明勿盲重发）与 `FILE_TRANSFER_FAILED`（落盘失败）
- **超时**：发送方等回执默认 120s（`CROSSCHAT_TCP_TIMEOUT_MS` 可调）
- **第三方实现者注意**：参考实现是**单 broker 星型**——多实例集群需自行解决实例间路由（哪台节点连在哪个实例）与注册表共享，本实现不含

### 排障对照

| 症状 | 根因 | 解法 |
|---|---|---|
| `TCP_TRANSPORT_FAILED 无法连上 broker` | node.json 地址错 / serve 没跑 / 防火墙 | 核对 node.json 的 host:port；A 机 `crosschat serve` 起没起；win 防火墙放行 |
| `TCP_TRANSPORT_FAILED … 远端状态不明` | 发送后超时/断线 | **勿盲目重发**（可能与首次投递叠加）——先在对端查 send-log 或 `status --conversations` |
| `PEER_OFFLINE 机器 X 已注册但当前不在线` | 对端节点没连 | 对端 `crosschat serve --connect`；稍后重试；若两端另配了 ssh 也可走 ssh 形态 |
| `UNKNOWN_MACHINE 注册表没有…` | 目标名/mid 没登记或抄错 | broker 机 `crosschat serve --list` 查 mid8 与名字 |
| `MACHINE_NAME_COLLISION` | 同名机器或 mid 前缀太短 | 报错里列了 mid——改用（更长的）mid 前缀寻址 |
| 收到"文件…已送达"但路径不存在 | 附件 >5 天被懒删除回收 | 回对端"附件已过期，请重发 --file" |
| serve 启动即退、报错含 `EADDRINUSE` | 7260 被占（多半是旧实例） | `crosschat serve --stop` 再起；或 `--port` 换端口（会记住） |

### 清理与卸载

```
> crosschat clean [--force]     # 清 inbox/parts：默认懒删除规则；--force 全清（跳过确认，含未读）
> crosschat uninstall [--yes]   # 删 ~/.crosschat + 状态目录 + 双侧 skill；serve 在跑会拒删（先 --stop）；结尾 npm uninstall -g @oatelauser/crosschat 收尾
```
