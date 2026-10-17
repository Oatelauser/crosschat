# multichat 需求总库

> 本文件是整个项目的需求存放处：按主题各占一个大标题（首章：SSH 跨机联邦；后续 tcp 星/local 管道等切片各自补章）。一切以源码为准、文档为辅——每条需求附源码锚点 `file:line`（锚点随版本漂移时以最新源码为准），供成书阶段逐条核验。

# SSH 跨机联邦需求

范围界定：本章只收 ssh 传输形态（`--via ssh:<host>`，按机器投递、名字在对端机解析）。tcp 星（`--via tcp:…` 三段直达/机器级操作）是正交并存的另一条通道，不在本章，只在与 ssh 共用的机制处记边界句。

## 一、配置需求（环境层——crosschat 零自有配置代码）

ssh 形态的设计前提是"零配置层"：一切连接参数交给 ssh 原生的 `~/.ssh/config`，crosschat 不引入任何自有配置文件（设计否决记录：自有别名层/ssh 参数旗标面 = 重建 ssh 已有的运维标准，见 `docs/research/federation-v1-design-notes.md` §4 D1）。

- **REQ-SSH-C1 · 别名即配置**：`--via ssh:<host>` 的 host 必须是发起方 `~/.ssh/config` 里的 Host 别名；非默认用户/端口/密钥全部由 ssh config 解决（HostName/User/Port/IdentityFile）。源码锚点：`src/federation.ts:37-62`（parseViaValue）。
- **REQ-SSH-C2 · host 白名单防注入**：host 字符集仅限 `[A-Za-z0-9._-]`，越界报 USAGE（host 会进 ssh 命令行，防命令行注入——"让危险字符根本不进 argv，而不是转义它"）。锚点：`src/federation.ts:55-60`。
- **REQ-SSH-C3 · 单向网络（NAT）零代码**：本机能出站连对端、对端连不回时，回程由本机常驻 ssh 反向隧道（`ssh -N -R 2222:localhost:22 …` 或 Xshell 等价配置）背过去；crosschat 源码中无任何隧道代码（全仓 grep 无命中），对端只需把回程别名指向 `localhost:2222` 且 **`User` 行必写**（缺 User = ssh 拿本机当前用户去连 → `Permission denied`；Port 误写 22 = 连到对端自己的 sshd → `Host key verification failed`）。这是纯环境约定，见 `docs/federation.md` §1.5（2026-10-08 真机闭环实测）。
- **REQ-SSH-C4 · 别名 = 对端系统 hostname（自动回程的软依赖）**：跨机信封的 origin 与 ref 机器段携带的是发送方 **hostname**（非对端给自己起的别名），回信端自动选路时拿它当 `--via ssh:<hostname>` 用——因此对端 ssh config 的别名必须等于发起方系统 hostname，回程路条才自动成立。这不是代码强校验：手写 `--via ssh:<任意别名>` 仍可用，但信封照抄路径（不带 --via）会 miss。锚点：`src/federation.ts:223`（encodeOrigin 取 `osHostname()`）、`src/commands/send.ts:129-141`（pickAutoVia 用 ref 里的 m 当 host）。
- **REQ-SSH-C5 · sshd 环境 PATH 约束**：远端以登录 shell 执行 `crosschat`，sshd 默认 shell 只见**系统** PATH——npm 全局 bin 不在系统 PATH 时（nvm/自定义前缀），Linux 必须软链 `ln -s "$(npm prefix -g)/bin/crosschat" /usr/local/bin/crosschat`，Windows 须把 npm 全局目录加进系统 PATH；否则远端报 `REMOTE_FAILED [via …] (127): command not found`。环境约定，代码无感知。
- **REQ-SSH-C6 · host key 播种与提速（可选）**：首连用 `ssh -o StrictHostKeyChecking=accept-new <对端> exit` 记指纹（ssh-keyscan 有算法协商缺陷抓不到指纹，弃用）；提速可加 `ControlMaster auto` 复用连接（ssh 原生，摊薄每次握手 100-300ms，设计笔记 R2）。均为 ssh config/运维层，代码零参与。

## 二、命令面与隐式规则

显式命令面只有一条入口；其余规则多为**隐式**（agent/用户照抄信封即可，不需要知道）：

```
crosschat send --via ssh:<host> --to <名/id8> --body "…"        # 发起新对话
crosschat send --via ssh:<host> --conversation <mc2_…|cN> --body "…"   # 续对话（回信通常免写，见 REQ-SSH-B6）
```

- **REQ-SSH-B1 · 远端命令面固定不可配**：发起方实际组装的命令是固定字面 `ssh <host> -o BatchMode=yes -o ConnectTimeout=10 crosschat send --to <名>|--conversation <ref> --json --origin <base64url>`，不提供任何远端命令可配项（可配 = 注入面，设计 D2）。锚点：`src/federation.ts:159-178`（buildSshArgv）。
- **REQ-SSH-B2 · 正文永远走 stdin（隐式）**：远端命令**不含** `--body` 旗标；正文经 stdin 管道传入，远端 CLI 在 `--body` 缺席时读 stdin。动机：同时免疫三方 shell（cmd/PowerShell/bash）的引号矩阵与 argv 长度上限。锚点：`src/federation.ts:203`（`child.stdin.end(input)`）、`src/cli.ts:544`（--body 在场不读 stdin——防 agent harness 挂着空管道 hang）。⚠ 勘误：`docs/federation.md` §3.1/§4.2 写作 `--body -`，源码无此旗标，见本章末勘误表。
- **REQ-SSH-B3 · 旗标值白名单**：进入远端 argv 的值域受限——`--to` 禁空格与 cmd/PowerShell 元字符（`& | < > ^ % " '`）及首杠（名字含空格的单机语义不跨机，跨机改用 id8/ref 寻址）；`--conversation` 必须匹配 `mc[12]_[A-Za-z0-9_-]+`。锚点：`src/federation.ts:65-79`（validateRemoteFlagValues）。
- **REQ-SSH-B4 · `--origin` 机器注入、agent 不可见（隐式）**：发起方自动把本地 caller 身份（claude/codex/human + 完整 id + 显示名 + 本机 hostname + machine-id）编码为 base64url 整串注入远端命令；远端 sshd 环境无 agent env，没有它 caller 会塌缩成 human、对话不可回复（设计 D5，最重要的隐藏发现）。`--origin` 在解析表里但不出现在 usage（隐藏旗标）。两条隐藏不变量：a) **origin 在场即权威**——压过接收方进程的任何环境残留身份（长跑接收进程可能泡在 agent env 里，残留赢了会把信封署名改成本机会话，B3.1 bug2）；b) **完整 id 才可路由，显示名只给人看**——origin 必须携带会话完整 id（名字进 ref = 回信路条断，2026-10-07 实测缺陷的回归锚定）。锚点：`src/federation.ts:89-102`（encodeOrigin）、`src/cli.ts:173-176`、`src/commands/send.ts:306-307`（权威性）、`test/via-send.test.ts`（两条不变量各有专测）。
- **REQ-SSH-B5 · `--json` 恒在（隐式）**：远端回执恒为结构化 JSON（status/to/turn/replyRef/queue/mailbox），发起方解析后按本地格式重渲染——回执语义零翻译损耗。锚点：`src/federation.ts:174`、`261-267`（RemoteReceipt 解析）。
- **REQ-SSH-B6 · 回信零 `--via`（隐式自动选路）**：信封 reply-hint 不带 `--via`，执行侧按 ref 自动补路由（显式 `--via` 一字不动）：a) ref 带 starId → 固定走 tcp；b) 对端端点带 m/mid → pickAutoVia 三分支：本机 ssh config 有对端别名 → `ssh:<m>`；无别名且本机 node.json 可读 → `tcp:<m>`；否则照旧 `ssh:<m>`；c) 超旧引用（无任何机器指纹且本机注册表查无两端）→ 报错教学显式 `--via`。`--origin` 在场（接收腿）不选路——防两机对弹。锚点：`src/commands/send.ts:168-221`（autoViaFromRef）、`129-154`（pickAutoVia + sshConfigHasAlias，通配 Host 不算确定性别名）。
- **REQ-SSH-B7 · 跨机 status 的形态边界**：`crosschat status --via tcp:<机器>` 远程枚举只支持 tcp 形态；ssh 对端用 `ssh <对端> crosschat status`（USAGE 报错原文教学）。锚点：`src/cli.ts:249-251`。
- **REQ-SSH-B8 · 超时旋钮**：`CROSSCHAT_SSH_TIMEOUT_MS` 环境变量覆写本地等待上限（默认 120s；非法值静默降级——"配置是给操作者的旋钮，不是给攻击者的面"）。锚点：`src/federation.ts:225-226`。
- **REQ-SSH-B9 · 身份解析链（origin 的原料）**：caller 身份三源解析——`CLAUDE_CODE_MESSAGING_SOCKET` 按管道路径匹配注册表、须**恰一**命中（零或多命中 → IDENTITY_UNRESOLVED）；`CODEX_THREAD_ID` > `CODEX_SESSION_ID`（codex 线程身份）；两者皆无 → human（可发不可收）。两族同时在場 → CALLER_IDENTITY_CONFLICT（常见于 Claude 终端里起的 codex daemon 派生 shell）。identityKey（`claude:<id>` / `codex:<id>` / `human`）是限流桶与记账的归并键。锚点：`src/identity.ts:75-99`（resolveCallerIdentity）、`101-114`（恰一命中）、`60-63`。

