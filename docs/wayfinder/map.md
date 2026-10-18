# Wayfinder Map：跨平台 agent 会话通信工具（Windows 起步）

label: wayfinder:map

## Destination

一期实现方案完全确定、可以直接开工：Claude↔Codex 在 Windows 单机上互聊（人启动的交互式会话），两条原生通道（Claude named pipe / Codex App Server）实测验证有结论，broker 一期架构与长对话上下文策略拍板；所有架构决策为完整集（账本/回执/状态机/联邦/三平台）留好接缝。本地图只做决策与验证，不执行实施。

## Notes

- 2026-10-02 项目更名 multichat → crosschat（双命令过渡，历史文档保留旧名）
- 领域：本地 agent 间通信（Claude Code / Codex CLI）。借鉴 embassy 设计，不 fork（Q8c）。
- 背景资料：
  - `docs/research/embassy-architecture.md` —— embassy v4.7.0 源码研究报告（机制 + Windows 依赖清单，含 file:line 引用）
  - `docs/embassy-main/` —— embassy 完整源码本地副本，借鉴代码以此为准（MIT）
  - https://zhuanlan.zhihu.com/p/2073740790577246851 —— 第三方架构分析
  - 已证实事实：Windows 版 Claude Code 存在 `~/.claude/sessions/<pid>.json` 注册表（含 `messagingSocketPath: \\.\pipe\LOCAL\cc-msg-*`、`peerProtocol:1`、`peerFeatures:["notify_idle","artifact_yield"]`）
- 站定性约束（制图 grilling 已锁定，2026-10-01）：
  - Q1 分期：一期最小，完整集必须保证可达
  - Q2 排除 WSL 方案
  - Q3 单机先行；跨机联邦是长期硬需求
  - Q4 全方向矩阵：Claude↔Codex、Claude↔Claude、Codex↔Codex
  - Q5 原生唤醒优先；降级必须附"为何原生不可行"的论证
  - Q6 人手动启动交互式会话并题词；不用 headless 每轮拉起
  - Q7b 一期仅 Windows 可运行；平台抽象层从第一天开始
  - Q8c 自研骨架、逐模块借鉴 embassy
  - Q9 不承诺与 embassy 联邦协议互通，留雾区评估
  - 最终支持 win/mac/linux，异构互聊
- 站定性产品约束（2026-10-01 用户反馈）：**使用形式必须低入侵** —— 不得依赖题词被逐字执行；协议教学与收发机制尽量内建（skill / 信封自带），题词只承担角色设定。
- 站定性架构约束（2026-10-06 提炼，007/009 全程教训）：**crosschat 只拥有"会话间寻址与投递"，一切生命周期归原生**——创建=`codex` TUI / `codex exec`、命名=双侧 `/rename`、销毁/轮换=codex 原生；crosschat 可观测原生状态（如 thread-writer-locks）但不得复制或代理生命周期（自有状态无生死钩子，必悬空膨胀——mailbox init/name set/codex new/--spawn 四案同因否决）。
- 站定性产品约束（2026-10-06 用户反馈，同日二次修订）：**既有功能零回归 + 跨机场景轻量部署** —— 任何新功能纯增量，改默认行为必须先经用户确认（铁律在案）。**v1 准入门槛不变**：无 broker、无新监听端口、无新守护进程、无必填配置文件、不发明新鉴权（信任边界=ssh 同用户），部署以"两端 npm i -g + ssh 免密"为上限（免密=机器通道密钥，每台 ssh-keygen 一次 + 对每个对端 ssh-copy-id 输一次现有密码，密码登录共存，不做 sshpass 类塞入）。**终点传输面（2026-10-06 拍板、2026-10-10/11 用户两度修订）：传输前缀 = ssh / tcp 两种，broker 不是第三传输而是 tcp 的部署拓扑**——tcp = 纯转发器组件（用户 2026-10-10 拍板）：全网唯一监听端口、其余机器零入站，三角色 `crosschat serve`（服务端）/ `serve --connect`（常驻客户端）/ `send --via tcp:`（瞬态发送），星型密钥 + gen-key 打印式分发，proto:1 草案协议（MQTT/NATS/STOMP/JSON-RPC 取材，协议规范公开、第三方可实现兼容 broker），文件通道（sha256 锚/断点续传/去重/懒删除 5 天+512MiB/单文件 64MiB），mid8 双轨寻址（协议用 machine-id 前缀、人用名字）；**已实施（票B B1–B3.1，2026-10-11）**，drill a（win+WSL 双机全链含跨机 agent 自主对话闭环）真机通过，形态二（云端堡垒+ssh 隧道包裹）drill 待用户确认后补；tcp 属可选分层组件，核心 CLI 的无守护形态不变。目标矩阵：linux/win/mac 三类两两互通（含自身），win 收件腿需 OpenSSH Server、mac 需开远程登录、win 侧 npm 全局 bin 须在 sshd 默认 shell PATH——**mac 实机验证因此从"如有再补"升级为联邦 M 腿依赖**。
- 技能：按票型调用 research / grilling(+domain-modeling) / prototype。
- Tracker 约定（本地 markdown）：claim = 把票的 `claimed-by` 改成自己；blocking 用 `blocked-by` 字段；解决 = 在票文件末尾追加 `## Resolution` 一节并把 `status` 改为 `closed`，然后在下方 Decisions so far 加一行。
- 另图：`docs/wayfinder/book/`——「crosschat 在线书（mdBook/GitHub Pages）」努力 2026-10-15 立图（含管道落地/真零基础/书为真源/活文档四拍板），独立编号，与本图票流互不相扰。

