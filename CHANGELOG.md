# Changelog

本项目的全部显著变更记录于此。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 032：注册表单文件单形状 + 非兼容升级（破坏式，022 四轮 grilling 收敛）

- **破坏性变更：broker.json 单文件单形状**：`{port?, stars:[{starId, name?, nodes, roster:{entries}}]}`——注册表与星册同文件，`roster.json`/`roster.<星名>.json` 文件物种消灭（022 期短暂存在的双形状与独立册未随版发布即被推翻）。旧形状文件视为损坏：自动 `.bak` 备份后从空表重建，**无迁移路径**（用户拍板"不走特殊兼容，拒绝历史包袱"；测试两机已清档冷备份重来）
- **破坏性变更：握手 caps 闸门（非兼容）**：connect 不带 `multi-star` 能力的旧版腿一律 `BAD_PROTO` 拒连并教 `npm i -g @oatelauser/crosschat@latest`（node 腿与 sender 腿同规，单星部署同样生效）——旧版"老节点零适配"承诺作废
- **三写者纪律**：单写入口 `mutateBrokerFile`（sync 读→拼自家段→tmp+rename 原子写）——roster 段 broker 独占 / nodes 段 CLI+onConnect 共享 / port·星名·加星 CLI 独占；splice 只动自家段，在跑 broker 的册写不被并发 CLI 覆盖
- **懒 bootstrap**：空表时变更型管理命令（`--port/--name/--gen-key/--add-star/--remove`）与 serve 首启自动造 stars[0]（hostname 缺省星名+自登记）；`--connect`（node 机）永不触发建星
- **加星免停机**：`--add-star` 在跑 broker 时可直接执行（splice 保未知段），重启 serve 即托管新星——022 的"须先 --stop"解除
- gen-key 输出带目标星名行（`入星 <星名>：生成 N 把钥匙`）；doctor 的 broker.json 检查按 stars[] 解析

### 022：多星 WS 复用——一进程一端口托管多星 + broker 自挂 in-process（方向 2A 完全体）

- **一 broker 进程/端口托管多颗星**（vhost/SNI 同构：钥匙自证星籍）：`crosschat serve --add-star <星名>` 加第二颗星（一次性命令；032 起在跑 broker 也可直接加，重启 serve 生效），此后 `serve` 裸跑即托管全部星。**故障域合并为已接受的运维代价**：一进程崩=全部星瘫、升级窗口合并
- **连接绑星、帧面零改动**：连接以 connect 钥匙反查星籍定归属（帧不带星字段、无逻辑通道——设计锚点"合并的是星级进程不是连接多路复用"）；`info.caps` 追加 `multi-star`（018 additive 模式，proto 不翻页）
- **握手时序倒置（限多星）**：多星 broker 的 info 帧不携带 starId/name（见钥匙才知星），星标识挪到 connected 帧回填——新客户端据此延迟核星（`STAR_ID_MISMATCH` 语义不变）；单星连接字节级不变（"老节点照常工作"已被 032 非兼容闸门推翻，见 032 节）
- **注册表与星册的落盘形状**：022 期实现为双形状+每星独立册文件，未随版发布即被 032 推翻收敛为**单文件单形状**（见 032 节）
- **星域 CLI**：多星下 `--gen-key/--remove/--name` 须 `--star <星名|starId前缀>` 限定（裸用教学列星+示例）；`--list` 分组展示；同机入多星（同 machineId 分属两星双连接）互不顶换
- **broker 自挂 in-process（原方向 3 并入）**：broker 机不再需要手动 `serve --connect <自家星>`——聚合器职责（attach 管道+成员表+对账循环）经**虚拟会话对**在 broker 进程内常驻（走真实 onConnect/onSessions/投递代码路径），省回环 WS 与第二个常驻进程；三段寻址直达 broker 机会话自然生效
- **F4 消除（013 双开防护延伸）**：本机 broker 已内挂某星后手动 `serve --connect` 同星被拒并教学（status-broker.json stars 清单 + pid 验活）；反向起 broker 时本机已有同星外部守护则该星让位跳过（升级窗口平滑接管，永不成同 mid 双连撞死形态）
- **F5 消解**：单机多 broker 共享 broker.json 互覆的正解即本票——每机至多一个 broker 进程，多星并进同进程