## 三、聊天机制与大小阈值

- **REQ-SSH-M1 · 单条正文三层来源**：`--max-body-kb <KiB>` > `CROSSCHAT_MAX_BODY_KIB` > 默认 16384（16KiB）；来源值有 16MiB 绝对上界（再大按封顶）；非法来源静默降级到下一层。锚点：`src/limits.ts:13-37`。
- **REQ-SSH-M2 · 端点硬顶**：claude 投递管道 64KiB、codex 1MiB——配置再大也送不进端点，到硬顶 = 提额无效。锚点：`src/limits.ts:19-20`。
- **REQ-SSH-M3 · ssh 腿本地预检线 1MiB**：发起方无法预知远端目标形态，本地按最宽端点（codex 1MiB）预检，超线在**出发前**挡下（ssh 进程零调用，测试锚定）；远端 CLI 用自己的两层来源复检（claude 端点更严 64KiB 在对端才暴露）。`--max-body-kb` 不透传远端（远程命令面固定，见 B1）。锚点：`src/commands/send.ts:281-288`、`test/send-command.test.ts:569-585`（sshCalls===0 断言）。
- **REQ-SSH-M4 · 超限教学按场景六变体，"教学只教当前传输能兑现的"**：MESSAGE_TOO_LARGE 文案分本地单机（落盘发路径）/ssh 形态（scp 三步配方）/tcp 形态（--file 通道）/绝对上界/远端来件无硬顶/远端来件有硬顶。ssh 的 scp 配方：发送方落盘 → `scp <文件> <别名>:/tmp/<文件名>` → `--via` 发对端本地路径（scp 与 --via 共用同一份 ssh config）。**scp 的执行者是 agent/人，代码只教不做**——ssh 形态无内建文件通道（tcp 才有 --file 自动分块 64MiB），"scp 是 ssh 的红利"（设计笔记 §10）。锚点：`src/limits.ts:61-105`（bodyTooLargeMessage）、`test/limits.test.ts:72-83`（三分支文本逐字快照，用户确认的红线：一字不许动）。
- **REQ-SSH-M5 · 远端来件的教学纪律**：读报错的是发送方——绝不指 `--max-body-kb`（发送方本机提额管不到接收方，指了就是无效循环）；无硬顶场景指接收方操作者调 `CROSSCHAT_MAX_BODY_KIB` 或走 scp；有硬顶场景 scp 是唯一出路。锚点：`src/limits.ts:52-59`（注释原则）、`73-82`。
- **REQ-SSH-M6 · 投递状态三态跨机同语义**：远端 `delivered` / `queued`（对端忙入队，轮末处理）/ `parked`（旧 daemon 异常态，看门狗 0.5-5 分钟自动重投）经 ssh 即刻返回，"发送即完成本轮"纪律跨机成立；parked 的 mailbox 路径是**远端机器的路径**，本地渲染标注"位于 `<host>`"。锚点：`src/federation.ts:303-314`。
- **REQ-SSH-M7 · 跨机轮次纪律**：防乒乓限流器是单机记账（每对端点 60s 30 条，跨机腿各自记账），turn 计数是跨机唯一防线——接近预算即总结收尾。锚点：`src/federation.ts:229-231`（发起侧也落本机 send-log，B14 审计不被跨机绕过）、`skills/crosschat/SKILL.md` 轮次纪律节。

## 四、底层实现原理

