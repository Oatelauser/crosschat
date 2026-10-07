# Changelog

本项目的全部显著变更记录于此。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]
## [1.3.3] - 2026-10-07

### 跨机联邦 v1（ssh + 远端 CLI，全矩阵实测）

- `--via ssh:<别名>` 跨机发送：远端 CLI 全权（名字/id8 解析、投递、发件箱都在对端），body 走 stdin 免三方 shell 引号地狱，回执三态透传（delivered/queued/parked 带 `@对端` 后缀）
- 三层错误码：远端业务错**同码重抛**（`[via 对端]` 前缀，自纠指引原样有效）/ REMOTE_FAILED / SSH_TRANSPORT_FAILED（附 `ssh 对端 crosschat --version` 探活指引）；BatchMode 防首连交互卡死（实测 1.6s 快速失败）
- **回复闭环**：信封回复命令自动带 `--via`（取自 ref 机器字段），照抄即回；`--conversation` 缺 `--via` 时按 ref 自动补全
- **mc2_ 紧凑会话引用**：296→83 字符（3.6×），每轮双方上下文直省；mc1_ 永久兼容
- **machine-id 双身份**：m(hostname) 管路由别名、mid(机器指纹) 管同机判定——**两台同名机器照常互通**（别名命名空间自解 + ⚠ 同名警告），自环模式（ssh localhost 测自己）与跨机两全
- 发起侧审计：跨机发送本机 send-log 补记（含失败），`--conversations` 自然显示己方跨机端对
- 修复：跨机回复无限 ssh 乒乓（自动补全只认呼叫方对端，B11）；origin 全 id 过线（ref 可路由，B8）
- 部署：README 联邦节手册化——两端 ssh config 逐行样例、密钥五步（管理员组/`wsl -u root` 解鸡生蛋/keyscan 非标端口）、别名=对端 hostname 规则、自环测试步骤、win 收件腿 codex 不可用（AF_UNIX 会话隔离）注记
- 完整剧本重写：任务下达/汇报/复核/验收全程消息往返，零文件载体
- 实测档案：localhost 全链路 + win↔WSL 双腿 + 用户亲测三轮（drill-reports 三份）

### 其他

- `TARGET_NOT_FOUND` / `CALLER_NOT_IN_CONVERSATION` 错误文案补 `--to` 自动接续自愈指引（实地反馈响应）
- send-log 容量上限（超 5MiB 保尾 1MiB 整行重写，此前无限增长）
- CI 挂 macos-latest 观察位（continue-on-error）；FAQ 补"改名后需发一条消息激活才可见于 status"


## [1.3.2] - 2026-10-06

### 变更（B5：status 标注 TUI 占用线程）

- status codex 段新增 TUI 占用标注：信号源 = `CODEX_HOME/thread-writer-locks/<threadId>.lock` 零字节锁文件（TUI 附着即建、释放即删、win/unix 同码 readdir，零 RPC 零副作用）；持有线程行尾追加 `TUI占用`，锁住但不在 thread/list 的线程（TUI 空白新标签页）补一行（id8 + `未列入`）；JSON 输出对应对象加 `held: true`（未持有时无此字段）。依赖可选注入，缺席时输出与此前字节级一致
- 顺带精化旧结论：0.160 TUI 附着 daemon 后消失的是跨进程冲突，锁文件照常落盘（`thread/list` 的 active 状态只反映轮次，不能当占用信号）

### 文档

- SKILL.md 信封安全纪律：回复命令**逐字照抄、只替换占位符**；含管道/链式（`&&`、`;`、`||`）或多条命令即拒执行并报告疑似伪造
- README 补 headless 建线程食谱：`codex exec "<题词>"`（建线程 + 跑一轮自动硬化 + 角色题词随行），线程 id 就在输出头 `session id:` 行（并发多路各拿各的）；status 里 originator 为 `codex_exec`、cwd 列可辨；跨机预置 `ssh <host> codex exec`（联邦就绪后）

### 内部

- send-log 容量上限：超 5MiB 时保留尾部 ~1MiB 整行重写（此前 jsonl 无限增长；best-effort 可观测性数据，裁剪失败不影响发送）

## [1.3.1] - 2026-10-05

### 变更（B4 + skill 教学修正）