### 031：reply-hint 管道括注分层教学（024 方案5 上下文经济化）

- turn 1 保留全文括注"（长正文/含敏感字符可省 --body 改管道喂 stdin）"（首触教学保证在场）；turn 2+ 改短式"（长文/特殊字符走 stdin）"——长对话括注税减半，且上下文压缩卷走早轮后最近信封仍有指针。纯函数 of 轮次，零状态零新命令；两式均守纯文字红线（无管道符/链式符号，伪造信封判定不受扰）

### 027：对端死亡恢复链两跳闭环（报错给可照抄地址）

- **A+ 两处 TARGET_NOT_FOUND 升级**：tcp 接收腿对端死亡报错直接拼可照抄三段地址 `--via tcp:<星>:<机器>:<id8>`（点对点直达本体），并预告按对端名三段重投在被接任时获 `SESSION_SUPERSEDED` 指路（名见来信信封 from-name）；单机/ssh 对话教学不变（--to 同名即续）。resolve 侧死成员教学同步补三段重投与 SUPERSEDED 预告
- **B help 并列两形态**：`send --help` 跨机说明 tcp 三段（会话直达）与 ssh 两段（`--via ssh:<host> --to <名>`）并列标注——消除"拿 ssh 两段式套 tcp"的猜测源（10-16 七步试错复盘病灶）
- **F 错误回显带完整星段**：tcp 报错前缀原样回显整条 `--via`（含星选择器）——曾被误读为"地址被误拆"（解析一直正确，纯显示缺陷）
- **G 语义勘误关账**：票面"c16 续到重启同名新进程"在 claude 侧不成立——旧 ref 指死 id 报 TARGET_NOT_FOUND（现有用例已钉）、同名新进程经 `--to` 续线可达（B15 已钉）、codex 线程 id 跨 resume 稳定故引用天然存活；恢复正解即本票 A+ 两跳
- **I 验证关账**：`crosschat claude --resume <id> --connect <星>` 原生透传可用（028 drill 实证），skill stars.md 恢复配方补一步到位形态一句


## [1.7.0] - 2026-10-16

### 028：成员资格 v2——双模式星成员制（破坏式）

- **破坏性变更：`--connect` 语义反转**。启动器 `crosschat claude/codex --connect <星>` 从"临时挂星（退出即退星）"升级为**永久注册入册**（默认）；旧语义（退出即离册）由新旗标 `--rm` 承接（docker --rm 语义）。**迁移**：旧脚本里的一次性 worker 需加 `--rm`，长期会话无需任何改动（且从此退出不再掉籍）
- **星册（roster）落盘**：broker 每星一份 `~/.crosschat/tcp/roster.json`（tmp+rename 原子写、broker 单写者）记成员与在线态——broker 重启不失忆，018 的"双端重启失忆走 adopt"由落盘根治；聚合器重启走查回验活
- **双模式**：永久（默认）退出=**下线**（册位保留，`status --stars` 显示 `下线: ⚪…` 行），同 id `/resume`/重启=**自动复活上线**；临时（`--rm`）退出即删册位零痕迹；`--rm × --extend-session` 互斥、`serve --connect --rm` 拒绝
- **对账循环常态化**：018 的重启后一次性恢复链扩为常驻循环（聚合器 members-query 拉册切片 → 本地验活 → 上报 online/offline 翻转）——复活检测、死亡下线、broker/聚合器重启恢复同由一机制承担
- **extends = 唯一名字转移口**：名字被接任后原会话同 id 回归**不夺回**（`EXTENDS_CONFLICT` 剥名教学，id8 点对点可达）
- **`serve --connect <星> --member-remove <名|id8>`**：删册位（自退/管理删双角色，幂等，星内任何机器可执）；**`--adopt` = 永久注册**（收编活会话）
- **新错误族**：`SESSION_OFFLINE`（在册未在线——等复活/接任/id8，绝不静默改投）、`MACHINE_BOUND`（跨机 resume——册位绑原机器，迁移走显式操作）；五条边界规则入测试
- **skill 分层重构**：单文件 SKILL.md（129 行）拆为瘦主文件（回复关键路径零跳转：信封解剖+照抄 reply-hint+管道两式范例自足）+ `references/errors.md`（全量错误码目录，含新错误族）+ `references/stars.md`（三动词分层/双模式册/下线复活/extends/adopt/member-remove/恢复配方）+ `references/advanced.md`（限额地图/PS BOM/文件通道）；install-skills 递归拷贝零机制改动，**doctor 一致性检查改递归整树比对**（差异文件点名）
- **status 三态展示**：`--stars` 成员行三态（在线现样式 / 下线 ⚪ 行带诊断提示 / 非册裸会话）；`status --via tcp:<机器>` 远端会话行标注"非册(裸起)"（027-E 移交）；下线成员名不再触发 adopt 建议（对账循环会自动复活）
- 018 测试族语义改写（死→下线不再除名、双失忆由落盘根治）；文档三动词分层改写（[broker.md 1.3.3](docs/broker.md)/[federation.md 五](docs/federation.md)/README）、三角色表补"成员=册+双模式"