- **REQ-SSH-U1 · 传运执行器**：spawn `ssh` 子进程（stdio 三管道），正文经 `child.stdin.end(input)` 写入后关闭（EOF），stdout/stderr 各自累积并 cap 在 262144 字符；超时定时器 kill 子进程；远端提前退出导致的 stdin EPIPE 被吞（close 事件携带真实退出码）。锚点：`src/federation.ts:181-205`（defaultSshExec）。
- **REQ-SSH-U2 · 错误三层映射**：a) 本地超时/进程未退出（timedOut 或 code===null）→ `SSH_TRANSPORT_TIMEOUT`，文案纪律"远端状态不明勿盲目重发（可能与首次投递叠加），先在对端查 send-log/status 核实"；b) ssh 自身退出码 255（不通/密钥/known_hosts）→ `SSH_TRANSPORT_FAILED`，指引 `ssh <host> crosschat --version` 探活自证；c) 其余非 0 → stderr 正则 `crosschat: ([A-Z_]+): (.+)` 匹配后**同码重抛**（MESSAGE_TOO_LARGE 等自纠指引跨机照常有效），消息加前缀 `[via <host>]`；不匹配 → `REMOTE_FAILED` 附 stderr 尾部 400 字。锚点：`src/federation.ts:235-259`。
- **REQ-SSH-U3 · 双超时链**：外层本地等待（CROSSCHAT_SSH_TIMEOUT_MS，默认 120s）+ 内层 ssh 自身 TCP 连接超时（ConnectTimeout=10s，命令行固定参数）；BatchMode=yes 让任何交互提示（密码/host key 确认）变成快速失败而非挂满 120s（设计 F2）。锚点：`src/federation.ts:167-171`、`225-226`。
- **REQ-SSH-U4 · `--origin` 编码格式**：`<p>/<完整id>[/<显示名>]@<hostname>[:<mid 的 base64url>]` 整串再 base64url——显示名可含空格/unicode/@//（F1：永不解析只占槽），整串编码免疫三方 shell 引号（设计 F1）；mid 随行让接收方分辨同名机器（B10）。锚点：`src/federation.ts:81-102`（encodeOrigin）、`119-156`（decodeOriginIdentity）。
- **REQ-SSH-U5 · 同机判定**：双方 machine-id 都在场 → mid 决定（每装机唯一，hostname 撞名无法伪造匹配）；任一方 mid 缺失 → 退 hostname 相等（B10 前语义，mid 不可读时仍正确）。mid 的平台源：win=注册表 MachineGuid（带杠）、linux=/etc/machine-id、mac=IOPlatformUUID，boot 内缓存。**normalizeMid（小写+去非 hex）只用于比对边界**——win 带杠与 linux 纯 hex 互认；存储与线上帧保持历史形态，绝不归一后存储。锚点：`src/federation.ts:113-116`、`src/platform/machine-id.ts:15-21`（平台源）、`24-28`（归一边界规则）。
- **REQ-SSH-U6 · 接收腿盖章与同名警告**：`--origin` 在场的 send（远端来件）把 ref 两端点各盖 m（hostname，路由回程用）+ mid（同机判定用）章；本机无 m = 本地端点。检测到对端 hostname 与本机相同但 mid 不同 → 输出追加"⚠ 两台机器同名：已按跨机路由，建议改名"。锚点：`src/commands/send.ts:399-431`、`419-425`。
- **REQ-SSH-U7 · mc2_ 紧凑引用（对话自包含路由的核心）**：ref = 双方端点原生 id + 8 字节随机 nonce + 轮次计数器，无服务端状态即可路由回信。mc2_ 二进制布局：flags LEB128 varint（端点类型码 2bit×2 + id 裸装位×2 + m/mid/starId 存在位）→ id（UUID 压 16 裸字节，非 UUID 走 varint 长度前缀串——id 格式漂移逃生门）→ m/mid 串 → nonce 裸字节 → 轮次 varint（LEB128，长对话可超 127 轮）→ starId 尾段（tcp 专用）。mc2_ ≈84 字符 vs mc1_（base64url(JSON)）≈290——每轮双方上下文都付一遍，3.7× 瘦身是刚性需求。mc1_ 永久兼容解码（旧信封/分片/日志不过期）；旧 CLI 读新 ref 的版本偏差是设计好的路径（'trailing bytes' + 升级教学）。解码全程边界校验（Cursor，截断=skew 或损坏）。锚点：`src/ref.ts:55-151`（布局+编码）、`154-235`（解码）、`197-235`。
- **REQ-SSH-U8 · 会话短柄 cN（消灭手抄百字符 ref）**：本地会话分片寄生的两字符柄（c+数字），信封 hint 与人眼输出行优先用柄，柄缺席（状态未接线等异常路径）回退完整 ref 保底不断；柄跨轮复用、旧柄照发也精确路由（路由靠 nonce，本地轮号自愈）。锚点：`src/envelope.ts:42-49`、`79`、`src/commands/send.ts:226-229`（双形态解析）、`src/federation.ts:289-299`（跨机回执落定后配柄）。柄与分片的完整机制（隐藏细节）：分片 = 每对一 JSON（文件名 sha256(pairKey)，B20 布局，遗留全局文件只读兜底、永不回写）；柄号本机全分片唯一分配（max+1，CAS 撞号重试一次 max+2），每分片 LRU 封顶 8 条（键插入序即 LRU 序）；**分配写不推进会话线**——投递失败的 send 不污染 `--to` 接续；同 nonce 旧柄被新柄顶替、随轮次原地自新；消费侧撞号 → 报错列出全部候选 ref，过期 → 教 `--to` 接续；写盘 tmp+rename 原子、无跨进程锁（同对毫秒级竞态 last-write-wins，续话线最坏滞后一轮，ref 自包含故在途回信不受影响）。跨机回执若带回 mc1_ 旧 ref，本地落账时重编码为 mc2_（同解码内容，紧凑形）。锚点：`src/conversations.ts:305-439`（柄全机制）、`137-151`（原子写/自愈）、`test/via-send.test.ts`（mc1_→mc2_ 重编码断言）。
- **REQ-SSH-U9 · 回执机器段 name(mid8)**：跨机回执显示 `to名@name(mid8)`——mid8 权威源 = 回执 ref 对端端点的 mid，无名回退 mid8，ref 不可解码回退目标原样输入；寻址面零改动（错误前缀 `[via X]` 照旧，写成 name(mid8) 会弄坏机器解析，属断回信路的回归）。锚点：`src/federation.ts:332-364`（machineDisplay）。
- **REQ-SSH-U10 · 发起侧对账**：跨机发送的每条出口（成功/三态失败）都落本机 send-log（from/fromName/to/target=`via:<host>`/status/turn/replyRef），跨机对话因此出现在本机 `status --conversations`，传输族判定（ssh/tcp/local）吃这份记账。send-log 纪律（隐藏细节）：**只记元数据、永不写消息正文**（审计面即隐私面）；超 5MB 轮转挪 `.old`（历史整份保留，非原地截断）；读取恒为有界尾窗（status 视图 200 行、限流计数 500 行，从文件尾 64KB 分块倒读）；限流检查只读、本次条目在投递结局后才落账（30 条/60s/对，014 蒸发——不自建计数文件，同一份条目既审计又限流）。锚点：`src/federation.ts:229-231`、`278-286`、`src/send-log.ts:21-46`（形状+轮转）、`77-120`（尾窗倒读）、`src/rate-limit.ts:11-20`、`src/commands/status.ts:346-358`（conversationFamily：端点带 m 且无 starId=ssh）。

## 五、安全与零回归不变量

