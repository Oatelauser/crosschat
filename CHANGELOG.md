# Changelog

本项目的全部显著变更记录于此。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.5.5] - 2026-10-12

### 修复

- **回信 Windows 机器经 conversation ref 全断（P1，v1.5.4 现场）**：Windows machineId 是带杠 UUID（MachineGuid）、Linux 是纯 hex——ref 推导的 targetMachine 带杠过不了 broker 的 hex 判定 → UNKNOWN_MACHINE。修复：`normalizeMid`（小写+去非 hex）做在**五个比对边界**（resolveTarget 双侧/autoViaFromRef/onConnect 绑定/roster 与碰撞预警/did-you-mean），存储与线上帧保持历史形态（零迁移、混合版本安全）；UNKNOWN_MACHINE 报错自动列注册表候选（did-you-mean）。回归夹具含平台真实形态值（流程教训入档：身份类测试必须用平台真实形态夹具）
- 文档：README/broker.md/federation.md 题词例句去 CLI 黑话注解（"send 时加 --via …"→"走 ssh/tcp 跨机"自然语，旗标映射归还 skill）


## [1.5.4] - 2026-10-12

### E0：星名字段换轨（词表自解释）

- node.json 词表：条目 `name`=星名（**broker 权威**：`serve --name` 设置/hostname 缺省，info 帧下发、守护连接自动同步覆盖，改名重启 broker 全网 2s 收敛）、顶层 `showName`=本机显示名（自报 roster 称呼用）；旧字段 alias/顶层 name 读取层自动映射、同步时清旧键无缝换轨
- 星名字符集 `[A-Za-z0-9._-]{1,32}` 禁冒号（限定词语法保留字）；`--name` 与 `--connect` 互斥
- 选择器全线统一"星名精确→starId 前缀唯一"（via/--connect/--stop 同规则），报错列 `cloud(6b76e1)` 式条目拷了即用；守护标签/日志取解析后星名；broker status 行带星名

### E1：远程会话枚举（012 票）

- `crosschat status --via tcp:<机器名|mid8>`——查远机会话清单，语法镜像 send --via（多星 `tcp:<星名>:<机器>`）；帧表新增 status-query/status-result（additive，14→16 型），broker 按 send 同款 pending 路由、ownMid 本机直答
- payload 分段镜像本地 status 语义（codex 挂掉=unavailable 段部分应答）；过滤参数/--json 请求方本地套用；超时教学"对端未应答——节点客户端在跑吗/两端需升级"（覆盖旧 broker 偏差）
- skill：查远机用它替代"赌名字发送"；ssh 形态对端仍走 ssh


### D0：超长引导与寻址（现场反馈批二）

- **tcp 超长自动降级文件通道**：正文 >1MiB 自动落临时文件走 `--file`（≤64MiB 一次成功，输出注明对端落地路径，成功即删临时文件；失败保留原文并给本机路径）；tcp 腿尺寸线统一为 1MiB 直发/64MiB 文件（替代原 16KiB 默认前置+16MiB 绝对上界的 tcp 分支）；ssh/单机报错路径字节不变，**报错三分支文案逐字快照锁死**（超长引导的权威教学）
- **信封再瘦**：删除 hint 后的"--to 接续/超 16KiB"静态教学行（skill 与分通道报错已全覆盖且该行数字对 tcp/ssh 有误导）——固定开销降至 ~160 字符/条（较最初 -62%）
- **`--to` 前缀解析**：全名精确（字节不变）→ 唯一前缀（大小写不敏感，跨两侧计数）命中直投；多命中 NAME_COLLISION 列候选教完整名重试；id8/--conversation 零影响
- **skill 教学梯度重排**：名字/关键词在手直接发（CLI 自己解析）→ 多候选报错里挑全名 → 才 status（带过滤）；MESSAGE_TOO_LARGE 改阶梯地图（单机 16KiB 默认可提额 / ssh·tcp 正文 1MiB / tcp 超限自动转文件 / 准确数字以报错为准）


