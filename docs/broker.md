# 转发器手册（tcp broker · proto:1）

> 本文是 [README · 通信方式](../README.md#-通信方式) 表中"跨机联邦 · tcp"的完整手册。

一句话：跨机 tcp = 选一台机器跑 `crosschat serve`（broker），其余机器各贴一份钥匙——之后 `--via tcp:<机器>` 跨机互发，**发送零进程，接收方保持节点客户端在线**。用法与 [ssh 联邦](federation.md)同构，回复照抄信封里的命令即可。

```bash
crosschat send --via tcp:host-b --to worker2 --body "跑一次构建，产物清单发回来"
# → delivered to worker2@host-b (turn 1)
```

### 怎么用这篇手册

| 你这台机是… | 做哪节 |
|---|---|
| broker 机（选出来的中心） | 只做 **1.2**。**跳过 1.3——serve 启动即已可收可发，不需要 --connect** |
| node 机（其余机器） | 1.3 |
| CI 机（只发不收） | 1.3 只贴钥匙，不跑 --connect |

- 部署（1.1–1.4）→ 日常聊天（第二章，一句话题词）→ 原理（第三章，折叠）→ 协议对接（第四章，折叠）
- 命令块：`>` = 敲的，其余 = 期望输出，`#` = 备注；Linux 写法，win 等价（`nano`→`notepad`）
- 端口默认 **7260**；钥匙 = 一份 `node.json`，唯一入网凭证

---

## 一、环境搭建

### 1.1 选谁当 broker

选**最常开机、最可达**的一台——它挂了跨机就瘫：

- 局域网 → 最常开机的那台
- 跨公网 → 云端/堡垒机（唯一公网入口；安全组放行端口入站。明文风险已拍板接受，TLS 挂账中）
- win + WSL 同物理机 → 算两台机，选常开侧
- 已有 ssh 联邦 → 机器 ≥3 台或要文件通道时才值得切 tcp

### 1.2 broker 机（两条命令，完）

起服务——本机自动登记为首个成员，**即刻可收可发**：

```
> crosschat serve
已自动生成本机 node.json（/root/.crosschat/tcp/node.json，host=127.0.0.1——本机 send --via tcp: 凭证）
broker listening on 0.0.0.0:7260（Ctrl+C 退出）
# 后台常驻：crosschat serve --detach（输出 pid 与端口，日志 ~/.crosschat/tcp/broker.log）
# 换端口：crosschat serve --port 7777（给一次即记住）
```

发钥匙——打印的 JSON 交给对应机器（打印自带核对规则与提示，照做即可）：

```
> crosschat serve --gen-key 2
自动探测 broker 地址：192.168.1.10:7260（多网卡/NAT 常探错——按下述规则人工核对改写 node.json 的 host 与 port）：
  · broker 机自身 → 无需分发（首次 serve 已自动写好 127.0.0.1 的自用 node.json）
  · broker 是云主机/NAT 内网机 → host 填对外公网 IP（探测常拿内网 IP，必核对）
  · 普通局域网 → broker 机的局域网 IP；broker 用非默认端口时 port 一并改
分发前把每份 node.json 的 name 改成「贴这份配置的机器」的自报名字（建议=其 hostname；纯显示用——roster 怎么称呼它，寻址/回信不依赖，走 machine-id 前缀）
--------------------------------
{
  "brokers": [
    {
      "host": "192.168.1.10",
      "port": 7260,
      "alias": "yang",
      "starId": "a1b2c3d4e5f6",
      "key": "a3f0…64位hex…"
    }
  ],
  "name": "改成「贴这份配置的机器」的名字"
}
--------------------------------
{ …第二份同构… }
放置路径（目标机器）：~/.crosschat/tcp/node.json（win 写法 C:\Users\<用户>\.crosschat\tcp\node.json）
多星：一台机入多个 broker 时，把各星钥匙的条目合并进同一份 brokers 数组即可；本配置为数组形状，目标机 crosschat 需 ≥1.5.2
本命令须在 broker 机上执行（钥匙登记进本机 broker.json）；broker 机自己的 node.json 已由首次 serve 自动写好，勿用上面的钥匙覆盖
钥匙已进入终端回滚缓冲，分发完建议清屏
```

### 1.3 node 机（贴钥匙 + 上线）

把一份钥匙存成 `~/.crosschat/tcp/node.json`，改 host（按打印的规则）和 name（本机名）。本机也要装 crosschat：

```
> mkdir -p ~/.crosschat/tcp && nano ~/.crosschat/tcp/node.json
# 粘贴整段 JSON，改 host 与 name，保存
> cat ~/.crosschat/tcp/node.json
{
  "brokers": [
    { "host": "192.168.1.10", "port": 7260, "alias": "yang", "starId": "a1b2…", "key": "a3f0…" }
  ],
  "name": "host-b"
}
```

字段一句话：条目里的 `key`=钥匙（不用改）、`alias`=broker 机显示名（不用改）；`name`=本机自报名（roster 里怎么称呼你，寻址走 mid8 与它无关）。

上线（断线自动重连永不放弃）：

```
> crosschat serve --connect --detach
节点客户端后台运行中 pid=8412（日志：/home/me/.crosschat/tcp/node.log）
```

> 记住一条：**收件靠这条常驻连接，断了=别人发你 PEER_OFFLINE；发送零进程**。broker 机两端都不需要——它的收发在 serve 进程里。

**入第二颗星（可选）**。gen-key 打印的就是数组形状——把新星的条目**追加进同一份 `brokers` 数组**即可（旧单星形状文件永远兼容，连一次自动补 starId）：

```
> cat ~/.crosschat/tcp/node.json
{
  "brokers": [
    { "host": "118.196.47.9", "port": 7777, "alias": "cloud", "starId": "a1b2c3d4e5f6", "key": "…" },
    { "host": "192.168.1.10", "port": 7260,  "alias": "home",  "starId": "9f8e7d6c0123", "key": "…" }
  ],
  "name": "yang"
}
```

收几颗星跑几个守护（按别名选，starId 前缀消歧）；发送多星机发起新会话加限定词 `--via tcp:cloud:<机器>`——**回信/续发零感知**，会话引用自带星标识、CLI 自动选星，agent 照抄命令不变：

```
> crosschat serve --connect cloud --detach     # 挂 cloud 星收件
> crosschat serve --connect home --detach      # 挂 home 星收件
> crosschat serve --stop cloud                 # 只停 cloud；无参=全停（先守护后 broker）
```

### 1.4 验证（三眼，不对回 1.2/1.3 排）

```
> crosschat status                      # 节点机上跑：节点客户端行=本机守护，broker 行=可达性
节点客户端: online tcp:yang (since 10-11 10:30)
broker: 可达，2 机器在线
在线机器: yang (ec542c2c)、host-b (9f8e7d6c)

> crosschat serve --list                # broker 机上跑：注册表全貌，mid8 是寻址权威
label     name              mid8      added-at
self      yang              ec542c2c  2026-10-11T02:12:00.059Z
node-1    host-b            9f8e7d6c  2026-10-11T02:31:10.402Z

> crosschat send --via tcp:host-b --to worker2 --body "联调测试"   # 真发一条，最终裁决
delivered to worker2@9f8e7d6c (turn 1)
```

---

## 二、跨机 tcp 聊天

部署完（第一章），日常就剩一件事：像单机一样给 agent 一句话。命令、协议、回程路由全部由信封自带——**你不需要记任何命令**。

### 2.1 会话实录（一句话触发）

准备：两端各有已命名的 agent 会话（终端跑 `crosschat claude`，进去 `/rename <名字>`，随便发一条激活；codex 会话同理）。然后整个过程（图例：**👤 用户** 你说的指令 · **🤖 agent** 回复/收件 📨）：

```
👤 用户[boss -> worker2]  用 crosschat（先 status 确认名字）给 host-b 机器的 claude 会话「worker2」发消息：
                          要求走 tcp 转发器（send 时加 --via tcp:host-b），让它跑一次构建并回报结果。
🤖 worker2 收到            📨 来自另一会话的消息:
                          <cross-session-message from-name="boss" turn="1">
                          …跑一次构建并回报结果…
                          回复请运行: crosschat send --conversation mc2_… --body "<你的回复>"
🤖 worker2[worker2 -> boss] 构建完成，产物清单见下一条
🤖 boss 收到               📨 构建完成，产物清单见下一条（turn 2，自动经 broker 跨机回到 A 机）
```

与 ssh 跨机的全部差别：题词里的 `--via tcp:host-b`。回程路条由信封自动携带（`--via tcp:<发送方 mid8>`），worker2 零配置照抄即回。

### 2.2 文件通道（--file）

消息里塞大内容不如直接送文件。`--file` 只能与 `--via tcp:` 同用，一句话题词形态：

> 用 crosschat 把 ./report.md 用文件通道发给 host-b 的 worker2（send 时加 --via tcp:host-b --file ./report.md），正文让它分析这个文件。

对端收到的正文是自动生成的：`文件 report.md 已送达：/home/<B用户>/.crosschat/tcp/inbox/3f2a1b9c-report.md`——路径在**对端机器上**，agent 直接可读。语义五条：

- **sha256 锚**：发送前算摘要；对端收齐校验不过则清残片要求整档重传（重跑同一命令即可）
- **断点续传**：每 256KiB 一块落盘，中断后重跑同一命令从断点续传（对端保留锚点）
- **去重秒回**：对端 inbox 已有同 sha 文件时直接回路径，不重传
- **懒删除回收**：inbox 文件 >5 天删；总量 >512MiB 从最旧删起——**附件过期就没了**：收到"已送达"但路径不存在（>5 天），回对端"附件已过期，请重发 --file"
- **单文件上限 64MiB**；超限报 `FILE_TOO_LARGE`，请压缩或分段

---

## 三、底层实现

<details><summary>展开：内部调用链 / 手动命令实录 / mid8 寻址 / 自登记 / 单星边界（点击）</summary>

这一章回答"它到底怎么跑通的"。排障深挖、或想理解设计取舍时读。

### 3.1 一条消息的内部调用链

**发送腿（瞬态，发完即走）**：

```
crosschat send --via tcp:host-b --to worker2 --body "…"
  → 读 ~/.crosschat/tcp/node.json（broker 地址 + 钥匙）
  → WebSocket 连 broker → 握手（info/connect/connected，见第四章）
  → 发 send 帧 → 等 receipt 帧（默认 120s，CROSSCHAT_TCP_TIMEOUT_MS 可调）
  → 打印 delivered/queued/parked → 断开
```

**中转腿（broker 常驻）**：收到 send 帧 → 解析 targetMachine（3.2 寻址算法）→ 目标是本机则直接本机投递；否则找到目标节点的常驻连接，转发 deliver 帧，等该节点回 result（超时按 PEER_OFFLINE 报），再映射成 receipt 回发送方。

**接收腿（节点客户端常驻）**：收 deliver 帧 → 在**本机**执行投递（与单机 `crosschat send` 同一套：找到目标会话，注入消息；对方忙则入本机发件箱、看门狗自动重投）→ 回 result 帧（delivered/queued/parked + turn + replyRef）。

### 3.2 mid8 寻址（双轨）

- **寻址权威 = machine-id 前缀（mid8）**：machine-id 是每台机器安装时生成的稳定指纹。`--via tcp:9f8e` 按**最短无歧义前缀**解析（git 短哈希式）——0 命中报 `UNKNOWN_MACHINE`；多命中报 `MACHINE_NAME_COLLISION` 并列出双方 mid 前 12 位，加长即消歧（注册时若两机 mid 前 8 位碰撞，broker 日志会预警"需 ≥9 位"）
- **名字 = 人读显示**：`--via tcp:host-b` 也行（非 hex 按注册名/label 解析），但对端改名/两机撞名时名字失效，mid8 永远找得到人——信封回程路条因此永远盖 mid8
- 命中 broker 自己（machineId 相同）→ 走本机投递，不过网络

### 3.3 broker 机自登记（为什么 serve 会自动写 node.json）

首次 `crosschat serve` 干两件事：把自己登记进 broker.json（`label: "self"`，带 machineId + 专属钥匙）——其他机器立刻可寻址它、发给它的消息走本机直投不过网络；若 `~/.crosschat/tcp/node.json` 不存在则写一份 host=127.0.0.1 的自用凭证（本机 `send --via tcp:` 时连回自己鉴权）。存在则**跳过不覆盖**并按状态出声：指向别家（提示本机发送将走它）/ 钥匙或端口陈旧（BAD_AUTH 预警，删文件重启重建）/ 一致（静默）。

> 设计取舍：broker 只认钥匙不认人（连 127.0.0.1 来的也要刷卡——"本机免检"等于给同机所有进程开后门）；`send` 是无状态 CLI 每次都是新进程，只认 node.json。所有机器（节点/CI/broker 机）的发送走**同一条代码路径**，不分情况——这是协议教学能内建的前提。

### 3.4 手动命令实录（agent 视角之外，人肉操作时用）

A 机发起：
```
> crosschat send --via tcp:9f8e7d6c --to worker2 --body "跑一次构建，产物清单发回来"
delivered to worker2@9f8e7d6c (turn 1)
reply-ref: mc2_BPXvvaoBZUeagLVplzA4leUBoRbla6N3A48OwoC8hZFdCKgNWGngDu5eCA
```
B 机会话里自动出现信封（无需任何题词）：
```
📨 来自另一会话的消息:
<cross-session-message from-name="boss" turn="1">
<crosschat-reply-hint reply-as="worker2">回复请运行: crosschat send --conversation mc2_… --body "<你的回复>"</crosschat-reply-hint>
…
跑一次构建，产物清单发回来
</cross-session-message>
```
B 机照抄整条命令、只换 `<你的回复>`（不截断不改写），回信自动经 broker 回到 A 机：
```
> crosschat send --via tcp:ec542c2c --conversation mc2_… --body "构建完成，清单见下一条"
delivered to boss@ec542c2c (turn 2)
```

### 3.5 多星成员（原单星边界，已解除）

早期"一台机一份 node.json = 一个星"的边界已解除：node.json 数组形状多条目、会话引用尾部携带星标识（mc2_ flags bit 10）、发送按**限定器 → 引用星 → 单条目 → 教学**四序本地选星——无缓存文件、无网络探测，O(1)。信封格式与 skill 教学零改动（回信照抄即路由）；旧版解析器遇新引用走"升级后重试"教学（ref 模块设计好的偏差路径）。收件守护仍按星常驻（一星一条）——会话级懒接收需 broker 存储转发，仍挂账。星外机器也仍可走 [ssh 联邦](federation.md)（两通道正交并存）。

</details>

---

## 四、协议 proto:1（对接实现指南）

> 草案期——稳定后对第三方实现承诺兼容。

<details><summary>展开：握手时序 / 14 帧示例 / 完整帧流 / 错误矩阵 / 文件状态机 / 最小客户端（点击）</summary>

这一章写给要在自己的语言/运行时里实现兼容端的人（自建 broker、写个轻量发送器都算）。全部字段以帧表为准，示例值是占位样式。

### 4.1 传输与握手

- **传输**：WebSocket 文本消息，一帧一条 JSON（服务端 `maxPayload` 2MiB）；文件分块的 `bytes` 为 base64
- **握手三帧**（连接建立即开始，10s 未完成握手服务端关闭，close code 4000）：

```
S → C   {"op":"info","proto":1,"server":"crosschat/1.5.1","caps":[],"starId":"a1b2c3d4e5f6"}
C → S   {"op":"connect","proto":1,"role":"node","machineId":"<全 mid，64位hex>","auth":"<64位hex钥匙>","name":"host-b"}
S → C   {"op":"connected","machineName":"yang"}
```

- `starId`：broker 的星标识（broker.json 顶层 12 hex，首次 serve 生成）——节点客户端在**发 connect（钥匙）之前**比对：与本机条目不符即断连（`STAR_ID_MISMATCH`，钥匙不出手）；条目缺 starId 则放行并自动回填
- `role`：`node`（常驻收件，必须带 machineId，首次连接时把 mid 绑定到该钥匙；重连改名即覆盖显示名）或 `sender`（瞬态发送，只要 auth）
- 钥匙不在注册表 / node 的 machineId 与登记不符 → 恒定延迟 500ms 后 `BAD_AUTH`（close 4001）——延迟是防钥匙枚举计时
- 协议版本不符 → `BAD_PROTO`（close 4000）
- 同一 mid 的新连接会顶掉旧连接（旧连接被 close 1000 "replaced"）

- **心跳**：服务端每 30s 发 ws ping，60s 无 pong 判死断开——客户端用标准 ws 库回 pong 即可，无需应用层帧

### 4.2 帧表（14 型；`?`=可缺省）

| 帧 | 方向 | 字段 |
|---|---|---|
| `info` | S→C | proto, server, caps, starId? |
| `connect` | C→S | proto, role(node/sender), machineId?, auth, name?（≤32 字符显示名） |
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
| `roster` | C→S | （空） |
| `roster-result` | S→C | machines:[{name?, mid8, online}] |

每帧示例（占位值）：

```json
{"op":"send","id":"a1b2c3","targetMachine":"9f8e7d6c","to":"worker2","body":"跑一次构建","origin":"claude/boss@yang"}
{"op":"receipt","id":"a1b2c3","status":"delivered","turn":"1","replyRef":"mc2_…"}
{"op":"deliver","id":"a1b2c3","fromMachine":"yang","payload":"跑一次构建","to":"worker2","origin":"claude/boss@yang"}
{"op":"result","id":"a1b2c3","status":"delivered","turn":"1","replyRef":"mc2_…"}
{"op":"error","code":"PEER_OFFLINE","message":"机器 host-b 已注册但当前不在线","id":"a1b2c3"}
{"op":"roster-result","machines":[{"name":"yang","mid8":"ec542c2c","online":true},{"name":"host-b","mid8":"9f8e7d6c","online":false}]}
```

### 4.3 一条消息的完整帧流（两台客户端视角）

**发送方**（瞬态 sender，发完断开）：

```
ws 连接 tcp://<broker>:7260
S → info / C → connect(role:sender) / S → connected        # 握手（4.1）
C → send{id:"a1b2c3", targetMachine:"9f8e7d6c", to:"worker2", body:"…"}
S → receipt{id:"a1b2c3", status:"delivered", turn:"1", replyRef:"mc2_…"}
连接关闭
```

**接收方节点客户端**（常驻 node，同一时刻被动收到）：

```
S → deliver{id:"a1b2c3", fromMachine:"yang", payload:"…", to:"worker2"}
C → result{id:"a1b2c3", status:"delivered", turn:"1", replyRef:"mc2_…"}
# 目标会话忙 → status:"parked"（节点本机发件箱接管，看门狗重投，不影响发送方已收到的回执）
# 节点侧结构化失败 → status:"error" + code/message → broker 映射成发送方 error 帧
```

### 4.4 错误应对矩阵

| 错误码 | 何时发生 | 客户端应对 |
|---|---|---|
| `BAD_AUTH` | 钥匙不在注册表 / node 的 mid 与登记不符 | 核对 node.json 的 key；别重试（恒定延迟防枚举，重试无意义） |
| `STAR_ID_MISMATCH` | info 的 starId 与本机条目不符（配置陈旧/贴错星） | 向管理员重新索取 node.json；守护遇此错永久停机不重试 |
| `BAD_PROTO` | connect 的 proto ≠ 1 | 对齐协议版本再连 |
| `UNKNOWN_MACHINE` | targetMachine 解析 0 命中 | 名字/mid 抄错或没登记——broker 机 `--list` 核对 |
| `MACHINE_NAME_COLLISION` | 同名机器或 mid 前缀多命中 | 报错里带了双方 mid——改用更长的 mid 前缀 |
| `PEER_OFFLINE` | 目标注册了但不在线；**或**节点在 result 超时内没回应 | 前者：对端把 `--connect` 拉起；后者：**勿盲目重发**（首次投递可能已在途），先在对端查 send-log |
| `NOT_READY` | broker 本机投递器未接线（版本过旧） | 升级 broker 机 crosschat |
| `FILE_TOO_LARGE` | file-begin 的 size > 64MiB（broker 预拒） | 压缩或分段 |
| `TCP_TRANSPORT_FAILED` | 客户端侧：连不上 broker / 等回执超时断线 | 核对 node.json host:port、防火墙；超时型**勿盲目重发** |
| `FILE_TRANSFER_FAILED` | 客户端侧：文件落盘失败 | 查磁盘/权限，重跑 |

### 4.5 文件通道状态机

```
C → file-begin{id, targetMachine, sha256, name, size}
     ├─ size > 64MiB            → S: error FILE_TOO_LARGE
     ├─ 对端已有同 sha 完整文件  → S: file-result{ok:true, dedup:true, path}
     ├─ 对端有断点锚（上次没收完）→ S: file-result{ok:true, resumeFrom:<nextSeq>}
     └─ 全新                     → S: file-result{ok:true, resumeFrom:0}
C → file-chunk{id, seq, bytes(base64, 256KiB/块)}   # seq 从 resumeFrom 起，必须连续递增
C → file-chunk{…} …
C → file-end{id}
     └─ sha 校验过 → S: file-result{ok:true, path:"…/inbox/<sha前8位>-<name>"}
        校验不过 → 清残片，发方整档重来（重跑同一命令）
```

中断续传 = 重新跑一遍 begin→chunk→end，从对端给的 `resumeFrom` 续发；分块失序或未知 id → `file-result{ok:false, error:"分块失序或未知 id——请重新 begin 续传"}`。

### 4.6 最小第三方客户端（纯发送器，5 步）

1. WebSocket 文本连接 `ws://<broker>:7260`，单帧 ≤2MiB
2. 等 `info`（校验 proto=1）→ 回 `connect{proto:1, role:"sender", auth:"<钥匙>"}`
3. 等 `connected`（收到 `error` 按矩阵应对）
4. 发 `send{id:<自造唯一id>, targetMachine, to, body}` → 等同 id 的 `receipt`（或 `error`）
5. 拿到回执即关闭连接

注意：ws 层 ping/pong 由所用 ws 库自动应答；id 只要在单连接内唯一即可。要收消息就实现 node 角色（常驻 + 处理 `deliver` 回 `result`）+ 心跳。

### 4.7 第三方实现者注意

参考实现是**单 broker 星型**——多实例集群需自行解决实例间路由（哪台节点连在哪个实例）与注册表共享，本实现不含（一台机器入多颗星由节点侧承担，见 3.5）。注册表格式见 broker 机 `~/.crosschat/tcp/broker.json`（顶层 starId/port；nodes[] 内 label/key/machineId/machineName/addedAt）。节点侧 node.json 双形状：`{broker:{host,port,alias,starId?},key,name}`（单星）或 `{brokers:[{host,port,alias,starId?,key}…],name}`（多星）。会话引用 mc2_ 可在尾部携带 starId（flags bit 10）——旧版解析器遇此扩展走 `INVALID_CONVERSATION_REF`+升级指引，属设计好的版本偏差路径。

</details>

---

## 排障对照

| 症状 | 根因 | 解法 |
|---|---|---|
| `TCP_TRANSPORT_FAILED 无法连上 broker` | node.json 地址错 / serve 没跑 / 防火墙 | 核对 node.json 的 host:port；broker 机 `crosschat serve` 起没起；云机查安全组放行 |
| `TCP_TRANSPORT_FAILED … 远端状态不明` | 发送后超时/断线 | **勿盲目重发**（可能与首次投递叠加）——先在对端查 send-log 或 `status --conversations` |
| `PEER_OFFLINE 机器 X 已注册但当前不在线` | 对端节点没连 | 对端 `crosschat serve --connect`；稍后重试；若两端另配了 ssh 也可走 ssh 形态 |
| `UNKNOWN_MACHINE 注册表没有…` | 目标名/mid 没登记或抄错 | broker 机 `crosschat serve --list` 查 mid8 与名字 |
| `MACHINE_NAME_COLLISION` | 同名机器或 mid 前缀太短 | 报错里列了 mid——改用（更长的）mid 前缀寻址 |
| status `节点客户端: 未运行` | 本机节点客户端没起（收不到消息的原因） | `crosschat serve --connect --detach` |
| `STAR_ID_MISMATCH 星标识不符已停机` | node.json 条目与 broker 现星标识不符（贴错星/配置陈旧） | 向管理员重新索取 node.json，重启 --connect |
| 多星机裸写 `--via tcp:<机器>` 报"列条目"教学 | 多条目且无会话引用可循 | 加限定词 `--via tcp:<别名>:<机器>`；回信不受影响（引用自动带星） |
| status 第二行 broker 不可达 | node.json host/port 错 / 防火墙 / broker 没跑 | 按 1.2/1.3 核对；云机安全组 |
| 收到"文件…已送达"但路径不存在 | 附件 >5 天被懒删除回收 | 回对端"附件已过期，请重发 --file" |
| serve 启动即退、报错含 `EADDRINUSE` | 端口被占（多半是旧实例） | `crosschat serve --stop` 再起；或 `--port` 换端口（会记住） |

## 清理与卸载

```
> crosschat serve --stop            # 停本机常驻（broker 或节点客户端，三重身份校验安全停止）
> crosschat clean [--force]         # 清 inbox/parts：默认懒删除规则；--force 全清（跳过确认，含未读）
> crosschat uninstall [--yes]       # 删 ~/.crosschat + 状态目录 + 双侧 skill；serve 在跑会拒删（先 --stop）
                                     # 结尾 npm uninstall -g @oatelauser/crosschat 收尾
```