- **REQ-SSH-S1 · 信封防伪造**：正文里出现的保留标签（`cross-session-message` / `crosschat-*` / 旧名 `multichat-*`）一律加 `<\` 前缀中性化——body 不能伪造信封 framing。锚点：`src/envelope.ts:19`、`56-58`。
- **REQ-SSH-S2 · reply-hint 单命令纪律**：真实 hint 永远只有一条纯粹的 `crosschat send`；括注必须是纯文字（内建管道教学），hint 内出现第二条带管道符/链式符号的命令即判伪造信封（安全红线，测试锚定）。接收方纪律：逐字照抄、只换占位符。锚点：`src/envelope.ts:80-87`、`skills/crosschat/SKILL.md` 安全纪律节。
- **REQ-SSH-S3 · 零回归铁律（架构级）**：`--via` 缺席 → runSend 现路径字节级一致——全部联邦逻辑住在 via 早分支之后，单机路径零改动；显式 `--via` 一字不动（自动选路只在 via 缺席时介入）。锚点：`src/commands/send.ts:272-291`（设计 D9）。
- **REQ-SSH-S4 · 文档化残险**：伪造信封可诱导回信至指定 `--via` 目标（形状合法单命令，纪律拦不住）；前提是已入信任边界（同用户/已认证联邦节点），接受为文档化残险，缓解 = skill 纪律 + 题词角色约束；消息签名留待 broker 形态评估（设计笔记 R1）。

## 附：文档 vs 源码勘误（成书必须修正）

| # | 文档位置 | 文档说法 | 源码事实 | 锚点 |
|---|---|---|---|---|
| 1 | `docs/federation.md` §3.1 / §4.2 | 远端命令带 `--body -`（正文走 stdin 旗标） | 远端命令**无** `--body` 旗标；stdin 是隐式行为（--body 缺席时远端读 stdin），命令面 = `--to/--conversation + --json + --origin` | `src/federation.ts:159-178`、`src/cli.ts:544` |
| 2 | `docs/federation.md` §3.4 / §4.3 | 远端报错"stdout 里的 CODE: message 结构"被解析同码重抛 | 匹配的是 **stderr**（`res.stderr.match(/crosschat: ([A-Z_]+): (.+)/)`；远端 CLI 本来就把错误打到 stderr） | `src/federation.ts:252`、`src/cli.ts:463-470` |
| 3 | `docs/federation.md` §2.3 | "块数据走 ssh 自己的文件通道"易读成内建通道 | ssh 形态无内建文件通道：代码只做 1MiB 预检 + 报错里教 scp 三步配方，scp 由 agent/人执行（tcp 才有内建 --file） | `src/limits.ts:70-91`、`src/commands/send.ts:281-288` |

# 单机通信需求

范围界定：本章收 `--via` 缺席的一切投递——claude 会话（命名管道/UDS 直投）与 codex 线程（app-server proxy 投递），连同其全部本地状态（会话分片/短柄、发件箱/看门狗、发送记账/限流）与启动器/教学层。ssh 腿见首章，tcp 星另行补章；与两条跨机腿共用的机制（身份解析链/上限三层来源/信封防伪造/ref 编码/记账纪律）首章已立档，本章只记单机视角的边界句并指回。

## 一、命令面与隐式规则

显式命令面九个：`send / status / doctor / install-skills / serve / clean / uninstall / claude / codex`；另有一个**隐藏维护入口** `crosschat __drain [--watch]`（不进 usage，看门狗与人工单轮补投用）。skill 教学的正是这九个——"不要猜测不存在的子命令"是协议纪律的一部分。

- **REQ-LOC-B1 · 目标名判定序（D0）**：全名精确（字节不变，claude 侧与 codex 侧各自恰一命中；同侧重名或两侧同名 → NAME_COLLISION 列候选）→ 大小写不敏感**前缀**匹配（只前缀不包含，跨两侧合并计数——唯一命中投递、多命中列名单教完整名）→ codex id 寻址（可选 `codex/` 前缀 + id8 或完整小写 uuid；id8 多命中列全 id 教完整 id）→ NAME_NOT_FOUND 附全部可用名清单（未命名线程计数并教 id8 寻址）。锚点：`src/resolve.ts:38-112`。
- **REQ-LOC-B2 · --to 与 --conversation 互斥必选**：同给 → TARGET_CONFLICT；都不给 → TARGET_REQUIRED（例外边界：`--via tcp:<星>:<机器>:<会话>` 三段自带收件人免 --to，属 tcp 章）。锚点：`src/commands/send.ts:574-587`。
- **REQ-LOC-B3 · 正文来源纪律（隐式 stdin）**：`--body` 与 stdin 同给 → BODY_CONFLICT；`--body` 缺席才读 stdin（agent harness 常挂空管道，`--body` 在场还去读会 hang——这是隐式行为不是旗标）；两者皆无/空 → BODY_REQUIRED。长正文/敏感字符的管道教学内建在信封括注里（纯文字提示，非命令）。锚点：`src/cli.ts:559-561`、`src/commands/send.ts:589-601`、`src/envelope.ts:83`。
- **REQ-LOC-B4 · --conversation 双形态**：`c<数字>` 本地短柄先解析成唯一完整 ref（扫全部分片；过期/撞号在此教学自纠，出路=改 `--to` 接续）；`mc1_`/`mc2_` 前缀直用永续。锚点：`src/commands/send.ts:226-229`、`src/conversations.ts:428-439`。
- **REQ-LOC-B5 · --to 同名即续（隐式接续）**：状态接线时 `--to` 不开新对话——接该端点对最新存档 ref 前进一轮（轮次计数因此有意义；实测修 30 条消息全标 turn=1 的问题）；状态缺席/不可解码 = 全新对话（自愈）。锚点：`src/commands/send.ts:376-382`、`src/conversations.ts:212-231`。
- **REQ-LOC-B6 · 入口机会补投（隐式 drain）**：每次 `send`/`status` 进命令先跑一轮发件箱补投——每轮预算 5 条投递/15s 墙钟/5s 忙等，每获缓解线程一行 stderr、死线程一行死信；补投失败绝不连坐本命令。锚点：`src/cli.ts:470-521`、`src/outbox.ts:73-77`。
- **REQ-LOC-B7 · human 可发不可收**：人（无身份环境变量）能发能续，但对 human 端点的回复 → CANNOT_REPLY_TO_HUMAN（没有可投递的会话）。锚点：`src/commands/send.ts:335-340`。
- **REQ-LOC-B8 · 发送即完成纪律**：`delivered`/`queued`/`parked` 全部 exit 0 = 本轮完成，绝不重发、不轮询 status 等回复（异步原生唤醒：对方回信作为新消息注入并唤醒会话）；人眼输出行尾 `· 续话 cN`，柄缺席（异常路径）回退完整 `reply-ref:` 行保底。锚点：`src/commands/send.ts:625-653`、`skills/crosschat/SKILL.md:72-76`。
- **REQ-LOC-B9 · status 视图族**：裸跑 = 三段式摘要（本机会话计数+滞留+最近5会话 / tcp 星 / ssh 段）；任何过滤旗标/--json = 明细视图（claude/codex 两段，未命名默认隐藏 `--all` 带出，TUI 占用标记来自 thread-writer-locks）；`--conversations` = 逐对总览（方向/相对时间/轮次/末态/滞留/回执/柄）。codex 不可达降级为 unavailable 段（一侧宕是合法状态答案），绝不连坐 claude 段。传输族三分类（端点带 m 无 starId=ssh；带 starId=tcp；无 m=单机）是本章与跨机章的视图边界。锚点：`src/commands/status.ts:421-443`、`568-616`、`359-370`。
- **REQ-LOC-B10 · doctor 严重度语义**：只有 ❌ 使退出码 1；"未安装 codex/claude"“daemon 未跑”是**合法机器状态**→ ⚠️ 教学提示不判错（用户拍板）；skill 安装比对基准 = npm 包内 skills 整树（递归含 references/）。锚点：`src/commands/doctor.ts:59-63`、`185-209`、`216-232`。

## 二、聊天机制与大小阈值

**专家立场（成书必守）**：crosschat 不管理 agent 的上下文窗口——上下文耗尽的协议级答案是**轮次计数/预算**（turn="N/M" 软提醒不硬拦），一切"阈值"都是传输与状态治理，不是上下文治理。把上限讲成"上下文保护"是概念错误。

- **REQ-LOC-M1 · 生效上限与检查时序**：单条正文三层来源（`--max-body-kb` > `CROSSCHAT_MAX_BODY_KIB` > 默认 16384；来源值 16MiB 绝对上界；非法静默降级——解析链与 ssh 章共用，见 REQ-SSH-M1）。单机特有时序：配置值在路由定型前早检，**端点封顶在目标解析出来后补检**（claude 管道 64KiB / codex 1MiB；生效值 = min(配置, 端点封顶)——配置再大也送不进端点）。锚点：`src/commands/send.ts:238-270`、`385-397`、`src/limits.ts:13-20`。
- **REQ-LOC-M2 · 超限教学单机变体**：未到硬顶 → "可提额"指 `--max-body-kb`/`CROSSCHAT_MAX_BODY_KIB`；到端点硬顶/绝对上界 → 明说封顶值与"提额无效"，唯一出路 = 落盘发文件路径（`Write the content to a file and send the path instead.`）。教学只教当前传输能兑现的（跨机变体属 ssh/tcp 章）。锚点：`src/limits.ts:84-105`。
- **REQ-LOC-M3 · 防乒乓限流**：每端点对 60s 滑窗 30 条；计数不建文件——读 send-log 尾窗（500 行）同一份条目既审计又限流（014 蒸发）；检查只读、本次条目投递结局后才落账（未来检查才数它）。尾窗被全机高频挤占时计数偏低、限流偏松——持续 8 条/秒才触达，文档化接受。锚点：`src/rate-limit.ts:13-52`、`src/commands/send.ts:479`、`501`。
- **REQ-LOC-M4 · 轮次与预算**：ref 自带轮次计数器，每轮 c+1；`--conversation` 续话时**分片线优先**——分片已推进到信封快照及以后（迟回复/同旧底并行发送）时分片线赢，轮次不再相撞（B22）；`--max-turn`/`CROSSCHAT_MAX_TURN` 合并进 turn 属性显示 `N/M`，软提醒不硬拦（超了照发照显）。锚点：`src/commands/send.ts:344-350`、`src/conversations.ts:249-266`、`src/envelope.ts:66-68`。
- **REQ-LOC-M5 · 投递三态（单机语义）**：`delivered` = 已进对端（claude：管道写完；codex：turn/start 返回 inProgress）；`queued` = 对端 codex 忙、daemon≥0.160 把 turn 收进服务端队列轮末串行处理（收件箱语义——queued 时回执探针结构性不可能命中，干脆不探）；`parked` = 本地发件箱（仅旧 daemon 异常态：~10s 停滞预算内线程不可达，或 TUI 持写者锁）。三态都无需重发。锚点：`src/codex/deliver.ts:19-22`、`117-121`、`src/commands/send.ts:528-557`。
- **REQ-LOC-M6 · codex rollout 回执**：投递后在对方 rollout 文件里找信封内嵌的唯一 reply-ref 标记（5 次 × 300ms）——"delivered"从"服务器收了 turn"升级为"消息可验证落在对方会话历史里"；`unconfirmed` = 预算内没看到，**不是丢失**；status --conversations 对 unconfirmed 行再做一次有界复查（2×200ms）。锚点：`src/send-log.ts:69-83`、`src/cli.ts:451-452`、`src/commands/status.ts:870-879`。
- **REQ-LOC-M7 · claude 一次性写**：管道写一次、连接即关、**永不重试**——重连重写可能造成对端重复消费。连接失败 = CLAUDE_PIPE_CONNECT_FAILED（确定未达）；写中途失败 = CLAUDE_PIPE_WRITE_UNCERTAIN（状态不明，绝不自动重发）。锚点：`src/platform/pipe-transport.ts:14-16`、`src/claude/deliver.ts:24-31`。
- **REQ-LOC-M8 · 发件箱队列纪律**：有更早滞留时新 send **入队不插队**（FIFO——直接投递可能钻进 drain 错过的空窗，破坏顺序）；每线程 200 条上限，到顶诚实拒绝（OUTBOX_FULL 指向 mailbox 取回内容）。锚点：`src/commands/send.ts:509-527`、`src/outbox.ts:38`、`105-136`。
- **REQ-LOC-M9 · 阈值总表（单机全部数字）**：正文默认 16KiB/上界 16MiB/端点 64KiB(claude)·1MiB(codex)；限流 30 条/60s/对；发件箱 200/线程；send-log 轮转 5MB；柄表每分片 LRU 8；分片 30 天未更新被 clean 回收；管道 flush 宽限 250ms；codex 停滞停车预算 ~10s；RPC 请求超时 30s；proxy spawn 超时 10s；drain 每轮 5 条/15s/5s 忙等；看门狗退避 30→60→120→300s。锚点：各文件常量行（`src/limits.ts:13-20`、`src/rate-limit.ts:13-16`、`src/outbox.ts:38`、`src/send-log.ts` + `src/log-rotate.ts:8`、`src/conversations.ts:310`、`src/commands/clean.ts:12`、`src/platform/pipe-transport.ts:37`、`src/codex/deliver.ts:45-46`、`src/codex/rpc.ts:70`、`src/codex/transport.ts:43`、`src/outbox.ts:73-77`、`src/watchdog.ts:16`）。

## 三、底层实现原理

### claude 投递腿（管道）

- **REQ-LOC-U1 · 注册表发现**：枚举 `~/.claude/sessions/*.json`（Claude Code 自己写的注册表，crosschat 只读）；可路由 kind 仅 `interactive`/`bg`（daemon/daemon-worker 不是用户会话）；进程活探测 signal 0（EPERM = 活着只是无权发信号）；损坏条目跳过并计数，绝不抛。锚点：`src/claude/registry.ts:8`、`63-89`、`src/platform/process-inspector.ts:4-13`。
- **REQ-LOC-U2 · 接收前提 crossSessionInbound**：claude 会话能收消息的前提是带 `--settings {"crossSessionInbound":"accept"}` 启动——没有它入站帧停在 parity hold。**`crosschat claude` 启动器负责注入**（这是该启动器对 claude 侧存在的核心理由）；用户自带 `--settings` → SETTINGS_CONFLICT（教合并后直启）。锚点：`src/commands/claude-wrapper.ts:28`、`70-76`。
- **REQ-LOC-U3 · 帧协议（平台差异）**：win32 = auth 行 `{type:"auth",token}` + user 帧；unix = **只发 user 帧**（同 uid 内核凭据即身份，无密钥无 auth 行）。user 帧 = 单行 JSON `{msgV:1,msg_id:uuid,type:"user",message:{role:"user",content},priority:"next"}`；换行分隔、整载一次写完、写毕 end socket。锚点：`src/claude/frame.ts:15-29`、`src/claude/deliver.ts:39-45`。
- **REQ-LOC-U4 · peerToken 密钥文件**：文件名 = `<pid>.<sha256(归一化管道路径)>.key`，住 sessions 目录；归一化 = 保留 `\\.\pipe\` 前缀 + 其余全部小写（Claude Code 自己的哈希规则，活样本验证）；缺失/无 peerToken → CLAUDE_KEY_FILE_MISSING/INVALID。锚点：`src/claude/key-file.ts:12-60`。
- **REQ-LOC-U5 · 管道传输语义（两平台同形）**：win 命名管道与 unix UDS 走同一 `net.createConnection({path})` API、同一线协议（写一次/不重试）；250ms flush 宽限——对端正常会在我们 EOF 后立刻关连接，短宽限让断管以错误浮出而不是假 delivered（命名管道的写错误可能晚 end 回调一拍）。错误二分：没连上=CONNECT_FAILED，连上后出问题=WRITE_UNCERTAIN。锚点：`src/platform/pipe-transport.ts:18-164`。

### codex 投递腿（app-server proxy）

- **REQ-LOC-U6 · 每操作全新链**：spawn `codex app-server proxy` → 在其 stdio 双工上做 WebSocket 升级（`ws://localhost/rpc`，JSON-RPC 帧走 ws 文本消息）→ initialize → thread/resume → 状态判定 → turn/start → 确认 inProgress → unsubscribe → close。一次操作一条会话，无池化无复用；close 先发 ws close 帧再收割进程树。锚点：`src/codex/deliver.ts:10-22`、`src/codex/client.ts:88-92`、`src/codex/transport.ts:357-453`。
- **REQ-LOC-U7 · proxy 环境清洗与进程回收**：spawn proxy 前剥掉两族身份变量（CLAUDE_CODE_*/CODEX_*——父会话的双身份会渗进 proxy 触发 CALLER_IDENTITY_CONFLICT，实测 B5）；proxy 短命，close 时杀**自己 spawn 的那棵**进程树（win taskkill /T /F，unix SIGKILL；优雅退出 2s 宽限）；**用户的 daemon 绝不由 crosschat 起停**。锚点：`src/codex/transport.ts:48-65`、`246-267`。
- **REQ-LOC-U8 · daemon≥0.160 开窗投递**：忙线程的 turn/start 被接受并按线程串行排队（实测 2026-10-03，inbox 语义），轮末落历史；轮询只留给 not_loaded（resume 后异步加载）与旧 daemon 的写者锁拒绝，两者 ~10s 停滞预算后停车（B19，替代旧 120s 阻塞）；旧 daemon 对忙线程拒绝 turn/start → 映射 BUSY → 照样停车。锚点：`src/codex/deliver.ts:19-22`、`84-150`、`167-194`。
- **REQ-LOC-U9 · 审批永不代答**：线程状态 waiting_approval（含 waitingOnUserInput，规范层同义）→ CODEX_APPROVAL_REQUIRED，只有用户能答；服务端主动请求（审批族）只记录为证据，永不回响应。锚点：`src/codex/deliver.ts:122-127`、`src/codex/rpc.ts:63-66`。
- **REQ-LOC-U10 · RPC 线协议事实**：响应/通知帧**无 jsonrpc 字段**（`{id,result}`/`{method,params}`，本机 schema 核实）；客户端方法白名单（越界=编程错误）；每请求 30s 超时；超时后迟到响应丢弃不视为故障；坏帧 = 协议失败连坐全部 pending。锚点：`src/codex/rpc.ts:6-9`、`12-24`、`70`、`136-145`。
- **REQ-LOC-U11 · thread/list 源过滤**：必须显式 `sourceKinds:['cli','vscode','exec']`——缺省只列交互式源，`codex exec` 线程（source=exec）永远不可见；useStateDbOnly + recency 排序 + limit 20；发现是只读的：从不 resume、从不 start turn。锚点：`src/codex/client.ts:105-130`、`src/codex/discovery.ts:14-17`。
- **REQ-LOC-U12 · 写者锁与 TUI 占用**：codex TUI 附着线程时持有零字节标记 `<codexHome>/thread-writer-locks/<threadId>.lock`（附着建/释放删）；`.coordination` 是目录级锁不算线程锁；status 对"锁在但未列入 thread/list"的线程照样出行（新 TUI 标签页还没有 rollout 是真实状态）。**`codex queue` 不是绕路**：exit 0 但消息永远到不了本地 TUI（实测黑洞）。锚点：`src/codex/rollout-meta.ts:143-164`、`src/commands/status.ts:763-767`、`src/codex/deliver.ts:96-101`。