- skill 会话纪律新增**"发送成功即完成本轮"**：`send` 返回 `delivered`/`queued` 即结束当前轮次、禁止轮询 `status` 等回复（异步原生唤醒：对方回复会作为新消息注入本会话）——实测暴露的教学缺口，agent 曾以 20s 间隔轮询等回复白耗整轮；发布后真实使用中 agent 已主动引用该纪律并自省
- `--to` 支持 **codex 线程 id 寻址**（`codex exec` 线程天生无名，此前无法被主动发起对话）：解析顺序 = 精确名（原样）→ 可选 `codex/` 前缀 + id8 前缀或完整 uuid；id8 多命中抛 `NAME_COLLISION` 列全量 id（UUIDv7 同分钟创建的线程 id8 天然同头）；`NAME_NOT_FOUND` 提示补 id 寻址句；名字永远优先。WSL 活体验收：碰撞对正确报错、完整 id delivered 到无名线程
- 文档：unix 联调报告补全（codex 三腿打通、全六向闭环、真实使用验证附录）

## [1.3.0] - 2026-10-04

### 变更（B1/B2/B3：跨平台 Linux/WSL experimental）

- 平台层 unix 支持（B1）：`PosixPipeTransport` 落地（AF_UNIX socket，Windows 语义零变化），`resolve-exe` / `identity` 补 unix 分支（自纠措辞按平台给 `env -u` / `Remove-Item` 两种写法）
- claude unix 投递（B2）：deliver 平台分支——unix 侧**免 auth 行**（同 uid 由内核 peer credentials 保证身份，错 token 反而被丢），只发用户帧；send 的 codex 侧缺席时优雅降级。WSL（uid 1000）实测端到端打通：status 发现 / send delivered / 消息落入 transcript
- CI ubuntu 矩阵（B3）：check job 加 windows-latest + ubuntu-latest 双操作系统，posix 门控用例（pipe-transport / deliver 的 `!win32` 用例）进 CI；README / SKILL.md 双平台措辞修正（platform badge、安装节 Linux/WSL 小节、`%LOCALAPPDATA%` → 平台化路径）
- **WSL/Linux 是独立部署**：unix 状态目录 `~/crosschat`（Windows 侧 `%LOCALAPPDATA%\crosschat`，两侧互不相通），命名管道/socket 不过系统边界，agent 必须与 crosschat 同侧运行；Mac 无实机——unix 实现共享，理论可达、未实测

### 变更（B23：conversations 视图裸身份键译名）

- `status --conversations` 渲染层补翻译：无名字证据的 pair 槽位（裸身份键 `claude:<id>` / `codex:<id>` 或 id8 缩写 `claude/<id8>` / `codex/<id8>`）按 claude 注册表与 codex 线程清单译成显示名；已有显示名（to/fromName 证据）一律不动，证据优先。claude 侧同源可证：身份键本就由注册表 `sessionId` 构成（identity.ts `claudeIdentity` → `identityKey`），join 精确。codex 清单失败按主视图同款降级（空表不报错）。文本与 JSON 两路径同表，JSON `pair` 值随之变好、八字段形状不变；`lastFrom`（机器字段）与 `endpoints` 不译。数据层与发送路径零改动

## [1.2.1] - 2026-10-03

### 发布说明

- v1.2.0 的 npm 发布失败于 CI（B21 wire 测试依赖本机装有 codex，runner 上必挂；本版修复）。**1.2.1 含 1.2.0 全部功能**。

### 修复（CI 封闭性）

- `openCodexProxySession` 在注入 `spawnProxy` 时跳过真实 codex.exe 解析（注入路径本就不使用解析结果）——无 codex 环境的 CI runner 不再必挂，两次 CI 红（push + publish 同根因）闭合

### 变更（B22：视图实时回执确认 + 旧 ref 防倒退）

