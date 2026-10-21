# crosschat TUI 能力范围研究（2026-10-21）

状态：源码研究，供重新界定 TUI 需求；不是实施票，不代表用户已批准功能或实现。**覆盖命令入口、会话发现、status、doctor、消息与文件发送、SSH/TCP、星成员、原生启动器及维护命令。** 核对代码基线为 `dfd2362`。仅阅读仓库源码、测试及项目文档，没有访问真实钥匙或会话消息正文，没有运行实际探测或管理命令；产品代码未改动。

## 结论

现有 crosschat 能支持完整的跨会话通信终端工作台，broker 管理应是其中的 TCP 子模块。本机会话浏览、远机会话查询、星成员与原生发现对照、投递对话账本、环境诊断、文件与维护都已有核心能力。底层也有消息发送，但“源码存在 send”不等于“用户要求在 TUI 聊天”。SSH 远机查询需要 TUI 新增固定命令适配；doctor 的交互化需要提取结构化检查结果。

用户本轮纠正的是产品范围：TUI 应覆盖 crosschat 全产品，不应只服务 broker 主或星管理员。普通用户即使没有 broker 或 adminKey，也应能使用本机会话发现、状态、诊断和具备凭证的通信功能。具体页面、首版优先级仍待设计对齐。

**用户随后明确的边界（2026-10-21）**：TUI 不能代表原生 Claude Code 或 Codex 聊天。它负责发现、观察、诊断和管理；原生会话拥有发言身份、消息往复和聊天上下文。TUI 不能仅通过选中会话就冒用其身份，也不承接原生聊天前端。前一版“发送面板”的建议不再列为已定 TUI 需求；独立 human 单向投递是否需要单独入口，尚未决定。

## 完整能力地图

| 功能区 | 可呈现/执行的范围 | 现有接缝与新增工作 |
|---|---|---|
| 总览/status | 本机工具与会话计数、TCP 多星与守护、SSH 对话摘要、滞留提示 | 现有聚合逻辑；应接只读数据源，不自动循环执行 CLI status |
| 会话发现 | 本机 Claude/Codex；TCP 远机会话；SSH 远机会话；工具/目录/状态等筛选、原生占用信号、星籍差异 | 本机与 TCP 已有；SSH 固定命令执行适配需补；真正全量 Codex 分页需扩查询层 |
| 对话/投递 | 通信双方、方向、轮次、续话柄、delivered/queued/parked/failed、回执、发件箱与看门狗 | 已有台账与库函数；不是聊天正文，也不是任务完成证明 |
| 消息寻址与指引 | 展示、复制目标地址和现有发送/续话命令，供回到原生会话使用 | runSend 是已存在的底层能力；不据此批准聊天或代理发言面板；human 单向入口另议 |
| SSH | 选择已配置对端、版本/会话/doctor 查询、寻址、部署和回程核验指引 | SSH send 已实现但实际消息往复保留在原生会话；主机列表与固定查询适配需补 |
| TCP/星群 | broker 与本机节点守护起停、选星连接、星/节点/钥匙管理、星册与在线机器、adopt/删册 | 已有 serve、registry、管理插座与 WS；沿用三层权限与本机作用域 |
| 诊断 | 本机环境、工具/daemon、skill、身份残留、TCP 配置/连通性、守护版本/PID、滞留；SSH 远程望诊 | 已有 doctor；结构化检查项/可操作修复需另外整理；TCP 没有远程 doctor op |
| 原生会话入口 | 调用 crosschat claude/codex，选入星、永久/临时、接任、原生 resume 参数 | 已有启动包装器；TUI 需处理终端交接，保持原生生命周期边界 |
| 文件/维护 | TCP 发文件/续传/去重、收件和残片展示、清理、skill 安装更新、数据卸载与帮助 | 底层已实现；细粒度进度、清理预览、单项操作需补 UI/内部接口，不是都已有 CLI |

代码依据在下文各节；这是一份最大可实现范围的能力盘点，不是要求一次实现全部功能。

## 一、会话发现：本机、SSH、TCP 各是什么

