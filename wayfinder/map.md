# Wayfinder Map：跨平台 agent 会话通信工具（Windows 起步）

label: wayfinder:map

## Destination

一期实现方案完全确定、可以直接开工：Claude↔Codex 在 Windows 单机上互聊（人启动的交互式会话），两条原生通道（Claude named pipe / Codex App Server）实测验证有结论，broker 一期架构与长对话上下文策略拍板；所有架构决策为完整集（账本/回执/状态机/联邦/三平台）留好接缝。本地图只做决策与验证，不执行实施。

## Notes

- 领域：本地 agent 间通信（Claude Code / Codex CLI）。借鉴 embassy 设计，不 fork（Q8c）。
- 背景资料：
  - `research/embassy-architecture.md` —— embassy v4.7.0 源码研究报告（机制 + Windows 依赖清单，含 file:line 引用）
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
- 技能：按票型调用 research / grilling(+domain-modeling) / prototype。
- Tracker 约定（本地 markdown）：claim = 把票的 `claimed-by` 改成自己；blocking 用 `blocked-by` 字段；解决 = 在票文件末尾追加 `## Resolution` 一节并把 `status` 改为 `closed`，然后在下方 Decisions so far 加一行。

## Decisions so far

- [Codex 在 Windows 的原生通道可行性](tickets/001-codex-windows-feasibility.md): 原生可行——本机活体验证 `codex app-server proxy` + WebSocket over stdio + `initialize`/`thread/list` JSON-RPC 全链路成功，schema 含 `thread/resume`/`turn/start`/`turn/steer`，无需降级轮询（缺口仅为移植项：三元组/目录名、socket 见证模型、进程收割、env 变量双读）。
- [Claude Windows named pipe 实测验证](tickets/002-claude-windows-pipe-verification.md): 原生可行但需适配——用户帧逐字节兼容并在自建会话上端到端注入成功（回复 OK）；Windows 强制先写 auth 行（peerToken 来自 `<pid>.<sha256(管道路径)>.key`）、管道名随机须读注册表、接收会话需 `crossSessionInbound:"accept"` 否则消息被 parity hold、会话生命周期须网关自管。
- [一期 broker 架构设计](tickets/003-broker-phase1-design.md): **无需 broker**——一期 = 无状态 CLI 四命令（`send`/`status`/`install-skills`/`claude` 包装）；skill+信封双教学、双侧自动发现零注册、同步 send 不重试、自包含会话引用、防乒乓文件限流、Node22+TS；考虑并否决 Claude 原生 ListAgents 伪 peer 广告（embassy v4.0.0 主动移除同款）；broker 回归条件 = 忙时持久队列/异步回执/跨机不占线。
- [长对话的上下文策略](tickets/004-context-strategy.md): 一期 = 预算+计数提示——单条 16KiB 上限、ref 内嵌轮次计数、信封显示第 N 轮、接近预算 skill 自动收尾；一切超限同步显式报错（MESSAGE_TOO_LARGE / RATE_LIMITED）交 agent 自纠，长内容落盘发路径引用（同机文件系统=天然泄压阀）；摘要轮换/外部档案留二期。
- **一期全部设计票关闭，frontier 清空——目的地达成，进入实施（B0✅ B1…B5）**

- [B5 联调决策（非票，实施期实测定型）](../b5-drill-report.md): codex 接收一期语义 = headless 信箱模型——投递目标为未被 TUI 占用的线程，"开着=只读（对 multichat），关着=可投"，原生 turn 零轮询（3 轮全链路实测通过）；claude↔claude、codex→claude、daemon headless 回信均实测通过。

## Not yet specified

- 联邦协议与异构互聊设计（win↔linux 跨机）；与 embassy 生态的互通性评估（Q9）
- 完整集的范围与节奏：持久账本、回执、投递状态机、TUI、服务安装 + 看门狗（launchd `KeepAlive{Crashed}` 语义等价物）、Windows 安全见证模型（named pipe ACL 哲学）；broker 回归条件已定（003），联邦 v1 可先 ssh+远端 CLI
- 二期长对话机制（004 遗留）：换轨续传模式 = 自动档案（broker 回归后邮差全程落盘）+ 摘要服务 + 新会话读档接续；不做"原地压缩"（transcript 归 provider 所有，外部工具做不到）
- 二期上限可配置化（2026-10-01 用户追问）：单条上限从 16KiB 常量改为按端点的 `maxBodyBytes`，各传输协议封顶（claude peer 帧 64KiB / codex ws 1MiB / 新适配器各自定）；004 轮次预算按两端模型窗口的最小值定；Claude Code 挂 GLM 等大窗口模型时传输层无感；GLM 自家 agent CLI 属二期新适配器问题（有无原生唤醒通道决定原生 or 降级，同 codex 评估流程）
- mac/linux 平台适配排期
- agent 侧 skill 文案（embassy-peer 等价物）——形式已定（003：skill+信封双保险），具体文案实施时写
- 工具命名
- codex TUI 占用标注：status 显示哪个线程被 live TUI 持有；需查写者锁存储位置（状态库 lease vs daemon 内存表）；禁止用 resume 探测（会抢写者）
- codex TUI 侧注入调研票：`hooks/list` 能力探明——"开着也能投"的唯一残余希望（daemon 协议已证死路：全量方法表无注入路径，单写者锁是上游安全设计）；codex 官方放开注入 API 则另说
- 专用信箱线程机制化：每机一个 multichat 自有的常闭 operator 线程作默认收件地址，避免工作线程混用（一期靠 README 文档指导）

## Out of scope

- WSL 方案（Q2 已排除：WSL 内的 broker 唤醒不了 Windows 侧会话）
- 本地图内的实施执行（wayfinder 默认只规划；实施在地图走完后另开会话）