### 信封瘦身 A+（token 优化，现场反馈驱动）

- 回信命令去 `--via`、reply-hint 去重复 `conversation` 属性——ref 全信封唯一，固定开销 **-36%**（~420→~270 字符/条）；tcp/ssh/单机三态归一式 `crosschat send --conversation <ref> --body`
- 执行侧自动选路（autoViaFromRef）：ref 星标识→本机条目走 tcp（target=对端完整 mid）；无星走既有 ssh 补全；超旧无指纹引用→教学加显式 --via；接收腿（--origin 在场）不选路防对弹
- 旧信封照抄照 work，交叉兼容；架构手册/README/两手册例句全量换新句式

### status 套件

- "转发器"两行拆名：`节点客户端:`（多守护带 [选择器] 标签）/`broker:`；alias 展示 >16 字符截短
- 过滤参数：`--claude`/`--codex` 选段、`--name <子串>`（主视图+conversations）、`--via tcp|ssh`（配 --conversations 按传输族）、`--json` 组合结构不变
- `(unnamed)` 默认隐藏（默认行为变更经用户拍板），`--all` 带出；skill 同步 --all 注记与"跨机正文别堆本机细节"教学（权限分类器现场拦截教训）
- 形态二（云端直连）drill 实录归档销账：10 问 10 答/21 轮零丢失（`docs/drill-reports/broker-cloud-drill-20261012.md`）；挂票 012 远程会话枚举 `status --via tcp:<机器>`


## [1.5.3] - 2026-10-12

### 修复与打磨

- **gen-key/自登记只产出数组形状**（用户现场反馈：打印单星结构被误读为"不支持多星"）——node.json 从此一种形状（单星=数组一项，入第二星=追加条目）；gen-key 尾注补多星合并指引与版本要求（目标机 ≥1.5.2）；ensureSelfEntry 状态检测改双形状（按"本 broker 钥匙条目"定位，多星机上自用条目与外星条目共存不误报）；旧单星形状文件读取/回填永续兼容
- `status --conversations` 末条为 `queued` 时行尾自动加注"（已交对端队列待消费——对方回信即证明已处理）"；README 补 queued 语义与账本视角说明（现场反馈归档 `docs/drill-reports/field-feedback-20261012.md`）

## [1.5.2] - 2026-10-12

### 多星成员（011 票：一台机器同时入多个 broker 星，无状态路由）

- **node.json 双形状**：旧单星形状永兼容（连一次自动回填 starId）/ 多星 `{brokers:[…],name}` 数组——唯一落盘配置，零缓存文件
- **starId 星标识**：broker 首次 serve 生成（broker.json 顶层 12 hex，与 machine-id 解耦）；gen-key 打印进 node.json；info 帧携带；节点**在发钥匙之前**比对（不符即断 `STAR_ID_MISMATCH`，守护永久停机不退避——钥匙不出手）
- **mc2_ 尾部扩展**（flags bit 10 携带星标识）：回信/续发自动选星，信封与 skill 教学零改动；旧版解析器遇新引用走既有"升级后重试"版本偏差教学
- **发送路由四序**（纯本地，无探测）：限定器 `tcp:<别名|starId前缀>:<目标>` → 会话引用星 → 单条目 → 报错教学；`--file` 同路
- **命令面**：`--connect <选择器>` / `--stop <选择器>`（无参=先全部守护后 broker）；uninstall 拒删扩为扫全部守护；doctor 逐条目+缺 starId/双条目同星 ⚠️；status 多守护逐行+`--json` 新键 `tcpProfiles`（旧键不动）
- 单星机全路径行为字节不变（快照测试锚定）；设计经六轮俯瞰（探测路由/会话缓存文件/mc3_ 均否决，票面存档）

### serve / gen-key 输出增强（消除黑盒）