| 范围 | 现成能力与事实边界 | 源码/文档依据 |
|---|---|---|
| 本机 Claude | 扫 `~/.claude/sessions/*.json`，仅接受 `interactive` / `bg`，要求有 messaging socket 字段且 PID 存活；返回 sessionId、pid、kind、name、status、cwd、updatedAt/startedAt。坏条目跳过并计数。不是任意进程扫描，也不是所有 Claude 历史会话。 | `src/claude/registry.ts:8`、`:10`、`:34`、`:63`、`:84` |
| 本机 Codex | 新建临时 app-server proxy 会话，initialize + thread/list 后关闭；不 resume、不启动轮次。列出结果追加 rollout 首行中的 cwd/originator/创建时间。 | `src/codex/discovery.ts:11`、`:17`、`:33`；`src/codex/rollout-meta.ts:26`、`:64`、`:117` |
| Codex 发现上限 | **当前只请求最近 20 条未归档线程，无分页**：`archived:false, limit:20, sortKey:'recency_at', sourceKinds:['cli','vscode','exec'], useStateDbOnly:true`。可能包含 `not_loaded`，因此不能称“所有活进程”或“全部历史”。 | `src/codex/client.ts:105`—`:129`；来源集合有测试 `test/codex-deliver.test.ts:459` |
| Codex 状态 | `not_loaded / idle / busy / waiting_approval / system_error`；等待用户输入与等待审批合并为 `waiting_approval`。TUI 必须把“发现到”“正在执行”“有人开窗”分开显示。 | `src/codex/client.ts:13`、`:64` |
| SSH 远机 | 官方办法是 `ssh <alias> crosschat status`，远端运行自己的发现逻辑，过滤同本机；可加 `--json` 取结构化结果。**`crosschat status --via ssh:<alias>` 明确被拒绝**，没有现成 status SSH 库调用链。TUI 可新增固定命令适配，不应标为既有内建 op。 | `docs-book/src/reference/ssh-commands.md:55`—`:61`；`src/cli.ts:316`—`:317` |
| TCP 远机 | `status --via tcp:<machine>`，多星时可 `tcp:<star>:<machine>`，经 broker 转发 status-query，让目标机扫描返回。`runViaTcpStatus()` 直接返回 `{target,payload}`。远机离线/未知机器/旧端不应答有错误区分。 | `src/serve/via-tcp.ts:641`—`:683`；`test/status-remote.test.ts:347`—`:360` |
| TCP 查询范围 | 载荷仅 Claude/Codex 会话列表和 Codex unavailable；不包含远机 writer locks、转发器状态、doctor 结果或远端对话账本。Claude 行也没有 sessionId，仅 pid；Codex id 已截成 id8。 | `src/serve/protocol.ts:229`—`:265`；`src/serve/node.ts:260`—`:294`；`src/commands/status.ts:674`—`:678` |

本机原始发现函数保留完整 ID；CLI status JSON 不完全保留：Claude 只输出 name/kind/status/pid/cwd，Codex 输出 id8 与元数据。若 TUI 要稳定选中、跨视图联动，应优先直接调用发现函数，不从人类格式反解析，也不能假设 JSON 包含全部身份。依据：`src/commands/status.ts:483`—`:517`。

## 二、默认名单、未命名、TUI 占用与筛选

- 裸 `status` 为三段摘要：本机计数、最近五个命名会话；TCP 星及机器；最近五段 SSH **已有对话**。SSH 摘要不是 SSH 配置主机清单，也不证明那些主机此刻在线。Codex 摘要排序时间实际取创建时间，不能统一标为“最近活跃时间”。依据：`src/commands/status.ts:574`—`:620`。
- 文本默认隐藏未命名；`--all` 只恢复未命名，**不会扩大 Codex 20 条源列表，不会纳入 Claude 死 PID**。JSON 默认已含未命名，`--all` 不改变 JSON。按工具选段 `--claude/--codex`；`--name` 为显示名大小写不敏感子串匹配，非 cwd/id 搜索。依据：`src/commands/status.ts:404`—`:424`、`:465`—`:525`；`test/status-filters.test.ts:301`—`:319`。
- 本机 `listWriterLocks()` 读取 `CODEX_HOME/thread-writer-locks/<threadId>.lock`，排除 coordination；status 追加 `held:true` / “TUI占用”，对有锁但未入 thread/list 的空新页补 `not_listed` 行。文本补行随 `--all` 展开；TCP 远端载荷没有该信号。**这里的 TUI 指 Codex 原生终端写者，不是待开发的 crosschat 管理 TUI。** 依据：`src/codex/rollout-meta.ts:142`—`:164`；`src/commands/status.ts:504`—`:526`、`:553`—`:559`、`:674`。
- 源码 writer-lock 读取只看文件存在，不进一步验进程/mtime；因此应标为占用信号，不能升级成绝对活性保证。既有研究也记录异常退出残留尚未验证。依据：`src/codex/rollout-meta.ts:150`—`:164`；`docs/research/codex-tui-occupancy-signals.md:28`。
- `--stars` 是独立视图，CLI 只允许再组合 `--json`；`--conversations` 不接受工具选段，裸 `--via ssh|tcp` 只过滤对话传输族。TUI 可在内存中做更自由的工具/名字/目录/状态组合筛选，但需将其说明为新增 UI 能力。依据：`src/cli.ts:273`—`:339`。

## 三、成员册与原生发现必须保留两种视图

| 数据 | 解决的问题 | 无法代替另一方的原因 |
|---|---|---|
| 原生发现 | “这台机器当前有哪些可被工具识别、路由的会话？” | Claude 活 PID 与 Codex 未归档线程含裸起、不在星册者；Codex 未加载状态也不是在线进程证明。 |
| 星成员册/roster | “谁属于这颗星、现在在线还是下线、从谁接任？” | 会话退出后册位保留，可存在 offlineSessions；不是对端机器全部会话扫描。 |

依据：`src/claude/registry.ts:59`—`:88`；`src/codex/client.ts:110`—`:128`；`src/serve/protocol.ts:208`—`:223`、`:270`；`src/serve/broker.ts:1566`—`:1602`。

