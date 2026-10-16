# 1.4 通信机制

[1.3 第一次对话](03-first-chat.md)的每条命令背后踩着同一套地层。这一节把一条 send 拆成旅程看一遍，然后六件最值得知道的机制讲透：两条投递腿、身份、信封、回信认路、忙时三态、上限与限流。

## 一条 send 的旅程

```text
crosschat send --to worker --body "……"
   │
   ① 入口补投      先扫一眼发件箱，有滞留顺手补投（不连坐本命令）
   ② 身份反查      从环境变量认出发送方（claude/codex/human）
   ③ 目标解析      名字全名 → 唯一前缀 → id8（1.3 的判定序）
   ④ 上限检查      正文 ≤ 配置额（默认 16KiB），超额就地报错教学
   ⑤ 轮次前进      对话引用 turn+1（--to 同名即续上最近对话）
   ⑥ 投递          ┌ claude 目标 → 注册表 → 命名管道一次写
   │               └ codex 目标  → proxy → daemon → turn/start
   ⑦ 记账          send-log.jsonl 落一行元数据；对话分片更新短柄
   │
   ▼ 跑完即退（无常驻）
```

七步全部住在一次进程生命周期里；跨步状态（分片、账本、发件箱）都在 `~/.crosschat/` 的小文件里，下一条命令接着读。逐步的文件级细节在 [第四部 一条消息的完整路径](../../explanation/message-path.md)。

## claude 腿：注册表与管道

