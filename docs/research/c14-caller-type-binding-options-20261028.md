# C14：调用方工具类型的绑定与持续核验选项

2026-10-28。只读研究及方案选项，尚未实施；研究阶段仅写文档，没有修改产品代码、命令、skill、模型配置或原生工具，没有运行测试或发送消息。后续讨论已条件批准Q19并要求解决多会话重复询问；最新收敛方案见[统一设计](../development/c14-explicit-tool-design-20261028.md)。

## 结论与本轮约束

可以实现“一次确认，多个会话复用，后续由程序重核”，但须把**来源分类的共享范围**与**每次调用的实例/会话核验范围**分开。来源分类可跨同一可核实原生入口或Host域中的多个会话共享；各次调用仍分别关联当前实例并核验完整原生ID。不能将询问粒度锁死为session＋instance，也不能仅凭 `provider + native session ID` 将同ID的CLI/Desktop合并。当前 `resolveCallerIdentity` 读取普通shell身份时，Codex、OpenCode、Harness均未提供完整来源域及实例关联或 `endpointType`。[源码：src/identity.ts:112](../../src/identity.ts)

用户确认应当保存为“用户确认的类型，已通过哪些原生一致性核验”，而不是升级成不存在的原生来源证明。无需新增鉴权系统、token或 `--from-tool`；send的 `--tool` 始终表示收件类型，拟议的独立identity确认操作表达自身分类。可否复用确认，取决于适配器能否给出可重复关联的来源上下文，不能由模型是否记得上轮回答决定。下文的接口与保存方式是方案，不是已存在能力。

既有批准边界见[逐轮记录](../development/c14-user-command-review.md)：

- Q17：所有 `send`，包括 `--conversation`，显式携带收件 `--tool`，hint/TUI 负责生成；取消“唯一候选可省略参数”的隐式分支。
- Q8：原生会话身份匹配、既有引用的收件端明确时，允许正常回信；不能再额外要求证明本次发信 shell 属于 CLI/Desktop，或因来源探测暂不可用一律阻断它。
- Q9/Q10/Q11：已确定收件端不跨类型回落；不同实际端点分别通信记录及成员资格；OpenCode shared 不按窗口拆分。
- Q13：来源工具类型独立展示；未知仍为待核实，不将收件选择写成发信类型。
- Q15：TCP 类型能力不支持时明确拒绝并提示升级，不丢类型兼容投递；SSH没有同一能力握手。
- Q16：同一引用显式补齐已核实类型，保留本机 cN、nonce 和连续轮次；旧未知信息不得覆盖已确定类型。
- Q18：先研究原生识别；不足时询问用户自己的类型，再研究程序持续核验。用户没有批准“凡无法证明来源就禁止主动通信”，本研究也不将其设为默认结论。普通 human 单向发送不因本研究被额外禁用。

## 现有源码实际提供的证据