现成 roster 机器字段为 name/mid8/online，附 `sessions`、`offlineSessions`；会话声明含 sessionId、name、tool、extends。只显示注册过机器指纹的机器；未激活钥匙不是 roster 机器。TUI 应在“节点凭证管理”另列未使用钥匙，不能把它们补成离线机器。依据：`src/serve/broker.ts:1574`—`:1601`。

已有文本提示可利用：远机原生行对照其星册后标 `非册(裸起)`；本机 --stars 在本机守护在线时可给 `--adopt` 建议。JSON 远程视图为保持契约**没有**非册标记，TUI 要自行连接两份结构数据。依据：`src/commands/status.ts:328`—`:336`、`:642`—`:703`。

## 四、对话与投递状态可成为独立页面

`conversationSummaries()` 已提供强类型数组：两端、完整 ref、更新时间、轮次、最后投递状态/方向、滞留数、回执确认、cN 续话柄。来源是本机对话分片、send-log 尾部约 200 行、outbox 数量，不需要读取消息正文。`status --conversations --via ssh|tcp --name ...` 提供过滤。它是**本机发送账本视角**，不是聊天内容浏览器，不是全网会话事实源；尾窗外轮次/状态可为空。依据：`src/conversation-summary.ts:6`—`:72`、`:89`—`:105`；`src/commands/status.ts:800`—`:838`；`docs-book/src/howto/status.md:68`—`:85`。

CLI 对话 JSON 还刻意省略 `endpoints` 与 `handle`，直接接 `ConversationSummary[]` 更适合 TUI。现成确认复查会读 rollout 检查 marker，若暂不需要，应不接 `confirmReceipt`，并不要为总览高频反复扫描。依据：`src/commands/status.ts:820`—`:823`、`:868`—`:883`；`src/cli.ts:519`—`:522`。

## 五、doctor 的覆盖、上下文、边界

现成检查按“环境 / tcp·星 / 其他”分组，仅 ❌ 令退出 1；⚠️ 保持合法状态提示。**它只诊断并打印修复指引，不执行修复、安装、重启、删文件或补投。** 依据：`src/commands/doctor.ts:131`—`:158`、`:401`—`:427`；CLI 入口 `src/cli.ts:654`—`:666`。

| 组 | 现有检查 | 源码 |
|---|---|---|
| 环境 | Node≥22；Claude CLI 可解析、可路由会话数、坏注册条目；Codex CLI 与 daemon 版本≥0.160；双侧技能整树与安装源差异；Claude/Codex 双身份环境残留。缺一侧工具或 daemon 未起通常为警告。 | `src/commands/doctor.ts:160`—`:244` |
| 按星网络 | node.json 可解析/钥字段；多条目缺 starId、重复 starId；逐 broker host:port TCP connect；broker.json stars/nodes 基本形状、零星待配、非默认端口提示。 | `src/commands/doctor.ts:246`—`:329` |
| 守护对账 | status-node*.json 与 broker 快照新鲜度（90秒）、PID 验活、常驻版本与本机 CLI 是否一致；陈旧、无 PID、PID 死亡降信息提示。 | `src/commands/doctor.ts:332`—`:397` |
| 其他 | 发件箱滞留条数/最老年龄、watchdog 是否运行、mailbox 路径。 | `src/commands/doctor.ts:401`—`:415` |

doctor 的“broker 可达”目前只是 **TCP 端口连上**，没有认证、WS op 正确性、双向送达、SSH 连接或远机运行环境的端到端验证。一次体检运行在执行机器上；SSH 望诊可运行 `ssh <peer> crosschat doctor`，TCP 协议没有远程 doctor op。依据：`src/commands/doctor.ts:98`—`:104`、`:290`—`:295`；`docs-book/src/reference/ssh-commands.md:59`—`:61`；`src/serve/protocol.ts:247`—`:265`。

## 六、TUI 调用接缝与探测副作用

| 接缝 | 现成返回 | 使用建议/限制 |
|---|---|---|
| `listClaudeSessions()` | `ClaudeRegistryScan` | 本地文件/PID 读取；保留完整 sessionId 与 malformed 计数。 |
| `listCodexThreads()` / `listWriterLocks()` | `CodexThreadWithMeta[]` / `Set<string>` | 每次枚举建立并关闭 proxy；现有默认最近20条。锁与列表合并由上层负责。 |
| `runViaTcpStatus()` | `Promise<{target,payload:StatusPayload}>` | 结构化远机扫描；需要普通 node key、连接目标 broker，非 adminKey 远程管理 API。 |
| `fetchRosterFor()` | `Promise<RosterMachine[] \| undefined>` | 瞬态 sender 连接，默认2秒，失败返回 undefined；不能将 unknown 显示成0台在线。 |
| `conversationSummaries()` | `ConversationSummary[]` | 本机元数据汇总，含 JSON 不暴露的端点和续话柄。 |
| `runStatus()` | `Promise<string>` | 返回文本或 JSON 字符串，无导出的完整视图对象；可复用但直接使用源数据更稳。 |
| `runDoctor()` | `{output:string,failed:boolean}` | CLI 无参数，也不支持 `--json`；若要逐项状态、按钮、过滤，应提取机器可读 checkId/severity/context/remediation，而非解析中文/emoji。 |