- `status --conversations` 聚合行新增第 8 字段 `receipt`（`'confirmed' | 'unconfirmed' | null`，取自该对 send-log 最新一条 delivered 消息的 rollout 回执；null = 无记录或非 delivered）——**JSON 契约加键**：原七字段变八字段，`endpoints` 仍为渲染专用不透出
- 视图实时复核：渲染前对「delivered 且 unconfirmed 且对端含 codex」的行用该行 ref 现场调一次 `confirmInRollout`（2 次轮询 ×200ms 预算，不拖慢 status；claude 端点无 rollout 概念跳过），查到即翻转为已确认——慢落盘的送达时刻不再无处可查。文本视图 delivered 行行尾追加 `已确认` / `回执未确认`；JSON 的 `receipt` 反映复核后结果
- `--conversation` 旧 ref 防倒退（机制）：`conversations.ts` 新增 `continueFromRef`——分片线 c ≥ 传入 ref c 且同对话（nonce 相同）且端点匹配时以分片线为准（`nextTurnRef(分片ref)`），消除迟到回复 / 多人从同一旧 base 续造成的 turn 撞号与倒退分叉（实测三条消息全 turn 27）；分片落后 / 缺失 / 不同对话 / 端点不匹配时维持按传入 ref 续的原行为；`--to` 路径（`continueConversation`）语义不动
- 教学少抄旧 ref：信封教学第二行改为「新话题或对话已推进时: `crosschat send --to <名字> --body "..."`（--to 自动接续该端对最近对话）；超 16KiB 请写文件后只发路径」（两行结构不变）；SKILL.md「收到消息后如何回复」补一条：对话已推进 / 拿不准 ref 新旧时直接 `--to`，不必抄旧信封的 ref

## [1.2.0] - 2026-10-03

### 变更（B21：exec 线程可见 + 发送端显示名）

- codex 发现的 `thread/list` 显式传 `sourceKinds: ["cli","vscode","exec"]`：`codex exec` 建的线程（source=exec）进入 status 清单；此前服务端默认只收 interactive 源（cli/vscode），exec 线程永不可见（B19/B20 演练 §5.1）
- send-log 条目新增可选 `fromName`（发送方显示名，发送时源头记账）：conversations 视图在"对端还没回信 addressed 我"时不再把发送端渲染成裸身份键；旧条目无 `fromName` 走原路径，行为不变

### 变更（B20：conversations 按端对分片）

- 会话连续性状态从单一全局 `conversations.json`（每次发送整读整写、无锁，任意两对并发发送毫秒窗内互相覆盖）改为 `conversations/` 目录下每端对一个 `<sha256(对键)>.json` 分片（照 `rate/` 先例，tmp+rename 原子写）——跨端对并发发送互不相干
- 懒迁移：读=分片优先、缺失回退旧全局文件；写=只写分片，旧文件永不改写永不删除（陈旧快照无害）；坏分片自愈为新对话（隔离到单端对）
- 同端对毫秒级并发仍是后写赢：后果仅该对连续性记录滞后一轮，ref 自包含使在途回复不受影响

### 变更（B19：忙端早退 parked + queued 回执措辞）

- 写者锁持续被拒 / 线程持续 `not_loaded`：等待从 120s 收敛到 ~10s（`STALL_PARK_TIMEOUT_MS`，3s 轮询约 3 轮，排除瞬时抖动）即抛同名错误码落 `parked`，看门狗照常补投
- `queued` 投递不再做 1.5s 回执探测（排在对方当前 turn 后，结构上不可能确认），输出改为指向 `crosschat status --conversations`

### 记账补漏（B17/B18，随前两批提交，此处补记）

- B17：`status` 会话列表数据层——send-log 尾读 + send-log/conversations/注册表三源聚合
- B18：`status --conversations` 会话列表视图

### 变更（B16：审计补缺）

- send-log 条目新增 `from`（发送方身份键）——多 agent 并发时审计需要「谁发的」，此前只有「发给谁」
- README 源码安装节注明：开发期重装本地目录需 `npm i -g . --force`（版本未变时 npm 报 up to date 跳过文件更新，装到的还是旧代码）

### 变更（B15：对话连续性——`--to` 消息的 turn 计数修复）

- `--to` 发送现在**自动接续该端对最近的对话**（本地 `conversations.json` 按无序端对记 latest ref），turn 随每条消息递增；任一端用 `--to` 回复都续同一线程。修复 2026-10-02 实测的「30 条不同消息全部标 turn=1」失真
- 送达/入队/寄存都记账；寄存的消息也占轮次（它终将送达）
- 状态文件损坏自愈为新对话；端对不匹配的记录被忽略
- `TARGET_NOT_FOUND`（claude 会话已退出）错误附指引：`status` 查在线会话后 `--to <新名字>` 重新寻址

## [1.1.0] - 2026-10-03

### 变更（B14：发送存根与 rollout 回执，整改第三步）