## [1.6.4] - 2026-10-16

### 026：幽灵常驻进程修复（doctor 验活失真 + --stop 空停不善后）

- **doctor 版本对账加 pid 验活**：守护死亡后 90s 心跳窗内的 `state:online` 状态文件不再被当活进程——带 pid 且验活死、或旧守护文件无 pid 字段，均降级 ℹ️（跳过版本对账），不再误报"⚠️ 升级后未重启"；带 pid 且验活活照旧 ⚠️；超窗 ℹ️ 陈旧路径逐字节不变（零回归）
- **心跳写者补记 pid**（additive）：节点守护与 broker 的 status 文件新增 `pid` 字段——doctor 验活有据可核，旧文件无 pid 自然走 ℹ️
- **--stop 空停善后**：node/broker 停靠零进程命中时，把 state=online/running 的状态文件复位为 stopped（其余字段保留，写失败不阻塞停机）并打印复位行——幽灵窗口两头闭合
- 缺陷来源：2026-10-16 云端 1.6.3 drill 实钓（守护异常消失后状态文件无 pid 可核、`--stop` 不留痕）

### skill：PS 5.1 管道 BOM 防坑

- here-string 管道教学补一句：Windows PowerShell 5.1 可能给 stdin 前置 BOM（U+FEFF），字节精确场景先 `$OutputEncoding = New-Object System.Text.UTF8Encoding $false`；PowerShell 7 无此问题（drill 实测发现）


## [1.6.3] - 2026-10-16

### 024：v1.6.2 首轮现场反馈打磨

- **信封正向坐标 from-addr**：tcp 腿信封新增加性属性 `from-addr="tcp:<星>:<机器>:<工具>/<会话>"`（claude/名、codex/id8、human 降机器级），渲染于 from-machine 之后——收件方一眼知道对端在哪台机哪个形态，消除"以为对端在本机"的错位；from-machine 值字节不动（016① 分片绑定零回归）；ssh 腿保持 from-machine、单机不补（同机无错位）
- **reply-hint 内建管道教学**：信封回复提示尾加纯文字括注"（长正文/含敏感字符可省 --body 改管道喂 stdin）"——治转义坑的结构性根子（hint 原本只教 inline `--body`，照抄纪律把所有收件方赶进转义坑）；红线：括注禁带管道符命令（防伪造信封判定误伤），测试锚定
- **skill 教学扩容**：stdin 管道从备选升为"长正文/含敏感字符一律管道优先"（bash 单引号 heredoc + PowerShell here-string 两式范例+逐字到达样例）；PS 轻路径三层（单引号 inline→here-string→`ReadAllText`，注明 Get-Content 5.1 编码坑）；大小限额地图（`--max-body-kb`/env 提额旗标链、claude 64KiB/codex 1MiB 端点硬顶、tcp ≤64MiB 超限自动文件通道、ssh scp 旁路）；"查自己地址"=`status --stars` 成员行；CALLER_IDENTITY_CONFLICT 自纠 PowerShell 写法前置
- 决策锚点：`--body-file` 砍掉（转义与限额正交，管道全场景覆盖，低入侵不添私有旗标；重开条件=适配器无 shell 环境）；原生会话弹窗调研归档（`crossSessionInbound: accept` 可消弹窗但用户级弃人闸，免弹窗正路=启动器，见 drill-reports/native-claude-popup-20261016）