依据：`src/commands/status.ts:22`—`:67`、`:427`—`:434`；`src/commands/doctor.ts:23`—`:64`；`src/serve/via-tcp.ts:522`—`:548`、`:646`—`:660`；`src/conversation-summary.ts:22`—`:67`；`src/cli.ts:659`—`:666`。

副作用需要明确：

1. **不要把 CLI status 当零副作用轮询黑盒。** `src/cli.ts:645`—`:647` 会在 status 前 `drainAtEntry()`，自动补投本机 outbox；即使 `--json` 也相同，SSH 包装远机 status 同样承袭远端行为。直接发现/roster 源读取不经过该入口。
2. Codex 发现不修改线程，但会创建并结束自己的 proxy 进程/连接；rollout 元数据只读首行，不读取消息轮次。依据：`src/codex/discovery.ts:12`—`:49`；`src/codex/rollout-meta.ts:26`—`:56`。
3. 网络发现不是纯静态读取：roster/status-query 建连认证，远机执行扫描、节点记查询日志，超时/认证失败需作为读取结果展示。依据：`src/serve/via-tcp.ts:522`—`:542`、`:654`—`:676`；`src/serve/node.ts:722`—`:731`。
4. doctor 不自动修复，但运行 Codex 版本子进程、PID 检查与每个 broker 的 socket connect；默认检查同步，TUI 不宜阻塞渲染或每5秒完整重跑。依据：`src/commands/doctor.ts:69`—`:108`、`:190`—`:209`、`:290`—`:295`。

## 七、就本研究部分建议的产品范围

- **直接能做**：本机身份与会话浏览、工具/名称/未命名/状态筛选、原生 Codex 占用提示、TCP 机器与会话浏览、星册在线/下线与非册差异、对话投递台账与滞留摘要、doctor 手动体检及修复命令查看。
- **薄适配即可做**：SSH 已知别名选择与固定命令的版本/会话/doctor 查询；统一“本机 / SSH 机器 / TCP 星与机器”上下文；多源结果分阶段加载、标记最后更新时间和未知状态。此处是建议新增 UI/适配，不是已经存在的产品接口。
- **需单列需求/工程改造**：Codex 真正全量分页与归档视图；SSH 主机清单完整解析与可达性管理；结构化 doctor；TCP 远机 doctor/占用/完整 ID 扩展；一键执行修复。不能在首版设计中默认承诺。

这些结论只界定现有能力与实现成本，不代替用户决定最终页面与首版优先级。

## 八、底层发送能力与原生聊天边界

- 现有 `runSend()` 支持按名称/ID 选目标、按 ref/cN 续话、正文/stdin、单机与 SSH/TCP 路由、正文上限和软轮次预算、JSON 回执。这是底层能力盘点，不是已批准的 TUI 发送页面。按用户最新边界，TUI 可提供寻址与命令指引，实际原生会话往复留在 Claude Code/Codex；独立 human 单向入口仍待明确需求。依据：`src/commands/send.ts:52`—`:73`、`:223`、`:275`—`:294`；`src/cli.ts:46`—`:82`。
- **独立终端的 human 是现成身份，能发不能收。** `resolveCallerIdentity()` 从环境识别 Claude/Codex，缺身份变量时返回 human；对端尝试回到 human 会报 `CANNOT_REPLY_TO_HUMAN`。如果 TUI 继承某个 agent 的环境，则发送属于该 agent，必须明确显示实际身份；不能仅凭选中一个会话就代其发送。依据：`src/identity.ts:6`—`:16`、`:75`—`:107`；`src/commands/send.ts:316`—`:345`；`docs/usage.md:9`—`:15`；测试 `test/send-command.test.ts:271`。
- 对话列表可以查其他端点对，但续话时实际 caller 必须是两端之一，不能把任意台账行做成无条件“回复”按钮。依据：`src/commands/send.ts:329`—`:344`。
- `delivered` 证明投递机制接受，`queued` 是对端服务端队列，`parked` 是本机/相应接收腿的异常态发件箱；都不能表示 agent 已理解消息或任务完成。`queued` 不应由 TUI 自造“完成”状态，超时不明也不能自动重发。依据：`src/commands/send.ts:506`—`:564`；`src/send-log.ts:21`—`:43`；`docs/usage.md:31`—`:43`。
- 双向人机聊天、所有 agent 原生对话正文的统一浏览、跨设备完整收件流，均不属于现有发送台账。send-log 只记元数据，mailbox 只镜像异常态滞留；若需要这些产品能力，必须先设计接收端点和数据源，不能由界面补画出来。依据：`src/send-log.ts:6`—`:14`；`src/identity.ts:6`—`:16`；`src/outbox.ts:86`—`:105`。

## 九、SSH 应是独立能力区，而不是 TCP 的附属