## Decisions so far

- [Codex 在 Windows 的原生通道可行性](tickets/001-codex-windows-feasibility.md): 原生可行——本机活体验证 `codex app-server proxy` + WebSocket over stdio + `initialize`/`thread/list` JSON-RPC 全链路成功，schema 含 `thread/resume`/`turn/start`/`turn/steer`，无需降级轮询（缺口仅为移植项：三元组/目录名、socket 见证模型、进程收割、env 变量双读）。
- [Claude Windows named pipe 实测验证](tickets/002-claude-windows-pipe-verification.md): 原生可行但需适配——用户帧逐字节兼容并在自建会话上端到端注入成功（回复 OK）；Windows 强制先写 auth 行（peerToken 来自 `<pid>.<sha256(管道路径)>.key`）、管道名随机须读注册表、接收会话需 `crossSessionInbound:"accept"` 否则消息被 parity hold、会话生命周期须网关自管。
- [一期 broker 架构设计](tickets/003-broker-phase1-design.md): **无需 broker**——一期 = 无状态 CLI 四命令（`send`/`status`/`install-skills`/`claude` 包装）；skill+信封双教学、双侧自动发现零注册、同步 send 不重试、自包含会话引用、防乒乓文件限流、Node22+TS；考虑并否决 Claude 原生 ListAgents 伪 peer 广告（embassy v4.0.0 主动移除同款）；broker 回归条件 = 忙时持久队列/异步回执/跨机不占线。
- [长对话的上下文策略](tickets/004-context-strategy.md): 一期 = 预算+计数提示——单条 16KiB 上限、ref 内嵌轮次计数、信封显示第 N 轮、接近预算 skill 自动收尾；一切超限同步显式报错（MESSAGE_TOO_LARGE / RATE_LIMITED）交 agent 自纠，长内容落盘发路径引用（同机文件系统=天然泄压阀）；摘要轮换/外部档案留二期。
- **一期全部设计票关闭，frontier 清空——目的地达成，进入实施（B0✅ B1…B5）**