### 025：doctor 分组树展示

- 平铺编号清单改两级缩进分组树：`环境` / `tcp · <星名>`（逐星聚合，不可达星一眼可辨）/ `其他`——组名顶格、条目缩进两空格、无框线（grep 友好）、编号条目退役、空组不出行、"其他"殿后
- 陈旧状态文件按文件名星段归组（`status-node-<星>.json`→对应星；无线索归"其他"）；检查项集合/判定逻辑/诊断文案/退出码/结论行**零变化**（纯展示层 +105 行 ≤150 预算，结构测试钉死结论行与退出码语义）


## [1.6.2] - 2026-10-15

### 023：StarJoiner.stop() 重连窗口挂起竞态修复

- **修复启动器退出挂起**：`crosschat claude/codex --connect` 的子会话退出时，若 stop() 恰落在聚合器重连窗口（管道断开重试中），重连完成后监督循环在新健康管道的 `waitClose` 上永等——包装器进程不退出。现 stop 信号与该等待点 race，stop 即时唤醒收线（预存形状，018 批二引入、021 实施时发现）

### 020：三段寻址工具维度（会话段限定词 工具/名）

- **会话段可选工具限定词**：`--via tcp:<星>:<机器>:<工具>/<会话名>`（如 `tcp:cloud-broker:yang:claude/cloudworker10` 与 `…:codex/cloudworker10` 各达各的）——同机 claude/codex 同名（多适配器常态）消歧；裸名唯一时照旧可用（1.6.1 已发布地址零破坏）。分隔符选 `/`（`@` 已固定表示"谁@哪台机"）
- **解析收命中集（修静默首中 bug）**：broker `resolveSessionMember` 从"首个名命中即投"改为收集全部命中——1 命中投；>1 报 `NAME_COLLISION`（复用单机 `--to` 同码，教学文案区分场景）：跨工具列全部限定地址照抄即达；**同工具同名**（限定词救不了）与**老聚合器未声明 tool** 改列 `名(id8)` 行并教升级/短前缀
- **限定词判定防自伤与枚举耦合**：会话段全串先按裸名精确匹配（会话名本身可含 `/`，名为 `codex/notes` 的成员优先于限定词拆解）；未命中才拆 `工具/` 前缀，且**仅当命中该机已声明的 tool 值**才当限定词——broker 永不硬编码工具清单，新适配器声明即寻址
- **会话段 id8 短前缀寻址**：`tcp:<星>:<机器>:<id 前 8 位>`（与机器段 mid8 同一语法；全量 id 今日已可命中；多命中教加长）
- **声明面加 tool**：attach/sync/sessions/members 声明加可选 `tool` 字段（值规约：小写字母/数字 ≤16，禁冒号禁斜杠，大小写归一，`sanitizeTool` 一处定义）；启动器与 adopt 天然知道 side 直接填；恢复链验活回填同一来源（claude=进程扫描 / codex=rollout）
- **extends 血统按工具各归各**：`extendsByOldName` 收列表化——claude"boss"与 codex"boss"的接任互不冲突（同工具同旧名仍先声明先得 `EXTENDS_CONFLICT`）；死名多血统报碰撞列全部接任者地址；`SESSION_SUPERSEDED` 指路地址带工具限定词
- **启动期同名预警**：launcher spawn 前经 attach status 探针查成员表，`-n <名>` 与星内既有成员异工具同名时打一行"星内已有 codex/<名>，你的地址将是 claude/<名>"（预警行 spawn 前打=021 纪律；聚合器不在静默跳过不延迟 spawn，探针 ~2s 上限）
- **显示面带 tool**：`status --stars` 成员行 `机器:claude/名`、三段直达回执 `claude/名@机器`、SUPERSEDED 指路地址；roster/members 声明帧随 tool 字段透传（additive，旧读者忽略）
- **破坏性收紧**：同工具同名从今日"静默首中投递成功"（018 批一首中实现）变为显性碰撞报错——019 同款收紧立场，混版本窗口内行为严格变好（唯一名单路径不变）
- 文档：[broker.md 2.2/1.3.3/1.3.4/2.7](docs/broker.md)（限定词教学+验证阶梯剧本）、[联邦手册五](docs/federation.md)、SKILL.md、README 同步