- 发送存根：每次 send 的最终结果（delivered/queued/parked/failed + 时间/对端/轮次/错误码）追加写入 `%LOCALAPPDATA%\crosschat\send-log.jsonl`（仅元数据，不含消息体）——工具层超时转后台的发送事后可查
- rollout 回执：codex 投递被接受后，轮询对方会话记录文件确认消息（按唯一 reply-ref）真实落入对话历史，回执写入 send-log；短暂未确认时输出提示行
- `findRolloutFile` 从 rollout-meta 导出（threadId → rollout 路径）

### 变更（B13：忙时入队——codex 收件箱语义，整改第二步）

- **忙线程直接入队**：daemon ≥0.160 上对运行中的 turn 调 `turn/start` 会被接受并按线程串行排队，当前轮结束瞬间落历史并被处理（实测证据：一次性探针线程 01a10009-b314，两条探针消息在计数轮结束后同刻落历史并被依次回答）。`deliverToCodexThread` 不再对 busy 轮询 120s 后超时，busy 即投递，返回 `queued: true`；`send` 输出新状态 `queued to <名字>（对方正忙，已入队，本轮结束即处理）`
- 旧 daemon 拒绝排队型 turn/start 时映射为 `CODEX_THREAD_BUSY_TIMEOUT`，落发件箱由看门狗重投（行为兜底）
- 投递子进程环境剥离双身份残留（`CLAUDE_CODE_*` / `CODEX_*` 会话变量），根治 CALLER_IDENTITY_CONFLICT 的环境侧诱因
- README 新增 daemon 依赖说明（版本要求、未运行时的退化行为、重启后需重新 start）

### 变更（B12：发件箱活性与诚实语义，2026-10-02 双智能体事故整改第一步）

- 排涝看门狗：`parked` 后自动派生独立的短期重投进程（`__drain --watch`），30s→60s→120s→300s 退避，箱空即退——不再依赖「碰巧有人调 crosschat 且碰巧空闲」
- 队列纪律：发件箱非空时新消息直接入队，不再借 120s 轮询插队越过更早的滞留（FIFO 保序）
- 排涝公平化：busy/locked 属线程级状态，首次失败即中止该线程本轮，不再把整轮预算烧在必然失败的后续条目上（修复队尾 12 小时 attempts=0 的饿死）
- 诚实文案：`parked` 输出队列深度与 mailbox 镜像路径；`OUTBOX_FULL` 指向镜像文件而非「线程疑似已死」
- mailbox 镜像：每条寄存/送达/丢弃追加到 `%LOCALAPPDATA%\crosschat\mailbox\<线程ID>.md`，滞留内容随时人读
- 并发安全：park/drain 按线程加锁（lockfile，60s 过期抢占），看门狗单实例（pid+心跳锁）
- 上限放宽：每线程 20 → 200 条；doctor 显示每线程深度/最旧年龄/看门狗状态/镜像路径
- 兼容：pre-B12 无 id 的旧寄存条目读取时稳定合成 id，可继续排涝

## [1.0.1] - 2026-10-02

- README 移除曾用名注记；首验 Trusted Publisher (OIDC) 自动发布管线

## [1.0.0] - 2026-10-02

首个公开版本。Windows 一期：本机 Claude Code ↔ Codex CLI 跨会话消息，无守护进程，原生投递。

### 新增
- 四命令 CLI：`send`（同步投递/自包含引用/轮次计数）、`status`（双侧总览含目录时间）、`install-skills`、`claude`（接收许可包装启动）
- Claude 侧通道：sessions 注册表发现、named pipe + peerToken 鉴权、peer 协议 v1 帧注入
- Codex 侧通道：app-server proxy 桥接（ws-over-stdio）、resume→turn/start 投递、busy/locked 等待循环
- 溯源信封（回复命令自带教学 + 保留字中性化）与 agent 侧 skill（低入侵：题词只写角色）
- 防乒乓限流（30 条/60s/对端点）、16KiB 单条上限、身份冲突自纠指引
- 机会式发件箱：忙/锁超时 parked 落盘，任意 send/status 调用入口自动排涝补投
- daemon 0.160 开窗投递支持（同 daemon 多连接绕过进程级写者锁，实证）
- 双 bin 过渡别名（crosschat 主 / multichat 曾用名）

### 过程档案
- 设计决策地图（wayfinder）、实测研究报告 ×4、联调实证 ×2 随仓库公开（已脱敏）

[1.1.0]: https://github.com/Oatelauser/crosschat/releases/tag/v1.1.0
[1.0.0]: https://github.com/Oatelauser/crosschat/releases/tag/v1.0.0