- [B5 联调决策（非票，实施期实测定型）](../drill-reports/b5-drill-report.md): codex 接收一期语义 = headless 信箱模型——投递目标为未被 TUI 占用的线程，"开着=只读（对 multichat），关着=可投"，原生 turn 零轮询（3 轮全链路实测通过）；claude↔claude、codex→claude、daemon headless 回信均实测通过。二轮加固：同线程开窗即拒/关窗即通 3 拒 3 通零误报；`--no-daemon` 假设证伪（daemon 模式 TUI 开窗仍锁）；新已知问题 CALLER_IDENTITY_CONFLICT（daemon 从带 CLAUDE_CODE_* 环境的终端启动致派生 shell 身份污染，B5.3 加自纠指引）。
- [codex 开窗注入调研票（2026-10-02，结论两度修正）](../research/codex-open-window-injection.md): 研究票发现 `codex queue`（底层 `thread/queue/add`）并 E2E"验证"开窗秒达 → B6 接入 → **实地联调证伪**：本地普通 TUI 下 queue 是黑洞（exit 0 但消息既不进开窗现场也不进历史，2 条静默丢失；疑似 remote 架构专用，`--remote` 参数佐证；研究代理的成功 E2E 推测用了自建 remote 形态）。B7 修复 = 删 queue 路径，active-writer 改为等待释放循环（开窗时 multichat 侧轮询等待、关窗即 headless 送达、默认 120s 超时报错指引）。**教训已记**：子代理研究报告的 E2E 结论必须标注其环境形态（本地/remote），集成批次不得以此替代己方 live 验证。
- [B8 开窗投递终局（2026-10-02，daemon 升 0.160 后）](../research/codex-0160-inject-items.md): **开窗投递 ✅ 落地，零代码改动**——根因链闭合：`codex app-server proxy` 是 daemon 桥接（同进程多连接），0.160 TUI 自动附着 daemon，写者锁仅跨进程形态出现（旧 daemon ≤0.157 / `--no-daemon`）。实测：TUI 附着开窗 6s delivered、模型答 OPEN-OK 并经 reply-ref 回投；关窗无回归；`codex queue` 在 0.160+附着下复活为可见投递通道（12s 消费）。等待循环保留为旧环境兜底。daemon 升级实录：update 的 error 5（疑似安全软件拦句柄）→ 干净 home 官方安装器置备 0.160 成品移植 + junction 重建；旧 0.157.1 保留于 app-server-daemon.bak-0157 可回滚。
- [跨平台（Linux/WSL）可行性研究](tickets/005-cross-platform-linux-wsl-feasibility.md): **可行（a）**——unix 消息插座原生存在且更简单：WSL 实测 socket `/run/user/<uid>/cc-socks/<pid>.sock`、无 auth 行（内核同 uid 凭证）、帧与 Windows 逐字节同格式，注册表/key 文件/env 语义跨平台一致（embassy 源码 + 2.1.288 bundle + WSL 实装三层证据）；差异仅"unix 不发 auth 行/不读 key 文件"与"socket 目录以注册表为准不硬编码"。分批 B1 平台层 → B2 claude unix 投递联调 → B3 codex/CI ubuntu/文档/发版 1.3.0-experimental；零回归铁律 + subagent 编排模式执行。详见 `../research/claude-unix-socket.md`。
- [codex 线程 TUI 占用可观测性](tickets/006-codex-tui-occupancy-observable.md): **结论 a——信号源零成本**：`CODEX_HOME/thread-writer-locks/<threadId>.lock` 零字节锁文件，TUI 附着即建、释放即删，readdir 枚举即得持有清单（win/unix 同码、零 RPC 零副作用）。**精化 B8**：0.160 附着后消失的是跨进程冲突，锁文件照常落盘。thread/list 反证：active 只反映轮次、TUI 空标签页线程不在列表——不能当占用信号；进程 argv 弃用。实施草案 ~40 行单批次（status 行尾标记 + JSON `held` 字段），不动投递路径。详见 `../research/codex-tui-occupancy-signals.md`。

## Not yet specified

