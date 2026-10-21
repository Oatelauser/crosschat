# 跨机通信：tcp

> 本文是 [README · 通信方式](../README.md#-通信方式) 表中"跨机联邦 · tcp"的完整手册。

一句话，四个动作——每个一条命令：

| 动作 | 谁来做    | 命令                                                            |
|---|-----------|-----------------------------------------------------------------|
| **起服务** | broker 机 | `crosschat serve --detach`（起端口与转发，**永不造星**）        |
| **造星**   | broker 机 | `crosschat serve --add-star <星名>`（首星同此命令；热生效）     |
| **机器连星** | node 机   | `crosschat serve --connect <星> --detach`（1.6.0 起兼任聚合器） |
| **会话入星** | 跨机会话  | `crosschat claude -n <会话> --connect <星>`（1.7.0 起默认**永久注册**；一次性 worker 加 `--rm`）|

星建好、机器连上、会话入星之后，星内任何人按三段地址直达该会话（免 `--to`）：

```bash
crosschat send --via tcp:<星>:<机器>:<会话> --body "跑一次构建，产物清单发回来"
# → delivered to worker2@host-b(9f8e7d6c) (turn 1) · 续话 c1
```

### 角色：broker / node / 聚合器 / 成员

| 角色 | 是什么 | 一句话职责 |
|---|---|---|
| **broker**（星心） | 星心机器上的常驻服务（`crosschat serve`，[1.2](#12-broker-机起服务与造星) 部署） | 星的消息中转站：管机器注册表 + 会话成员册（roster，落盘不失忆），一切跨机消息经它转发；它挂了跨机就瘫。一个 serve 进程托管多颗星（`--add-star`），全部星共用一个进程/端口 |
| **node**（节点机） | 接入星的每台机器，凭一份 [node.json 钥匙](#131-配置连接密钥)入网 | broker 机由 serve/加星**自登记**为星内首个 node（机器级即刻可收可发），其余机器贴钥匙后 `serve --connect` 入网 |
| **聚合器** | node 机上 `serve --connect` 起的那条常驻连接（[1.3.2](#132-启动聚合器连接星)） | 一份进程两份职责：机器级**收件** + 维护本机会话的**星籍**（N 个会话共用这一条连接，不随会话数增长） |
| **成员**（会话册） | 经[启动器入星](#133-启动会话入星)的 claude/codex 会话 | **册+双模式**：永久（默认——退出=下线、册位保留、同 id resume 自动复活）或临时（`--rm`——退出即离册）；三段寻址 `tcp:<星>:<机器>:<会话>` 的终点 |

在此之上才是**会话**：机器连星了但会话没入星，星内依然找不到它。

### 怎么用这篇手册

| 你这台机是… | 做哪节 |
|---|---|
| broker 机（星心） | [1.2](#12-broker-机起服务与造星) 全做（起服务→造星→发钥→管理）。要跑入星会话时 1.3 的[启动会话](#133-启动会话入星)照用（聚合器自动拉起，无需手动） |
| node 机（其余机器） | [1.3](#13-node-节点) 全做 |
| CI 机（只发不收） | [1.3](#13-node-节点) 只贴钥匙，不跑 --connect |

- 部署（[一](#一环境搭建)）→ 日常使用（[二](#二日常使用)，含全链验证阶梯）→ 底层实现（[三](#三底层实现)，折叠）→ 协议参考（[四](#四协议参考proto13-对接实现指南)，折叠）→ [排障](#排障对照)（永不折叠）
- **验证一律编号步骤**：每步"命令 → 期望输出"成对，顺序执行、照抄可跑
- 命令块：`>` = 敲的，其余 = 期望输出，`#` = 备注；Linux 写法，win 等价（`nano`→`notepad`）
- 端口默认 **7260**（改口=手编 broker.json，[1.2.1](#121-启动服务serve永不造星)）；钥匙 = 一份 `node.json`，唯一入网凭证；`<XX>` = 占位符

---

## 一、环境搭建

### 1.1 broker 选择规则

选一台当星心（broker）——它挂了跨机就瘫。三条标准：**常驻**（最常开机）、**可达**（其余机器连得到它）、**端口可开**（能放行一个入站端口）。对号入座：

- 局域网 → 最常开机、能被各机直连的那台
- 跨公网 → 云端/堡垒机（唯一公网入口；安全组放行端口入站。明文风险已拍板接受，TLS 挂账中）
- win + WSL 同物理机 → 算两台机，选常开侧；**win 连 WSL broker 的 host 用 127.0.0.1**（WSL 镜像网络下它报的 LAN IP 从 win 不可达，实测）
- 已有 [ssh 联邦](federation.md) → 机器 ≥3 台或要文件通道时才值得切 tcp

### 1.2 broker 机：起服务与造星

两件事分两步：**serve 只起端口与转发服务，永不造星**（零星启动是合法待配状态）；每一颗星——包括第一颗——都由 `--add-star` 显式命名创建，加删改全程免重启。星建好后再发钥（1.2.3）、再谈管理分权（1.2.4）与远程管理（1.2.5）。

#### 1.2.1 启动服务（serve，永不造星）

```
> crosschat serve --detach
broker 后台运行中 pid=8412 端口 7260（日志：/home/me/.crosschat/tcp/broker.log）
# 前台调试：crosschat serve（零星态会先打一行教学：首星 crosschat serve --add-star <星名>）
# 端口默认 7260；非默认口=手编 ~/.crosschat/tcp/broker.json 顶层 "port" 后重启 serve（--port 命令已移除）
```

serve 启动时把 broker 机**自登记**进已建的每颗星（星内首个 node——机器级即刻可收可发）并写好本机自用的 node.json（host=127.0.0.1，本机发送的凭证）；配置落盘 `~/.crosschat/tcp/broker.json`（端口+星册），后续重启只需 `crosschat serve` / `serve --detach`，不带参数。

**验证**（两条都过 = 服务已就绪；星在下一步造）：

1. 验证端口监听：
   ```
   > ss -tln | grep 7260
   LISTEN 0 128 0.0.0.0:7260 ...
   ```
2. 验证零星态教学（台账此时无星，合法待配）：
   ```
   > crosschat serve --list
   （台账零星——合法待配状态；首星：crosschat serve --add-star <星名>，serve 永不自动造星）
   ```

#### 1.2.2 造星（--add-star，热生效）

星是显式命名创建的（1-32 字符 `A-Za-z0-9._-`，禁冒号），首星与后续星同一命令：

```
> crosschat serve --add-star cloud
已加星 cloud——本 broker 现托管 1 颗星（经在跑 broker 已生效，免重启；自登记+内挂聚合器随对账落位）
发钥：crosschat serve --star <星名> --gen-key <n>（星域命令一律须 --star——单星亦然）；查星：crosschat serve --list
注意：多星共用一个 broker 进程——故障域合并（一进程崩=全部星瘫、升级窗口合并），此为已接受的运维代价
# broker 没在跑时同样可加：回执变"已落盘，serve 启动即托管"
```

再加一颗星（同一进程同一端口，vhost 同构——机器凭钥匙自证星籍，连接握手时按钥匙定归属星）：

```
> crosschat serve --add-star lab
已加星 lab——本 broker 现托管 2 颗星（经在跑 broker 已生效，免重启；自登记+内挂聚合器随对账落位）
# …后两行同上
```

**热生效语义**：加星/删星/改星名/改显示名/发钥/删钥/发吊星管理钥都免重启——CLI 落盘型命令完成后经本机管理插座通知在跑 broker 立即对账，打印"经在跑 broker 已生效"必出自 broker 回执（不预支成功）；broker 没跑则落盘、下次 serve 启动即托管（回执会注明）。托管多颗星后，星域管理命令（`--name` / `--gen-key` / `--gen-admin-key` / `--remove-admin-key` / `--remove` / `--list-nodes` / `--list-members` / `--star --show-name`）一律 `--star <星名|starId前缀>` 指名目标星——**单星也不例外**（036 起统一当多星处理，不存在单星机特殊形态；漏给会点名现有星并给示例）。

四条多星语义：

- **单文件单形状**：注册表与星册同在 `broker.json` 一份文件（每星自带 roster 段）——一颗星的成员/接任/下线与另一颗互不相干；同机入两星也互不干扰
- **非兼容升级（032 拍板）**：连接握手须声明 `multi-star` 能力（新版客户端自动带）；旧版 crosschat 腿连上即拒——`BAD_PROTO` 并教 `npm i -g @oatelauser/crosschat@latest`，不留兼容包袱
- **broker 机免自挂**：broker 进程自动内挂本机聚合器（attach 管道、成员表都在 serve 进程里）——星心机**不需要** `serve --connect <自家星>`，手动再起会被双开防护拦下教学
- **故障域合并**：所有星共用一个进程——一进程崩=全部星瘫、升级窗口合并。自部署形态（星主同一人）下这是已接受的代价；不同主顾的星别并进同一 broker

**验证**（分组列出各星；单星平铺无 `===` 头，管理钥条目 name 列标（星管理钥）见 [1.2.4](#124-管理权限三层)）：

```
> crosschat serve --list
=== 星 cloud ===
label     name              mid8      added-at
self      yang              ec542c2c  2026-10-11T02:12:00.059Z
=== 星 lab ===
label     name              mid8      added-at
self-lab  yang              ec542c2c  2026-10-11T02:20:00.000Z
```

改星名 / 改 broker 机显示名（都走本机管理面，热生效）：

```
> crosschat serve --star cloud --name prod --detach
# 改星名：本机域专属（星管理员拿不到）；--name 不是一次性命令——改完照常进入 serve，加 --detach 免前台
> crosschat serve --show-name win-main
显示名已改为 win-main（经在跑 broker——聚合器已重挂，秒级生效）
> crosschat serve --star cloud --show-name cloud-main
星 cloud 显示名已改为 cloud-main（经在跑 broker——聚合器已重挂，秒级生效）
# --show-name 两形态：裸=全局默认名（'' 清除）；--star <星> =该星条目级覆盖（node.json 条目 showName，
# 缺省回落顶层全局值；'' 清除覆盖回落全局）——broker 机可按星用不同机器名，注册表 machineName 每星一份
# node 机改名=手编 node.json（顶层全局或条目级 showName，同口径生效）+ 重启守护（1.3.1）
```

删星（`--remove-star`）见 [1.2.6](#126-删星--remove-star)。

#### 1.2.3 发钥（--gen-key）

生成 node 节点的钥匙；`--gen-key N` 一次打 N 份（1-10），打印的整段 JSON 交给对应机器，存放在[node节点配置文件](#131-配置连接密钥)。须 `--star <星名>` 指明目标星（单星亦然——036 起星域命令一律指名）：

```
> crosschat serve --star cloud --gen-key 2
自动探测 broker 地址：192.168.1.10:7260（多网卡/NAT 常探错——按下述规则人工核对改写 node.json 的 host 与 port）：
  · broker 机自身 → 无需分发（首次 serve 已自动写好 127.0.0.1 的自用 node.json）
  · broker 是云主机/NAT 内网机 → host 填对外公网 IP（探测常拿内网 IP，必核对）
  · 普通局域网 → broker 机的局域网 IP；broker 用非默认端口时 port 一并改
分发前把每份 node.json 的 showName 改成「贴这份配置的机器」的自报名字（建议=其 hostname；纯显示用——寻址/回信走 machine-id 前缀）；条目 name=cloud 是星名（broker 权威，连接自动同步，不用改）
入星 cloud：生成 2 把钥匙
--------------------------------
{
  "brokers": [
    {
      "host": "192.168.1.10",
      "port": 7260,
      "name": "cloud",
      "starId": "a1b2c3d4e5f6",
      "key": "a3f0…64位hex…"
    }
  ],
  "showName": "<当前node机器名>"
}
--------------------------------
{ …第二份同构… }
放置路径（目标机器）：~/.crosschat/tcp/node.json（win 写法 C:\Users\<用户>\.crosschat\tcp\node.json；入多星把各星条目合并进同一份 brokers 数组）
本命令须在 broker 机上执行（钥匙登记进本机 broker.json）；broker 机自己的 node.json 已由首次 serve 自动写好，勿用上面的钥匙覆盖
钥匙已进入终端回滚缓冲，分发完建议清屏
```

输出怎么读，四条（CLI 回显已带前两条，这里点重点）：

1. **host**：打印的 host 只是探测值——云主机/NAT 必改**对外公网 IP**，局域网核对 LAN IP（探测常错，人工核对是规则不是建议）
2. **JSON 体**：`key`（该机钥匙）、`name`（星名）、`starId`（星标识）三个字段**照抄不改**；只有 `host`/`port` 按 host 条规则改
3. **showName**：改成「当前 node 机器」的名字（建议星内唯一）——机器名用于 tcp:<星>:<机器> 的机器段寻址
4. **安全**：钥匙进过终端回滚缓冲，分发完建议清屏；本命令只在 broker 机上跑

此步的最终验证在 [1.3](#13-node-节点)——node 机凭这份钥匙连上星，即钥匙正确。

#### 1.2.4 管理权限三层

管理是分层的，一把钥匙只干一层的事（034 拍板）。三层角色：

| 角色 | 凭什么 | 能做什么 |
|---|---|---|
| **普通成员**（node） | 星钥（node.json 条目的 `key`） | 机器收发 + 会话入星 + **读本星**清单（`--list-nodes` / `--list-members`）+ 删册位 `--member-remove`（028：星内任何机器可执） |
| **星管理员** | 星管理钥（同条目可选字段 `adminKey`，**发放即绑定一星、一星一权**） | 上述 + 本星发钥 `--gen-key` / 删节点 `--remove`——可经 `--via tcp:<星>` 远程执行 |
| **broker 主** | 本机插座（在 broker 机上跑 CLI 即是） | 全部：加删星、改星名、发/吊星管理钥、`--list` 分组清单、`--show-name`…… |

> 表按**连接身份**论。世上不存在全能远程钥匙：加删星/改星名/发吊星管理钥只认 broker 机本机（管理插座）；在 broker 机上跑 CLI=本机插座=broker 主——机器物理在场即全权。

三条硬边界：

- **星管理钥永不过线**：管理连接走挑战应答（broker 发一次性 nonce，客户端回 HMAC 证明），钥匙本体不出现在任何网络帧里；`info` 无 `challenge-auth` 能力（旧版/中间人剥除）即拒连，**无降级路径**——绝不回落裸钥发送
- **越权即拒**：普通成员调管理 op / 任何人远程调本机域 op → `ADMIN_REQUIRED` 并教学找谁
- **审计逐笔**：管理写 op 进 broker.log 逐笔记来源（`audit admin-op <动作> <对象> 来源=本机插座` 或 `来源=星管理钥(<label>)`）

发星管理钥（broker 机；`--star` 限定目标星）：

```
> crosschat serve --star cloud --gen-admin-key ops-wsl
已发星管理钥 ops-wsl（星 cloud——经在跑 broker 已生效）
贴钥：把下面一行并进目标机器 node.json 该星条目（与星钥同条目；钥匙永不过线——连接走挑战应答）：
  "adminKey": "b7f1…64位hex…"
远程管理（目标机器）：crosschat serve --via tcp:cloud --gen-key <n> | --remove <label> | --list-nodes | --list-members
本命令须在 broker 机上执行（管理钥登记进本机 broker.json）；钥匙已进入终端回滚缓冲，分发完建议清屏
```

吊星管理钥（broker 机；label 或前缀）：

```
> crosschat serve --star cloud --remove-admin-key ops-wsl
已吊星管理钥 ops-wsl（星 cloud——经在跑 broker 已生效，现有管理连接已失效，后续连接即 BAD_AUTH）
```

本轮直接升级：`--remove`/远程`remove-node`删除节点后，该星内使用该节点钥匙认证的已有node和sender连接立即失效；吊管理钥同样撤销对应已有管理连接。其他凭证、其他星和永久成员册不受影响。broker先禁止后续帧、清理在途路由，再发送明确的`credential-revoked`通知并关连接；已发出的投递不表示撤回。

节点收到明确撤权后保存不含裸钥的暂停记录，并暂停该星守护重连和启动器自动拉起，保留node.json及原生会话。恢复时取得新钥、更新该星条目，再显式`crosschat serve --connect <星>`；普通网络中断仍自动重连，一般`BAD_AUTH`不当作明确撤权。暂停记录损坏会明确报错并停止自动拉起；写盘失败时保留暂停IPC owner，避免启动器立即重建连接。

`--list` 里管理钥条目同表可见、永不回显钥匙本体：

```
> crosschat serve --list
=== 星 cloud ===
label     name              mid8      added-at
self      yang              ec542c2c  2026-10-11T02:12:00.059Z
ops-wsl   （星管理钥）       -         2026-10-20T03:11:00.000Z
```

#### 1.2.5 远程管理（--via tcp）

星管理员不必登 broker 机：在本机（条目带该星钥匙/管理钥的机器）上用 `--via tcp:<星>` 远程管。**读用星钥（成员身份），写用星管理钥（挑战应答）**——都是"该星的"身份，不是 broker 主：

```
> crosschat serve --via tcp:cloud --list-nodes
星 cloud 节点表（2 条；不含钥匙）：
  self      yang              ec542c2c  2026-10-11T02:12:00.059Z
  host-b    host-b            9f8e7d6c  2026-10-12T08:30:00.000Z

> crosschat serve --via tcp:cloud --list-members
星 cloud 成员册（2 条）：
  9f8e7d6c claude/worker2 @ host-b（在线）
  ec542c2c claude/boss @ yang
```

写 op（本机条目须带 `adminKey`，见 [1.2.4](#124-管理权限三层) 发钥）：

```
> crosschat serve --via tcp:cloud --gen-key 1
远端发钥（星 cloud，broker ws://192.168.1.10:7260）：生成 1 把钥匙
--------------------------------
{ …node.json 同 1.2.3… }
放置路径（目标机器）：~/.crosschat/tcp/node.json（入多星把各星条目合并进同一份 brokers 数组）
钥匙已进入终端回滚缓冲，分发完建议清屏

> crosschat serve --via tcp:cloud --remove host-b
已从星 cloud 远端移除 host-b
```

两条教学错误（照抄即自纠）：

- 本机条目无 `adminKey` → `本机 node.json 的星 cloud 条目无 adminKey（星管理钥）——找 broker 主发放（broker 机 crosschat serve --star <星> --gen-admin-key <label>），把回显的 adminKey 并进该星条目`
- 钥匙已吊/不属于该星 → `BAD_AUTH 星管理钥证明不匹配（钥匙已吊销或不属于本 broker 的星）——找 broker 主核对：crosschat serve --list 可查管理钥 label`

#### 1.2.6 删星（--remove-star）

删整星是破坏性动作：执行前先打**将死清单**（无 y/n 交互——看清再回车）；册随星葬、钥匙作废、无墓碑无复活；**最后一颗星也允许删**（零星合法）：

```
> crosschat serve --remove-star drill1
将删除星 drill1：登记机器 1 台、册内成员 1 名——册随星葬、钥匙作废、无墓碑无复活（被删星连接即断）
星 drill1 已删除（经在跑 broker：连接已断、聚合器已收、status 已刷新）
```

删后语义三条：

- 被删星的**在线成员**先收 `STAR_DELETED 星 X 已被删除（crosschat serve --remove-star）——册随星葬、钥匙作废、无墓碑无复活；如需重建找管理员 crosschat serve --add-star` 错误帧再断连
- **发送方直报**：其他机器拿死星钥再投 → `BAD_AUTH 钥匙不匹配任何星——星可能未创建或已删除（--remove-star 即废钥），找管理员核对 node.json 或索取新配置`（不走防重发绕弯）；broker 机自登记条目随删摘除，本机投递改报 `--via 选择器 drill1 不匹配任何条目——本机 node.json 现有：…（现存星清单）`
- **重建** = 重新 `--add-star` + 重新配钥入星（旧钥匙已废，node 侧死条目靠上述教学自清）

#### 1.2.7 升级 broker 节点

```
> npm i -g @oatelauser/crosschat@latest
> crosschat serve --stop && crosschat serve --detach
> crosschat install-skills
```

> 为什么必须重启常驻：npm 升级只换 CLI，`serve` 常驻进程仍跑旧版本——doctor 的版本对账行会点名。

**验证**：
```
# 期望：无 ❌（版本对账行不再点名"升级后未重启"）
> crosschat doctor
```

### 1.3 node 节点

#### 1.3.1 配置连接密钥

本机先装 crosschat（`npm i -g @oatelauser/crosschat && crosschat install-skills`），再把钥匙存成 `~/.crosschat/tcp/node.json`。一般情况下都不需要怎么修改，占位符对照：

| 占位符 | 填什么                                                                     |
|---|----------------------------------------------------------------------------|
| `<broker公网IP>` | broker 的可达地址——云机/NAT 填**对外公网 IP**（按 [1.2.3](#123-发钥--gen-key) 的 host 规则核对） |
| `<端口>` | broker 端口，数字不带引号（默认 7260）                                     |
| `<星名>` / `<starId>` / `<钥匙>` | 钥匙 JSON 里原样照抄，不改                                                 |
| `<本机名>` | 本机自报名（建议=hostname；star 集群里怎么称呼你）                         |

完整文件示例：

```
> mkdir -p ~/.crosschat/tcp && nano ~/.crosschat/tcp/node.json
# 粘贴整段 JSON，改 host 与 showName，保存
> cat ~/.crosschat/tcp/node.json
{
  "brokers": [
    { "host": "<broker公网IP>", "port": <端口>, "name": "<星名>", "starId": "<starId>", "key": "<钥匙>" }
  ],
  "showName": "<本机名>"
}
```

**机器改名**：node 机=改本机 node.json 的 `showName`（顶层=全局默认；条目级=按星覆盖，缺省回落全局）+ 重启守护；broker 机=`crosschat serve --show-name <名>` 全局热改 / `--star <星> --show-name <名>` 按星热改（秒级）。名字来源=各机自己的 node.json（全局默认+按星覆盖，036 双态），别手改 broker.json。

**验证**：
```
# 期望：无 ❌；tcp 条目缺 starId、同星双条目等配置问题会被 ⚠️ 点名
> crosschat doctor
```

#### 1.3.2 启动聚合器连接星

起这条常驻连接**兼任聚合器**，一份进程两份职责：
- **收件**（断了=别人发你 `PEER_OFFLINE`；普通断线自动重连；明确撤权后暂停该星重连与启动器自动拉起，换钥后显式重连）
- **维护本机会话的星籍**（把入星声明报给星——[2.3](#23-extends-换轨接任旧会话退休新会话接班)/[2.4](#24-adopt-收编会话活着但不在星里)/[2.5](#25-重启自愈与降级告警) 的换轨、收编、自愈全靠它）

```
> crosschat serve --connect <星名> --detach
节点客户端后台运行中 pid=8412（日志：/home/me/.crosschat/tcp/node.log）
```
隐式操作：
- **每（机器×星）永远只有一个聚合器**：重复 `serve --connect <同星>` 会被双开防护直接拒绝（exit 1 + 教你先 `serve --stop`）
- 它兼任两职：机器级收发（本机出站的星凭证）+ 本机会话的星成员聚合（N 个会话共用这**一条**连接，不随会话数增长）
- [启动会话](#133-启动会话入星)时的 `--connect` 会在聚合器没跑时**自动拉起**——本节手动命令是兜底不是必经

多星机按星名各跑一条：
> broker 机跨机聊天不用启动聚合器，使用[会话入星启动](#133-启动会话入星)
```
> crosschat serve --connect cloud --detach     # 挂 cloud 星收件+聚合
> crosschat serve --connect home --detach      # 挂 home 星
> crosschat serve --stop cloud                 # 只停 cloud；无参=全停（先守护后 broker）
```

**验证**：

1. 验证星集群的状态
   ```
   # 期望：星可达、守护 online、本机在机器表：
   > crosschat status --stars
   tcp: 共 1 星
     <星名> ✓ 可达，2 机器在线
     守护: <星名>: online
     <本机名>(ec542c2c) 在线
   ```

#### 1.3.3 启动会话（入星）

三个动词各管一层：`serve --connect` = **机器接入**，启动器 `--connect` = **会话注册入册**，`--rm` = **临时修饰**。会话注册 1.7.0 起**默认永久**（破坏式变更：1.6.x 原为退出即退星）——退出只是下线，册位保留在星册（roster），同 id resume/重启自动复活。

**claude 会话入星（永久注册，默认）**：

1.新会话入星 = 自动启动聚合器（假设没启动） + 启动会话入册
```
> crosschat claude -n <会话名> --connect <星名>     # -n 是 claude 原生命名参数，包装器只透传不认领
入星 <星名>——会话地址 tcp:<星名>:<本机名>:<会话名>（attach 自动，异常见日志）
```
隐式操作：
- 横幅在 claude 接管屏幕**前**打印（报地址不预支成功）；启动后入星全程静默——attach 确认/断连重连提示落 `~/.crosschat/tcp/launcher.log`，失败才出一行 stderr
- 星内已有**异工具同名**成员时，横幅后多一行预警（同样 spawn 前打）：`预警: 星内已有 codex/<会话名>，你的地址将是 claude/<会话名>（同名异工具，发送方需带工具限定词）`——把发送期碰撞提前到启动期可见；聚合器不在则静默跳过（尽力而为，不延迟启动）
- 聚合器没跑会**自动拉起**（几秒内），不用管
- **退出 = 下线，不是退星**：册位保留，`status --stars` 显示为下线成员（`下线: ⚪…` 行）；期间投它报 `SESSION_OFFLINE`（等上线，绝不静默改投）
- **同 id `/resume` 或重启 = 自动复活上线**（聚合器对账循环本地验活，数秒内重入册），无需任何重新声明；会话内 `/rename` 改名 → 聚合器扫描（≤30s）自动跟随

2.启动式的 `/resume` 恢复上下文入星（推荐——对**任何**对话都成立，无论它之前入没入过星）
```
> crosschat claude --connect <星名>   # 起进程入星（此刻还没名字）
> /resume <会话名>                    # 进程内切对话
```
隐式操作：
- 成员资格跟着**进程的启动声明**走（声明的是启动那一刻的会话 id）；`/resume` 切对话后由**聚合器扫描跟随**（会话名 ≤30s 更新）——资格不依赖 claude 内部的会话号行为
- ⚠️ 个别 claude 版本 resume 换号导致旧声明失配（投三段地址报 `SESSION_NOT_MEMBER`/`SESSION_OFFLINE`）：等对账循环一轮（新 id 若在册即自动复活），或同方式 3 的 `--adopt`，或退出后用本方式重进
- **resume 进哪个对话，哪个对话即经本会话可达**——等效收编：之前从没入过星的对话，切进来就直达
- 会话名自动跟随 resume 进来的对话名（扫描 ≤30s 更新）；退出=下线（册位保留）

3.普通方式 `/resume`（裸起会话）——**注意：这种方式不做启动声明**，分情况：
```
> crosschat serve --connect <星名> --detach   # 只启动聚合器（聚合器不自动收编任何会话）
> crosschat claude                             # 裸起会话：没带 --connect
> /resume <会话名>
```
分情况说明：
- resume 的是**普通对话**（从没入过星）→ 星内无人可达它，投三段地址报 `SESSION_NOT_MEMBER`（要入星走下面的 `--adopt`）
- resume 的是**星内老对话** → 1.7.0 起**自动归队**：该会话在册（下线态），聚合器对账循环本地验活发现它活着即自动复活上线（≤30s）——册位在，裸 resume 也能回队（1.6.x 须 adopt 的痛点已由落盘册根治）
- 等不及/没归队时补救：收编 `crosschat serve --connect <星名> --adopt <会话名>`（`status --stars` 会在诊断行直接打印这条命令，照抄即可）

**临时会话（`--rm`，docker --rm 语义）**——一次性 worker 用它，退出即离册零痕迹：

```
> crosschat claude -n <一次性名> --connect <星名> --rm
# 退出即删册位：之后按名投报 SESSION_NOT_MEMBER（与从未入册同码）
```
- `--rm` 只作用于**会话册位**，不碰机器守护（聚合器生命周期独立——永久成员的复活检测依赖它活着；退机器走显式 `serve --stop`）；`serve --connect … --rm` 组合被拒绝
- `--rm × --extend-session` 互斥报错（临时会话无血统可接）

**彻底删册位（member-remove）**——永久成员的自退/管理删（幂等，星内任何机器可执）：

```
> crosschat serve --connect <星名> --member-remove <会话名|id8>
# 下线≠删除：册位还在就还能复活；member-remove 才是删——之后该名投递报 SESSION_NOT_MEMBER
```

**codex 形态**（无 `-n`：codex 没有启动期命名参数，进去后改名，聚合器扫描自动跟随）：

```
> crosschat codex --connect <星>
入星 <星>（attach 自动，异常见日志）      # codex 无 -n：启动前只打星名行，地址待 /rename 后由扫描补
# （codex 交互里）/rename <会话名>
# 聚合器下一轮扫描（≤30s）即把该名挂进成员表，三段寻址生效
```
（codex 同样吃双模式：默认永久注册/退出下线/同 id 复活；一次性加 `--rm`。）

**多星并存**（`--connect` 可重复；一台机/一个会话可同时挂多颗星）：

```
> crosschat claude -n <会话名> --connect <星> --connect <另一星>
# 两颗星各出一行"入星"，tcp:<星>:<本机名>:<会话名> 与 tcp:<另一星>:<本机名>:<会话名> 都直达
```
（各星独立册、独立上下线；`--rm` 作用于同命令的全部 `--connect`。）

**验证**（两步：成员表见它；真发一条是最终裁决——本机对自己发也走全链）：
```
# 期望：星下多出会话成员行——`会话: <本机名>:claude/<会话名>`（带工具前缀；老聚合器未声明 tool 时保持裸名）；
# 退出后再看：同位置变 `下线: ⚪<本机名>:claude/<会话名>（等 resume 复活…）`
> crosschat status --stars
# 期望：`delivered to <会话名>@<本机名>(ec542c2c) (turn 1) · 续话 c1`，且该会话里收到消息
> crosschat send --via tcp:<星>:<本机名>:<会话名> --body "联调测试"
```

双机全链把玩（对端机器的会话、错误教学、extends、adopt、重启自愈、热加删星）见 [2.7 验证阶梯](#27-验证阶梯全链把玩顺序执行)。

#### 1.3.4 会话继承（换轨接任）

会话上下文耗尽、换新会话接班时，用 `--extend-session` 声明继承——对端投**旧会话名**会得到接任者指路，不用挨个通知：

1.改名接任（新会话用新名）
```
> crosschat claude -n <新会话名> --connect <星名> --extend-session <旧会话名>
# 对端再投 tcp:<星名>:<本机名>:<旧会话名> →
# ❌ SESSION_SUPERSEDED：旧会话已由 <新会话名> 接任（报错里带 tcp:<星名>:<本机名>:claude/<新会话名> 指路——带工具限定词）
# 对端改投 <新会话名> 即达
```
2.同名接任（新会话沿用旧名）——**不需要** --extend-session
```
> crosschat claude -n <旧会话名原样> --connect <星名>
# 名字是寻址句柄：旧名随新会话复活，对端按原名照投即达
```
隐式操作：
- **先声明先得（按血统）**：同工具同旧名只认第一个 --extend-session 声明，后来的启动时报错拒绝；跨工具血统各归各（claude"boss"与 codex"boss"的接任互不冲突）——投旧裸名有多条血统时报 `NAME_COLLISION` 列出全部接任者地址
- **活着优先**：旧会话还活着时声明接任 → 存为"候任"，旧会话正常收消息，死后接任才生效
- **接任者胜复活**（1.7.0）：名字被接任后，原会话同 id 回归**不夺回**名字（收 `EXTENDS_CONFLICT` 教学——按 id8 寻址或换名重启）；extends 是唯一名字转移口
- **校验分级**：本机有该旧名的对话史 → 严格校验防手滑；无记录 → 静默放行（无人会查询的名字，声明无害）

#### 1.3.5 node节点升级

同 [1.2.7](#127-升级-broker-节点) broker 节点款，重启换成守护形态：

```
> npm i -g @oatelauser/crosschat@latest
> crosschat serve --stop
> crosschat serve --connect <星名> --detach  # 或者使用会话入星的操作，也可以启动聚合器
> crosschat install-skills
```

**验证**：
```
# 期望：无 ❌
> crosschat doctor
# 期望：已入星的活会话数秒内经恢复链自动回成员表（见 2.5；broker 与本机聚合器**都**重启过则走 2.4 adopt）
> crosschat status --stars
```

---

## 二、日常使用

部署完（第一章），日常就剩一件事：像单机一样给 agent 一句话。命令、协议、回程路由全部由信封自带——**你不需要记任何命令**。

### 2.1 跨机聊天（一句话触发）

准备：两端各有已入星的 agent 会话（[1.3.3](#133-启动会话入星) 启动器起的）。然后整个过程（图例：**👤 用户** 你说的指令 · **🤖 agent** 回复/收件 📨）：

```
👤 用户[boss -> worker2]  用 crosschat 走 tcp 跨机给 tcp:<star>:<showName> 机器的 claude 会话「worker2」发任务：要求它跑一次构建并回报结果。
🤖 worker2 收到            📨 来自另一会话的消息:
                          <cross-session-message from-name="boss" from-machine="<A机>" from-addr="tcp:<星>:<A机>:claude/boss" turn="1">
                          …跑一次构建并回报结果…
                          回复请运行: crosschat send --conversation c3 --body "<你的回复>"（长正文/含敏感字符可省 --body 改管道喂 stdin）
🤖 worker2[worker2 -> boss] 构建完成，产物清单见下一条
🤖 boss 收到               📨 构建完成，产物清单见下一条（turn 2，自动经 broker 跨机回到 A 机）
```

agent 组装的就是三段寻址（[2.2](#22-三段寻址找人)）；回程路条由信封自动携带，worker2 零配置照抄即回。

查对端机器上的会话名单（发起跨机新消息前先点名，机器级操作）：`crosschat status --via tcp:<机器名|mid8>`——过滤参数（`--claude`/`--codex`/`--name`）与本地同构；ssh 形态对端仍用 `ssh <对端> crosschat status`。

### 2.2 三段寻址（找人）

```
crosschat send --via tcp:<星>:<机器>:<会话> --body "构建跑了吗"
                      │     │      │      └ 会话名（星成员名；禁冒号；同名撞车时可带工具限定词 <工具>/<会话名>）
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

**工具限定词**（同机 claude/codex 同名时消歧）：会话段可写 `<工具>/<会话名>`，如 `tcp:cloud:host-a:claude/boss` 与 `tcp:cloud:host-a:codex/boss` 各达各的。裸名唯一时照旧可用（已发布地址零破坏）；撞名时报 `NAME_COLLISION` 列出全部限定地址，照抄即达；**同工具**同名（限定词救不了）报错改列 `会话名(id8)` 两行，会话段投 `<id 前 8 位>` 短前缀直达（与机器段 mid8 同一语法）。解析规则防自伤：会话段全串先按裸名精确匹配（会话名本身可含 `/`），未命中才拆限定词，且前缀仅当命中该机已声明的工具值才生效——新适配器声明即寻址，broker 不内置工具清单。

错误三条：

- 非成员名 → `SESSION_NOT_MEMBER`（教学：会话须经启动器入星——对端重起或 [2.4](#24-adopt-收编会话活着但不在星里) adopt 收编）
- 死名有人接任 → `SESSION_SUPERSEDED`（报错原文给出接任者的三段地址——带工具限定词，改投即可）
- 同名撞车 → `NAME_COLLISION`（列限定地址或 id8，见上）

### 2.3 extends 换轨接任（旧会话退休，新会话接班）

场景：旧会话 boss 退休了，新会话要接任它的名字血统——投给旧名的消息自动被指路到接任者：

```
> crosschat claude -n boss2 --connect cloud --extend-session boss
入星 cloud——会话地址 tcp:cloud:host-a:boss2（attach 自动，异常见日志）
# 有对话史时日志（~/.crosschat/tcp/launcher.log）里多一行：
#   extends boss：本机有该名对话史——接续登记后，投给旧名的消息将指路到新会话
```

`--extend-session` 的四级校验（失败方向不锁死）：旧名仍是**活成员** → 拒绝并指路（先退旧会话或去掉旗标）；本机有该名对话史 → 放行并出声；都无 → 静默放行（没人查询的名字无害）；broker 侧同旧名撞车 → 回执 `EXTENDS_CONFLICT` 指路先声明者（后声明者照常入星，只是 extends 不生效）。

**alive-wins**：旧名还是活成员时 extends 休眠——投旧名仍到旧会话本尊，这是防误伤的保守语义。

顺带两条自动语义（无需操作）：

- **改名跟随**：claude 会话内 `/rename`，聚合器下一轮扫描（≤30s）自动更新成员表（同会话 ID 换名）；codex 同理。改名后旧名自然退位（投旧名按非成员报错）——要保留旧名可达性，用上面的接任声明
- **双活性模型**（1.7.0：死=下线，册位保留）：claude 成员活性 = 进程在（退出即下线，同 id 重启自动复活）；codex 成员活性 = 线程在（rollout 落盘、durable——TUI 关了线程还在，resume 即复活；extends 对 codex 几乎不适用）

### 2.4 adopt 收编（会话活着但不在星里）

**什么时候需要**：会话活着、但不在星成员表里。三种来路——① 会话被 `--rm`/member-remove 删过册位（1.6.x 的"双端重启失忆"已由落盘册根治，重启不再丢名单）；② 会话不是经启动器起的（裸 `claude`/`codex` 起的，现在想入星）；③ 改名后想补旧名接任声明。**判定信号**：投三段报 `SESSION_NOT_MEMBER`，或 `crosschat status --stars` 里出现诊断行：

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

**恢复链**（重启自愈，一般无需人工）：聚合器重启 → 向 broker 查回本机最后已知名单 → 逐个本地验活 → 活的自动重新入册（孤儿会话自动找回，死名不复活）；broker 也重启过（双失忆）→ 恢复链空 → 走 [2.4](#24-adopt-收编会话活着但不在星里) 的 adopt（status 诊断行会把命令打印好）；启动器还活着时则连查都不用查——旗标在手，原样重声明（含 extends）。

**降级告警**：本机 crosschat 比 broker 机新（broker 还不支持会话成员）时，启动器/聚合器会在**命令行直接打一行**：

```
broker 不支持会话成员（proto:3），已降级机器级——本机会话的入星声明不生效（机器级收发不受影响）
```

含义：机器级操作（远程枚举、文件通道）照常工作，只是入星/三段寻址/extends 不生效。解法 = 按 [1.2.7](#127-升级-broker-节点) 升级 broker 机的 crosschat 后重启 serve，零配置自动恢复。

### 2.6 文件通道（--file，机器级）

消息里塞大内容不如直接送文件。`--file` 与机器级 `--via tcp:<机器>` 同用（文件落在对端机器的收件目录，通知对端会话去读），一句话题词形态：

> 用 crosschat 走 tcp 跨机把 ./report.md 文件发给 host-b 的 worker2，正文让它分析这个文件。

对端收到的正文是自动生成的：`文件 report.md 已送达：/home/<B用户>/.crosschat/tcp/inbox/3f2a1b9c-report.md`——路径在**对端机器上**，agent 直接可读。语义五条：

- **sha256 锚**：发送前算摘要；对端收齐校验不过则清残片要求整档重传（重跑同一命令即可）
- **断点续传**：每 256KiB 一块落盘，中断后重跑同一命令从断点续传（对端保留锚点）
- **去重秒回**：对端 inbox 已有同 sha 文件时直接回路径，不重传
- **懒删除回收**：inbox 文件 >5 天删；总量 >512MiB 从最旧删起——**附件过期就没了**：收到"已送达"但路径不存在（>5 天），回对端"附件已过期，请重发 --file"
- **单文件上限 64MiB**；超限报 `FILE_TOO_LARGE`，请压缩或分段（tcp 正文超 1MiB 会自动转文件通道，见 [SKILL.md](../skills/crosschat/SKILL.md) 大小地图）

### 2.7 验证阶梯（全链把玩，顺序执行）

双机剧本：云机 serve 已起、已 `--add-star cloud-broker`（[第一章](#一环境搭建)搭好，云机与发起端都已贴钥匙），云机上再入星两个会话当对端。每步"命令 → 期望输出"成对，从上往下走完 = 三段寻址、错误教学、换轨接任、收编、重启自愈、热加删星全部亲手过一遍。

**云机：**

1. （022 起无需操作——broker 进程已自动内挂本机聚合器；旧版 crosschat 的星心机才需要 `crosschat serve --connect cloud-broker --detach` 起第二个常驻）
2. cd 到任意工作目录，跑：`crosschat claude -n cloudworker10 --connect cloud-broker`
   → 期望一行（claude 启动前）：`入星 cloud-broker——会话地址 tcp:cloud-broker:cloud:cloudworker10（attach 自动，异常见日志）`
   → 进入 claude 后随便说一句话让它活着

**本机：**

3. `crosschat status --stars`
   → 期望：cloud-broker 星下出现 `会话: cloud:cloudworker10`
4. `crosschat send --via tcp:cloud-broker:cloud:cloudworker10 --body "三段直达验证"`
   → 期望：`delivered to cloudworker10@cloud(000c6989) (turn 1)`，云端会话里收到
5. `crosschat send --via tcp:cloud-broker:cloud:ghost --body x`
   → 期望：`SESSION_NOT_MEMBER` 报错 + "会话须经启动器入星"教学

**云机（工具限定词——同机同名消歧）：**

6. 再入星一个 codex 同名会话：`crosschat codex --connect cloud-broker`，进入后 `/rename cloudworker10`
   → 本机 `status --stars`：成员行变 `cloud:claude/cloudworker10、cloud:codex/cloudworker10`
7. 本机裸名投：`crosschat send --via tcp:cloud-broker:cloud:cloudworker10 --body x`
   → 期望：`NAME_COLLISION`，列出 `tcp:cloud-broker:cloud:claude/cloudworker10` 与 `…:codex/cloudworker10`，改投限定地址即可
8. 限定直达：`crosschat send --via tcp:cloud-broker:cloud:codex/cloudworker10 --body x`
   → 期望：delivered，codex 会话收到（回执显示 `codex/cloudworker10@cloud`）

**云机（extends 接任）：**

9. 退出 claude 那个 cloudworker10（Ctrl+C），另起接任：
   `crosschat claude -n cloudworker11 --connect cloud-broker --extend-session cloudworker10`
10. 本机投限定旧名：`crosschat send --via tcp:cloud-broker:cloud:claude/cloudworker10 --body x`
    → 期望：`SESSION_SUPERSEDED` 报错，内含 `tcp:cloud-broker:cloud:claude/cloudworker11` 指路；改发 cloudworker11 → delivered
    → 顺带验证 alive-wins：投裸名 cloudworker10 仍 delivered（codex 那位活着）

**云机（adopt 收编）：**

11. 裸起一个会话（直接敲 `claude`，不经 crosschat），进去后 `/rename limbo`
12. 云端另开终端：`crosschat status --stars`
    → 期望出现诊断行，直接给出完整命令：`crosschat serve --connect cloud-broker --adopt limbo`
13. 照抄执行
    → 期望：`已收编 limbo…入星 cloud-broker`；本机发 `tcp:cloud-broker:cloud:limbo` → delivered
    → 再跑一次 adopt → 期望"已是成员"幂等提示（exit 0）

**重启自愈（云机，保持 cloudworker11 活着）：**

14. `crosschat serve --stop && crosschat serve --detach`
    → 本机 `status --stars`：cloudworker11 成员行数秒内自动回来（恢复链验活重入册）

**热星 drill（云机 broker 在跑，加星→收→删全程免重启）：**

15. `crosschat serve --add-star drill1`
    → 期望：`已加星 drill1——本 broker 现托管 2 颗星（经在跑 broker 已生效，免重启；自登记+内挂聚合器随对账落位）`——cloud-broker 星全程零感知
16. 云机 cd 到工作目录跑：`crosschat claude -n drillworker --connect drill1`，随便说一句话让它活着
    → 期望一行：`入星 drill1——会话地址 tcp:drill1:cloud:drillworker（attach 自动，异常见日志）`
    → 云机 `status --stars`：drill1 星下出现 `会话: cloud:drillworker`
17. 云机：`crosschat send --via tcp:drill1:cloud:drillworker --body "热星验证"`
    → 期望：`delivered to drillworker@cloud(000c6989) (turn 1)`——broker 一次都没重启
18. 云机：`crosschat serve --remove-star drill1`
    → 期望两行：`将删除星 drill1：登记机器 1 台、册内成员 1 名——册随星葬、钥匙作废、无墓碑无复活（被删星连接即断）` + `星 drill1 已删除（经在跑 broker：连接已断、聚合器已收、status 已刷新）`
    → 云机再投同地址 `crosschat send --via tcp:drill1:cloud:drillworker --body x`
    → 期望：`USAGE: --via 选择器 drill1 不匹配任何条目——本机 node.json 现有：cloud-broker(6b76e1)`（broker 机自登记条目随删摘除，现存星清单直报）
    → **其他机器**拿 drill1 死星钥再投 → 期望：`BAD_AUTH: 钥匙不匹配任何星——星可能未创建或已删除（--remove-star 即废钥），找管理员核对 node.json 或索取新配置`

---

## 三、底层实现

<details><summary>展开：内部调用链 / mid8 寻址 / 自登记与管理插座 / 手动命令实录 / 多星成员（点击）</summary>

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

### 3.3 自登记与管理插座（为什么加星免重启、谁能写台账）

**自登记**：serve 启动与 `--add-star` 都会把 broker 机登记进每颗星（star.nodes 的 self 条目，带 machineId + 专属钥匙）——其他机器立刻可寻址它、发给它的消息走本机直投不过网络；同时写本机 `~/.crosschat/tcp/node.json` 自用凭证（host=127.0.0.1，本机 `send --via tcp:` 连回自己鉴权）。已存在则**跳过不覆盖**并按状态出声：指向别家（提示本机发送将走它）/ 钥匙或端口陈旧（BAD_AUTH 预警，删文件重启重建）/ 一致（静默）。broker 机与其他节点完全同构——所有机器的发送走同一条代码路径，这是协议教学能内建的前提。

**管理插座（033 热闭环的核心）**：broker 运行期是台账（broker.json）**唯一写者**——管理命令（加删星/改星名/改显示名/发钥删钥/发吊星管理钥）热路径经本机管理插座（unix socket / win 命名管，零 TCP 端口；地址随机=知道地址即能力，写进 status-broker.json）受理，CLI 打印"已生效"必出自 broker 回执；插座连上但回执超时=CLI 报错教重试，**绝不回落直写**。broker 没跑时走冷路径：CLI 直调同一套 registry 库函数落盘（函数不分家——首星/预配机不断腿），serve 启动即托管。对账幂等（按 starId）：磁盘新增星落位并播种内挂聚合器；消失星收尾（弃状态→停聚合器→闭连接，被删星在线会话先收"星已删除"教学帧）。

**审计（034）**：管理写 op 逐笔记 broker.log——`audit admin-op <动作> <对象> 来源=本机插座`（本机 CLI）或 `来源=星管理钥(<label>)`（远程挑战应答连接）；星管理钥连接入星另记 `admin-auth 星管理钥(<label>) 入星 <星>`。

> 设计取舍：broker 只认钥匙不认人（连 127.0.0.1 来的也要刷卡——"本机免检"等于给同机所有进程开后门）；管理插座只在本机、地址随机——"broker 主"不是一把钥匙，是**物理在场**这件事本身，世上不存在全能远程钥匙由此落地。

### 3.4 手动命令实录（agent 视角之外，人肉操作时用）

A 机发起（三段直达）：
```
> crosschat send --via tcp:cloud:host-b:worker2 --body "跑一次构建，产物清单发回来"
delivered to worker2@host-b(9f8e7d6c) (turn 1) · 续话 c3
```
B 机会话里自动出现信封（无需任何题词）：
```
📨 来自另一会话的消息:
<cross-session-message from-name="boss" from-machine="yang" from-addr="tcp:cloud:yang:claude/boss" turn="1">
<crosschat-reply-hint reply-as="worker2">回复请运行: crosschat send --conversation c5 --body "<你的回复>"（长正文/含敏感字符可省 --body 改管道喂 stdin）</crosschat-reply-hint>
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

> 草案期——稳定后对第三方实现承诺兼容。proto:3 不是线上版本号翻页：`proto` 字段仍为 1，新能力经握手 `caps` 数组协商（见 [4.8](#48-proto3-能力协商caps与-attach-管道)）。

<details><summary>展开：握手时序 / 帧表 / 完整帧流 / 错误矩阵 / 文件状态机 / 最小客户端 / caps 协商与 attach 管道（点击）</summary>

这一章写给要在自己的语言/运行时里实现兼容端的人（自建 broker、写个轻量发送器都算）。全部字段以帧表为准，示例值是占位样式。

### 4.1 传输与握手

- **传输**：WebSocket 文本消息，一帧一条 JSON（服务端 `maxPayload` 2MiB）；文件分块的 `bytes` 为 base64
- **握手三帧**（连接建立即开始，10s 未完成握手服务端关闭，close code 4000）：

```
S → C   {"op":"info","proto":1,"server":"crosschat/1.5.1","caps":["session-members"],"starId":"a1b2c3d4e5f6","name":"yang"}
C → S   {"op":"connect","proto":1,"role":"node","machineId":"<全 mid，64位hex>","auth":"<64位hex钥匙>","name":"host-b","caps":["session-members","multi-star"]}
S → C   {"op":"connected","machineName":"yang"}
```

握手时序恒倒置（036 起单星同形——不存在单星机特殊形态）：`info` **不带** starId/name（caps 恒含 `"multi-star"`）——归属星由钥匙自证（连接绑星），`connected` 回填 `starId`/`name`。

**管理连接（034 星管理钥，挑战应答——钥匙永不过线）**：`connect` 带 `admin:true` 且**不带 auth**，broker 回一次性 `nonce`，客户端以 `proof = HMAC-SHA256(星管理钥, nonce)` 的 hex 应答：

```
S → C   {"op":"info","proto":1,"server":"crosschat/…","caps":["session-members","challenge-auth",…]}
C → S   {"op":"connect","proto":1,"role":"sender","admin":true,"caps":["multi-star","challenge-auth"]}
S → C   {"op":"auth-challenge","nonce":"<64位hex一次性>"}
C → S   {"op":"auth-proof","proof":"<HMAC-SHA256(adminKey, nonce) 的 hex>"}
S → C   {"op":"connected"}          # 命中即连接绑星（发放即绑定一星）；未命中=BAD_AUTH（close 4001）
```

- nonce 每连接每挑战现发、证明一次性消费——捕获的旧证明在他连接（nonce 不同）或本连接（已消费，重放=BAD_AUTH）都不再有效
- **无降级路径**：`info.caps` 无 `challenge-auth`（旧版/被中间人剥除）即拒连，绝不回落裸钥发送管理钥
- 被吊管理钥的下一次挑战应答即 `BAD_AUTH`（验证面每连接现读台账）

- `starId`：星标识（broker.json 各星条目内 12 hex，`--add-star` 时生成）——info 恒不携带（036 起单星同形），节点客户端在 connected 回填后校验：与本机条目不符即断连（`STAR_ID_MISMATCH`，钥匙不出手）、缺失即回填
- `caps`（connect 侧）：032 起**必带** `multi-star`——不带（旧版腿）即 `BAD_PROTO` 拒连并教 `npm i -g @oatelauser/crosschat@latest`（非兼容升级，不留历史包袱）
- `role`：`node`（常驻收件，必须带 machineId，首次连接时把 mid 绑定到该钥匙；重连改名即覆盖显示名）或 `sender`（瞬态发送，只要 auth）
- 钥匙不在注册表 / node 的 machineId 与登记不符 → 恒定延迟 500ms 后 `BAD_AUTH`（close 4001）——延迟是防钥匙枚举计时
- 协议版本不符 → `BAD_PROTO`（close 4000）
- 同一 mid 的新连接会顶掉旧连接（旧连接被 close 1000 "replaced"）

- **心跳**：服务端每 30s 发 ws ping，60s 无 pong 判死断开——客户端用标准 ws 库回 pong 即可，无需应用层帧

### 4.2 帧表（25 型；`?`=可缺省）

| 帧 | 方向 | 字段 |
|---|---|---|
| `info` | S→C | proto, server, caps（恒含 `multi-star`）；starId/name **恒不带**（036 起单星同形——倒置形，星标识由 connected 回填） |
| `connect` | C→S | proto, role(node/sender), machineId?, auth?, name?（≤32 字符显示名）, caps（必带 `multi-star`；node 侧另加 `session-members`）, admin?（034 管理连接=true 且不带 auth——走挑战应答） |
| `connected` | S→C | machineName?, starId?, name?（恒回填星籍——036 起单星同形） |
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
| `discover-query` | 双向 | id, targetMachine, request（新只读发现：list/detail；不补投；broker转发时分配独立id） |
| `discover-result` | 双向 | id, ok, result?（Provider/分页/完整ID/详情/来源错误）, error? |
| `discover-cancel` | 双向 | id（仅请求owner可取消；broker向原目标传播取消） |
| `credential-revoked` | S→C | starId, kind(node/admin), reason(node-removed/admin-key-revoked), message；先撤现有连接权限并清路由，再通知断开，不带钥匙 |
| `sessions` | C→S（node） | sessions:[{sessionId, name?, extends?}]——全量重播：数组即该连接当前全部成员，空数组=清空；extends 旧名 string=同机 / {machine,name}=跨机 |
| `members-query` | C→S（node） | （空）——聚合器重启后查回"我以前的成员" |
| `members-result` | S→C | members:[{sessionId, name?, extends?}]——broker 断连后保留的最后已知名单（纯内存，broker 重启即空） |
| `member-remove` | C→S | target（028 删册：名精确或 id 前缀 ≥8 位；星内任何机器可发——命令面 `serve --connect <星> --member-remove` 与聚合器 `--rm` 退场共用） |
| `member-remove-result` | S→C | ok, removed:[名\|id8…], error?——幂等（零命中=ok 注明本不在册）；多名命中=拒绝列 id8 教消歧 |
| `auth-challenge` | S→C | nonce——034 管理连接挑战（一次性；防重放） |
| `auth-proof` | C→S | proof——HMAC-SHA256(星管理钥, nonce) 的 hex（钥匙本体永不出现在任何帧里） |
| `admin-op` | C→S | id, action, n?(gen-key), host?(gen-key), label?(remove-node)——034 星管理域：action∈{list-nodes, list-members, gen-key, remove-node}；list-stars/set-name 等本机域 op 一律 ADMIN_REQUIRED |
| `admin-op-result` | S→C | id, ok, error?, results?(gen-key 新钥+node.json 文本——仅此路径回显钥匙), nodes?/members?（读回显**永不带钥匙**）, removed? |

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
| `ADMIN_REQUIRED` | 034：非管理员调管理 op（成员发钥/删节点、任何人远程调本机域 op） | 找星管理员（星管理钥）或 broker 主本机执行；世上不存在全能远程钥匙 |
| `STAR_DELETED` | 星已被 `--remove-star`（册随星葬、钥匙作废、无墓碑无复活） | 找 broker 主重建（`--add-star`）后重新配钥入星 |

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
2. 等 `info`（校验 proto=1）→ 回 `connect{proto:1, role:"sender", auth:"<钥匙>", caps:["multi-star"]}`（032 起无 caps 即拒）
3. 等 `connected`（收到 `error` 按矩阵应对）
4. 发 `send{id:<自造唯一id>, targetMachine, to, body}` → 等同 id 的 `receipt`（或 `error`）
5. 拿到回执即关闭连接

注意：ws 层 ping/pong 由所用 ws 库自动应答；id 只要在单连接内唯一即可。要收消息就实现 node 角色（常驻 + 处理 `deliver` 回 `result`）+ 心跳。

### 4.7 第三方实现者注意

参考实现是**单 broker 星型**——多实例集群需自行解决实例间路由（哪台节点连在哪个实例）与注册表共享，本实现不含（一台机器入多颗星由节点侧承担，见 3.5）。注册表格式见 broker 机 `~/.crosschat/tcp/broker.json`（032 单文件单形状：`{port?, stars:[{starId, name?, nodes, roster:{entries}}]}`——注册表与各星星册同文件；nodes[] 内 label/key/machineId/machineName/addedAt，034 起 key 可选：星管理钥条目=label+adminKey+addedAt（无 key/machineId，与星钥同表存放）；顶层 `port` 是**手编字段**——`--port` 命令已移除，改文件重启生效）。节点侧 node.json：`{brokers:[{host,port,name(星名),starId,key,adminKey?,showName?(条目级显示名覆盖——036)}…], showName(本机全局默认显示名)}`——旧字段 alias/顶层 name 读取时自动映射；adminKey（星管理钥，与星钥同条目）可选，供远程管理写 op 走挑战应答。`nodes[].machineName` 不是权威——名字来源是各机自己的 node.json（顶层全局默认 + 条目级按星覆盖双态，036 修订 017 单一事实源；节点机经连接帧上报、broker 机经 serve 启动读回刷新；显式缺失/空则清除，roster 回退 mid8）。会话引用 mc2_ 可在尾部携带 starId（flags bit 10）——旧版解析器遇此扩展走 `INVALID_CONVERSATION_REF`+升级指引，属设计好的版本偏差路径。

### 4.8 proto:3 能力协商（caps）与 attach 管道

**caps 协商**（线版本号不动，能力走握手数组）：

- broker 的 `info` 恒带 `caps`，proto:3 起含 `"session-members"`，多星 broker 另含 `"multi-star"`，034 起恒含 `"challenge-auth"`（管理连接挑战应答）；老 broker（proto:1 期）`caps` 缺省或为空
- 会话级感知的聚合器在 `connect` 带上 `caps:["session-members","multi-star"]`；**不带 `multi-star` 的旧版腿 032 起直接拒连**（BAD_PROTO+升级教学，非兼容升级），不带 `session-members` 的新版腿按机器级对待
- 034 管理连接在 `connect` 带上 `admin:true` + `caps:["multi-star","challenge-auth"]`；客户端见 `info.caps` 缺 `challenge-auth` 即拒连（无降级——绝不裸发星管理钥），星钥连接不受影响
- 聚合器发现 broker 无此 cap → **不发** `sessions`/`members-query`（老 broker 对未知 op 静默丢，发了也白发），并在命令面打一行降级告警（见 [2.5](#25-重启自愈与降级告警)）
- 后续能力（如 010 TLS）沿 `caps` 数组追加，不翻 `proto` 字段

**attach 管道**（启动器↔聚合器的本机 IPC；win named pipe `\\.\pipe\crosschat-attach-<星名>` / unix `<tcp目录>/attach-<星名>.sock`）：换行分隔 JSON，逐帧回执一行：

| 帧 | 语义 |
|---|---|
| `{op:"attach", sessionId, name?, extends?}` | 声明成员（成员键=会话 ID；name/extends 禁冒号；幂等重声明=覆盖） |
| `{op:"detach", sessionId}` | 退星（幂等：不在表内也回 ok） |
| `{op:"sync", sessions:[…]}` | 全量对账（替换整表） |
| `{op:"status"}` | 只读探针 → 回 `{ok, online, brokerCap, members:[…]}`（启动器 extends 校验与 adopt 幂等判断的数据源） |

聚合器侧语义：成员表变化即全量重播 `sessions` 帧；对账循环常态化（1.7.0）——每轮 members-query 拉册切片 + 本地验活（claude=进程扫描，codex=rollout 落盘存在）：死→上报下线（册位保留，不再除名）、册内活而未声明→自动复活；扫描同时做改名跟随（同 id 换名即更新重播）。

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
| `SESSION_NOT_MEMBER 会话 X 不是星成员` | 三段寻址的会话名没入星（裸起的会话）或已被 `--rm`/member-remove 删除 | 该会话所在机用启动器入星（`crosschat claude -n <名> --connect <星>`）；会话已活着则 `crosschat serve --connect <星> --adopt <名>` 收编 |
| `SESSION_OFFLINE 成员 X 已下线` | 永久成员退出/死亡（1.7.0：册位保留，不再除名） | 等 resume 上线（同 id 自动复活）后重发；或新会话 `--extend-session` 接任；或会话段投 `<id 前 8 位>` 点对点 |
| `MACHINE_BOUND 册位绑在 X` | 同 id 换机器 resume（跨机复活被拒） | 先在原机器 `serve --connect <星> --member-remove <名|id8>` 删册位，再到新机器重新入星 |
| `SESSION_SUPERSEDED 已由 <机器>:<会话> 接续` | 旧名是死名且有接任者（--extend-session 声明过） | 照报错里的 `tcp:<星>:<机器>:<会话>` 改投接任者 |
| `EXTENDS_CONFLICT`（启动器/adopt） | extends 旧名仍是活成员（alive-wins 下会休眠） | 先退旧会话再接续，或去掉 `--extend-session` 直接开新名 |
| `STAR_DELETED 星 X 已被删除`（成员被断连） | 星被 `--remove-star`（册随星葬、钥匙作废） | 无复活——找 broker 主 `--add-star` 重建后重新配钥入星 |
| `BAD_AUTH 钥匙不匹配任何星——星可能未创建或已删除` | 拿死星钥投递（星被删或从未创建） | 同上——重建后重新配钥；别重试（旧钥已废） |
| `--via 选择器 X 不匹配任何条目…`（broker 机投已删星） | broker 机自登记条目随删星摘除 | 报错里已列现存星清单；星重建后自登记自动回填 |
| `ADMIN_REQUIRED 管理op…` | 非管理员调管理 op（普通成员发钥/删节点、任何人远程调本机域 op） | 找星管理员（星管理钥，`--via` 写 op）或到 broker 机本机执行；世上不存在全能远程钥匙 |
| `BAD_AUTH 星管理钥证明不匹配…` | 星管理钥已被吊销或不属于该 broker 的星 | broker 主 `crosschat serve --list` 查管理钥 label；要恢复就重发 `--gen-admin-key` 并换新 adminKey |
| `USAGE serve: --port 已移除（034）` | 用了已删的 `--port` 旗标 | 手编 broker.json 顶层 `"port"` 后重启 serve；首启非默认口=先手写 broker.json（`{"port": <N>, "stars": []}`）再 serve |
| `零星待配（合法状态）`（serve/status/doctor） | broker.json 无星——serve 永不自动造星，零星合法 | `crosschat serve --add-star <星名>` 显式创建首星（[1.2.2](#122-造星--add-star热生效)） |
| 老命令 `--via tcp:<机器> --to <会话名>` 报错教学 | 两段式会话投递已废弃（019） | 会话投递改用三段寻址 `tcp:<星>:<机器>:<会话>`；机器级操作（status 枚举/`--file`）不受影响 |
| 启动器/聚合器打"broker 不支持会话成员（proto:3），已降级机器级" | broker 机 crosschat 还是老版本 | 机器级收发不受影响；升级 broker 机 crosschat 后 `serve --stop && serve --detach` 重启即恢复 |
| 想看远机上有啥会话 | 本机 status 不跨机 | `crosschat status --via tcp:<机器>`（tcp 星；过滤参数同本地）；ssh 形态对端仍用 `ssh <对端> crosschat status` |
| status `节点客户端: 未运行` | 本机聚合器没起（收不到消息的原因） | `crosschat serve --connect <星> --detach` |
| `STAR_ID_MISMATCH 星标识不符已停机` | node.json 条目与 broker 现星标识不符（贴错星/配置陈旧） | 向管理员重新索取 node.json，重启 --connect |
| 多星机裸写 `--via tcp:<机器>` 报"列条目"教学 | 多条目且无会话引用可循 | 加限定词 `--via tcp:<星>:<机器>`；回信不受影响（引用自动带星） |
| status 第二行 broker 不可达 | node.json host/port 错 / 防火墙 / broker 没跑 | 按 [1.2](#12-broker-机起服务与造星)/[1.3](#13-node-节点) 核对；云机安全组 |
| 收到"文件…已送达"但路径不存在 | 附件 >5 天被懒删除回收 | 回对端"附件已过期，请重发 --file" |
| serve 启动即退、报错含 `EADDRINUSE` | 端口被占（多半是旧实例） | `crosschat serve --stop` 再起；换端口=手编 broker.json 顶层 `"port"` 后重启（`--port` 已移除） |
| 升级 npm 包后跨机行为怪异（新 CLI + 旧常驻） | npm 升级只换了 CLI，`serve` 常驻进程仍跑旧版本 | `crosschat serve --stop && crosschat serve --detach`（broker 机）或 `serve --stop && serve --connect <星> --detach`（节点机）重启常驻；`crosschat doctor` 的版本对账行会点名 |

## 清理与卸载

```
> crosschat serve --stop            # 停本机常驻（broker 或聚合器，三重身份校验安全停止）
> crosschat clean [--force]         # 清 inbox/parts + 30 天未更新的 conversations 分片：默认懒删除规则；--force 全清（跳过确认，含未读）
> crosschat uninstall [--yes]       # 删 ~/.crosschat（含状态目录）+ 旧版散装状态目录 + 双侧 skill；serve 在跑会拒删（先 --stop）
                                     # 结尾 npm uninstall -g @oatelauser/crosschat 收尾
```

---

> **迁移注记**：1.6.0 前手册教授的两段式会话寻址（`--via tcp:<星>:<机器> --to <会话名>`）已废弃（wayfinder [019](wayfinder/tickets/019-ambient-session-delivery-retirement.md)）——会话投递统一走三段寻址；机器级操作（远程枚举、文件通道、roster）不受影响。1.8.0 前"serve 首启自动造星 / `--port` 换端口"口径已废（wayfinder [033](wayfinder/tickets/033-star-lifecycle-hot.md)/[034](wayfinder/tickets/034-remote-admin-key.md)）——星一律 `--add-star` 显式创建，端口是 broker.json 手编字段。