| 来源 | 当前可取得的数据和核验 | 可说明什么 | 缺口与不能推出的结论 |
| --- | --- | --- | --- |
| Claude 普通 shell / 登记 | `CLAUDE_CODE_MESSAGING_SOCKET` 精确匹配唯一完整 `sessionId`；登记包含 PID、socket，可选 `startedAt`，只扫描 interactive/bg 活进程 | 当前实现认可的原生会话身份；当前登记入口属于已接入的 CLI messaging 通道 | `startedAt` 可缺；活 PID 检查只用 signal 0。当前识别没有 OS 进程出生时间关联和实例绑定存储，不可说已防所有 PID/socket 重用。[src/identity.ts:166](../../src/identity.ts)、[src/claude/registry.ts:10](../../src/claude/registry.ts)、[src/platform/process-inspector.ts:4](../../src/platform/process-inspector.ts) |
| Codex 普通 shell | `CODEX_THREAD_ID` 或 `CODEX_SESSION_ID` → 原生完整 ID；本轮Windows Desktop两次独立exec另观察到原生 `CODEX_TOOL_CALL_ID` | 当前认可的会话身份；tool-call ID可研究逐调用关联 | thread/session ID不携带 CLI/Desktop归属；tool-call ID每次变化，不能直接作为持久绑定键。现caller尚未读取它，也未单独核对两session变量同在时是否相等。[src/identity.ts:112](../../src/identity.ts)、[调用证据1](evidence/c14-caller-identity-20261028/current-desktop-native-context-1.json)、[调用证据2](evidence/c14-caller-identity-20261028/current-desktop-native-context-2.json) |
| Codex CLI daemon | initialize 返回 `userAgent`、`codexHome`；现改名适配器读取 `daemon.pid` 中 PID、`processStartTime`、executable/path digest，核验活 PID，结合 `realpath(home)` 生成上下文指纹 | 可区分 CLI 服务及其登记的运行代次，用于服务变化失效 | 指纹函数目前是改名模块内部实现，未接入 caller；这些字段来自原生 PID 文件，不是每次都独立向 OS 验证的出生时间。服务能读到 ID 不证明本次 shell 来自这个服务。[src/codex/client.ts:164](../../src/codex/client.ts)、[src/codex/rename.ts:24](../../src/codex/rename.ts) |
| Codex `--connect` 窗口桥 | 本窗口独占 WebSocket 生命周期；跟踪真实 `thread/start/resume/fork` 及 `turn/start` 请求/响应，拥有选择顺序；关闭时回收 | 可证明这个受控窗口选择了哪个完整 ID；共享 follower 有代次取消与迟到释放 | 接口只向上层传选择事件，没有“某次普通 shell 调用由哪个连接/turn 产生”的映射。已有窗口 token 只服务既有连接，不宜把它变成新的 caller token，也不能据其继承环境认定发信归属。[src/codex/session-events.ts:20](../../src/codex/session-events.ts)、[src/application/session-selection.ts:7](../../src/application/session-selection.ts) |
| Codex Desktop IPC | `ownerId`、thread ID、snapshot revision、activeTurnId、实际 IPC 连接；响应校验 owner，owner 断开则终止连接 | 此连接上该 thread 的当前接收 owner；可检测其断开及 snapshot 更新 | snapshot revision 是线程状态版本，不是 owner 重启代次；没有本次 shell/进程与 owner 的关联接口，活 owner 不能单独证明发信来自 Desktop。[src/codex/desktop-ipc.ts:9](../../src/codex/desktop-ipc.ts)、[初始化与事件处理:165](../../src/codex/desktop-ipc.ts) |
| OpenCode 普通 shell / HTTP | `OPENCODE_SESSION_ID`；显式集成 fallback 与原生 ID 不一致时拒绝。服务路径受 home/XDG/配置影响；登记有 URL、PID、可选 version/password，`/api/info` 比对 PID/version；详情核对完整 ID，发现标为 shared | 可核实选择的服务及服务中实际会话；本批工具类型为 opencode/shared | 当前 API未返回实例 generation/start-time；连接对象不向 caller 暴露服务指纹；显式 URL 没有登记 PID 可比。环境 ID 不能单独证明当前 shell 用的是哪一台/哪一个本地服务。`/api/session/active` 也不是窗口当前选择事件。[src/identity.ts:119](../../src/identity.ts)、[src/opencode/service.ts:46](../../src/opencode/service.ts)、[服务核验:184](../../src/opencode/service.ts)、[src/opencode/client.ts:26](../../src/opencode/client.ts) |
| Harness 普通 shell | caller 当前只读 `DSH_SESSION_ID`。既有固定上游研究记录原生 shell 每次生成 `DSH_HOME`、`DSH_SHELL=1`、session ID，profile 可用时有 `DSH_PROFILE/DSH_PROFILE_DIR` | session ID 为当前接入认可身份；其余原生上下文可研究接线 | caller 尚未消费 home/profile；不能直接拿某个 profile 环境值替代 bridge 实例核验。正式 Desktop 普通 shell 未由 npm/Web 验收替代。[src/identity.ts:129](../../src/identity.ts)、[固定上游核查](deepseek-harness-native-contract-20261023.md)、[shell-env 一手源码契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/shell-env/README.md) |
| Harness Host bridge | 每次 mount 生成新的 `instanceId`；原生 `profileContext.name` 决定 host/desktop；登记含 PID、instanceId、profile/type、version、createdAt，`/v1/info`逐项比对。精确 root 查询按完整 ID，重复实例不选首项 | 当前桥实例及其活 root 身份；实例重启可由新 UUID 区分；profile/type 一致性已有受控接线 | 登记写在 crosschat home 的 instances 目录，不等于已记录 `DSH_HOME/PROFILE_DIR`；info也未给出 shell 调用链。createdAt 是登记时间，不是 OS 进程出生时间；UUID 是运行标识，不是来源鉴权。需把每次 shell 的 home/profile 与具体实例关联起来，不能只按“活 roots 中唯一”归属。[integrations/dsh/bridge.js:41](../../integrations/dsh/bridge.js)、[src/dsh/registry.ts:7](../../src/dsh/registry.ts)、[src/dsh/service.ts:106](../../src/dsh/service.ts)、[src/dsh/client.ts:96](../../src/dsh/client.ts) |
| TCP/本机 attach 及 node | 既有连接、星 ID、完整机器 ID、成员声明及 claim 的真实 socket 生命周期；旧 socket 不能释放新连接的 claim | 可复用“运行时连接拥有声明、旧代次不能覆盖新代次”的生命周期模式 | 这是成员声明的所有权，不是普通 shell 的调用来源。不能因为会话已入星，就认定调用属于该窗口/该类型。[src/serve/attach-client.ts:19](../../src/serve/attach-client.ts)、[src/serve/node.ts:974](../../src/serve/node.ts)、[claim 释放:1033](../../src/serve/node.ts) |