### 会话状态与记账

- **REQ-LOC-U13 · 会话分片（B20 布局）**：每端点对一个 JSON，文件名 `sha256(无序对键)`（对键 = 两侧端点键排序后 `\n` 连接——角色无关，A→B 与 B→A 同一对话）；遗留全局 conversations.json 只读兜底、永不回写（懒迁移，分片缺席才读）；写盘 tmp+rename 原子；**无跨进程锁**——同对毫秒级竞态 last-write-wins，接续最坏滞后一轮，ref 自包含故在途回信不受影响；损坏分片自愈为缺席（隔离到本对）。锚点：`src/conversations.ts:61-68`、`131-168`、`137-151`。
- **REQ-LOC-U14 · 分片寄生表**：`handles`（cN→ref，本机全分片唯一分配 max+1、CAS 撞号重试一次、每分片 LRU 封顶 8、键插入序即 LRU 序、同 nonce 旧柄被新柄顶替并随轮次原地自新；**分配写不推进会话线**——投递失败的 send 不污染 --to 接续）与 `machines`（mid8→对端名，回执显示用，additive 旧版忽略）。锚点：`src/conversations.ts:305-421`。
- **REQ-LOC-U15 · 发件箱与 mailbox**：每线程一 JSON 于 `~/.crosschat/outbox/`；park/drain 变更走逐线程锁文件（独占创建，60s 陈旧偷死锁持有者；争锁 park 降级无锁直写——毫秒窗，与 B12 前同险）；mailbox 镜像 `~/.crosschat/mailbox/<threadId>.md` 人类可读（park 追加原文/送达追加标记行，尽力而为不权威）；CODEX_THREAD_NOT_FOUND = 死信**整线程丢弃**；busy/locked = 线程级状态，队首失败即中止本线程本轮（不把预算烧在必败上——2026-10-02 事故教训）。锚点：`src/outbox.ts:22-36`、`79`、`165-260`。
- **REQ-LOC-U16 · 看门狗**：任何 park 后 spawn 分离进程 `crosschat __drain --watch`（隐藏入口）；单实例 = outbox 目录 pid+时间戳锁文件，心跳 90s 新鲜度（无心跳但 pid 活着也算在跑）；连续空手轮退避 30→60→120→300s，任何投递成功归零；发件箱清空即退出（**无常驻 daemon**——有滞留才有进程）；vitest 环境守卫防测试泄漏后台进程。锚点：`src/watchdog.ts:16-26`、`33-73`、`82-109`。
- **REQ-LOC-U17 · 发送记账**：每条 send 的最终结局（delivered/queued/parked/failed + from/fromName/to/target/turn/replyRef/receipt）一行 JSON 落 `~/.crosschat/send-log.jsonl`；**只记元数据永不写正文**（审计面即隐私面）；超 5MB 轮转挪 `.old`（历史整份保留）；读取恒为有界尾窗（从文件尾 64KB 分块倒读；status 视图 200 行/限流 500 行）；drain 补投过同一限流器（按寄存时的 caller 键）；`status --conversations` 的存在权威 = 分片库，尾窗与发件箱只做增补。锚点：`src/send-log.ts:17-54`、`86-133`、`src/conversation-summary.ts:65-73`。
- **REQ-LOC-U18 · 状态根与生命周期**：状态目录全平台统一 `~/.crosschat`（014 起不看 LOCALAPPDATA；旧院路径零迁移零双读，仅 uninstall 清扫）；clean 懒规则顺带回收 30 天未更新的分片（--force 全清含未过期）。锚点：`src/state-root.ts:10-26`、`src/commands/clean.ts:12`、`104-122`。