### 019：两段式会话投递退役（ambient 退场，代码跟上 proto:3-only 文档）

- **破坏性变更**：`crosschat send --via tcp:<星>:<机器> --to <会话名>` 的两段式会话投递（投给机器上任意同名活会话的 ambient 语义）**已废弃**——发送侧解析一处收窄，改报 `SESSION_NOT_MEMBER` 同款教学（会话须经启动器入星 `crosschat claude/codex --connect <星>`，跨星改用三段寻址 `--via tcp:<星>:<机器>:<会话名>` 直达）；错误在连接 broker 前即抛出。**迁移**：把两段式 + `--to` 的用法换成三段寻址；机器级操作不受影响（见下）
- **机器级操作零回归**：`status --via tcp:<机器>` 远程枚举、`--file` 文件通道、`--conversation` 引用续话、roster/机器名解析、ssh 形态（`--via ssh:<别名> --to <名>`）全部照旧
- 测试面：两段式 + `--to` 用例改为断言报错教学；机器级传输/格式化/文件覆盖改走 `--conversation` 合法腿保全

### 021：启动器控制台输出纪律（横幅不串 TUI）

- **横幅 spawn 前同步打**：入星横幅原先由异步 attach 循环打印——sessionId 靠 spawn 后快照差分获得，确认到达时 claude/codex TUI 已接管控制台，裸 stdout 写落进输入区（1.6.1 实测误认作模型自敲初始化命令）。现改为子进程启动前打印，且文案不预支成功：`入星 <星>——会话地址 tcp:<星>:<机器>:<会话名>（attach 自动，异常见日志）`（-n 场景三要素 spawn 前全知）；名未知（claude 无 -n / codex 无 -n）只打星名行 `入星 <星>（attach 自动，异常见日志）`；多星循环逐星一行
- **spawn 后成功路径全静默**：attach 确认（原"已入星…直达"行）与断连重连提示不再打控制台，落 `~/.crosschat/tcp/launcher.log`（节点日志旁挂，时间戳+轮转）；extends 对话史出声同落日志。失败路径（attach 拒绝/聚合器超时/降级告警/extends 冲突）保留一次 stderr 不变——例外场景可见性优先于整洁

## [1.6.1] - 2026-10-15

### 文档重造（proto:3-only 口径，先行于 019 代码收窄）

- **两段式教学退场**：broker.md 重写为「跨机通信：tcp」——三层概念一句话（启动星/机器连星/会话入星）+ 新旧差异表 + 环境搭建按"broker 当选规则 / broker 节点 / node 节点"重组（每操作紧跟编号验证：命令 → 期望输出成对，含全链验证阶梯）；删两段式会话寻址（`--via tcp:<星>:<机器> --to <会话名>`）全部教学，保留机器级操作（`status --via tcp:<机器>` 枚举 / `--file` 文件通道）与协议参考帧表，末尾迁移注记；README 通信方式表/快速入门/会话入星章/命令列表同步 proto:3 口径（占位符 `<星> <机器> <会话>`）；SKILL.md 跨机段删两段式会话投递教学（from-machine 坐标改教三段）；federation.md 五章速查措辞对齐

### -n 原生透传修复

- 启动器只认死自家旗标——`-n` 等 claude/codex 原生参数原样透传（命名回归根治）；attach 名取自注册表快照而非旗标

## [1.6.0] - 2026-10-15

### 018：proto:3 会话级星成员（批二：命令面与链路；批一协议核心见下）

