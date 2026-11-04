# C14：Codex／Claude 发信身份与持续核验研究

2026-10-28。状态：**只读研究，未实施**。按用户 Q18 调研“程序优先识别自己的工具；无法自动识别时由用户确认一次，后续由程序重新核验绑定”。Q17 已批准所有 send（包括 `--conversation`）显式指定收件 `--tool`，本研究不重新审批该结论，也不把收件类型当作发信身份。

## 结论

**存在比历史候选推断更好的原生依据。** Codex 固定版本源码为 shell 注入当前 thread、root session 和本次 tool-call ID；当前 Windows Desktop 的两个独立调用已实际观察到会话 ID 稳定、调用 ID 改变。结合受控 CLI 窗口连接、原生 Hook 的 session/turn/tool-use 信息，以及有界进程来源核验，可以研究“按调用重新核验”的 Provider 实现。此前“只有 ID 所以无法识别”的结论过窄。[S1][S2][E1][E2]

但**现成的、通用的 CLI/Desktop 来源证明尚未完成**：Codex 这些原生字段标识会话和调用，本身不包含 `cli`／`desktop`；当前 Hook 输入也没有该字段。受控 WS 桥证明窗口选择，Desktop IPC 证明特定原生会话有一个收件 owner，两者都不能单独证明任意 shell 的出处。程序需要将本次调用同已核实的原生执行实例绑定，不能只检查“同 ID 有 Desktop owner”或“有 Desktop 祖先”。[S2][S3][R1][R2]

Claude Code 的依据更直接：官方文档明确描述原生当前会话 ID、宿主 PID、每会话 messaging socket/token，并支持 Hook 输入。当前 crosschat 已按 socket 精确匹配登记，且可继续研究每次命令核对当前 ID/PID/socket 的一致性；无需为了形式一致给每个工具添加一套自报身份。[S5][S6][R3]

## 来源版本与证据等级

| 对象 | 固定范围／读取日期 | 证据等级 |
| --- | --- | --- |
| Codex 原生源码 | 官方 tag `rust-v0.163.0`；annotated tag `129b8ec7ee6f4511557a4856279f529025c25af4` 指向 commit `83086188ae0614bd882818ff1aa23f3194962012`，tag 日期 2026-10-15 | 源码证明；没有在本研究安装／运行该版本 |
| Codex 官方文档 | Hooks、App Server、Environment Variables、Config Reference，2026-10-28 实际读取 | 当前公开文档；页面可继续变化，不把 main/schema 新字段默认当旧版本已有 |
| 当前 Windows Desktop | `OpenAI.Codex_26.1021.3705.0` 的现有调用环境；root 在当前正常上下文做只读采样 | 本机正向观察，仅限所存三份脱敏证据 |
| Claude Code | 2026-10-28 官方 Hooks／Environment Variables 页面；按页面的最低版本说明 | 官方文档证明；本研究未重跑原生 Claude |
| crosschat | 当前共享工作区，只读 `identity.ts`、Codex wrapper、WS bridge、Desktop IPC 与既有验证记录 | 当前实现事实，不能代替原生新能力验收 |
| OS 来源核验 | Microsoft Win32_Process 文档、Linux kernel proc 文档；Apple xnu commit `f6217f891ac0bb64f3d375211650a4c1ff8ca1ea` | 字段/API存在的依据，不代表三平台 crosschat 已实现／验收 |

## Codex：已知原生字段与能力