### 启动器与教学层

- **REQ-LOC-U19 · 启动器旋钮与身份清洗**：`crosschat claude/codex` 剥离 `--max-body-kb`/`--max-turn`（crosschat 的旋钮不是原 CLI 的参数）→ 写进子进程 env（该会话后续所有 send 经 env 层继承；send 显式参数仍最高优先）；同时剥**对族**身份变量（从 codex 里启 claude / 从 claude 里启 codex 的双身份残留，把报错里 env -u 人工自纠机构化）；codex 侧**零设置注入**（接收靠原生 daemon，启动器存在意义=旋钮+身份清洗）；旋钮校验启动器**快错**（人在终端一次性输入，报错当场可纠）vs send 侧静默降级（agent 自纠循环不打断）——有意的不对称。锚点：`src/commands/claude-wrapper.ts:79-93`、`src/commands/codex-wrapper.ts:48-70`、`src/limits.ts:107-162`、`src/identity.ts:32-58`。
- **REQ-LOC-U20 · install-skills 与教学层**：把包内 skills/crosschat 整树复制到 `<root>/.claude/skills/crosschat` 与 `.codex/skills/crosschat`（幂等覆盖不删除）；skill = 协议自教学层（低入侵约束：机制自带教学，题词只留角色），收信方只读 SKILL.md 即可正确回复；doctor 递归比对安装树与安装源（多出文件不管——只覆盖不删除，冗余无害）。锚点：`src/commands/install-skills.ts:31-48`、`src/commands/doctor.ts:212-232`。