- **入星启动**：`crosschat claude -n <名> --connect <星>` / `crosschat codex --connect <星>`（codex 无 -n，`/rename` 后聚合器扫描自动跟随）——`--connect` 可重复（多星并存）；聚合器不在自动 `serve --connect <星> --detach` 拉起（013 双开护栏在位），attach 管道重试连接；启动器存活期间守连接（聚合器重启自动重声明，含 extends），会话退出即退星；任何入星失败只出一行 stderr 不连坐会话本身
- **三段寻址命令面**：`crosschat send --via tcp:<星>:<机器>:<会话> --body "…"` **免 --to**（会话段即收件人，此前批一只通帧层，CLI 被 TARGET_REQUIRED 挡住——本批接线）；非成员名 `SESSION_NOT_MEMBER` 教学、死名接任 `SESSION_SUPERSEDED` 指路、alive-wins 语义随批一
- **extends 四级校验接线**（失败方向不锁死）：旧名仍是星内活成员（roster 聚合的聚合器内存）→ 拒绝并指路；本机 send-log 有该名跨星对话史 → 放行并出声；都无 → 静默放行（无人查询的名字）；broker 侧同旧名先声明先得（`EXTENDS_CONFLICT` 回执不锁死）。**偏离说明**：会话分片 ref 带星标识但不带会话名——"分片有该名对话史"的实际落盘证据面是 send-log 的 to 显示名（尾窗），已在代码注释与手册注明
- **恢复链②（broker 补丁）**：broker 为每机器**断连后保留最后已知成员名单**（lastKnownMembers，纯内存零持久文件）；新增 `members-query`/`members-result` 帧——聚合器重启上线查回名单 → 逐个本地验活（claude 扫描/codex rollout）→ 活的自动重新入册（孤儿找回）、死名不复活；修复了一个自毁竞态：首上线的空 sessions 重播会把 broker 名单清零——空表现跳过首播（broker 侧未声明=无成员，路由语义等价）。双失忆（broker+聚合器都重启）恢复链空 → 走 adopt
- **`serve --adopt <会话名>`**（与 `--connect <星>` 连用，可选 `--extend-session`）：按名找本机活会话（复用 send 的 resolve——UNKNOWN 带候选、claude/codex 同名 NAME_COLLISION）→ 按其会话 ID 向聚合器 attach（**收编活进程不新建**）；已是成员幂等提示；已是成员+`--extend-session`=补接任声明（改名场景）；聚合器不在自动拉起
- **status 星会话视图**：`--stars` 每星下新增会话成员行（`机器:会话名 (extends←旧名)` 精简格式，仅明细视图——裸跑三段式摘要不炸行）；本机会话活着但非成员且该星守护在线 → 诊断行**当场打印完整 adopt 命令**（名字已填，复制即用）；本机 broker 星自动经 roster 原位升级为全量机器表（含 mid8/离线机/成员）
- **9b 降级告警显性化**：broker 无 session-members cap 时启动器/`serve --connect --detach` 父进程/前台聚合器在**命令行**（stdout/stderr）打一行"broker 不支持会话成员（proto:3），已降级机器级"——不只日志；新增瞬态 caps 探针 `fetchBrokerCaps`（修复 open/message 竞态丢首帧）
- **/rename 自动跟随（裁定 1 补全）**：聚合器活性循环（30s）顺带做名字跟随——claude 扫描名覆盖（无名扫描不抹 -n 名）、codex 名从线程表回填（9a"id 先行、名字从扫描回填"落地）
- **协议**：新增 `sessions`（批一）/`members-query`/`members-result` 帧、`roster-result.machines[].sessions` 字段、attach 管道 `status` 探针 op（回执 {ok,online,brokerCap,members}）——全部 additive，老节点/老 broker 零感知
- **resolve.ts 判定序入参放宽为结构最小类型**（pid 可缺省）——adopt 直接喂注入扫描结果；`send --to/--conversation` 校验对三段 via 形态豁免
- **过渡期承诺**：两段式机器寻址（`--via tcp:<机器>`/`tcp:<星>:<机器>` + `--to`）与 ambient 会话投递**保持可用**——非成员收紧仅作用于三段会话寻址；ambient 全弃用是未来单独的迁移决策，随版另告
- 文档随册：README 会话入星章（全命令形态/图解/adopt/降级）、[转发器手册 2.3/4.8](docs/broker.md)（教学级用法 + proto:3 帧表/caps/attach 管道）、[联邦手册五](docs/federation.md)（会话级操作速查）、SKILL.md 三段寻址与新错误码教学

## [1.5.12] - 2026-10-15

### 013：双开防护