| 字段／入口 | 可以核实什么 | 不能直接推出什么 | 状态与依据 |
| --- | --- | --- | --- |
| `CODEX_THREAD_ID` | 当前执行上下文的原生 thread；源码在环境策略之后覆盖注入 | CLI/Desktop、活窗口或收件 owner | 固定源码证明；当前 Desktop 实际存在。[S1][E1][E2] |
| `CODEX_SESSION_ID` | 源码称 shared root-session identity；普通 root thread 可与 thread ID 相同 | 不能假定子 agent、fork、resume、重启后恒与当前 thread 相同，也不是端点标签 | 固定源码证明；本次仅观察普通 root 两调用相同。[S1][E1][E2] |
| `CODEX_TOOL_CALL_ID` | 当前工具调用 ID；源码先清除旧值再写入 `context.call_id` | 它本身没有 owner／端点信息；不能假定所有旧版本、MCP server 或跨机执行都具有相同语义 | 固定源码证明；当前 Desktop 两次独立调用实际变化。[S1][E1][E2] |
| `CODEX_VERSION` | 原生 runtime 编译版本注入，可用于能力探测和缓存失效 | 不能作为 CLI/Desktop 标记 | 固定源码证明；本次未读取用户该变量值。[S1] |
| `CODEX_TURN_ID` | 无本研究确认的 shell 注入契约 | 不能要求所有 shell 必须提供该键 | 当前 Desktop 两调用均不存在；turn 可研究由 Hook／事件关联获得。[E1][E2][S2] |
| Codex `PreToolUse` | 原生输入包含 `session_id`、`turn_id`、`tool_use_id`、工具名；子 agent 有额外 agent 字段 | schema 没有 CLI/Desktop 字段；`source` 若来自 SessionStart 表示 startup/resume/clear/compact/fork，不能当产品入口类型 | 官方文档＋固定 schema/source 证明；与 shell call-ID 的精确关联及 Desktop Hook 范围待实测。[S2] |
| `shell_environment_policy.set` | 配置可给原生命令设置环境覆盖 | 仅在 wrapper 的父 env 写标记，不证明共享 daemon 的 shell 得到该标记；线程级配置／调用级重核尚需验证 | 固定源码证明策略存在；不在本轮改配置或注入标记。[S1] |

上述 `CODEX_*` 身份／调用字段在本次读取的官方 Environment Variables 页面没有逐项公开说明；因此其升级稳定性应标为“固定源码与原生探针覆盖”，不能宣称全部是长期不变的公开配置 API。[S4]

### 当前 Desktop 的正向实测

root 保存的 [进程链](evidence/c14-caller-identity-20261028/current-desktop-process-chain.json)显示本次命令为 `pwsh.exe → Codex app 内置 codex.exe → ChatGPT.exe`，各级有 PID、父 PID、可执行路径和创建时间；路径已脱敏，没有读取命令行或环境值。该链确实可由程序观察，不只是模型自报。

[第一次调用](evidence/c14-caller-identity-20261028/current-desktop-native-context-1.json)与[第二次调用](evidence/c14-caller-identity-20261028/current-desktop-native-context-2.json)只保存键存在性与 SHA-256 前缀：thread/session 指纹相同，tool-call 指纹改变，turn-ID 键不存在。第二次明确为同一 agent turn 内独立的工具调用；**这不是多模型轮次、重启、CLI 或三平台验收**。

进程链＋原生 ID 的组合可作为自动识别该受控拓扑的候选依据，但本次没有把它与某个 Desktop IPC `ownerId` 或 Hook `tool_use_id` 实际关联。不能把“某个祖先为 Desktop”推广到 Desktop 启动的嵌套 CLI、SDK、共享 app-server、容器／WSL／远端 executor。[E1][E2][E3]

### CLI wrapper 与 app-server 绑定

现有 `crosschat codex --connect` 在 binding 成功时，以随机 token 认证独占 loopback WS，将真实 CLI 窗口的 native RPC 透传到已有原生 owner；成功 `thread/start/resume/fork`／`turn/start` 是窗口选择证据。已有 CLI 0.163.0 真实选择验证。[R1]

可研究在**实际成功的受控连接**上保存原生 thread/turn、连接代际及本次工具调用关联，再同 shell 的 thread/session/call-ID 对账。官方 app-server 的 `item/started` 带 `threadId`、`turnId`、item；命令项有 item ID／可选 PTY process ID。**协议 processId 不应直接等同 OS PID**；普通历史项也不等于当前 invocation，关联规则仍须验证。[S3]

当前实现没有这一发信身份链：窗口 token 只给 TUI 连桥，resolver 不读取它；共享 daemon 派生 shell 是否继承并能可靠使用它尚无证据。普通 `crosschat codex` 不建此桥；`--connect` binding 失败也会继续原生启动，不能只看启动命令就标为受控 CLI。[R1][R3]

仅凭客户端 `initialize.clientInfo.name` 或记录里的 `originator/source` 也不够。官方服务将 client 信息用于连接上下文，但单个字符串本质上仍是客户端提供的信息；受控启动实例和连接核验不可省略。本仓库已有真实反例：CLI 因继承 `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop` 而带 Desktop/vscode metadata 标签。[S3][R4]

### Desktop IPC 的边界

