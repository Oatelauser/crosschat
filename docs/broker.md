# 跨机通信：tcp

> 本文是 [README · 通信方式](../README.md#-通信方式) 表中"跨机联邦 · tcp"的完整手册。

一句话，三层概念——每层一条命令：

| 概念 | 谁来做 | 命令 |
|---|---|---|
| **启动星** | broker 机（一次） | `crosschat serve --detach` |
| **机器连星** | 每台机器（一次） | `crosschat serve --connect <星> --detach`（1.6.0 起兼任聚合器） |
| **会话入星** | 每个要被跨机直达的会话 | `crosschat claude -n <名> --connect <星>` |

星起来、机器连上、会话入星之后，星内任何人按三段地址直达该会话（免 `--to`）：

```bash
crosschat send --via tcp:<星>:<机器>:<会话> --body "跑一次构建，产物清单发回来"
# → delivered to worker2@host-b(9f8e7d6c) (turn 1) · 续话 c1
```

### 新旧差异（1.6.0 起）

| 场景 | 旧（两段式，已废弃） | 新（proto:3 三段） |
|---|---|---|
| 给对端机器上的会话发消息 | `--via tcp:<机器> --to <名>`——名字由对端机解析，投给任何同名活会话 | `--via tcp:<星>:<机器>:<会话>`——直达入星会话；非成员名报错指路 |
| 会话怎么可被跨机找到 | 不用做事（裸起的会话照收） | 启动器入星：`crosschat claude -n <名> --connect <星>` |
| 旧会话退休、名字还要能找到 | 做不到（名字死了投递就断） | 换轨接任：`--extend-session <旧名>`，投旧名自动指路到接任者 |
| 会话活着但丢了星籍 | 重投碰运气 | 收编：`crosschat serve --connect <星> --adopt <名>` |
| 机器级操作（查远机会话、发文件） | `status --via tcp:<机器>` / `--file` | **不变**（不受影响） |

### 怎么用这篇手册

| 你这台机是… | 做哪节 |
|---|---|
| broker 机（星心） | 只做 **1.2**。机器级收发 serve 启动即有；要跑入星会话时 1.3 的"启动会话"照用（聚合器自动拉起，无需手动） |
| node 机（其余机器） | 1.3 全做 |
| CI 机（只发不收） | 1.3 只贴钥匙，不跑 --connect |

- 部署（一）→ 日常使用（二，含全链验证阶梯）→ 底层实现（三，折叠）→ 协议参考（四，折叠）→ 排障（永不折叠）
- **验证一律编号步骤**：每步"命令 → 期望输出"成对，顺序执行、照抄可跑
- 命令块：`>` = 敲的，其余 = 期望输出，`#` = 备注；Linux 写法，win 等价（`nano`→`notepad`）
- 端口默认 **7260**；钥匙 = 一份 `node.json`，唯一入网凭证；`<XX>` = 占位符

---

## 一、环境搭建

### 1.1 broker 当选规则

选一台当星心（broker）——它挂了跨机就瘫。三条标准：**常驻**（最常开机）、**可达**（其余机器连得到它）、**端口可开**（能放行一个入站端口）。对号入座：

- 局域网 → 最常开机、能被各机直连的那台
- 跨公网 → 云端/堡垒机（唯一公网入口；安全组放行端口入站。明文风险已拍板接受，TLS 挂账中）
- win + WSL 同物理机 → 算两台机，选常开侧；**win 连 WSL broker 的 host 用 127.0.0.1**（WSL 镜像网络下它报的 LAN IP 从 win 不可达，实测）
- 已有 ssh 联邦 → 机器 ≥3 台或要文件通道时才值得切 tcp

### 1.2 broker 节点

#### 1.2.1 启动 broker 服务

两种形态——后台常驻为主，前台调试为辅：

```
> crosschat serve --detach
broker 后台运行中 pid=12345 端口 7260（日志：/root/.crosschat/tcp/broker.log）

# 前台形态（看得见实时日志，Ctrl+C 退出）：
> crosschat serve
已自动生成本机 node.json（/root/.crosschat/tcp/node.json，host=127.0.0.1——本机 send --via tcp: 凭证）
broker listening on 0.0.0.0:7260（Ctrl+C 退出）
# 换端口：crosschat serve --port 7777（给一次即记住）
# 起星名：crosschat serve --name cloud（给一次即记住；缺省取本机 hostname）
```

首次 serve 自动做两件事：把自己登记为星内首个成员（机器级即刻可收可发）；写好本机自用 `~/.crosschat/tcp/node.json`（host=127.0.0.1，本机发送的凭证）。

**验证**（两条都过 = 星已就绪）：

1. `crosschat serve --list`
   → 期望：注册表列出 `self` 行（本机已是星内首成员）：
   ```
   label     name              mid8      added-at
   self      yang              ec542c2c  2026-10-11T02:12:00.059Z
   ```
2. `ss -tln | grep 7260`
   → 期望：`LISTEN 0 128 0.0.0.0:7260 …`（端口在听；换了端口 grep 自己的）

#### 1.2.2 生成连接密钥

一台 node 机一份钥匙；`--gen-key N` 一次打 N 份，打印的整段 JSON 交给对应机器：

```
> crosschat serve --gen-key 2
自动探测 broker 地址：192.168.1.10:7260（多网卡/NAT 常探错——按下述规则人工核对改写 node.json 的 host 与 port）：
  · broker 机自身 → 无需分发（首次 serve 已自动写好 127.0.0.1 的自用 node.json）
  · broker 是云主机/NAT 内网机 → host 填对外公网 IP（探测常拿内网 IP，必核对）
  · 普通局域网 → broker 机的局域网 IP；broker 用非默认端口时 port 一并改
分发前把每份 node.json 的 showName 改成「贴这份配置的机器」的自报名字（建议=其 hostname；纯显示用——寻址走 machine-id 前缀，不依赖它；改名=改 showName 后重启常驻——节点机重启节点客户端、broker 机重启 serve）
--------------------------------
{
  "brokers": [
    {
      "host": "192.168.1.10",
      "port": 7260,
      "name": "yang",
      "starId": "a1b2c3d4e5f6",
      "key": "a3f0…64位hex…"
    }
  ],
  "showName": "改成「贴这份配置的机器」的名字"
}
--------------------------------
{ …第二份同构… }
放置路径（目标机器）：~/.crosschat/tcp/node.json（win 写法 C:\Users\<用户>\.crosschat\tcp\node.json）
多星：一台机入多个 broker 时，把各星钥匙的条目合并进同一份 brokers 数组即可
本命令须在 broker 机上执行（钥匙登记进本机 broker.json）；broker 机自用的 node.json 已由首次 serve 写好，勿用钥匙覆盖
钥匙已进入终端回滚缓冲，分发完建议清屏
```

输出怎么读，四条：

1. **探测行**：打印的 host 只是探测值——云主机/NAT 必改**对外公网 IP**，局域网核对 LAN IP（探测常错，人工核对是规则不是建议）
2. **JSON 体**：`key`（该机钥匙）、`name`（星名）、`starId`（星标识）三个字段**照抄不改**；只有 `host`/`port` 按探测行规则改
3. **showName**：改成"贴这份配置的机器"的名字（建议=其 hostname）——纯显示用，寻址不依赖；这是 roster 怎么称呼它的唯一来源
4. **安全**：钥匙进过终端回滚缓冲，分发完建议清屏；本命令只在 broker 机上跑

此步的最终验证在 1.3——node 机凭这份钥匙连上星，即钥匙正确。

#### 1.2.3 升级操作

```
> npm i -g @oatelauser/crosschat@latest
> crosschat serve --stop && crosschat serve --detach
> crosschat install-skills
```

> 为什么必须重启常驻：npm 升级只换 CLI，`serve` 常驻进程仍跑旧版本——doctor 的版本对账行会点名。

**验证**：

1. `crosschat doctor`
   → 期望：无 ❌（版本对账行不再点名"升级后未重启"）

### 1.3 node 节点

#### 1.3.1 配置连接密钥

本机先装 crosschat（`npm i -g @oatelauser/crosschat && crosschat install-skills`），再把钥匙存成 `~/.crosschat/tcp/node.json`。占位符对照：

| 占位符 | 填什么 |
|---|---|
| `<broker公网IP>` | broker 的可达地址——云机/NAT 填**对外公网 IP**（按 1.2.2 探测行三规则核对） |
| `<端口>` | broker 端口，数字不带引号（默认 7260） |
| `<星名>` / `<starId>` / `<钥匙>` | 钥匙 JSON 里原样照抄，不改 |
| `<本机名>` | 本机自报名（建议=hostname；roster 里怎么称呼你） |

完整文件示例：

```
> mkdir -p ~/.crosschat/tcp && nano ~/.crosschat/tcp/node.json
# 粘贴整段 JSON，改 host 与 showName，保存
> cat ~/.crosschat/tcp/node.json
{
  "brokers": [
    { "host": "<broker公网IP>", "port": 7260, "name": "<星名>", "starId": "<starId>", "key": "<钥匙>" }
  ],
  "showName": "<本机名>"
}
```

**机器改名 = 改本机 node.json 的 showName + 重启常驻**（节点机重启节点客户端、broker 机重启 serve）——全机种唯一的名字来源，别手改 broker.json。

**验证**：

1. `crosschat doctor`
   → 期望：无 ❌；tcp 条目缺 starId、同星双条目等配置问题会被 ⚠️ 点名

#### 1.3.2 启动聚合器连接星

```
> crosschat serve --connect <星> --detach
节点客户端后台运行中 pid=8412（日志：/home/me/.crosschat/tcp/node.log）
```

1.6.0 起这条常驻连接**兼任聚合器**，一份进程两份职责：**收件**（断了=别人发你 `PEER_OFFLINE`；断线自动重连永不放弃）+ **维护本机会话的星籍**（把入星声明报给星——2.3/2.4/2.5 的换轨、收编、自愈全靠它）。多星机按星名各跑一条：

```
> crosschat serve --connect cloud --detach     # 挂 cloud 星收件+聚合
> crosschat serve --connect home --detach      # 挂 home 星
> crosschat serve --stop cloud                 # 只停 cloud；无参=全停（先守护后 broker）
```

（broker 机要跑本机入星会话时同样需要聚合器——但不用手动起：1.3.3 的启动器会自动拉起。）

**验证**：

1. `crosschat status --stars`
   → 期望：星可达、守护 online、本机在机器表：
   ```
   tcp: 共 1 星
     <星名> ✓ 可达，2 机器在线
       守护: <星名>: online
       <本机名>(ec542c2c) 在线
   ```

#### 1.3.3 启动会话（入星）

**新 claude 会话入星**——聚合器没跑会**自动拉起**（几秒内），不用管：

```
> crosschat claude -n <会话名> --connect <星>
已入星 <星>：会话可经 tcp:<星>:<本机名>:<会话名> 直达
```

之后进入正常 claude 交互——**退出 claude 时自动退星**（detach），无需收拾动作。

**codex 形态**（无 `-n`：codex 没有启动期命名参数，进去后改名，聚合器扫描自动跟随）：

```
> crosschat codex --connect <星>
# （codex 交互里）/rename <会话名>
# 聚合器下一轮扫描（≤30s）即把该名挂进成员表，三段寻址生效
```

**多星并存**（`--connect` 可重复；一台机/一个会话可同时挂多颗星）：

```
> crosschat claude -n <会话名> --connect <星> --connect <另一星>
# 两颗星各出一行"已入星"，tcp:<星>:<本机名>:<会话名> 与 tcp:<另一星>:<本机名>:<会话名> 都直达
```

**验证**（两步：成员表见它；真发一条是最终裁决——本机对自己发也走全链）：

1. `crosschat status --stars`
   → 期望：星下多出会话成员行——`会话: <本机名>:<会话名>`
2. `crosschat send --via tcp:<星>:<本机名>:<会话名> --body "联调测试"`
   → 期望：`delivered to <会话名>@<本机名>(ec542c2c) (turn 1) · 续话 c1`，且该会话里收到消息

双机全链把玩（对端机器的会话、错误教学、extends、adopt、重启自愈）见 **2.7 验证阶梯**。

#### 1.3.4 升级操作

同 broker 节点款，重启换成守护形态：

```
> npm i -g @oatelauser/crosschat@latest
> crosschat serve --stop && crosschat serve --connect <星> --detach
> crosschat install-skills
```

**验证**：

1. `crosschat doctor`
   → 期望：无 ❌
2. `crosschat status --stars`
   → 期望：已入星的活会话数秒内经恢复链自动回成员表（见 2.5；broker 与本机聚合器**都**重启过则走 2.4 adopt）

---

## 二、日常使用

部署完（第一章），日常就剩一件事：像单机一样给 agent 一句话。命令、协议、回程路由全部由信封自带——**你不需要记任何命令**。

### 2.1 跨机聊天（一句话触发）

准备：两端各有已入星的 agent 会话（1.3.3 启动器起的）。然后整个过程（图例：**👤 用户** 你说的指令 · **🤖 agent** 回复/收件 📨）：

```
👤 用户[boss -> worker2]  用 crosschat 走 tcp 跨机给 host-b 机器的 claude 会话「worker2」发任务：要求它跑一次构建并回报结果。
🤖 worker2 收到            📨 来自另一会话的消息:
                          <cross-session-message from-name="boss" turn="1">
                          …跑一次构建并回报结果…
                          回复请运行: crosschat send --conversation c3 --body "<你的回复>"
🤖 worker2[worker2 -> boss] 构建完成，产物清单见下一条
🤖 boss 收到               📨 构建完成，产物清单见下一条（turn 2，自动经 broker 跨机回到 A 机）
```

agent 组装的就是三段寻址（2.2）；回程路条由信封自动携带，worker2 零配置照抄即回。

查对端机器上的会话名单（发起跨机新消息前先点名，机器级操作）：`crosschat status --via tcp:<机器名|mid8>`——过滤参数（`--claude`/`--codex`/`--name`）与本地同构；ssh 形态对端仍用 `ssh <对端> crosschat status`。

### 2.2 三段寻址（找人）

```
crosschat send --via tcp:<星>:<机器>:<会话> --body "构建跑了吗"
                      │     │      │      └ 会话名（星成员名；禁冒号）
                      │     │      └──────── 机器名或 mid8（收件机）
                      │     └─────────────── 星名（多星时的选择器）
                      └───────────────────── tcp 通道
```

发送方零状态：这串地址可以照抄进任何题词/文档（回信照旧走信封自带的 reply-hint，不依赖它）。投递路径：

```
发送机 ──send(targetMachine="host-b:boss")──▶ broker（cloud）
   broker 查星内成员表 ──▶ 命中 host-b 聚合器声明的成员 boss（键=会话 ID）
   ──deliver(sessionId=…)─▶ host-b 聚合器 ──▶ 按会话 ID 直投（不经名字解析）
```

错误两条：

- 非成员名 → `SESSION_NOT_MEMBER`（教学：会话须经启动器入星——对端重起或 2.4 adopt 收编）
- 死名有人接任 → `SESSION_SUPERSEDED`（报错原文给出接任者的三段地址，改投即可）

### 2.3 extends 换轨接任（旧会话退休，新会话接班）

场景：旧会话 boss 退休了，新会话要接任它的名字血统——投给旧名的消息自动被指路到接任者：

```
> crosschat claude -n boss2 --connect cloud --extend-session boss
已入星 cloud：会话可经 tcp:cloud:host-a:boss2 直达
# 有对话史时多一行提示：
#   extends boss：本机有该名对话史——接续登记后，投给旧名的消息将指路到新会话
```

`--extend-session` 的四级校验（失败方向不锁死）：旧名仍是**活成员** → 拒绝并指路（先退旧会话或去掉旗标）；本机有该名对话史 → 放行并出声；都无 → 静默放行（没人查询的名字无害）；broker 侧同旧名撞车 → 回执 `EXTENDS_CONFLICT` 指路先声明者（后声明者照常入星，只是 extends 不生效）。

**alive-wins**：旧名还是活成员时 extends 休眠——投旧名仍到旧会话本尊，这是防误伤的保守语义。

顺带两条自动语义（无需操作）：

- **改名跟随**：claude 会话内 `/rename`，聚合器下一轮扫描（≤30s）自动更新成员表（同会话 ID 换名）；codex 同理。改名后旧名自然退位（投旧名按非成员报错）——要保留旧名可达性，用上面的接任声明
- **双活性模型**：claude 成员活性 = 进程在（退出即除名）；codex 成员活性 = 线程在（rollout 落盘、durable——TUI 关了线程还在，resume 即复活，**永不自动除名**；extends 对 codex 几乎不适用）

### 2.4 adopt 收编（会话活着但不在星里）

**什么时候需要**：会话活着、但不在星成员表里。三种来路——① 双端重启失忆（broker 与聚合器都重启过，恢复链拿不回名单）；② 会话不是经启动器起的（裸 `claude`/`codex` 起的，现在想入星）；③ 改名后想补旧名接任声明。**判定信号**：投三段报 `SESSION_NOT_MEMBER`，或 `crosschat status --stars` 里出现诊断行：

```
> crosschat status --stars
tcp: 共 1 星
cloud ✓ 可达，2 机器在线
  守护: cloud: online
  host-a(ec542c2c) 在线
  会话: host-a:boss、host-a:worker2 (extends←boss)
  建议: crosschat serve --connect cloud --adopt limbo（会话活着但非成员——收编活进程入星）
```

**照抄诊断行**（名字已填好），或手写：

```
> crosschat serve --connect cloud --adopt limbo
已收编 limbo（claude，id 9f8e7d6c）入星 cloud
三段寻址：tcp:cloud:host-a:limbo
```

语义四条：按名找**本机活会话**（复用 send 的名字解析：名字不存在=报错列候选；claude/codex 同名=`NAME_COLLISION` 消歧）；命中即按其**会话 ID** 向聚合器 attach——**收编活进程，不新建**，现场上下文无损；已是成员=幂等提示（exit 0）；可与 `--extend-session <旧名>` 并用补血统（也是"改名后接任旧名"的声明通道）。

### 2.5 重启自愈与降级告警

**恢复链**（重启自愈，一般无需人工）：聚合器重启 → 向 broker 查回本机最后已知名单 → 逐个本地验活 → 活的自动重新入册（孤儿会话自动找回，死名不复活）；broker 也重启过（双失忆）→ 恢复链空 → 走 2.4 的 adopt（status 诊断行会把命令打印好）；启动器还活着时则连查都不用查——旗标在手，原样重声明（含 extends）。

**降级告警**：本机 crosschat 比 broker 机新（broker 还不支持会话成员）时，启动器/聚合器会在**命令行直接打一行**：

```
broker 不支持会话成员（proto:3），已降级机器级——本机会话的入星声明不生效（机器级收发不受影响）
```

含义：机器级操作（远程枚举、文件通道）照常工作，只是入星/三段寻址/extends 不生效。解法 = 按 1.2.3 升级 broker 机的 crosschat 后重启 serve，零配置自动恢复。

### 2.6 文件通道（--file，机器级）

消息里塞大内容不如直接送文件。`--file` 与机器级 `--via tcp:<机器>` 同用（文件落在对端机器的收件目录，通知对端会话去读），一句话题词形态：

> 用 crosschat 走 tcp 跨机把 ./report.md 文件发给 host-b 的 worker2，正文让它分析这个文件。

对端收到的正文是自动生成的：`文件 report.md 已送达：/home/<B用户>/.crosschat/tcp/inbox/3f2a1b9c-report.md`——路径在**对端机器上**，agent 直接可读。语义五条：

- **sha256 锚**：发送前算摘要；对端收齐校验不过则清残片要求整档重传（重跑同一命令即可）
- **断点续传**：每 256KiB 一块落盘，中断后重跑同一命令从断点续传（对端保留锚点）
- **去重秒回**：对端 inbox 已有同 sha 文件时直接回路径，不重传
- **懒删除回收**：inbox 文件 >5 天删；总量 >512MiB 从最旧删起——**附件过期就没了**：收到"已送达"但路径不存在（>5 天），回对端"附件已过期，请重发 --file"
- **单文件上限 64MiB**；超限报 `FILE_TOO_LARGE`，请压缩或分段（tcp 正文超 1MiB 会自动转文件通道，见 SKILL.md 大小地图）

### 2.7 验证阶梯（全链把玩，顺序执行）

双机剧本：星 `cloud-broker` 跑在云机（第一章搭好，云机与发起端都已贴钥匙），云机上再入星两个会话当对端。每步"命令 → 期望输出"成对，从上往下走完 = 三段寻址、错误教学、换轨接任、收编、重启自愈全部亲手过一遍。

**云机：**

1. `crosschat serve --connect cloud-broker --detach`
   → 云机自己的聚合器（星在本机时连自己也算 node 职责；已跑过则跳过）
2. cd 到任意工作目录，跑：`crosschat claude -n cloudworker10 --connect cloud-broker`
   → 期望一行：`已入星 cloud-broker：会话可经 tcp:cloud-broker:cloud:cloudworker10 直达`
   → 进入 claude 后随便说一句话让它活着

**本机：**

3. `crosschat status --stars`
   → 期望：cloud-broker 星下出现 `会话: cloud:cloudworker10`
4. `crosschat send --via tcp:cloud-broker:cloud:cloudworker10 --body "三段直达验证"`
   → 期望：`delivered to cloudworker10@cloud(000c6989) (turn 1)`，云端会话里收到
5. `crosschat send --via tcp:cloud-broker:cloud:ghost --body x`
   → 期望：`SESSION_NOT_MEMBER` 报错 + "会话须经启动器入星"教学

**云机（extends 接任）：**

6. 退出 cloudworker10（Ctrl+C），另起接任：
   `crosschat claude -n cloudworker11 --connect cloud-broker --extend-session cloudworker10`
7. 本机：`crosschat send --via tcp:cloud-broker:cloud:cloudworker10 --body x`
   → 期望：`SESSION_SUPERSEDED` 报错，内含 `tcp:cloud-broker:cloud:cloudworker11` 指路
   → 改发 cloudworker11 → delivered

**云机（adopt 收编）：**

8. 裸起一个会话（直接敲 `claude`，不经 crosschat），进去后 `/rename limbo`
9. 云端另开终端：`crosschat status --stars`
   → 期望出现诊断行，直接给出完整命令：`crosschat serve --connect cloud-broker --adopt limbo`
10. 照抄执行
    → 期望：`已收编 limbo…入星 cloud-broker`；本机发 `tcp:cloud-broker:cloud:limbo` → delivered
    → 再跑一次 adopt → 期望"已是成员"幂等提示（exit 0）

**重启自愈（云机，保持 cloudworker11 活着）：**

11. `crosschat serve --stop cloud-broker && crosschat serve --connect cloud-broker --detach`
    → 本机 `status --stars`：cloudworker11 成员行数秒内自动回来（恢复链验活重入册）

---

## 三、底层实现

<details><summary>展开：内部调用链 / mid8 寻址 / 自登记 / 手动命令实录 / 多星成员（点击）</summary>

这一章回答"它到底怎么跑通的"。排障深挖、或想理解设计取舍时读。

### 3.1 一条消息的内部调用链

**发送腿（瞬态，发完即走）**：

```
crosschat send --via tcp:cloud:host-b:boss --body "…"
  → 读 ~/.crosschat/tcp/node.json（broker 地址 + 钥匙，按星名/星标识选条目）
  → WebSocket 连 broker → 握手（info/connect/connected，见第四章）
  → 发 send 帧（targetMachine="host-b:boss"）→ 等 receipt 帧（默认 120s，CROSSCHAT_TCP_TIMEOUT_MS 可调）
  → 打印 delivered/queued/parked → 断开
```

**中转腿（broker 常驻）**：收到 send 帧 → 解析 targetMachine——`机器:会话` 形态先查星内成员表，命中即注入会话 ID（deliver 直达，不经名字解析）；纯机器段走 mid8 寻址（3.2），目标是本机则直接本机投递；否则找到目标节点的常驻连接，转发 deliver 帧，等该节点回 result（超时按 PEER_OFFLINE 报），再映射成 receipt 回发送方。

**接收腿（聚合器常驻）**：收 deliver 帧 → 在**本机**执行投递（与单机 `crosschat send` 同一套：找到目标会话，注入消息；对方忙则入本机发件箱、看门狗自动重投）→ 回 result 帧（delivered/queued/parked + turn + replyRef）。

### 3.2 mid8 寻址（双轨）

- **寻址权威 = machine-id 前缀（mid8）**：machine-id 是每台机器安装时生成的稳定指纹。三段地址的机器段、`status --via tcp:<机器>`、文件通道的 `--via tcp:<机器>` 都按**最短无歧义前缀**解析（git 短哈希式）——0 命中报 `UNKNOWN_MACHINE`；多命中报 `MACHINE_NAME_COLLISION` 并列出双方 mid 前 12 位，加长即消歧（注册时若两机 mid 前 8 位碰撞，broker 日志会预警"需 ≥9 位"）
- **名字 = 人读显示**：机器段填注册名也行（非 hex 按注册名/label 解析），但对端改名/两机撞名时名字失效，mid8 永远找得到人——信封回程路条因此永远盖 mid8
- 命中 broker 自己（machineId 相同）→ 走本机投递，不过网络

### 3.3 broker 机自登记（为什么 serve 会自动写 node.json）

首次 `crosschat serve` 干两件事：把自己登记进 broker.json（`label: "self"`，带 machineId + 专属钥匙）——其他机器立刻可寻址它、发给它的消息走本机直投不过网络；若 `~/.crosschat/tcp/node.json` 不存在则写一份 host=127.0.0.1 的自用凭证（本机 `send --via tcp:` 时连回自己鉴权）。存在则**跳过不覆盖**并按状态出声：指向别家（提示本机发送将走它）/ 钥匙或端口陈旧（BAD_AUTH 预警，删文件重启重建）/ 一致（静默）。

> 设计取舍：broker 只认钥匙不认人（连 127.0.0.1 来的也要刷卡——"本机免检"等于给同机所有进程开后门）；`send` 是无状态 CLI 每次都是新进程，只认 node.json。所有机器（节点/CI/broker 机）的发送走**同一条代码路径**，不分情况——这是协议教学能内建的前提。

### 3.4 手动命令实录（agent 视角之外，人肉操作时用）

A 机发起（三段直达）：
```
> crosschat send --via tcp:cloud:host-b:worker2 --body "跑一次构建，产物清单发回来"
delivered to worker2@host-b(9f8e7d6c) (turn 1) · 续话 c3
```
B 机会话里自动出现信封（无需任何题词）：
```
📨 来自另一会话的消息:
<cross-session-message from-name="boss" turn="1">
<crosschat-reply-hint reply-as="worker2">回复请运行: crosschat send --conversation c5 --body "<你的回复>"</crosschat-reply-hint>
…
跑一次构建，产物清单发回来
</cross-session-message>
```
B 机照抄整条命令、只换 `<你的回复>`（不截断不改写），回信自动经 broker 回到 A 机——引用自带星标识，CLI 自动选星，不需要写 `--via`：
```
> crosschat send --conversation c5 --body "构建完成，清单见下一条"
delivered to boss@yang(ec542c2c) (turn 2) · 续话 c2
```

### 3.5 多星成员（原单星边界，已解除）

早期"一台机一份 node.json = 一个星"的边界已解除：node.json 数组形状多条目、会话引用尾部携带星标识（mc2_ flags bit 10）、发送按**限定器 → 引用星 → 单条目 → 教学**四序本地选星——无缓存文件、无网络探测，O(1)。信封格式与 skill 教学零改动（回信照抄即路由）；旧版解析器遇新引用走"升级后重试"教学（ref 模块设计好的偏差路径）。收件守护按星常驻（一星一条）；**会话级星成员（proto:3）已落地**（见第二章与第四章）——每（机器,星）仍一条连接，会话成员经本地 attach 管道声明，不随会话数增长连接。星外机器也仍可走 [ssh 联邦](federation.md)（两通道正交并存）。

</details>

---

## 四、协议参考（proto:1/3 对接实现指南）

> 草案期——稳定后对第三方实现承诺兼容。proto:3 不是线上版本号翻页：`proto` 字段仍为 1，新能力经握手 `caps` 数组协商（见 4.8）。

<details><summary>展开：握手时序 / 帧表 / 完整帧流 / 错误矩阵 / 文件状态机 / 最小客户端 / caps 协商与 attach 管道（点击）</summary>

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

### 4.2 帧表（19 型；`?`=可缺省）

| 帧 | 方向 | 字段 |
|---|---|---|
| `info` | S→C | proto, server, caps, starId? |
| `connect` | C→S | proto, role(node/sender), machineId?, auth, name?（≤32 字符显示名）, caps?（proto:3 能力声明，缺省=老节点） |
| `connected` | S→C | machineName? |
| `error` | 双向 | code, message, id? |
| `send` | C→S | id, targetMachine, to?, conversation?, body, origin? |
| `receipt` | S→C | id, status(delivered/queued/parked), turn?, replyRef?, output? |
| `deliver` | S→C | id, fromMachine?, payload, to?, conversation?, origin?, sessionId?（三段命中时会话 ID 注入，id 定位不经名字解析） |
| `result` | C→S | id, status(delivered/queued/parked/error), turn?, replyRef?, code?, message?, output? |
| `file-begin` | C→S | id, targetMachine, sha256, name, size |
| `file-chunk` | C→S | id, seq, bytes(base64) |
| `file-end` | C→S | id |
| `file-result` | S→C | id, ok, path?, error?, resumeFrom?, dedup? |
| `roster` | C→S | （空） |
| `roster-result` | S→C | machines:[{name?, mid8, online, sessions?}]（proto:3：sessions=该机成员 [{sessionId, name?, extends?}]，老 broker 缺省） |
| `status-query` | 双向 | id, targetMachine（请求方→broker→目标节点原帧转发） |
| `status-result` | 双向 | id, ok, payload?({claude:[…], codex:[…]}｜{unavailable}), error? |
| `sessions` | C→S（node） | sessions:[{sessionId, name?, extends?}]——全量重播：数组即该连接当前全部成员，空数组=清空；extends 旧名 string=同机 / {machine,name}=跨机 |
| `members-query` | C→S（node） | （空）——聚合器重启后查回"我以前的成员" |
| `members-result` | S→C | members:[{sessionId, name?, extends?}]——broker 断连后保留的最后已知名单（纯内存，broker 重启即空） |

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
# 三段寻址形态：targetMachine:"host-b:boss"（机器:会话）——broker 命中星成员后
# deliver 帧注入 sessionId，接收侧按会话 ID 直投
```

**接收方聚合器**（常驻 node，同一时刻被动收到）：

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

参考实现是**单 broker 星型**——多实例集群需自行解决实例间路由（哪台节点连在哪个实例）与注册表共享，本实现不含（一台机器入多颗星由节点侧承担，见 3.5）。注册表格式见 broker 机 `~/.crosschat/tcp/broker.json`（顶层 starId/name(星名)/port；nodes[] 内 label/key/machineId/machineName/addedAt）。节点侧 node.json：`{brokers:[{host,port,name(星名),starId,key}…], showName(本机显示名)}`——旧字段 alias/顶层 name 读取时自动映射。`nodes[].machineName` 不是权威——单一事实源是各机自己的 node.json `showName`（节点机经连接帧上报、broker 机经 serve 启动读回刷新；显式缺失/空则清除，roster 回退 mid8）。会话引用 mc2_ 可在尾部携带 starId（flags bit 10）——旧版解析器遇此扩展走 `INVALID_CONVERSATION_REF`+升级指引，属设计好的版本偏差路径。

### 4.8 proto:3 能力协商（caps）与 attach 管道

**caps 协商**（线版本号不动，能力走握手数组）：

- broker 的 `info` 恒带 `caps`，proto:3 起含 `"session-members"`；老 broker（proto:1 期）`caps` 缺省或为空
- 会话级感知的聚合器在 `connect` 带上 `caps:["session-members"]`；缺省 = 老节点，broker 按机器级对待（零回归）
- 聚合器发现 broker 无此 cap → **不发** `sessions`/`members-query`（老 broker 对未知 op 静默丢，发了也白发），并在命令面打一行降级告警（见 2.5）
- 后续能力（如 010 TLS）沿 `caps` 数组追加，不翻 `proto` 字段

**attach 管道**（启动器↔聚合器的本机 IPC；win named pipe `\\.\pipe\crosschat-attach-<星名>` / unix `<tcp目录>/attach-<星名>.sock`）：换行分隔 JSON，逐帧回执一行：

| 帧 | 语义 |
|---|---|
| `{op:"attach", sessionId, name?, extends?}` | 声明成员（成员键=会话 ID；name/extends 禁冒号；幂等重声明=覆盖） |
| `{op:"detach", sessionId}` | 退星（幂等：不在表内也回 ok） |
| `{op:"sync", sessions:[…]}` | 全量对账（替换整表） |
| `{op:"status"}` | 只读探针 → 回 `{ok, online, brokerCap, members:[…]}`（启动器 extends 校验与 adopt 幂等判断的数据源） |

聚合器侧语义：成员表变化即全量重播 `sessions` 帧；活性核验每 30s（claude=进程扫描，codex=rollout 落盘存在，durable 永不自动除名）；扫描同时做改名跟随（同 id 换名即更新重播）。

</details>

---

## 排障对照

| 症状 | 根因 | 解法 |
|---|---|---|
| `TCP_TRANSPORT_FAILED 无法连上 broker` | node.json 地址错 / serve 没跑 / 防火墙 | 核对 node.json 的 host:port；broker 机 `crosschat serve` 起没起；云机查安全组放行 |
| `TCP_TRANSPORT_FAILED … 远端状态不明` | 发送后超时/断线 | **勿盲目重发**（可能与首次投递叠加）——先在对端查 send-log 或 `status --conversations` |
| `PEER_OFFLINE 机器 X 已注册但当前不在线` | 对端节点没连 | 对端 `crosschat serve --connect <星>`；稍后重试；若两端另配了 ssh 也可走 ssh 形态 |
| `UNKNOWN_MACHINE 注册表没有…` | 目标名/mid 没登记或抄错 | broker 机 `crosschat serve --list` 查 mid8 与名字 |
| `MACHINE_NAME_COLLISION` | 同名机器或 mid 前缀太短 | 报错里列了 mid——改用（更长的）mid 前缀寻址 |
| `SESSION_NOT_MEMBER 会话 X 不是星成员` | 三段寻址的会话名没入星（裸起的会话） | 该会话所在机用启动器入星（`crosschat claude -n <名> --connect <星>`）；会话已活着则 `crosschat serve --connect <星> --adopt <名>` 收编 |
| `SESSION_SUPERSEDED 已由 <机器>:<会话> 接续` | 旧名是死名且有接任者（--extend-session 声明过） | 照报错里的 `tcp:<星>:<机器>:<会话>` 改投接任者 |
| `EXTENDS_CONFLICT`（启动器/adopt） | extends 旧名仍是活成员（alive-wins 下会休眠） | 先退旧会话再接续，或去掉 `--extend-session` 直接开新名 |
| 老命令 `--via tcp:<机器> --to <会话名>` 报错教学 | 两段式会话投递已废弃（019） | 会话投递改用三段寻址 `tcp:<星>:<机器>:<会话>`；机器级操作（status 枚举/`--file`）不受影响 |
| 启动器/聚合器打"broker 不支持会话成员（proto:3），已降级机器级" | broker 机 crosschat 还是老版本 | 机器级收发不受影响；升级 broker 机 crosschat 后 `serve --stop && serve --detach` 重启即恢复 |
| 想看远机上有啥会话 | 本机 status 不跨机 | `crosschat status --via tcp:<机器>`（tcp 星；过滤参数同本地）；ssh 形态对端仍用 `ssh <对端> crosschat status` |
| status `节点客户端: 未运行` | 本机聚合器没起（收不到消息的原因） | `crosschat serve --connect <星> --detach` |
| `STAR_ID_MISMATCH 星标识不符已停机` | node.json 条目与 broker 现星标识不符（贴错星/配置陈旧） | 向管理员重新索取 node.json，重启 --connect |
| 多星机裸写 `--via tcp:<机器>` 报"列条目"教学 | 多条目且无会话引用可循 | 加限定词 `--via tcp:<星>:<机器>`；回信不受影响（引用自动带星） |
| status 第二行 broker 不可达 | node.json host/port 错 / 防火墙 / broker 没跑 | 按 1.2/1.3 核对；云机安全组 |
| 收到"文件…已送达"但路径不存在 | 附件 >5 天被懒删除回收 | 回对端"附件已过期，请重发 --file" |
| serve 启动即退、报错含 `EADDRINUSE` | 端口被占（多半是旧实例） | `crosschat serve --stop` 再起；或 `--port` 换端口（会记住） |
| 升级 npm 包后跨机行为怪异（新 CLI + 旧常驻） | npm 升级只换了 CLI，`serve` 常驻进程仍跑旧版本 | `crosschat serve --stop && crosschat serve --detach`（broker 机）或 `serve --stop && serve --connect <星> --detach`（节点机）重启常驻；`crosschat doctor` 的版本对账行会点名 |

## 清理与卸载

```
> crosschat serve --stop            # 停本机常驻（broker 或聚合器，三重身份校验安全停止）
> crosschat clean [--force]         # 清 inbox/parts + 30 天未更新的 conversations 分片：默认懒删除规则；--force 全清（跳过确认，含未读）
> crosschat uninstall [--yes]       # 删 ~/.crosschat（含状态目录）+ 旧版散装状态目录 + 双侧 skill；serve 在跑会拒删（先 --stop）
                                     # 结尾 npm uninstall -g @oatelauser/crosschat 收尾
```

---

> **迁移注记**：1.6.0 前手册教授的两段式会话寻址（`--via tcp:<星>:<机器> --to <会话名>`）已废弃（wayfinder [019](wayfinder/tickets/019-ambient-session-delivery-retirement.md)）——会话投递统一走三段寻址；机器级操作（远程枚举、文件通道、roster）不受影响。