- `serve --detach`（broker）输出补端口：`broker 后台运行中 pid=X 端口 N（日志：…）`
- broker 首启自登记**三态出声**：新写 node.json（路径+127.0.0.1 声明）/ 已存在指向别家（提示本机发送将走它）/ 已存在但钥匙/端口陈旧（BAD_AUTH 预警，删文件重启重建）；一致时静默。`--detach` 下在父进程 spawn 前执行，后台模式控制台同样可见
- `--gen-key` 输出重构：探测行带 host:port 并列 host 选择三规则（broker 自身 127.0.0.1 已自动配 / 云主机 NAT 填公网 IP——NAT 公网不绑网卡探测必失 / 局域网填局域网 IP、非默认端口 port 一并改）；尾部补目标机器放置路径与"须在 broker 机上执行、勿覆盖 broker 机自用 node.json"提示

### 文档

- README 快速入门补 tcp 第三段会话实录（👤🤖📨，与单机/ssh 同款风格）
- **broker.md / federation.md 四章重构**（用户现场反馈驱动）：一·环境搭建（broker 选型五场景/按 OS 分节，步骤原样保留）/ 二·跨机聊天（一句话题词实录，命令退居幕后）/ 三·底层实现（默认折叠）/ 四·协议对接（默认折叠，broker 补 14 帧示例 JSON·双向帧流实录·错误应对矩阵·文件状态机·最小客户端五步；federation 以 CLI 契约等价）；写作规范=文字先行、Linux 为主 win 一句带过；排障表永不折叠
- `docs/broker.md`：S1/S2/C1 期望输出按新打印更新；**单星边界**声明（一台机一份 node.json；多星=proto:2 挂账，路线已核不破坏升级）

## [1.5.1] - 2026-10-11

### 修复

- `crosschat doctor` 在无 codex CLI 的 Linux 机器上崩溃（v1.5.0 云端现场）：非 win32 下 codex 解析器不验存在性直接返回 `codex` → spawn ENOENT 时 `stdout` 为 undefined → 版本探测行 `firstLine(undefined).split` 崩。spawn error 现并入「codex CLI 未找到」❌ 分支，全探测对 undefined 容错；含回归测试（ENOENT + undefined stdout 形状）。serve/send/connect 不受影响，仅 doctor 探测路径。

## [1.5.0] - 2026-10-11

### tcp 转发器组件（票B：tcp/broker 合并为单一组件，全网唯一监听端口）

- 三角色：`crosschat serve`（服务端 broker，默认端口 7260 经 IANA 实查未分配）/ `crosschat serve --connect <别名>`（常驻节点，断线退避 1s→60s 永不放弃、≥5 分钟静音、broker 重启实测 2 秒自愈）/ `crosschat send --via tcp:<机器>`（瞬态发送，零进程）
- 三部署形态：两机 colocated（主打）/ 跨网堡垒+ssh 隧道包裹（公网明文风险的官方姿势，TLS 挂账待定）/ CI 零进程直发
- **mid8 双轨寻址**：协议寻址权威=machine-id 前缀（git 短哈希式最短无歧义，改名/同名免疫），名字=人读显示用；信封 reply-hint 盖 `--via tcp:<发送方 mid8>`，回信照抄即回
- 星型密钥：`--gen-key [N≤10]` 打印完整 node.json 分发（自动探测 IP 带"人工核对"声明——drill 当场应验）；`--list`/`--remove` 注册表管理；`--stop` 三重身份校验安全停止
- **文件通道**：`send --file`（sha256 锚/256KiB 分块/断点续传/去重秒回/懒删除 5 天+512MiB/单文件 64MiB）
- 协议 proto:1 草案公开（`docs/broker.md` 协议规范章：MQTT/NATS/STOMP/JSON-RPC 取材，第三方可实现兼容 broker；多实例集群注意事项已注明）
- `crosschat clean [--force]` 收件/断点清理；`crosschat uninstall [--yes]` 全量卸载（serve 在跑拒删）
- status/doctor 转发器区块+实时在线机器表（roster）
- 手册 `docs/broker.md`：三形态实录（形态二 drill 占位待补）+协议规范+排障对照
- drill a（win broker+WSL 节点）真机十腿全过，含**跨机 agent 自主对话闭环**（报告 `docs/drill-reports/broker-wsl-drill-20261011.md`）

