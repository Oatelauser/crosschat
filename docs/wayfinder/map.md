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
- 站定性产品约束（2026-10-06 用户反馈，同日二次修订）：**既有功能零回归 + 跨机场景轻量部署** —— 任何新功能纯增量，改默认行为必须先经用户确认（铁律在案）。**v1 准入门槛不变**：无 broker、无新监听端口、无新守护进程、无必填配置文件、不发明新鉴权（信任边界=ssh 同用户），部署以"两端 npm i -g + ssh 免密"为上限（免密=机器通道密钥，每台 ssh-keygen 一次 + 对每个对端 ssh-copy-id 输一次现有密码，密码登录共存，不做 sshpass 类塞入）。**终点传输面（用户 2026-10-06 拍板）：ssh → tcp → broker 三形态**——tcp 为局域网直连（可选监听 + 极简预共享鉴权）、broker 为独立组件、堡垒机形态（全节点出站连接、worker 免开入站端口、密钥拓扑星型）、最后实现；tcp/broker 属可选分层组件，核心 CLI 的无守护形态不变。目标矩阵：linux/win/mac 三类两两互通（含自身），win 收件腿需 OpenSSH Server、mac 需开远程登录、win 侧 npm 全局 bin 须在 sshd 默认 shell PATH——**mac 实机验证因此从"如有再补"升级为联邦 M 腿依赖**。
- 技能：按票型调用 research / grilling(+domain-modeling) / prototype。
- Tracker 约定（本地 markdown）：claim = 把票的 `claimed-by` 改成自己；blocking 用 `blocked-by` 字段；解决 = 在票文件末尾追加 `## Resolution` 一节并把 `status` 改为 `closed`，然后在下方 Decisions so far 加一行。

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

- 联邦协议与异构互聊设计（win↔linux 跨机）——**v1 设计已关闭（[008](tickets/008-federation-v1-ssh-design.md)，2026-10-06，六问全 A 拍板）**：ssh+远端 CLI、`--via` 传输通用命名空间、`--origin` 身份牌 + ref `m` 字段 + mc2_ 紧凑格式（79 字符，mc1_ 兼容）、三层错误码、发起侧审计补记账。**实施已完成并发布（2026-10-07）**：原计划 B1→B3，实际以 B6–B11 落地（--via ssh 寻址/回执透传/三层错误码/回复闭环/mc2 紧凑 ref/machine-id 双身份/B11 乒乓修复），v1.3.3 上 npm，win↔WSL 真机闭环验证（drill 报告 `../drill-reports/federation-wsl-connectivity-20261007.md`，B11/B2.1 现场修复另见 `../drill-reports/field-feedback-20261007.md`）。详见 `../research/federation-v1-design-notes.md`；与 embassy 生态的互通性评估（Q9）仍留雾区后续票
- 完整集的范围与节奏：持久账本、回执、投递状态机、TUI、服务安装 + 看门狗（launchd `KeepAlive{Crashed}` 语义等价物）、Windows 安全见证模型（named pipe ACL 哲学）；broker 回归条件已定（003），联邦 v1 可先 ssh+远端 CLI——**broker 形态用户已拍板（2026-10-06）：独立组件、堡垒机模式（全节点出站连接、免开入站端口、星型密钥拓扑）、三形态（ssh/tcp/broker）中最后实现**
- 二期长对话机制（004 遗留）：换轨续传模式 = 自动档案（broker 回归后邮差全程落盘）+ 摘要服务 + 新会话读档接续；不做"原地压缩"（transcript 归 provider 所有，外部工具做不到）
- 二期上限可配置化：**已实施（票A，2026-10-09）**——默认仍 16KiB（零回归），三层来源 `--max-body-kb` > `CROSSCHAT_MAX_BODY_KIB` > 16384，按目标端点封顶（claude 64KiB / codex 1MiB / `--via` 本地预检 1MiB 远端自检、16MiB 绝对上界）；轮次预算 `--max-turn` / `CROSSCHAT_MAX_TURN`（crosschat 感知不到两端模型，数字由操作者定）信封 `turn="N/M"` 软提醒不硬拦；`crosschat claude`/`crosschat codex` 增强启动器对（旋钮透传 env 注入 + 身份清洗家族注册表防 CALLER_IDENTITY_CONFLICT；opencode 等新家族=注册表加一行+其启动器，其余零改动）；平面分家定案：会话面配置→启动器对，传输面配置（tcp 端口/密钥、broker 编址）→传输组件自己的面（B/D 票设计空间）；信封教学行保持静态 16KiB（准确数字只住各侧报错）、远端来件拒绝教 scp 优先。GLM 自家 agent CLI 仍属未来新适配器票（有无原生唤醒通道决定原生 or 降级，同 codex 评估流程）
- Mac 实机验证（无环境；unix 实现共享 + embassy 实证外推，跨平台批次 B3 后如有实机再补；CI mac 观察位 2026-10-07 起两连绿——b235b44/9f68de1 build+单测面全绿，唯 2442a82 三平台共红系 lint 已修——build/单测面风险清零，接收腿（远程登录/sshd）实机 drill 仍待环境）
- agent 侧 skill 文案（embassy-peer 等价物）——形式已定（003：skill+信封双保险），具体文案实施时写
- 工具命名
- codex TUI 占用标注：**已关闭并实施（[006](tickets/006-codex-tui-occupancy-observable.md)，`7fbdcdf` feat(B5)——status 行尾 TUI占用 标记 + JSON held 字段 + 未列入锁行，已随 1.3.3 发布）**
- 专用信箱线程机制化：**已关票不做（[007](tickets/007-dedicated-mailbox-thread.md) wontfix，2026-10-06）**——命名由双侧原生 `/rename` 承接，无名用 id8 寻址（B4）；注册表否决（场景空心 + 无生死钩子必膨胀）。headless 建线程场景同日核实：id 即 `thread/start` 返回值 + 需一轮 bootstrap turn 硬化（[009](tickets/009-codex-new-command.md) 已 defer，无当前调用方），**008 联邦实施时若需接收端预置再并入该批次**

## Out of scope

- WSL 方案（Q2 已排除：WSL 内的 broker 唤醒不了 Windows 侧会话）
- 本地图内的实施执行（wayfinder 默认只规划；实施在地图走完后另开会话）