现有 IPC 可按 `hostId=local + conversationId` 找到 `handledByClientId`，把后续请求及 snapshot 绑定该 owner。它适于核验**收件目标和当前可用能力**；当前接线没有 shell PID、shell invocation nonce 或 `CODEX_TOOL_CALL_ID → ownerId` 查询接口。[R2]

因此可研究“原生 Hook／执行实例登记 → 本次 call-ID → IPC owner”交叉关联，但不能由“同 ID 有一个活 Desktop owner”直接给当前 shell 赋 Desktop 类型。官方公开 app-server文档不能当成这套 Desktop 私有协同 IPC 的稳定性保证。[S3][R2]

### Hook 的适用范围

官方 Hooks 文档明确：本地编排＋本地执行的受支持 Codex／Work threads 继续支持现有 Hook；云编排即便本地执行也不支持普通 command/local-config/plugin Hook，同期支持的企业 MCP Hook是另一合同。Hook还受启用、配置来源、信任审阅和管理策略约束。[S2]

所以本研究只能称“local CLI／Desktop 场景有可研究的官方 Hook 机制”，不能承诺所有 Desktop模式或未来云／远端场景都能安装同一个 command Hook。当前未安装 Hook，也没有将现有 shell 与真实 Hook 输入逐项匹配。某些 Hook 失败不会阻止工具执行，因而发信执行端仍须自己核验登记是否有效；不能把“已配置 Hook”当“本次 Hook 一定成功”。[S2]

## 进程来源：跨平台能做什么

| 平台 | 官方可用字段／接口 | 本研究结论与限制 |
| --- | --- | --- |
| Windows | `Win32_Process.ParentProcessId`、`CreationDate`、`ExecutablePath`；Microsoft 明确警告父 PID 会退出、重用 | 可有界追最近的原生执行实例，并把 PID＋创建时间＋原生路径/版本组合为指纹；当前 Desktop 链已观察。只记 PID 或“路径名包含 Codex”不够，父进程晚于子进程应拒绝关联。[S7][E3] |
| Linux | `/proc/<pid>/stat` 的 ppid／start_time，`/proc/<pid>/exe`；proc可配置 hidepid／受权限及命名空间影响 | 可研究等价指纹；容器、PID namespace、WSL、reparent、远端 executor 会截断或改变链。没有本轮 Linux 实测，读取受限应返回未知而非猜测。[S8] |
| macOS | Apple `proc_bsdinfo` 有 `pbi_ppid`、`pbi_start_tvsec/usec`；`proc_pidinfo`／`proc_pidpath` 提供查询 | 能设计同类进程来源采样，但沙箱、权限和应用升级路径变化须实测；本轮没有 macOS 验收。[S9] |

进程指纹负责“哪个执行实例”，原生 thread/call-ID 负责“这个实例中的哪次调用”；两者不能相互替代。共享 daemon 可执行多个会话；同一个 Desktop 祖先也能启动 CLI。分类必须处理最近的实际 native 执行实例／受控连接及嵌套边界，不能遍历到任意 Desktop 祖先便结束判断。这是由已知多入口结构推导的设计要求，尚未实施。[R1][R2][E3]

## Claude Code：可复用的公开机制

| 机制 | 官方事实与适配价值 | 限制 |
| --- | --- | --- |
| `CLAUDE_CODE_SESSION_ID` | 官方称由 Bash／PowerShell、Hook 和 stdio MCP 子进程自动提供；Bash／PowerShell／Hook 与 hook `session_id` 对应，`/clear` 后更新 | stdio MCP 保留启动时 ID；无显式 ID 的 continue/resume 有文档边界，不能用长期 MCP 环境代替每次 shell。[S5] |
| `CLAUDE_PID` | 官方称 shell／Hook 子进程得到 Claude 宿主 PID，最低 v2.1.214 | 与创建时间、可执行来源、当前会话/登记合并核验；PID本身会重用。[S5][S7] |
| messaging socket/token | 官方称 socket/token 由原生每会话设置，覆盖父会话继承值，settings env 不能设置；socket最低 v2.1.224，token最低 v2.1.228 | 只有实际绑定 inbox 的会话才提供；不能要求所有关闭 messaging 的入口都具有它。token不进入普通日志或本研究证据。[S5] |
| 原生 Hook | common `session_id`，PreToolUse有 `tool_use_id`；子agent有agent字段 | 需按当前会话/调用核对，不靠 transcript 最后一条，因为官方说明落盘可滞后。[S6] |
| `CLAUDE_ENV_FILE` | SessionStart等指定Hook可写后续Bash环境；可用于有明确归属的集成标记 | PowerShell v2.1.296后仅识别受限简单赋值；Windows路径值、复杂脚本、sandboxed PowerShell有明确限制；PowerShell Hook本身拿不到此变量。因此不能把通用export方案当三平台全shell已支持。[S6] |