### 修复

- `--json` 模式 codex queued/unconfirmed 回执被中文注记污染（tcp 桥必炸，人类可读输出不变）
- 远端来件（--origin）署名被环境残留身份压制——origin 在场即权威，ssh/tcp 接收腿同享修正
- skill 实地反馈三条不变式入教学（旧 ref 照抄安全/queued 消费确认=对端下一条 turn 号/管道敏感字符场景）

### 升级提醒

- 已装用户**重跑 `crosschat install-skills`**（skill 新增 tcp 段与错误自纠）

## [1.4.0] - 2026-10-09

### 上限可配置化与轮次预算（票A）

- 单条正文上限三层来源：`--max-body-kb` > `CROSSCHAT_MAX_BODY_KIB` > 16KiB 默认（默认行为零变化）；按目标端点封顶——claude 64KiB / codex 1MiB / `--via` 本地预检 1MiB（远端自检）、来源值 16MiB 绝对上界
- 轮次预算：`--max-turn` / `CROSSCHAT_MAX_TURN`，信封显示 `turn="N/M"`（合并进既有 turn 属性，零新增 token 负担）——软提醒不硬拦，调大下一条消息即生效；预算由操作者按两端模型窗口设定、两端建议对齐
- **新命令 `crosschat codex`**：与 `crosschat claude` 成对的增强启动器——旋钮透传（校验后写会话环境变量，本会话全部 send 继承；send 显式参数仍最高优先）+ **身份清洗**（启动时剥"别家"身份环境变量、留自家——CALLER_IDENTITY_CONFLICT 的机构化预防；家族注册表结构，新 agent 家族加一行即扩展；`CODEX_HOME` 等配置变量不动）
- 信封教学行保持静态 16KiB（读者是收方、数字是发方的，准确数字只住各侧自己的报错里）；远端来件被拒改教 scp 优先（撞端点硬顶时 scp 是唯一出路，不教提额死路）
- 新增 docs/commands.md 命令全量说明（send 全参数/优先级链/端点封顶表/启动器对/环境变量总表），README 速查挂钩
- 升级提醒：已装用户重跑 `crosschat install-skills`（旧 skill 不认识 `turn="N/M"`）

### 联邦操作手册定版（docs/federation.md）

- 手册按操作系统重构：Win/Linux/MacOS 三配置章 + 单向 SSH（NAT 反向隧道）独立章；全文 transcript 单代码块格式（`>` 标命令 / `#` 备注 / `<XX>` 占位符）
- NAT 反向隧道扩为完整实施手册（N1–N7 步骤/验证阶梯/失败对照表），win↔云端真机闭环实录（User 行必写/隧道即会话生命）
- 公钥交换改三小步结构（打印→对端装入→收对端公钥）；跨系统依赖显式化（⚠️前置/⚠️必做 全篇引用）；keyscan 全部换 `accept-new` 首连记指纹（实测部分服务端 keyscan 算法协商缺陷）
- 白纸冷走验收一次通过定版（drill 报告在案）；配套 `scripts/fed-ssh-clean.sh` Linux 侧联邦 ssh 信息幂等清理
- B11 跨机回复乒乓回归单测补录

### 文档

- README 多轮重构：主页（亮点/部署在前/双问答实录，细则外迁 docs/usage.md 与 federation.md）、快速入门单框流程记法（👤/🤖/📨 三图例）、错误码表瘦身
- docs/usage.md 边界行同步提额与预算；docs/wayfinder/map.md 状态同步

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