- **`serve --connect <星>` 起守护前拒同星双开**：扫本机进程清单（与 `--stop` 同一扫描与自身排除），已有同星守护在跑即 exit 1——broker 同机双守护会互顶乒乓（在途消息随顶换丢失、status 文件互写抖动），此前唯一防线是记得先 stop
- 同星判定按解析后星身份：名字 / starId 前缀 / 裸默认腿换拼写绕不过；教学报错带活守护 pid 与其原始拼写（`serve --stop <该拼写>` 直接可达）；裸 `--connect` 腿的教学为 `serve --stop node`
- 护栏失败方向一律放行（探测不到=现状行为），不把用户锁死

## [1.5.11] - 2026-10-14

### 017：机器自报名单一事实源（showName 通吃 broker 机）

- **改名只剩一条规则**：任何机器的自报名 = 本机 `node.json` 顶层 `showName`（缺省 hostname 兜底），改完**重启常驻**生效——节点机重启节点客户端、broker 机重启 serve。serve 启动读回本机 node.json 刷新注册表 machineName（此前仅首次登记、node.json 永不被读回，broker 机改名只能手改注册表或另跑节点客户端，两套心智）
- **语义对称**：showName 显式缺失/空 → 清除注册表 machineName（roster 回退纯 mid8）；node.json 读不了/损坏 → 维持现值（不因解析失败误删）；无变化不写；读取不依赖自用条目归属（node.json 呈 foreign 形态照读顶层 showName）
- **本机 status 的"在线机器"含本机**（带"（本机）"标记）——broker 机改名后本机 status 即见新名，不再自排除误导"没生效"
- 重名寻址护栏加用例锁死：多台同名 `--via tcp:<名>` 维持"报错+列 mid8 教消歧"；机器改名后同 mid8 新信封经会话分片 machines merge 覆盖旧名（回执显示自愈）
- **升级迁移**：此前手改过 broker.json 注册表 `machineName` 的，017 起重启 serve 会被 showName 覆盖——**把名字写进本机 node.json 的 showName**

## [1.5.10] - 2026-10-13

### 016：跨机回执统一与现场反馈打磨

- **跨机回执机器标识统一 `name(mid8)`**（无名回退 mid8）：修复同一对端回执时而 `@yang`（名）时而 `@ec542c2c…`（裸指纹）的显示发散——到达侧把信封 from-machine 名持久化进会话分片（additive `machines` 字段，旧版读写双向兼容），显示层据此还原；**寻址面零改动**（信封 from-machine、`--via` 解析、`[via X]` 错误前缀照旧纯名/纯 mid8，不并记——并记会弄坏寻址）
- **status ssh 段行标与 --conversations 对端名同口径**：`名@别名(mid8)`
- **skill 补两句**：管道形式适用于一切 send（含照抄 reply-hint 的回复命令，长/含引号正文免转义）；纯告别/收尾语无需回执，读毕收线即协议完成

### 015：doctor 降噪四刀

- **版本对账新鲜度校验**：`lastUpdated` 超 90 秒（守护已停止）的 status 文件跳过对账，不再误报"升级后未重启"；存在被跳过文件时文末一行点名并告知可删除（ℹ️ 行动提示，不计入结论计数）
- **重启口诀按守护类型给对**：节点守护版本不一致改建议 `crosschat serve --connect <星名> --detach`（broker 的 `serve --stop && serve --detach` 不变）
- **codex 装了但 daemon 没跑：❌ 降 ⚠️**，附教学"要用 codex 通道时先 codex app-server daemon start"（未安装→⚠️ 现状不变）
- **"与仓库版本一致"文案正名"与安装源一致"**——比对基准实为 npm 包内 skills 副本而非仓库工作树

## [1.5.9] - 2026-10-13

### G0：status 三段式与长引用退场