当前 crosschat 的 `resolveCallerIdentity` 用原生 socket 精确匹配唯一登记会话，已经比仅靠名称／历史可靠。可在后续完善原生 session ID、PID＋创建时间和登记 socket 的一致性重核；这属于候选实施方案，不是本研究已交付功能。[R3]

## 用户确认一次后的持续绑定（候选方案，未批准实施）

用户确认应是给**当前可观测的原生实例**补充类型标签，而不是把“这个 ID 永远属于 Desktop”存成事实。可设计以下最低合同：

1. 程序先采集 Provider、当前 native thread/root-session、执行实例指纹（PID＋创建时间、可执行来源/版本），以及现有受控连接或owner证据。能自动核实就不询问用户。
2. 无法区分入口但能稳定绑定当前实例时，用户确认 `cli`／`desktop`，记录 `user-confirmed` 来源；不要伪称原生已证明。若连实例都无法绑定，单次口头回答不能形成持续可信身份，只能保持待核实。
3. **每次 send** 重新读取本次 native thread／tool-call 上下文与当前实例；存在可用 Hook登记时核对当前 session/turn/tool-use，存在原生socket时核对唯一登记。不得因模型还记得上轮答案而跳过。
4. 正常同实例的新调用保留已确认类型，但调用ID应按本次更新；会话切换必须检查原生新ID，不能把旧会话绑定复制过去。子agent要核对实际 thread与root/agent字段，不把root session覆盖实际子thread。
5. 进程退出／创建时间改变、owner或连接代际更替、配置/二进制版本变更、原生会话切换而缺可靠事件、Hook中断/登记过期、来源相互矛盾、跨node或远端执行上下文变化时使绑定失效。允许有界只读重探测；不能为了维持“自动”而静默套旧类型。
6. 短暂不可读保留“暂不可核实”，不把已确认标签改成永久“不支持”。在原生证据恢复后可自动重新核对并恢复可用性；无法重新锚定实例时再请求用户确认。不能因失效而补发上次结果不明的消息。

这个方案能减少反复询问，但**用户标签＋没有可重复观测锚点**无法满足“后续由程序核验”，不能承诺无条件写一次永久生效。是否要求每个Provider都达到同样身份强度，及未知状态如何对用户呈现，仍属后续产品决策。

## 最小受控验证步骤

以下是后续开发／CI需要的探针，不在本研究执行：

1. 在隔离profile中分别运行正式Codex CLI／Desktop，loopback脚本模型要求原生普通shell只输出身份键存在性／脱敏指纹；至少跨两轮，比较thread/root-session稳定性、call-ID变化及缺字段行为。保留工具版本与owner。
2. 安装经用户同意的最小官方PreToolUse／PostToolUse观察Hook，只登记session/turn/tool-use及执行实例指纹；核对本次shell `CODEX_TOOL_CALL_ID` 与Hook精确一致。覆盖统一exec的持续进程和`write_stdin`，不能假定每次poll都会产生新shell。
3. wrapper桥记录自己真正成功的选择与turn，验证同daemon两窗口A/B、同ID两通道、resume picker、nested CLI、失败binding继续原生命令时不错误继承受控标记。确保Hook/事件中断时拒绝旧调用关联。
4. Desktop将实际shell调用与原生IPC owner关联；关闭/重开、owner更替及同ID CLI catalog同时存在时不能误归属。若原生接口不给关联，明确此能力缺口，不通过修改安装包/聊天数据库补造。
5. 用户确认一次后跨多轮自动重核；模拟PID重用（测试fixture）、进程重启、版本/路径变更、会话切换、Hook失效恢复、远端执行，证明旧绑定失效且未知写入零重发。
6. Claude在官方所述版本范围分别验证Bash／PowerShell的原生ID、PID、socket归属，`/clear`／resume／子agent，以及CLAUDE_ENV_FILE不适用路径。各平台逐格留证；本机Windows观察不能替代Linux/macOS。