现有 SSH 发送以 Host 别名为目标，固定执行远端 `crosschat send --json --origin ...`，正文走 stdin；使用 BatchMode 和连接超时，不新增常驻 crosschat 服务。`--via ssh` 是发送传输，不是任意远程管理命令的统一代理。依据：`src/federation.ts:159`—`:179`、`:181`—`:205`、`:217`；`docs/federation.md:437`—`:460`。

TUI 可组合以下能力，但应准确区分现成命令和新适配：

1. 选择已配置 SSH 对端，并执行版本自证、会话查询、doctor 望诊；后三者的远端命令已有文档，统一主机列表、超时、错误及缓存需要 TUI 适配。现有 ssh 摘要只是历史对话，不是配置主机发现。依据：`docs-book/src/reference/ssh-commands.md:45`—`:61`；`src/commands/status.ts:605`—`:620`。
2. 为该机已发现的会话提供 SSH 寻址/命令指引，并观察已有投递结果。底层 SSH 发送不要求目标会话入 TCP 星；两种寻址不能混用。按用户最新边界，不将该底层能力解释为 TUI 可以代表原生会话发言。依据：`src/federation.ts:235`—`:259`；`docs/federation.md:389`—`:395`、`:466`—`:468`。
3. 显示配置/免密/known_hosts/PATH/回程核验指引。现有代码没有完整 SSH 配置 CRUD、主机扫描、自动配钥/启 sshd/管理反向隧道的 API；这些不能作为已完成底层能力。依据：`docs/federation.md:24`—`:326`（部署步骤由人执行）；`src/commands/send.ts:143`—`:155`（仅简单 Host 别名判断）。
4. 若 TUI 增加通过 SSH 执行远端 `crosschat serve ...` 的适配，命令在远端机器当地运行，可使用该 SSH 用户在 broker 机上的本机管理权限。这是基于现有本机 CLI 的组合能力推导，**不是**把 WS 星管理钥变为全能远程钥匙，也不是现成 `serve --via ssh:` 旗标。依据：`src/commands/serve.ts:138`、`:195`—`:285`；`docs/broker.md:184`—`:200`。

SSH 文件大内容的 scp 是当前教学旁路，未内建进 `crosschat send --file`；若要 TUI 一键 scp，应作为额外执行适配，不能混称已实现的 crosschat 文件传输。依据：`docs-book/src/reference/ssh-commands.md:63`—`:74`；`src/commands/send.ts:277`—`:294`。

## 十、TCP 管理应同时覆盖普通节点和 broker

- 本机可起 broker、选星启动节点客户端/聚合器、后台运行、按 broker/node/星选择器停止；应显示当前角色、端口、连接状态、重连等待、日志和常驻版本，普通节点用户不需要拥有 broker.json 才能使用 TUI。依据：`src/commands/serve.ts:288`—`:350`、`:1084`、`:1393`；`src/commands/status.ts:104`—`:145`。
- broker 子模块保留原设计的加删星、改星名、节点钥匙发放/撤销、星管理钥发放/吊销、show-name 默认/按星覆盖及管理审计。哪些操作首版做由用户定，但这些都是现有底层能力，不应因为最初交接较窄就从总范围永久排除。读文件与管理插座/WS 的既有差异仍成立。依据：`src/commands/serve.ts:229`—`:285`；`src/serve/broker.ts:392`—`:509`。
- 会话侧已有 `adopt`：按名发现本机现存会话并入星，可补 extends；不会新建进程。`member-remove` 删除星册位，星内机器可发请求。adopt 与删册不是同一权限/作用域：adopt 依赖本机发现，不能直接从控制机用现有 WS 把任意远机会话收编；通过 SSH 到目标机执行本机命令是另一种可组合方式。依据：`src/commands/session-star.ts:583`—`:641`；`src/commands/serve.ts:1197`—`:1213`；`src/serve/via-tcp.ts:556`。
- 永久成员退出下线并保留册位；临时成员退出离册；extends 是名字接任；这些应在成员视图与启动表单说明。修改星册不等于终止 agent 进程。依据：`src/commands/session-star.ts:30`—`:90`；`README.md:141`—`:174`。
- 三层权限是 TCP 管理域的规则；本机发现、SSH 同用户命令、诊断、工具维护各有自己的执行上下文。不能用“未持管理钥”禁用整个产品。依据：`src/serve/broker.ts:214`—`:224`；`src/identity.ts:75`；`src/commands/doctor.ts:131`。

## 十一、原生启动器：可作为入口，不能复制会话生命周期

已有 `crosschat claude` 与 `crosschat codex` 包装器调用真实 CLI；可带原生参数、正文上限、轮次预算、选择一个或多个星、永久/临时成员、旧名接任。Codex 原生 resume 参数透传；Claude 侧接收许可由包装器注入。依据：`src/commands/claude-wrapper.ts:66`—`:132`；`src/commands/codex-wrapper.ts:48`—`:106`；`src/commands/session-star.ts:48`—`:90`；`docs/commands.md:62`—`:76`。