- **裸跑 status = 三段式摘要**：本机会话（计数 + 滞留子句（仅有滞留时）+ 最近 5 会话混排带侧标）/ tcp（每星一行：可达·机器数·客户端态 + 机器封顶 5）/ ssh（对话计数 + 最近 5 段或"无"）；任何旗标在场 = 明细视图逐字节不变
- **新旗标 `--stars`**：tcp 星内明细分组（可达 + 守护态 + 全量机器表，含离线星）；--json 加 stars 分组新键、旧键全保
- **`--conversations` ref 列换柄列（cN）**；send 输出 reply-ref 行退役，delivered 行尾 `· 续话 cN`（--json 的 replyRef 完整保留）——**人眼可见处零 30+ 字符 base64**
- 传输分类器统一：存档 ref 解码为权威（ssh/tcp/单机），send-log 痕迹仅兜底
- F1 抑制语义修正：**显式选段永不沉默**（--codex 遇 daemon 挂从整屏空串改为显示 unavailable 横幅）
- 顺手修正：会话行侧标空格分隔；单次发送成本实测累计 -60%（输出侧 -28 token）

## [1.5.8] - 2026-10-13

### 014：状态目录统一与生命周期（全平台一个院子）

- **状态目录全平台统一 `~/.crosschat`**（与 tcp 组件同根，不再看 LOCALAPPDATA）——旧院（win `%LOCALAPPDATA%\crosschat`、unix `~/crosschat` 无点）废弃，仅 uninstall 清扫；**升级即换新家，旧数据不迁移**（升级前 `status` 确认发件箱无滞留）
- **限流蒸发**：删 rate/ 计数目录——限流改读 send-log 尾窗推算（与审计的双重记账消除）；drain 重投不再计入窗口
- **日志轮转**：send-log 与 broker/node 守护日志 >5MB 转 .old 留一份（原 sendLog 截断逻辑删除，历史整份保留）
- **clean 扩**：默认顺带回收 30 天静默会话分片（--force 全清）
- 每个生成文件从此都有死期或封顶：自动层（滞留信/限流/旧柄/轮转）、手动层（clean）、终局层（uninstall）

### F2：会话短柄（抄不错工程）

- **reply-hint 从 100+ 字符 mc2_ ref 换成 2 字符本地短柄** `--conversation c3`——LLM 手抄长 ref 单字符出错这一现场实证的最脆弱环节从根消灭；信封固定开销累计 **-79%**（420→~90 字符）
- 短柄注册表**寄生会话分片零新文件**：nonce 键同线程同柄、全机 max+1 分配、CAS 撞号顶替、每分片 8 柄 LRU、柄随轮次自新；过期/撞号报错教 `--to` 兜底
- `--conversation` 双形态：`c<N>` 与 `mc1_/mc2_` 永续兼容；hint 生成消费同机同版本（零版本偏差）
- skill：照抄两字符柄，"逐字比对"纪律对回信作废

## [1.5.7] - 2026-10-13

### 修复

- **skill 删"正常汇报完成"**（用户拍板删比加好）——过度汇报/逐轮总结/全程回顾表的授权源头移除；保留"不轮询 status"禁令。agent 每轮工具使用流水汇报应显著收敛
- **doctor：CLI 未安装从 ❌ 降为 ⚠️**（用户拍板"未安装是合法机器状态不是故障"）——codex/claude 未装各出一行"纯 X 互聊可忽略"提示（codex 的两行 ❌ 合并为一行），退出码不再被拉低；纯 claude 机（云端）体检从此不红


## [1.5.6] - 2026-10-12

### F1：信封坐标与体检（现场反馈批）

- **信封 from-machine 属性**（仅跨机）：对端从此可从任一来信拿到你的机器名——"请对方主动向你发起新消息"类题词零附加坐标；取值链走 roster 真名（deliverLocal 的 `'local'` 占位清除），无名瞬态发送方整体省略（宁缺勿错）
- **INVALID_CONVERSATION_REF 归因改序**：手误（抄写截断/改坏→与信封逐字比对重抄）前置，版本偏差后置——单字符手误不再被误导去升级
- **status 过滤抑制**：任一过滤在场时零行段整段沉默（段头/unavailable 横幅一并），本地与远程同规；--json 不动
- **doctor 版本对账（6.6）**：常驻 status 文件带 version，≠ 本机 CLI → ⚠️"升级后未重启：serve --stop && serve --detach"——今天"新 CLI+旧常驻"的 P1 幻影从此体检红线；缺字段跳过（旧守护过渡期安全）
- **skill 两行**：ref 抄完与信封逐字比对再执行；from-machine 即对方的发起坐标
- 排障表加"升级后跨机行为怪异→重启常驻"行


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