- **tcp TLS（公网加密）**——[010](tickets/010-tcp-tls-transport.md)（2026-10-11 挂票，用户需求 ③）：明文公网两层风险（内容可看 + **钥匙可截走可伪造**——"PSK 挡伪造"仅在无窃听时成立）；方案倾向自签+钉指纹 TOFU（零域名零 CA），M 票，随 v1.6.0
- **多星成员档案化（proto:2）**——[011](tickets/011-multi-star-profiles.md)（2026-10-11 挂票；**2026-10-12 关票——双星真机 drill 闭环**，见 ../drill-reports/multi-star-drill-20261012.md）：终版为无状态路由（推翻早期档案目录+会话缓存案，六轮俯瞰否决记录在票）——node.json 双形状数组 + mc2_ 尾部 starId + 发送四序本地选星，零缓存零探测；同时解掉"一台机既当 broker 又当外连 node"的 node.json 冲突
- **远程会话枚举 status --via tcp:<机器>**——[012](tickets/012-remote-session-enumeration.md)（2026-10-12 挂票，形态二 drill 双 agent 现场点名）：additive 双帧（status-query/result 经 broker 中转目标守护）+ CLI/过滤组合 + skill 教学替代 ssh 查远机；**已实施关票（2026-10-12 真机闭环）**
- **ambient 会话投递退役**——[019](tickets/019-ambient-session-delivery-retirement.md)（2026-10-15 立票，用户拍板不留兼容窗口：两段寻址删会话投递改报错教学、机器级操作保留；文档已先行 proto:3-only，本票让代码跟上；**同日实施关票**——runViaTcpSend 唯一收窄点、21 处用例改合法腿+2 新用例，check 全绿，真机腿随 1.6.2 drill 补；随 1.6.2）
- **多星 WS 连接复用**——[022](tickets/022-multi-star-ws-reuse.md)（2026-10-15 立票，**优先级 A 需排期**、1.6.2 后开工；用户场景收口=同 broker 进程/端口托管多星（vhost/SNI 模型：钥匙自证星籍）；跨端点复用物理不可行已留痕；握手时序倒置+注册表多星化+一 WS 绑多星（HTTP/2 流复用式）走 caps 协商；broker 自挂 in-process 是否并票待定；连接层本就 epoll-reactor，零 worker 池）
- **StarJoiner.stop() 重连窗口挂起竞态**——[023](tickets/023-star-joiner-stop-race.md)（021 票外发现，预存形状；**同日实施关票**——stoppedSignal 与唯一无界等待点 waitClose race，~25 行+5s 限时回归测试，check 717 全绿；随 1.6.2）
- **v1.6.2 首轮现场反馈打磨**——[024](tickets/024-field-feedback-1-6-2.md)（2026-10-15 立票，归档 ../drill-reports/field-feedback-20261015.md；**同日二次拍板**：--body-file 砍掉改转义教学扩容——管道优先+heredoc/here-string 两式范例+大小限额地图进 skill（转义与限额正交，--body-file 解决不了超限，砍无损失，挂账条件=适配器无 shell 环境）；其余：信封正向三段坐标（与 020 对齐，先查证 from-machine 现状）/skill 查址教学/身份冲突自纠 PowerShell 前置；防伪造签名挂账评估；**同日三次拍板（全局俯瞰四点并入）**：reply-hint 内建管道括注（envelope.ts:72-73 根子，红线=括注禁带管道命令防伪造误判）/多星坐标措辞"任一可达星皆可为坐标"（022 联动）/信封格式与防伪票一次对齐/PS 单引号轻路径分层；**2026-10-16 实施完成 bbc24df，check 721 绿；**2026-10-16 验收关票**——第二轮现场反馈（../drill-reports/field-feedback-20261016.md）逐字两式双向/from-addr/括注全过，随 1.6.3 发版**）
- **doctor 分组树展示**——[025](tickets/025-doctor-grouped-tree.md)（2026-10-15 立票，015 续篇：平铺清单改两级缩进分组——环境/tcp 按星/其他，编号条目退役；纯展示层，检查逻辑/退出码/结论行不变；S 票 ≤150 行；**2026-10-16 实施完成 80d0f4d，check 721 绿；验收关票——win 多星/WSL/云端三形态全过，随 1.6.3 发版**）
- **原生会话弹窗调研归档**——[native-claude-popup-20261016](../drill-reports/native-claude-popup-20261016.md)（crossSessionInbound: accept 可消弹窗但用户级弃人闸；免弹窗正路=启动器（按会话、零安全代价）；2026-10-16 用户拍板归档不教学，重开条件=高频需求或平台出按会话粒度信任配置）
- **幽灵常驻进程：doctor 验活失真 + --stop 空停不善后**——[026](tickets/026-ghost-daemon-status.md)（2026-10-16 云端 1.6.3 drill 实钓：守护死亡后 90s 心跳窗内状态文件被当活进程报"升级后未重启"，无 pid 可核；--stop 零命中不清 online 文件。修法=对账加 isProcessAlive 验活/无 pid 降 ℹ️ + 写者补记 pid + 空停复位 state。S ≤150 行，修复落 main 不单独发版；**2026-10-16 实施完成（check 全绿 71 用例四路径），随下版车，真机自然验证=下版升级后 doctor 不再幽灵告警**）
- **reply-hint 管道括注分层教学**——[031](tickets/031-tiered-pipe-teaching.md)（2026-10-18 用户四案拍板"分层"：turn 1 全文括注保首触教学，turn 2+ 短式"走 stdin"省半税且压缩免疫；纯函数 of 轮次零状态。**同日实施关账**——envelope 三元+分层断言+SKILL 示例同步；README/broker/federation 示例 turn 1 天然仍对；随下版车）
- **对端死亡恢复链：报错给可照抄地址**——[027](tickets/027-peer-death-recovery.md)（2026-10-16 drill 复盘七步试错产物。四项=A+ 两处 TARGET_NOT_FOUND 拼可照抄三段地址/SUPERSEDED 预告/B help 并列 tcp 三段与 ssh 两段/F 报错回显带星段/G 引用续线语义钉死/I --resume 透传查验/D 022 注记；E/H/C 已移交 028。S ≤100 行，随下版车。**2026-10-18 实施关账**——A+/B/F 落地（tcp 腿地址用 id8：ref 端点不带名，零协议改动）；G 勘误关账（claude 侧旧 ref 续不到重启同名新进程——状态线按端点对分键，正解即 A+ 两跳）；I 验证透传可用+skill 补一句；check 743 绿+4 用例）
- **成员资格 v2：双模式星成员制**——[028](tickets/028-membership-v2.md)（2026-10-16 三轮 grilling 定案：`--connect` 语义升级为永久注册（**破坏式 1.7.0**，"没人用"窗口免费）+ `--rm` 临时；退出=下线、同 id resume=自动复活（claude 实证/codex 协议断言）；extends 唯一名字转移口；幂等增删；broker 每星 roster 落盘+恢复链常态化为对账循环；五边界规则；**skill 分层重构**（瘦主文件+references/ 子文件，回复路径零跳转，doctor 递归比对）；有意推翻 018"零新文件/除名不复活"两点。M~L，建议先于 022；吸收 027-E/H/C。**2026-10-17 关票——真机 drill 八项全过**（win↔WSL 双机双星，v1.7.0 已发，见 ../drill-reports/drill-028-20261017.md；现场发现 F1~F8 全非阻塞记档，--rm 异常死亡删册/WSL stop 假成功两条候选小票——**同日立票同日修复关票见下两条**）
- **--rm 异常死亡删册（028 drill F1）**——[029](tickets/029-rm-crash-cleanup.md)（2026-10-17 立票）：`temporary` 位随声明端到端（启动器 attach→聚合器成员表→broker 册落盘→切片回带），对账循环验得死临时成员即报 member-remove+墓碑（含聚合器重启后声明表为空的切片清册形态）；**同日实施关票**——check 739 绿（+3 用例），WSL 真机复演 kill 后一轮清册零痕迹+NOT_MEMBER
- **WSL serve --stop 假成功（028 drill F8）**——[030](tickets/030-wsl-stop-false-success.md)（2026-10-17 立票）：killPid 从"信号已发"改"确认死亡"（SIGTERM→限时探活→SIGKILL 兜底；ESRCH=已死即成功）；**同日实施关票**——真子进程吞信号用例+WSL 真机 stop 后 ps 验尸确死
- **proto:3 会话级星成员**——[018](tickets/018-proto3-session-membership.md)（2026-10-14 立票，多轮 grilling 定案：成员=会话 ID、继承唯一通道 --extend-session 显式声明、非成员投递报错（宽松否决留痕）、聚合器复用现有守护一星一连接、broker↔节点记忆互备零新文件、排期先于 010——用户裁定，TLS 敞口多开数日备案；**2026-10-15 两批实施完成随 1.6.0 发布**，win+WSL 真机验 7 项/集成覆盖 5 项，夹具 codexHome 机器依赖根除三过 CI；**2026-10-15 验收关票**——1.6.1 云+本机实测三段直达双向闭环零报错，同机跨工具同名静默首中盲区移交 020）
- **三段寻址工具维度**——[020](tickets/020-session-address-tool-qualifier.md)（2026-10-15 立票，1.6.1 验证发现：会话段无工具限定，同机 claude/codex 同名静默首中；用户拍板方案 A——会话段可选 `工具/名字` 限定词，撞名报碰撞列限定地址，裸名唯一零破坏；防枚举耦合=前缀只对该机已声明 tool 生效，新适配器零协议改动；俯瞰补强：extends 索引同治、全串精确匹配优先、启动期同名预警、同工具同名 id8 逃生口；**同日实施关票**——resolveSessionMember 收命中集/extendsByOldName 分血统/id8 寻址/启动预警全落地，7 新用例，check 716 全绿，混版本窗口与真机腿随 1.6.2 drill 补；随 1.6.2）
- **启动器控制台输出纪律**——[021](tickets/021-launcher-console-discipline.md)（2026-10-15 立票，1.6.1 验证发现：入星横幅由异步 attach 循环打印，晚于 claude TUI 接管控制台落进输入区；**同日实施关票**——横幅 spawn 前打不预支成功+spawn 后成功路径全静默落 launcher.log+失败保留一次 stderr，check 707 全绿，真机 TUI 零残留随 1.6.2 drill 补；票外发现 stop() 重连窗口挂起竞态待小票）
- **双开防护（--connect 同星互顶拒绝）**——[013](tickets/013-dual-daemon-guard.md)（2026-10-13 补立案；**2026-10-14 关票**：起守护前扫进程拒同星（星身份归一防换拼写、教学用活守护 pid+原拼写、失败方向放行），check 672 + 真机同/异拼写拒绝实测；实施已随 1.5.11 后 [Unreleased] 待发 1.5.12）
- **doctor 降噪三刀**——[015](tickets/015-doctor-noise-reduction.md)（2026-10-13 立票；**同日实施关票** f1bc54d，俯瞰补第④刀"安装源"正名：版本对账新鲜度校验 + 建议命令按守护类型 + codex 装了没跑降 ❌→⚠️；随 1.5.10 发布）
- **现场反馈打磨**——[016](tickets/016-field-feedback-polish.md)（2026-10-13 立票，同日①②③实施 203350a 随 1.5.10 发布；**2026-10-14 验收关票**：①回执 name(mid8) 三证、②管道教学双变体、③告别收线实战+防注入姿态首验；④零总结复发 3/3——文案治好内容错（无人伪称等待）、治不了汇报形式，用户拍板接受残余）；归档 ../drill-reports/upgrade-drill-20261013.md
- **机器自报名单一事实源**——[017](tickets/017-showname-single-source.md)（2026-10-13 立票，用户设计裁定；**2026-10-14 关票**：实施 2e7df0b 随 1.5.11 发布，WSL（wsl）+ 云端（cloud）双端真机验收——"改 showName+重启常驻"唯一改名口径，broker 机本机 status 含自身，重名寻址锁死）
- 联邦协议与异构互聊设计（win↔linux 跨机）——**v1 设计已关闭（[008](tickets/008-federation-v1-ssh-design.md)，2026-10-06，六问全 A 拍板）**：ssh+远端 CLI、`--via` 传输通用命名空间、`--origin` 身份牌 + ref `m` 字段 + mc2_ 紧凑格式（79 字符，mc1_ 兼容）、三层错误码、发起侧审计补记账。**实施已完成并发布（2026-10-07）**：原计划 B1→B3，实际以 B6–B11 落地（--via ssh 寻址/回执透传/三层错误码/回复闭环/mc2 紧凑 ref/machine-id 双身份/B11 乒乓修复），v1.3.3 上 npm，win↔WSL 真机闭环验证（drill 报告 `../drill-reports/federation-wsl-connectivity-20261007.md`，B11/B2.1 现场修复另见 `../drill-reports/field-feedback-20261007.md`）。详见 `../research/federation-v1-design-notes.md`；与 embassy 生态的互通性评估（Q9）仍留雾区后续票
- 完整集的范围与节奏：持久账本、回执、投递状态机、TUI、服务安装 + 看门狗（launchd `KeepAlive{Crashed}` 语义等价物）、Windows 安全见证模型（named pipe ACL 哲学）；联邦 v1 可先 ssh+远端 CLI——**broker（tcp 转发器）已实施（票B，2026-10-11）：独立进程组件、堡垒机模式（全节点出站连接、免开入站端口、星型密钥拓扑）、与 tcp 合并为单一组件（用户 2026-10-10 拍板，修订"三形态中最后实现"的排序）**
- 新 agent 适配器队列——GLM、opencode、zcode、deepseek-harness（2026-10-14 用户点名后三个入队）：每个新家族 = 身份注册表加一行 + 其启动器对（1.5.x 上限可配置化已定此接口）；投递形态按 codex 同款评估流程——先查原生唤醒通道，有则原生、无则论证降级；激活时各开 001 同款可行性票
- 二期长对话机制（004 遗留）——**2026-10-14 用户裁定关账，机制否决**：换轨续传 = **新会话直接 crosschat 询问旧会话**（现有能力，当日二期5→二期6 交接实证可行，且比静态档案多"可追问"能力）；"自动档案+摘要服务+读档接续"整体否决——crosschat 会因此多拥有一块内容/生命周期状态（007 信箱票同因），且 send-log 双侧落盘已兜原始记录、项目级知识由 wayfinder map/tickets 承担。残余场景"旧会话已死且无总结"经用户定性为**用户自毁系统文件的自责范围**（轮次预算纪律保证正常换轨时旧会话活着），系统不担。skill 零新增教学（流程自明）。E 票不再开。
- 二期上限可配置化：**已实施（票A，2026-10-09）**——默认仍 16KiB（零回归），三层来源 `--max-body-kb` > `CROSSCHAT_MAX_BODY_KIB` > 16384，按目标端点封顶（claude 64KiB / codex 1MiB / `--via` 本地预检 1MiB 远端自检、16MiB 绝对上界）；轮次预算 `--max-turn` / `CROSSCHAT_MAX_TURN`（crosschat 感知不到两端模型，数字由操作者定）信封 `turn="N/M"` 软提醒不硬拦；`crosschat claude`/`crosschat codex` 增强启动器对（旋钮透传 env 注入 + 身份清洗家族注册表防 CALLER_IDENTITY_CONFLICT；opencode 等新家族=注册表加一行+其启动器，其余零改动）；平面分家定案：会话面配置→启动器对，传输面配置（tcp 端口/密钥、broker 编址）→传输组件自己的面（B/D 票设计空间）；信封教学行保持静态 16KiB（准确数字只住各侧报错）、远端来件拒绝教 scp 优先。GLM 自家 agent CLI 仍属未来新适配器票（有无原生唤醒通道决定原生 or 降级，同 codex 评估流程）
- Mac 实机验证（无环境；unix 实现共享 + embassy 实证外推，跨平台批次 B3 后如有实机再补；CI mac 观察位 2026-10-07 起两连绿——b235b44/9f68de1 build+单测面全绿，唯 2442a82 三平台共红系 lint 已修——build/单测面风险清零，接收腿（远程登录/sshd）实机 drill 仍待环境）
- agent 侧 skill 文案（embassy-peer 等价物）——形式已定（003：skill+信封双保险），具体文案实施时写
- 工具命名
- codex TUI 占用标注：**已关闭并实施（[006](tickets/006-codex-tui-occupancy-observable.md)，`7fbdcdf` feat(B5)——status 行尾 TUI占用 标记 + JSON held 字段 + 未列入锁行，已随 1.3.3 发布）**
- 专用信箱线程机制化：**已关票不做（[007](tickets/007-dedicated-mailbox-thread.md) wontfix，2026-10-06）**——命名由双侧原生 `/rename` 承接，无名用 id8 寻址（B4）；注册表否决（场景空心 + 无生死钩子必膨胀）。headless 建线程场景同日核实：id 即 `thread/start` 返回值 + 需一轮 bootstrap turn 硬化（[009](tickets/009-codex-new-command.md) 已 defer，无当前调用方），**008 联邦实施时若需接收端预置再并入该批次**

## Out of scope

- WSL 方案（Q2 已排除：WSL 内的 broker 唤醒不了 Windows 侧会话）
- 本地图内的实施执行（wayfinder 默认只规划；实施在地图走完后另开会话）