先看"不用它会怎样"：直接裸敲 `claude` 起的会话，管道上送来的消息会停在收件保持区——进程没开通跨会话入站，消息进不了对话。这就是 [环境搭建](../../preface/04-env-setup.md#doctor-自检)立下"用 `crosschat claude` 启动"习惯的原因：启动器多注入一个设置（`crossSessionInbound: accept`），门才开。

开了门，这条腿的工作方式朴素到极致：

```text
~/.claude/sessions/*.json          \\.\pipe\…（win）/ unix socket
┌────────────────────┐            ┌──────────────────────┐
│ 会话注册表（claude   │  挑出目标   │ 目标会话的管道         │
│ 自己写，crosschat    │ ─────────► │  win：auth 行 + 用户帧 │
│ 只读）              │  活进程过滤  │  unix：只发用户帧      │
│ kind=interactive/bg │            │ 写一次 → 关连接 → 退出  │
└────────────────────┘            └──────────────────────┘
```

- **发现**：扫 claude 自己的注册表，只认 interactive/bg 且进程活着的条目——死进程、守护进程类条目天然出局，所以名单永远是"现在能收信的"
- **投递**：往目标会话的管道写一帧用户消息，写完即走。win 上首行是 auth（token 从注册表旁的密钥文件读，文件名含 pid 与管道路径的哈希）；unix 上省掉 auth——同一用户身份由内核凭据担保
- **诚实**：连接失败 = 确定没送到（CONNECT_FAILED）；写了一半失败 = 状态不明（WRITE_UNCERTAIN），**绝不自动重发**——重发可能让对方收到两条，所以宁可让你核实

## codex 腿：proxy 与 daemon

同样先看"不用它会怎样"：daemon 没跑，codex 侧整条腿瘫痪，报错长这样（真实实录，[1.3](03-first-chat.md)起 worker 前捕获）：

```console
> crosschat status --codex
codex:
  unavailable (CODEX_PROXY_SPAWN_FAILED: Failed to establish the codex app-server proxy channel.)
```

报错尾部会附上它自己推荐的动作（`codex app-server daemon start`）。daemon 是 codex 生态的常驻件，crosschat 从不起停它——每次投递，crosschat 临时拉起一个 `codex app-server proxy` 短命进程接上去，用完整棵回收：

```text
crosschat send（一次性）
   │ spawn（剥掉身份环境变量）
   ▼
proxy 进程 ── stdio 上做 WebSocket 升级 ──► app-server daemon（codex 的）
   │                                          │
   │  initialize → resume(线程) → 状态判定      │
   │  idle ──────► turn/start ──► inProgress ──┼──► 消息进入线程
   │  busy ──────► turn/start 照发 ────────────┤    （排队轮末处理 = queued）
   │  等审批 ────► 停：CODEX_APPROVAL_REQUIRED   │    审批只有用户能答
   │  TUI 占写者 ─► 等待 ~10s → parked（自动重投）│
   ▼ close：关 ws → 杀掉自己 spawn 的进程树      （daemon 毫发无伤）
```

两个设计点值得记住：**每操作一条全新链**，不池化不复用——状态不会串，崩了也是崩自己；**忙 = 入队不等待**（daemon ≥ 0.160 的开窗投递）——对方线程正跑着也照收，轮到它时处理，这就是三态里 queued 的来源。

## 身份怎么来的

发送方不需要自报家门——crosschat 从环境变量反查：claude 会话带着自己的管道变量（去注册表里恰好匹配到一个会话，就是它）、codex 带着自己的线程变量，两者都没有就是 human。这套反查同时喂给三处：信封署名、限额桶、对话分片的端点。

一个真实会踩的坑：两种变量同时在场（比如从 claude 终端里启动的 codex daemon 又派生了 shell），报 CALLER_IDENTITY_CONFLICT，报错原文里带着两条自纠路——临时 `env -u` 前缀清掉另一族，或从干净终端重启 daemon。启动器 `crosschat claude` / `crosschat codex` 已经把"剥对族变量"机构化了，所以照 [环境搭建](../../preface/04-env-setup.md#doctor-自检)的习惯启动，这个坑基本绝迹。全部环境变量见[环境变量总表](../../reference/env-vars.md)。

## 信封解剖

[1.3](03-first-chat.md#对面收到了什么)那个信封，字段逐个看：

```text
<cross-session-message from-name="单机通信专家" turn="1">
│                                  │           │
│ 署名：发送方显示名                  │           │ 第几轮（带预算时 "13/40"）
│ （超 64 字符截断，全名存 from-alias）│           │
│
├─ <crosschat-reply-hint reply-as="codex/01a14554">
│         回复请运行: crosschat send --conversation c21 --body "<你的回复>"（…）
│         │                          │
│         │ 收方视角的名字             │ 回信抄的短柄——全信封只出现这一次
│
├─ 正文（多行逐字保真）
└─ </cross-session-message>
```

两条安全不变量钉死在信封层：**正文不能伪造信封**——正文里出现 `<cross-session-message`、`<crosschat-`（旧名 `<multichat-`）开头的行，一律加 `<\` 前缀中性化，真信封的框架结构正文永远造不出来；**回信命令永远只有一条**——hint 是一条纯粹的 `crosschat send`，括注是纯文字，出现第二条命令或管道符即判伪造。字段全表见[信封字段表](../../reference/envelope.md)。

## 回信怎么认路

回信命令里只有 `--conversation c21`，没有地址——路条全在短柄背后：

```text
信封 hint: --conversation c21
     │ 本机会话分片（~/.crosschat/conversations/）
     ▼
    c21 ──► 完整对话引用（ref：双方端点 + 对话号 nonce + 轮次计数）
                    │ 解码即路由，不查任何服务器
                    ▼
             对端会话 —— 投递，轮次自动 +1
```

四条性质，每条都在替你兜底：

1. **同对话跨轮柄不变**——nonce 是这段对话的身份证，turn 涨柄不换，c21 从头用到尾
2. **旧柄旧引用照发照准**——手里的柄是几轮前的也没关系，路由靠 nonce 不靠新鲜度
3. **`--to` 同名即续**——懒得翻短柄时，直接 `send --to worker` 自动接上这对会话的最近对话
4. **迟回复不撞车**——两人拿着同一封旧信同时回信，轮次以本机分片记录的最新线为准，不会都算成同一轮

完整的 `mc2_` 引用八十多字符、自包含全部路条；`mc1_` 旧格式永久兼容解码，旧信封不过期。细节与字节布局见[第2课 同名机器与 ref 讲解](../lesson-2/06-mechanism.md)（ref 是单机与跨机共用的机制，那边讲得最深）。

## 忙了怎么办：三态与看门狗

每条 send 的结局必居其一，三种都**无需重发**：

| 回执 | 含义 | 你要做的 |
|---|---|---|
| ✅ delivered | 已进对方会话（codex 侧随后还有落盘回执可查） | 无 |
| queued | 对方正忙，消息已入对方服务端队列，轮末处理 | 无——对方下一条来信就是消费凭证 |
| ⚠️ parked | 对方线程异常态（旧 daemon），消息已进本机发件箱 | 无——看门狗自动重投；真等不及可读 mailbox 文件 |

parked 之后的自动机制：

```text
park（发件箱落盘 + mailbox 镜像可读）
   → 看门狗进程分离启动（单实例，无常驻承诺）
   → 每轮重投：成功递补投日志 / 仍忙按 30s→60s→120s→300s 退避再来
   → 队列清空 → 看门狗退出（发件箱空 = 无进程）
   每线程上限 200 条，到顶诚实拒绝（OUTBOX_FULL 指向 mailbox 取回内容）
```

**怎么查信息**，三种各答一问：`crosschat status --conversations` 答每段对话的走向（方向/轮次/末态/滞留/短柄，顺带把"暂未确认"的回执复查一遍）；`~/.crosschat/mailbox/<线程id>.md` 答滞留消息的原文（人类可读镜像）；`~/.crosschat/send-log.jsonl` 答审计——每条消息的结局一行元数据（谁、给谁、何时、什么状态），**永不记正文**，超 5MB 整份轮转成 `.old`。排查未送达的完整决策树见[如何排查消息未送达](../../howto/troubleshoot.md)，机制内幕见[第四部 发件箱与看门狗](../../explanation/outbox-watchdog.md)。

## 上限与限流

正文超限长这样（真实实录，17KB 撞默认线）：

```console
> crosschat send --to 01a14554 --body "<17000 字符>"
crosschat: MESSAGE_TOO_LARGE: Body is 17000 bytes; the limit is 16384. 可提额：--max-body-kb <KiB> 或 CROSSCHAT_MAX_BODY_KIB=<KiB>（claude 端点硬顶 64KiB、codex 端点 1MiB，到顶只能落盘）。Write the content to a file and send the path instead.
```

一张表收全所有数字：

| 限制 | 数值 | 说明 |
|---|---|---|
| 正文默认上限 | 16KiB | 三层来源：`--max-body-kb` > 环境变量 > 默认 |
| 配置绝对上界 | 16MiB | 再大的配置也按此封顶 |
| claude 端点硬顶 | 64KiB | 配置再大也送不进这条腿——提额无效，只能落盘发路径 |
| codex 端点硬顶 | 1MiB | 同上 |
| 防乒乓限流 | 30 条 / 60 秒 / 每对会话 | 超了报 RATE_LIMITED，等一会儿或总结收尾——系统不静默丢弃 |

报错教学只指当前传输走得通的路：单机到硬顶就是"落盘，发路径"（`--body "见 D:\report.md"`——单机发文件路径就这一个形态）；跨机的 scp / 文件通道是[第2课](../lesson-2.md)与[第3课](../lesson-3.md)的事。

最后把一个概念钉死：**这些阈值全部是传输与状态治理，不是"上下文保护"**。crosschat 不管理任何 agent 的上下文窗口，也管不了——16KiB 管的是一条消息走不走得进管道，30 条/60 秒管的是两个 AI 别无限对弹。对话真正的里程治理是**轮次**：turn 计数让你随时知道走了多远，`--max-turn` 预算（信封里 `turn="13/40"`）在接近时提醒总结收尾——软提醒不硬拦，任务没完可以继续，但优先收尾。用法见[如何控制对话轮次](../../howto/turn-budget.md)，16KiB 的由来见[第四部](../../explanation/size-limit.md)。

## 边界：同机同用户与平台例外

三句话划清单机通信承诺的范围：

1. **信任边界 = 同一台机器的同一个用户**。unix 腿连 auth 都省了——内核担保管道两端同 uid；win 腿的密钥文件也只有同用户读得到。跨用户的隔离与防护，crosschat 不做也不承诺，见[安全模型](../../explanation/security.md)。
2. **win 的一个平台例外**：codex daemon 的控制 socket 是 AF_UNIX，Windows 把它按登录会话隔离——从 sshd 会话、服务会话这类**另一登录会话**里投 codex 会吃连接拒绝（os error 10061）。日常终端与 daemon 同会话，无感；这条边界跨机侧同样成立，[第2课 2.4](../lesson-2/04-deploy-config.md)有实测注记。
3. **单机发文件没有专门通道**：发路径用 `--body`，发内容走管道。文件级传输（`--file`）是 tcp 星的内建能力，[第3课](../lesson-3.md)见。

## 一句话记住

单机通信 = 名字即地址、信封即路条：一条 send 读名册、算轮次、走管道，发完即退——对方自会带着短柄找回来。