因此 TUI 能提供启动参数表单或调用入口。当前包装器 `stdio:'inherit'`，需要 TUI 暂停/释放终端后交给原生 CLI，退出后恢复；多个原生终端同时嵌入、会话新建/重命名/删除服务、跨设备终端控制，不是现成接口。项目已有约束明确生命周期归原生，不能把“调用现有启动器”变为另造会话注册表或守护。依据：`src/commands/claude-wrapper.ts:54`—`:63`；`src/commands/codex-wrapper.ts:35`—`:43`；`docs/wayfinder/map.md:30`、`:88`。

## 十二、文件、安装与维护的范围

| 能力 | 已实现边界 | TUI 需处理的接缝 |
|---|---|---|
| TCP 发文件 | 单文件64MiB，256KiB分块，SHA校验、去重、断点续传；返回远端落地路径；超1MiB正文可自动转文件 | 路径/目标选择与结果可直接接；当前 sendFile 是内部函数，没有进度回调，精确进度/取消需增加内部接口，不能伪造百分比。依据 `src/serve/via-tcp.ts:313`—`:350`、`:363`—`:409`；`src/serve/file-channel.ts:23`—`:29`、`:60`—`:132` |
| 收件与断点 | 现有 inbox/parts 文件；5天保留、512MiB总量回收规则 | 可读取目录做数量/容量/条目展示；并非已有远程列目录或单项删除 op。依据 `src/serve/file-channel.ts:25`—`:29`、`:166`；`src/commands/clean.ts:33`—`:63` |
| 清理 | clean 默认回收过期文件和30天未更新的对话分片；force 全清相应文件和分片 | 现有命令没有 dry-run，若先做预览需提取同一清理计划逻辑；不能把执行 clean 当预览。依据 `src/commands/clean.ts:63`—`:141` |
| 技能安装/更新 | 幂等复制包内技能整树到 Claude/Codex 两侧，支持目标根目录 | 可提供显式执行入口，结果与 doctor 联动；不是安装 CLI 本体或包管理器升级。依据 `src/commands/install-skills.ts:34`—`:48` |
| 数据卸载 | serve 在跑时拒绝；显示范围并确认，清配置/状态/技能，最后提示 npm 卸载收尾 | 可放高级维护，但不能声称一键卸载已完成 npm 包删除。依据 `src/commands/uninstall.ts:59`—文件结尾 |
| 日志/帮助 | send-log元数据、broker/node/launcher日志、版本、usage、错误码教学均已存在 | 日志滚动可文件增量读取；全网统一日志和实时事件订阅目前不存在。依据 `src/send-log.ts:17`—`:43`；`src/cli.ts:36`—`:248`；`src/commands/session-star.ts:127`—`:145` |

本轮只盘点上述能力，没有执行清理、安装、卸载、发文件、发消息或起停任何服务。

## 十三、设计应如何重新定位（建议，未批准）

建议产品定位改为“crosschat 跨会话通信工作台”，普通使用者在没有 broker 的环境下也能工作。候选导航为：

```text
概览
会话       本机 / SSH远机 / TCP远机；发现、筛选、详情、地址/命令指引、入星入口
对话与投递 通信账本、续话柄展示、回执、滞留与看门狗
连接       SSH对端 / TCP连接；broker管理位于TCP子模块
诊断       本机体检 / SSH远程望诊；修复指引
文件与维护 TCP文件、收件/残片、清理、skill、版本帮助
```

成员操作、服务起停和维护可进入管理设计；每个动作必须绑定明确机器/星/调用方身份，使用现有命令语义，不把各通道权限混为一层。原生会话的聊天、发言身份和上下文继续由 Claude Code/Codex 承担，TUI 不因有 send 库函数就接管它们。

此前 broker 设计稿仍可用作 TCP/broker 子模块的素材，**不再能作为整个 TUI 的完整需求规格**。此前关于“普通成员只读是否额外加入”的问法也需修正：在全产品 TUI 中，普通用户的会话浏览、status/doctor 和现有成员可读能力本来就应被覆盖；是否增加独立的远程管理登录模式，是更小的交互决策。

需要另立明确需求而不能默认为现成的能力：human双向收件/聊天、统一原生消息历史、Codex全量/归档分页、SSH配置/配钥/隧道自动运维、TCP远程doctor及缺失身份字段、结构化诊断与一键修复、事件订阅。非 Claude/Codex 适配器及 TLS 在项目路线图中另有挂账，不能靠做 TUI 自动获得。依据：`src/identity.ts:6`、`src/codex/client.ts:110`—`:117`、`src/commands/doctor.ts:60`、`docs/wayfinder/map.md:52`、`:60`、`:81`。

## 十四、布局参考更新：k9s（2026-10-21）