## 四、安全与不变量

- **REQ-LOC-S1 · 信封防伪造与 hint 纪律**：正文里出现的保留标签（`cross-session-message`/`crosschat-*`/旧名 `multichat-*`）一律 `<\` 前缀中性化；reply-hint 永远只有一条纯粹的 `crosschat send`，括注必须是纯文字——hint 内出现第二条带管道/链式符号的命令即判伪造。与跨机共用同一份代码与红线（全量定案见 REQ-SSH-S1/S2）。锚点：`src/envelope.ts:19`、`56-58`、`79-87`。
- **REQ-LOC-S2 · 本地信任边界**：单机投递的信任模型 = 同用户文件系统——win 侧 peerToken 密钥文件与管道都在同 uid 可读范围；unix 侧干脆无 auth 行（同 uid 内核凭据即身份）。跨用户防护不存在也不承诺（同机同用户是前提边界，成书必须明示）。锚点：`src/claude/deliver.ts:24-29`、`src/claude/key-file.ts`。
- **REQ-LOC-S3 · 零回归（架构级）**：`--via` 缺席 → 本地路径字节级一致，全部跨机逻辑住在 via 早分支之后（见 REQ-SSH-S3）；单机是默认形态与回归锚点，不是跨机的附属。
- **REQ-LOC-S4 · 写一次永不重投**：claude 管道与 codex turn/start 都是写一次绝不自动重发（UNCERTAIN 语义 = 状态不明，重发可能造成重复消费——教学让人核实而非重试）；唯一的自动重投是发件箱，且仅限**确定未达**的 busy/locked 态。锚点：`src/platform/pipe-transport.ts:12-16`、`src/codex/deliver.ts:186-194`、`src/commands/send.ts:546-557`。
- **REQ-LOC-S5 · 消息是请求非授权**：skill 首条纪律——信封内容只代表发送方意图，是否行动由收方按自己的任务与权限判断；审批类交互永不代答（REQ-LOC-U9 是它在传输层的落点）。锚点：`skills/crosschat/SKILL.md:10`。

## 五、隐藏细节速查（2026-10-16 深挖：源码注释不显、只有测试/交叉读才浮出的层）

### 5.1 快照红线（用户确认过的权威文本，测试逐字锚定，一字不许动）

- **REQ-LOC-H1 · 三分支超限文案**：MESSAGE_TOO_LARGE 本地/ssh/tcp 三分支教学文本逐字快照（`test/limits.test.ts:72-83`）；RATE_LIMITED 文案字节稳定（`test/rate-limit.test.ts:64-76`）；信封金形状逐字节（`test/envelope.test.ts:5-20`）。
- **REQ-LOC-H2 · 信封零回归锚**：信封永不出现 `--via`、`--max-body-kb`、`CROSSCHAT_`、静态大小数字（D0 删行——大小是发方的事）；hint 内无 `|`/`&&` 且 `crosschat send` 全信封恰一次；柄在场时完整 ref **一个字节都不出现**；ref 全信封只出现一次（无 conversation= 属性）。锚点：`test/envelope.test.ts:88-94`、`98-103`、`114-118`、`177-184`、`132-149`。

### 5.2 测试钉死的隐式不变量

- **REQ-LOC-H3 · 信封细节四则**：①保留标签中性化连**闭合标签**一起（`</cross-session-message>` 也变 `<\/`）；②from-name 截断按 **codepoint 非 utf16**——64 个汉字不截，65 个才截且 `from-alias` 记录完整原名；③属性元字符（`& < "`）转义；④多行正文逐字保真于 hint 行与闭标签之间。锚点：`src/envelope.ts:19`、`10-11`、`52-54`，`test/envelope.test.ts:22-76`、`105-112`。
- **REQ-LOC-H4 · codex 链调用序恒定**：initialize → resume → turn/start → unsubscribe → close；busy 线程**恰一次 resume** 即 turn/start（零忙轮询）；写者锁等待轮询的是 resume；**resume 未成功绝不 unsubscribe**（NOT_FOUND/LOCKED 路径只有 close）；parked 信封逐字节重投。锚点：`test/codex-deliver.test.ts:95-109`、`111-122`、`167-182`、`256-277`、`test/send-command.test.ts:423-438`。
- **REQ-LOC-H5 · 三态全都推进会话线**：delivered/queued/**parked** 都 recordConversation（parked 后 `--to` 接续 turn 照常 +1——实测 1+parked2+3）；只有 **failed**（抛错路径）不推进（分配写也不推进）。锚点：`src/conversations.ts:269-272`、`test/send-command.test.ts:342-357`、`test/conversations.test.ts:260-270`。
- **REQ-LOC-H6 · queued 恒不探回执**：入队消息坐在对方运行中的 turn 后面，回执结构性不可能命中，探针一次都不发；尾注文案固定"已入对方服务端队列…终态可查 crosschat status --conversations"；delivered 探一次，confirmed 无任何尾注。锚点：`src/commands/send.ts:530-545`、`test/send-command.test.ts:470-489`。
- **REQ-LOC-H7 · 超旧引用双护栏**：无机器指纹的老 ref，只有当本机注册表**两端都查无**时才判"过旧教显式 --via"；本机认识任一端点 → 照旧 CALLER_NOT_IN_CONVERSATION（绝不误杀本地回复）。锚点：`src/commands/send.ts:208-221`、`test/send-command.test.ts:776-802`。
- **REQ-LOC-H8 · 限流细节**：对键无序（A→B 的记账计入 B→A 的窗口）；drain 补投**只读**限流窗、不写条目（补投不消耗窗口）；窗口满的条目本轮跳过原样保留下轮。锚点：`src/rate-limit.ts:25`、`test/rate-limit.test.ts:59-62`、`test/outbox.test.ts:219-263`。
- **REQ-LOC-H9 · 发件箱损坏策略两腿不同**：**park** 遇损坏文件自愈为空（当场覆盖写，弃旧数据）；**drain** 遇损坏文件跳过且**不删**（留给下轮/park 自愈）。drain 进行中新 park 的条目同轮就被捡到（FIFO 跨交错成立）；OUTBOX_FULL 拒绝时文件原样不动。锚点：`src/outbox.ts:116`、`198-207`、`test/outbox.test.ts:88-93`、`198-207`、`343-353`。
- **REQ-LOC-H10 · 轮转三则**：send-log 超 5MB 整份挪 `.old`（非截断）；`.old` 先 unlink 再 rename（win rename 不能覆盖已存在文件）；轮转失败不拦追加（下次再试）。锚点：`src/log-rotate.ts:10-20`、`test/state-paths.test.ts:54-81`。
- **REQ-LOC-H11 · clean 边界**：恰好 30 天**保留**，严格更旧才回收；conversations 目录里的非 .json 文件（tmp 残留）不碰。锚点：`src/commands/clean.ts:120-122`、`test/clean.test.ts:112-129`。
- **REQ-LOC-H12 · 名字解析优先序暗规则**：精确全名优先于同形 id（名字永远赢 id）；id 寻址只在前缀层 0 命中后才进场；`codex/` 前缀可选；重复旗标取后值；空 `--body` 值能过解析、运行期才 BODY_REQUIRED。锚点：`src/resolve.ts:9-15`、`test/resolve.test.ts:142-156`、`199`、`test/cli-args.test.ts:42-46`。
- **REQ-LOC-H13 · doctor 防崩回归锚**：codex spawn ENOENT 且 stdout undefined 不崩（v1.5.0 云端 doctor 崩溃根因——非 win 平台 resolveCodexExecutable 不验存在性直接返 'codex'）；skill 比对**递归 references/ 子树**、多出文件不算不一致。锚点：`src/commands/doctor.ts:190-193`、`212-232`、`test/doctor.test.ts:111-139`、`165-183`。
- **REQ-LOC-H14 · ref 防损坏性质**：validated-not-signed——翻改任意一个字符，结果要么仍是全形状合法 ref、要么 INVALID_CONVERSATION_REF 干净报错，**永不产生半解状态**；mc1 额外 JSON 键被忽略；校验即防线（无签名无校验和）。锚点：`src/ref.ts:154-235`、`test/ref.test.ts:72-87`、`110-114`。
- **REQ-LOC-H15 · machine-id 细节**：boot 内缓存（读一次）；win=注册表 MachineGuid（带杠）、linux=/etc/machine-id、mac=IOPlatformUUID，execSync/reg query 与 ioreg 实现；不可读 → undefined → 调用方退 hostname 比较；normalizeMid（小写+去非 hex）只用于比对边界，存储与线上帧保持历史形态。锚点：`src/platform/machine-id.ts:11-47`。
- **REQ-LOC-H16 · 状态视图三源合并规则**：存在权威=conversations 分片（send-log 有流量但分片没有的对**不显示**）；显示名优先序 to（收件证据）> fromName（发件证据）> from（裸身份键）> id8 短描述；pre-B16 旧条目（无 from）靠解码自身 replyRef 归对；窗口边缘切断的首行丢弃。锚点：`src/conversation-summary.ts:76-108`、`152-180`、`test/conversation-summary.test.ts:84-189`。

### 5.3 隐藏环境旋钮全集（单机可达，不进 usage）

- **REQ-LOC-H17 · 旋钮清单**：`CROSSCHAT_MAX_BODY_KIB` / `CROSSCHAT_MAX_TURN`（两层来源的 env 层）；`CROSSCHAT_CLAUDE_BIN`（claude exe 覆写，unix）；`CROSSCHAT_CODEX_BIN`（codex exe 覆写）；`CODEX_HOME`（rollout/写者锁/回执查找根——codex 生态原生变量，crosschat 尊重之）；身份五变量读三剥五（读 CLAUDE_CODE_MESSAGING_SOCKET / CODEX_THREAD_ID / CODEX_SESSION_ID；wrappers 与 proxy spawn 剥全部五枚）；APPDATA 参与 win 侧 exe 解析。隐藏命令入口 `crosschat __drain [--watch]`。锚点：`src/limits.ts`、`src/claude/resolve-exe.ts:32`、`src/codex/transport.ts:72`、`src/codex/rollout-meta.ts:23`、`src/identity.ts:32-39`、`src/cli.ts:537-550`。
- **REQ-LOC-H18 · 输出契约暗规则**：`--json` 恒单行闭合 JSON、replyRef 恒完整 ref（柄不进 JSON）；人眼输出行尾 `· 续话 cN`、柄缺席回退 `reply-ref:` 完整行；unknown command 走 stderr 带 `crosschat: USAGE:` 前缀。锚点：`src/commands/send.ts:625-634`、`test/send-handle.test.ts:38-68`、`src/cli.ts:682-684`。

## 附：文档 vs 源码勘误

| # | 文档位置 | 文档说法 | 源码事实 | 锚点 |
|---|---|---|---|---|
| 4 | `skills/crosschat/references/advanced.md:21`「发文件」节 | `crosschat send --to <名> --file <路径>` 可单机发文件（正文自动生成"文件 … 已送达"） | 本地路径（无 --via）遇 `--file` 一律 USAGE 拒绝："--file 目前仅配合 --via tcp:<机器> 使用；本机发文件路径直接 --body "<路径>" 即可"——单机发文件路径的唯一形态是 `--body "<路径>"` | `src/commands/send.ts:292-294` |

README 单机段（命令示例/三态/错误码表/审计说明）抽查与源码一致；skill references/errors.md、stars.md 与源码一致；上表为深挖发现的唯一勘误。