## 来源索引

- **S1**：Codex 0.163.0固定源码：[shell环境字段及注入](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/protocol/src/shell_environment.rs#L6)、[调用ID清理及写入](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/protocol/src/shell_environment.rs#L30)、[root-session/version注入](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/exec_env.rs#L40)、[统一exec的thread/call/session注入](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/unified_exec/process_manager.rs#L1469)、[独立SessionId类型](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/protocol/src/session_id.rs#L13)。
- **S2**：[OpenAI官方Hooks文档](https://developers.openai.com/codex/hooks/)，实际读取；[固定PreToolUse输入schema](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/hooks/schema/generated/pre-tool-use.command.input.schema.json#L13)、[请求结构](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/hooks/src/events/pre_tool_use.rs#L24)、[SessionStart生命周期source](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/hooks/src/events/session_start.rs#L25)、[原生command Hook执行](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/hooks/src/engine/command_runner.rs#L210)。
- **S3**：[OpenAI官方App Server文档](https://developers.openai.com/codex/app-server/)，实际读取；[命令项字段](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L290)、[item/started字段](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1343)、[连接client上下文](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server/src/message_processor.rs#L188)、[TUI客户端／session source](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/tui/src/lib.rs#L724)。
- **S4**：[OpenAI官方Environment Variables](https://developers.openai.com/codex/config-file/environment-variables/)、[Config Reference](https://developers.openai.com/codex/config-reference/)，均实际读取；本文没有把页面未说明的源码字段称为公开长期稳定配置。
- **S5**：[Claude Code官方Environment Variables](https://code.claude.com/docs/en/env-vars)，实际读取，含CLAUDE_CODE_SESSION_ID、CLAUDE_PID、原生messaging socket/token、CLAUDE_ENV_FILE及各自版本边界。Claude实现不是在本研究读取的开源源码，因此不编造固定实现commit。
- **S6**：[Claude Code官方Hooks](https://code.claude.com/docs/en/hooks)，实际读取，含common input、SessionStart、持久环境变量及PowerShell限制。
- **S7**：[Microsoft Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)，实际读取，ParentProcessId条目明确说明PID重用及CreationDate校验。
- **S8**：[Linux kernel proc文档](https://www.kernel.org/doc/html/latest/filesystems/proc.html)，实际读取，含ppid/start_time/exe及proc访问语义。
- **S9**：Apple官方xnu固定源码：[proc_bsdinfo父PID/启动时间](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/proc_info.h#L58)、[proc_pidinfo](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/libproc/libproc.c#L101)、[proc_pidpath](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/libsyscall/wrappers/libproc/libproc.c#L264)。
- **E1/E2/E3**：上述三份root采集的当前Windows Desktop脱敏JSON；均为只读采样，范围以各文件limits/scope为准。
- **R1**：本仓库[Codex wrapper](../../src/commands/codex-wrapper.ts)、[窗口WS桥](../../src/codex/session-events.ts)、[既有真实选择验收](../development/session-selection-membership-validation-20261026.md)。
- **R2**：本仓库[Desktop IPC](../../src/codex/desktop-ipc.ts)。
- **R3**：本仓库[当前caller identity](../../src/identity.ts)。
- **R4**：本仓库[原生三方回信证据](../development/three-way-roundtrip-validation-20261022.md)，metadata继承误标的实际反例。

## 本研究写入与清理归属

只新增本报告；未修改产品代码、其它文档、用户配置、原生工具或外部服务。没有安装／启动测试软件、读取凭据、触发GitHub写操作或连接用户原生会话。root另行采集的当前正常工具调用证据已独立注明来源。

公开源码／文档缓存唯一根：`D:\workspace\CC\multichat\node_modules\.cache\crosschat-c14-caller-research-20261028\codex-claude-b645a6`。`ownership.json` 记owner `/root/grill_endpoint_facts`、任务和“未安装原生工具”；全部为公开文本，无配置/钥匙/二进制。研究结论及固定链接在本报告，root核对后可统一清理该独占缓存，无需保留下载内容作为安装物。

root已核对绝对路径、ownership、44文件/10,717,263字节及无reparse/link。删除该独占缓存被自动审批复核以 `blocked by policy` 拒绝，未执行删除，不改用其他机制重试。缓存暂留供用户统一清理；没有安装物需要卸载，研究报告与必要脱敏证据保留。