用户建议参考 k9s。核对其[官方资源界面](https://k9scli.io/assets/screens/pods.png)与[交互文档](https://k9scli.io/topics/commands/)后，v3 设计改为紧凑上下文头部、当前资源快捷键、中央全宽表格、底部浏览路径，以及冒号页面选择和斜杠筛选。跨会话范围与原生聊天边界不变。

这属于待过目的布局建议，不是已经实现或完整批准的规格：主入口建议本机会话列表，概览保留为独立资源；SSH/TCP用上下文选择器进入，再沿机器、会话、成员等资源下钻。冒号输入只导航和调用已注册TUI操作，不执行聊天或任意shell。

仓库外产物：`C:/Users/yangsheng/.codex/visualizations/2026/10/21/01a15d5d-6d04-7b11-9ccb-39611d84b68b/crosschat-tui-k9s-layout-v3.txt`；同目录两张 `crosschat-tui-v3-*.png` 是代码绘制的设计预览，数据均为示例，不是运行中的应用截图。

## 十五、入口修订：连续资源工作区 v4（2026-10-21）

用户指出 v3 的入口分割感仍过强，并强调像输入 Pod 一样输入资源名切换列表。v4 将资源名输入作为主导航：按冒号输入 `sessions`、`ssh`、`stars`、`doctor` 等名称，显示补全/匹配，确认后原位替换表格；Esc 回原视图。单复数和简称为已登记路由的别名，不是任意 shell。

视觉上取消正文外框、头部分栏、独立大标题和彩色路径块，改为一行连接/身份、就地资源输入、连续全宽内容和轻量底部提示。原生聊天边界、接口限制及管理确认不变；这是针对本轮反馈的设计稿，未开始产品实现。

最新仓库外稿为同目录 `crosschat-tui-continuous-layout-v4.txt`；`crosschat-tui-v4-sessions.png`、`crosschat-tui-v4-resource-input.png`、`crosschat-tui-v4-ssh.png` 分别展示浏览、输入和切换结果。

## 十六、用户新增要求与完整评审册 v5（2026-10-21）

用户要求增加命令补全、查看所有会话（含匿名）的选项、为OpenCode等工具预留可扩展代码设计，并完整展示本机到SSH再到TCP的界面。

- 补全、别名、说明、帮助共用资源登记；上下文参数也补全。
- 会话默认包含匿名，工具筛选动态生成；匿名不在采集层丢弃。查看“所有”不能继续只取Codex最近20条：实现须补齐分页和完整性信息。旧远端或未完成查询显示部分结果，不能伪装取全。
- TUI采用统一会话模型和能力驱动动作；Provider Adapter与本机/SSH/TCP Context Adapter分离。Claude/Codex只是初始适配器，第三种Provider不应要求改通用页面。
- 当前核心身份及远端StatusPayload仍硬编码两种工具（`src/identity.ts:13`、`:30`；`src/serve/protocol.ts:252`），须在兼容适配处隔离，未来真实接入还需核心发现/身份/协议配合；`SessionMemberDecl.tool`已为string。不会将“预留OpenCode”说成“已支持OpenCode”。

完整静态评审册为同目录 `crosschat-tui-v5-review.html`，共39屏，依次为共享入口、本机、SSH、TCP；`crosschat-tui-v5-requirements.txt`记录需求、扩展Interface、已有协议限制和验收契约。补齐服务停止确认、SSH指引、TCP凭证、加星/改名/发钥结果/删节点等操作页。图片均是代码绘制的示例，不是已运行TUI。产品代码仍未实施。

## 十七、资源列表操作与人性化 TCP v6（2026-10-21）

用户进一步要求：命令提示同时筛选下方资源；状态中文加原值；各列限长，详情看全；默认入口改ctx；列全各资源按键；增删改从对应资源列表发起，详情只读；星默认节点视图，可切全星会话并显示所属节点，Enter下钻节点会话。用户特别强调TCP的目标是简化操作。

v6据此调整：

- 默认ctx列表，本机/SSH进入会话，TCP星进入节点；开屏不批量探测远机。统一输入保留当前表格，命令候选占两行，匹配资源同时实时筛选已加载数据；Tab选导航，Enter行为有提示，`/`可强制纯筛选。
- 原生状态例如`空闲<idle>`、`未加载<not_loaded>`；未知值保留原文，没采集到不伪造。每列硬性显示宽度，长值`…`，详情按字段换行/滚动/复制。
- 所有写操作弹层带所属资源列表和触发键；详情没有写快捷键。`a`新增/接入、`e`改名、`Ctrl+D`移除，按能力开放；执行后回原列表并以稳定ID保持选择。
- 星节点列表`v`切全星会话，显示节点名称/mid8；节点列表Enter和全星会话Enter均进入对应节点会话，`d`只读详情。默认聚合星册，`b`可切所有节点可发现会话；逐机限并发、部分结果和老端20条限制如实显示。
- “让新机器接入”从节点列表开始，自动选星、预填可达地址，生成配置及接收机命令后回列表等待上线；机器与未使用钥匙分表。权限不足解释该切哪个连接，TCP缺日志/任意远机改名能力时不给虚假成功路径。
- 界面机器节点资源为`machines`（别名`nodes`）；接入凭证为`keys`。旧CLI `--list-nodes`只在Adapter转换，避免把凭证与机器混为一个资源。

仓库外最新评审册为同目录 `crosschat-tui-v6-review.html`，49屏，每屏附完整按键；`crosschat-tui-v6-keys.txt`为资源/输入/详情/表单全部按键；`crosschat-tui-v6-requirements.txt`记录明确规则和验收。图片都是静态示例，没有实施TUI或执行管理动作。此前v5保留为历史稿。

用户随后明确：上述规则适用于全部资源，TCP仅为复杂场景示例。全局统一输入/筛选、状态翻译、列宽、只读详情、列表操作与弹层、完整按键及权限解释；本机、SSH、doctor、服务、文件、维护等同样按任务简化，自动带入目标和已有信息。只读资源维持只读，按真实能力开放操作。已将此全局约定与资源归属示例补入v6需求和评审册首页、统一规则区；产品代码仍未实施。

## 十八、实现位置、维护性与原功能变更授权（2026-10-21）

用户进入实现方案讨论，要求明确新项目还是复用当前项目、可扩展性/可维护性；授权发现原有代码问题时修复，但涉及功能变更必须等其同意。

核对当前`package.json`、`tsconfig.json`和CLI入口后，推荐沿用当前TypeScript/Node ESM单包，在`src/tui/`增加独立功能模块，以`crosschat tui`分支按需加载。继续同一构建、测试、安装与发布，不引入独立npm项目或monorepo。统一模型、Provider/Context Adapter、资源与操作登记、通用列表/输入/详情/弹层分开组织；公共业务能力按实际复用需要提取，保持CLI/TUI调用同一套行为。此为方案，尚未创建产品源码。

维护性以可验证行为约束：新增第三工具测试Adapter不改通用页面，按键/帮助/操作来源一致，匿名/分页/完整性与稳定选择不退化；普通CLI不加载交互UI。既有管理写者、热生效/冷落盘、权限策略必须复用，不能页面直接绕过broker写文件。依据：`src/cli.ts:593`、`src/commands/serve.ts:128`、`:133`、`:428`。

变更边界：可直接推进已明确的TUI需求和保持原功能契约的内部提取/修复；修改已有CLI默认行为、协议、权限、配置格式、清理规则等须先给具体方案等待同意。特别是TUI轮询需只读采集，不能悄悄取消CLI原有补投；TUI分页不顺带扩大旧调用方默认范围；doctor内部结构化不顺带加CLI参数或自动修复；远端新协议/字段/op要单独确认。将来真实OpenCode接入同样遵守此边界，不因UI预留就自动获得扩展原功能授权。

详细实施组织、验收和变更审批口径已记入仓库外`crosschat-tui-v6-requirements.txt`第十节。遇到需确认项时，先把证据、拟改行为、影响与兼容方案做成可审阅结果；等待用户决定该部分，其他不依赖工作继续。

## 十九、TUI前架构审查（2026-10-21）

用户要求先审查当前代码对TUI扩展/功能及未来OpenCode、zcode的准备度，再写TUI。已在`dfd2362`基线上完成独立核查和交叉复核，完整报告为`docs/research/pre-tui-architecture-audit-20261021.md`。

总体判断：现有协议、原生适配、依赖注入、原子写和测试基础可以保留；但核心仍是双工具模型，缺少结构化应用层，存在两组非类型导入环与命令输出反解析。建议先完成有限内部改造，不整体重写。Provider+nativeId身份、ref类型容量、远端载荷和对账活性是未来第三工具的重要改造面，不能仅在TUI层泛化。

本次真实执行`npm run check`：lint/build通过，49测试文件通过、3跳过；778项通过、11跳过。检查子进程移除CROSSCHAT_LIVE，未执行真实会话注入。静态导入图确认`send/node/via-tcp`、`serve/session-star`两组运行时导入环。

审查纠正此前设计的底层能力假设：`remove-node`只删除凭证，尚无主动关闭已认证连接的操作；`runServe`的nameArg分支不是独立纯改名服务，后续可进入broker启动。已在v6需求与评审册标明前者是待确认的目标功能，未擅改任何产品行为。远端完整发现、身份/ref/成员键迁移等需具体兼容方案并获用户同意；只读查询/结构化结果/管理接口的内部提取可先保留既有功能契约进行。

## 二十、活动任务排期与代码规范（2026-10-21）

用户要求列出任务排期，写/改代码同时优化规范，任务完成后删除。已建立`docs/wayfinder/tui-implementation-tasks.md`：14项实施任务、2项待确认任务，按架构/契约→依赖与模型→应用接口/外壳→本机→SSH/TCP→TCP管理→全链验收七批安排，批内按依赖并行。真实第三工具接入另行立项，本轮用第三测试Adapter验证扩展能力。

`docs/development/code-standards.md`作为本轮统一规范：CLI/业务/展示分离、Provider/Context/资源登记、纯读取与运行时解码、取消/资源owner、单写者/权限、显示与稳定选择、渐进lint/依赖门禁和有意义测试。规范优化随实际修改进行，不以整仓格式化、任意文件行数或固定覆盖率代替维护性。

新执行队列仅保留未完成事项：验收通过删除任务行、说明及活动引用，更新剩余依赖；最后删除清单及map入口。代码规范、设计、批准决定和必要验收证据保留。尚无实施任务完成，未开始产品实现；当前已验证任务ID/说明齐全、依赖无环。