补充：现有 machine ID 读取已经覆盖 Windows MachineGuid、macOS IOPlatformUUID、Linux `/etc/machine-id`，失败返回 unknown，不会创建新 ID；这可隔离不同机器，但不等于同机器不同 OS 用户、home 或 Host 实例。caller 接口尚未把这些维度统一为运行上下文。[src/application/session-membership/machine.ts:27](../../src/application/session-membership/machine.ts)

### OS 进程信息能够补什么

root 本轮已保存一次 Windows 只读观察：pwsh → Codex 原生 runtime → WindowsApps Codex 包的进程链及创建时间；脱敏记录明确没有将完整 session ID 绑定到 owner/turn，也未证明 nested CLI、重启或三平台多轮行为。[本轮原始记录](evidence/c14-caller-identity-20261028/current-desktop-process-chain.json)

Windows 官方说明 `ParentProcessId` 可能因父进程退出/PID重用指向其他进程，可结合 `CreationDate`核对；Linux `/proc/<pid>/stat` 和 macOS `proc_bsdinfo` 也有 parent/start-time 信息。这些说明跨平台技术上可读取进程代次，**不等于 crosschat 已实现统一读取器，也不等于沿任意祖先看到 Desktop 就证明来源**。必须识别最近的实际原生执行 runtime，处理 shell/工具嵌套与不可读进程；跨平台适配仍须实际验证。[微软一手文档](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)、[Linux v6.12 proc 文档](https://github.com/torvalds/linux/blob/v6.12/Documentation/filesystems/proc.rst#L337)、[Apple proc_info.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h)

### 优先研究的正向路径：原生逐调用标识

Codex固定v0.163.0源码的unified_exec执行路径注入 `CODEX_TOOL_CALL_ID`；root保存的当前Desktop两次独立exec中，thread/session指纹一致，tool-call指纹变化，`CODEX_TURN_ID` 均缺席。两次调用都在同一个agent turn内，不能写成“已通过多轮、重启或三平台”。[固定一手源码](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/unified_exec/process_manager.rs)、[证据1](evidence/c14-caller-identity-20261028/current-desktop-native-context-1.json)、[证据2](evidence/c14-caller-identity-20261028/current-desktop-native-context-2.json)

这个原生字段提供了比“查到某个活owner”更直接的执行关联方向：研究原生公开hook/执行回调能否同时得到同一call ID、session ID及自己的运行实例上下文；crosschat调用读取原生call ID，与该实例观测到的本次调用配对。运行核验仍以“实例代次＋完整会话”为范围，新的call ID只负责本次复核；用户分类在可核实来源域中共享，不要求每个会话重新确认。它不是新token或新鉴权，不能仅因存在这个字段就宣布已绑定Desktop。当前还没有证明hook侧字段、owner归属、并行调用及CLI/三平台原生一致性，这些要由逐工具调研补证。

## 最小绑定契约：把声明与关联分开

建议由 Provider Adapter 返回小型结构化结果，共用层保存和重核；不在通用界面写逐工具分支。这沿用已批准的稳定 Provider 注册与上下文隔离方向，不为来源绑定另造一套成员制。[共享设计:112、131](../development/session-selection-membership-design-20261026.md)

以下为建议的语义字段，不是本轮新增命令或最终 TypeScript 接口：

| 字段 | 作用与最小要求 |
| --- | --- |
| `sourceDomain` | Adapter给出的可重取来源关联，例如机器/用户、原生入口或Host域及必要的home/profile；用于分类共享，不能只由工具名、路径、session ID或当前PID构造 |
| `nativeIdentity` | 原生 Provider＋完整不透明 ID。每次从原生调用重新读取，身份缺失/冲突不能用用户确认补造；不能截短 ID |
| `executionScope` | 本机/OS用户上下文，实际 home/profile，当前调用关联到的原生实例或连接。Adapter 必须说明哪些是原生明确提供、哪些已通过关联核验、哪些缺失 |
| `runtimeFingerprint` | 能检测运行代次的原生 instanceId、已核实进程出生信息、owner/真实连接生命周期等；仅 PID、URL、端口、版本不足。版本变化另外使旧能力结论失效 |
| `sourceTool` | 原生识别或用户确认的工具类型；与收件 `--tool` 独立 |
| `basis` | 记录“原生明确提供”或“用户确认＋已核验一致性”。用户选择可验证与实例相容，不能伪称已得到原生来源证明 |
| `invocationEvidence` | 原生逐调用call ID与该实例hook/执行回调的同调用匹配，或已有可核实的原生进程关联；逐次更新，不把瞬态call ID当长期scope，不收集聊天正文 |
| `observationRevision` | 本次采样及适配器代次，用于丢弃旧探测/旧确认响应；不作为新鉴权凭据，也不放进用户正文 |

分类复用范围建议为：**执行机器/用户上下文 × Provider × 可核实来源域**，保存原生识别或用户确认的类型；同域新会话复用分类。**完整原生会话 × 已关联实例运行代次**是每次调用的核验范围，不是每次询问用户的粒度。不同CLI/Desktop来源不互相覆盖；同一实际shared服务按同一服务域处理，不臆造前端归属。Adapter若只能核实实例则仅在实例范围共享；缺少任何来源关联时明确记能力缺口。

### 分类范围与调用范围的差别

| 绑定范围 | 能否满足多轮复用 | 判断 |
| --- | --- | --- |
| 仅本条消息 | 只能保存这次确认；下一次 CLI 进程重启后没有可匹配上下文 | 可以记录本次声明，不能承诺“以后无需再问” |
| 仅 Provider＋完整 ID，永久保存 | 看似可以，CLI/Desktop 共 ID、多窗、同 ID resume 到另一实例会串用 | 不采用为默认持久绑定 |
| 会话＋具体实例代次＋可重取的调用关联 | 可逐次复核本会话，但若当作确认范围，会让新会话重复询问 | 用作调用核验，不单独决定询问粒度 |
| 可核实来源域的共享分类＋每次调用核验 | 同域多个会话一次确认，运行换代先自动复核 | 最新推荐；来源关联不足时不扩大范围，也不用逐会话提问伪称完成 |

“同一实例”也不能作为跨所有会话的无限通行证：同 Host 可承载多个根会话，同共享 daemon 可服务多个窗口。每轮仍读取真实 ID，按原生选择/恢复事件核对，不靠目录、busy/idle、最新记录或 live-root 集合猜当前会话。[Harness roots](../../integrations/dsh/bridge.js)、[Codex 窗口选择](../../src/codex/session-events.ts)、[共享需求](../development/session-selection-membership-design-20261026.md)

## 建议的询问、保存与重核流程

1. **先读原生身份与调用上下文。** 有明确原生类型则采用并继续一致性核验；没有则保留待核实，不根据收件参数、历史 originator/source、活 owner 列表自动推断。现 caller 的外族冲突与 OpenCode 原生/fallback ID冲突检查仍是入口事实，不能被缓存覆盖。[src/identity.ts:112](../../src/identity.ts)
2. **自动识别及已有分类都无法解决时才询问。** 程序核查所选分类与Provider、真实调用及来源相容，按可核实来源域保存，供后续不同会话复用。同域并发首次调用原子取得同一待确认项和单个询问展示权，其他调用不重复询问。未答不当同意；首问会话退出，后续活调用可接续同一项。独立 `identity confirm` 入口为收敛提议，尚未实施；模型记住回答不等于程序已保存。[src/application/send/types.ts:12](../../src/application/send/types.ts)
3. **持久状态由程序读取。** 单次 `send` 是独立进程，不能仅存在进程内变量。可以借用现有 `.crosschat` 状态根原则，另按具体上下文保存有界记录；路径与用户面管理方式仍需确认。本研究不增加常驻服务依赖。已有通信对状态用于路由/轮次，不宜在其中混入“ID永久属于某工具”的全局断言。[src/state-root.ts:11](../../src/state-root.ts)、[src/conversations.ts:18](../../src/conversations.ts)
4. **每次发送重核关键上下文。** 比较当次原生 ID、home/profile、实例/owner代次及当前类型证据；命中同一有效绑定才免问。可有界只读重探测，迟到响应不得替换新上下文；只读操作不安装、修配置、resume原生线程或重新投递正文。现共享操作已有有界重核/expected revision 模式，可以参考其生命周期，不能把改名探测直接当 caller 探测。[src/application/session-operations.ts:55](../../src/application/session-operations.ts)
5. **运行变化先自动重核，必要时才重新询问。** 实例、owner或版本变化使旧运行证据失效，但来源仍可关联、分类相容且自动重核通过时继续复用答案。来源暂不可达时保留已答分类为待重核，恢复后自动核验；来源确实变化或分类冲突时才说明原因并确认，不能静默把Desktop改为CLI。迟到回答不可改绑新来源；原确定引用的接收路由依Q9保持。

保存上需要明确单写 owner或条件写入策略。现 `conversations.savePair` 是 best-effort tmp＋rename，注释明确同对并发为 last-write-wins；不能照搬这一容错语义保存会影响后续来源分类的确认，否则旧窗口可能覆盖新确认。可按实例代次独立记录并检查 revision，实际实现方案再讨论。[src/conversations.ts:136](../../src/conversations.ts)

### 无法取得调用关联时的真实边界

用户选择 Desktop 后，程序读到“Desktop 内有这个 ID”，只完成**候选一致性**，没有证明当前 shell 从 Desktop 执行。若下一轮仍只有同一个 ID，程序无法判断它是否来自新开 CLI。此时需要补原生执行接线/可验证的进程关联，才能宣称持久自动识别；不应以重试全量候选扫描、一次性模型回答或新增 token 掩盖缺失字段。

对该缺口有两个可以继续讨论的层次，不能擅自合并：

- **运行来源绑定**：保证确认属于当前调用实例，可多轮复核，适用上面的最小契约。
- **既有对话的明确回信路线**：用户明确选定端点并写入 ref 后，后续按照 Q8/Q9 续聊；这是一条已确认的收件路线，能避免反复问收件类型，但不证明本次发送入口。不能把它直接填成已验证 `from-tool`。

当前研究不选择“缺来源证明就禁用一切新发送”的处理。对于缺少稳定调用关联的新通信，应由整体方案明确：如何接收用户确认、保存到什么可重取范围、显示何种声明依据，以及对不可核实时采取什么具体行为。原有 human 发送与Q8正常回信继续作为约束，不能因研究未完成而删除。[批准记录](../development/c14-user-command-review.md)

## 失效、冲突与恢复边界

| 场景 | 应核对/失效什么 | 保持的已批准行为 |
| --- | --- | --- |
| PID 被重用 | PID之外比较原生 instanceId、进程出生信息或真实连接代次；字段不足保持待核实 | 不把 `isProcessAlive(pid)` 当完整进程身份核验 |
| 同 ID 多窗口或 CLI/Desktop 同时运行 | 绑定按可关联执行实例隔离；缺实例关联时不能用第一个候选覆盖 | 不同接收端点的记录/成员独立；不把所有窗口当一个来源 |
| 当前窗口切换会话 A→B | 重新读取原生完整 ID，切换代次，迟到的 A 探测不得写入 B；类型若由同实例提供可继续复核 | 原生会话选择与发信 shell 关联分别核实，不靠目录/状态推测 |
| 工具/Host重启，resume 相同 ID | instanceId/owner连接/进程出生代次变化，旧运行证据失效；优先自动重核同一来源，成功就复用分类，不无条件重问 | 旧通信记录和永久成员不因此删除；原生ID相同不代表实例不变 |
| 服务 URL/端口相同，profile/home改变 | 比较完整实例上下文，不能只按地址命中 | 工具类型的路由分类与原生实例代次分开，不新造窗口分类 |
| 暂时超时、断连、权限不足 | 结论为暂不可用/待核实；有界只读恢复探测，不能永久标为“不支持” | 写后不明保持待核实，零自动重发；不自动安装/升级或切端点 |
| 原生类型与用户确认矛盾 | 记录冲突及新上下文，显式核对，不用优先级静默覆盖 | `--tool`不能用作发信来源，不能猜改其他原生身份变量 |
| 原生身份缺失/外族冲突 | 缺失保持 human或现有明确错误；不给用户选择填造原生 ID | 现有 human 单向发信不顺带禁用；冲突不靠缓存“修复” |
| 来源类型未知，但 caller 原生身份匹配且既有收件路线明确 | 不新增来源 owner证明门槛；不要把一次探测失败等同 caller不属于对话 | 按Q8允许回信；Q17显式收件tool继续校验；已确定路由不改绑 |
| 类型补齐与旧ref重放 | 仅显式核验未知类型；已有确定类型优先，旧观察不覆盖 | Q16保留cN/nonce/连续轮次；改变确定端点另建记录 |

讨论前代码 `verifyReplyCallerCandidates` 会因为来源候选读取失败、多端点或未知类型拒绝 typed 回信，它只是候选排歧义检查，源码自己说明“不构成 owner attestation”。这一实现不能作为最终方案继续无条件保留；用户Q8已明确收窄来源证明门槛。实际调整须在整体方案确认后完成，不在本研究执行。[src/application/send/index.ts:597](../../src/application/send/index.ts)

## 最小有意义的验证与兼容 CI 增量

以下均为**待开发的验证建议**，不是本轮已通过的测试，也不改变 C00/C12 平台矩阵决策。

| 层级 | 必要场景与可观察结果 | 可以复用的现有接缝 |
| --- | --- | --- |
| caller/绑定纯逻辑 | native ID缺失/冲突、用户声明与原生类型相容/矛盾、收件tool不污染来源；相同上下文复用确认、不重复询问 | `src/identity.ts`；现有 `test/opencode-identity.test.ts`、`test/dsh-identity.test.ts` |
| 跨会话确认体验 | 同来源连续新会话一次确认；并发首次仅一个待确认项；首问退出其他会话可接续；迟到答复不改绑；已答来源暂不可达后自动重核；正常重启/升级核验通过零重复问 | 共用分类/待确认契约待实现；不与通信对或成员状态混存 |
| 运行代次与竞态 | PID重用、实例重启、owner变化、同ID双端点/双窗、profile/home切换；旧探测/旧用户确认迟到不能覆盖新代次 | `test/session-selection.test.ts`、`test/codex-session-events.test.ts` 的取消/代次模式 |
| 原生逐调用关联 | 同session两次不同call ID仍命中同实例绑定；并行call不串用，错ID/旧call/未知hook实例不补造类型；新进程复核不依赖模型记忆 | 若Codex原生hook路径核实后补专属受控fixture；当前两份exec证据仅验证字段存在与变化 |
| 原生适配一致性 | Harness登记/info/profile冲突与同ID多实例；OpenCode服务更换PID/version且沿用URL；来源shell上下文与候选服务不一致时不写“原生已识别” | `test/dsh-adapter.test.ts`、`test/dsh-bridge.test.ts`、`test/opencode-adapter.test.ts` |
| Q8/Q17联合回归 | 显式收件tool＋caller ID匹配＋目标明确，来源类型未知或只读探测失败仍能正常续聊；原生ID冲突与收件tool冲突仍拒绝 | `test/c14-native-send-seams.test.ts`；需按批准语义改写讨论前断言，不把旧GREEN当新需求验收 |
| 引用和状态隔离 | 未知补齐保留cN/nonce/轮次；确定端点冲突不改绑；两实例并发不互相覆盖确认；损坏绑定不伪造来源、不删除聊天 | `src/conversations.ts` 与类型/引用隔离测试接缝 |
| 受控原生多轮 | 真实工具＋本机脚本模型：第一轮产生原生shell身份→用户确认fixture→第二次新的crosschat进程自动复核→重启/resume后旧绑定正确失效/恢复。必须由原生shell调用，不能只从外部测试进程注入env | `test/helpers/dsh-live-fixture.mjs`、`dsh-runtime-driver.mjs`、`opencode-live-fixture.mjs` |
| OS关联的必要反例 | Windows/Linux/macOS各自检查父PID重用/出生时间、不可读父进程、嵌套CLI；一个Desktop祖先不能错误绑定nestedCLI | 新OS读取器若采用则需对应真实runner验证；单份当前Windows链仅是线索，不是三平台验收 |
| 真实端点独立验收 | CLI与正式Desktop各自多轮普通shell、实例重启和同ID并存；Harness正式Desktop不能用npm/Web替代 | 消费C04/C11/C12/C22；不另造全工具×全对端组合，具体矩阵仍按C00批准范围 |
| 远端边界与资源 | 只在源机核验当前调用，TCP/SSH接收腿不拿目标机进程猜远端来源；取消清timer/句柄/连接；类型能力缺失拒绝，不重放写 | `test/endpoint-protocol.test.ts`、`src/serve/endpoint-identity.ts`、已有受控传输fixture |

现 Harness专用 workflow 的原生 probe 仅 Windows npm/Web，报告job的Ubuntu只处理证据；OpenCode既有workflow已有脚本模型与隔离生命周期入口。新增绑定验证应在既有正式工具＋本机mock序列中增加上述多轮证据，不放个人模型 key，不把mock直接造调用环境当原生来源识别通过。托管运行、三平台和正式Desktop的缺口继续留原任务表。[.github/workflows/dsh-compat.yml:17](../../.github/workflows/dsh-compat.yml)、[OpenCode工作流](../../.github/workflows/opencode-compat.yml)、[全量计划](../development/tool-compatibility-ci-tasks.md)

## 研究后的决定与实施边界

1. Q19已条件批准：用户确认补自身类型，只在程序无法分辨时用；Q8/Q9的收件路线选择是另一件事，两者不能互相冒充。
2. 用户要求避免多会话重复询问，最新提议为来源分类共享、逐调用核验、并发去重及先自动恢复；入口为程序生成的独立确认操作，最后整体确认前不实施。
3. 某Provider暂无稳定调用关联时，记录入口缺口，不以全局未知缓存或重复提问掩盖；不新增统一禁发，也不承诺永久记住一个ID就能适配全部CLI/Desktop。

本研究建议先利用每个Provider已有实例/连接元数据，再补最窄的原生执行关联；共用层只处理已核实结构、声明依据、代次与失效。这样能减少重复询问和模型记忆依赖，同时保留“当前尚无法识别”的准确边界。
