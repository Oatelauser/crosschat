# ZCode 接入决策检查点

2026-10-23，Asia/Shanghai。用户在完成 Harness npm/Web 开发后指示“开始下一个工作”，按原顺序开始智谱 / Z.ai ZCode。延续约束：单人维护、尽量少干预升级、真实工具配本机模型 mock、不使用真实 key、不改已有四工具行为。后续测试资料在用户指定 D盘总根下按工具隔离，正常测试软件卸载，总根最终由用户统一删除。

## 核查结论

研究时官网产品版本为 3.16.2，官方源码 main 固定 `3c5b227649371507ddc4eb46ac5133afe6db1cab`。内部 Agent/运行描述版本另有分层，不能用单个数字代替发行物。以下核查以源码与官方文档为主，另有用户原有 Desktop 3.15.3 的进程观测和用户提供的普通 Bash 诊断；尚无 crosschat 适配器端到端验收。

| 原目标 | 当前已核实事实 | 决策影响 |
| --- | --- | --- |
| 接入用户已打开的 Desktop 会话 | 手机远控通过授权 relay 和 Main 内部 MessagePort 附着已有 Host；未确认公开本机 attach 或与 Harness 等价的 Node Host 插件入口 | 不能用新建 app-server 或 Web 服务冒充已连接桌面会话 |
| Agent 普通 shell 自动带身份回信 | Bash trace 有 session ID，但未自动注入子进程 env；用户实际 3.15.3 会话普通 Bash 的五个身份变量均为 false；自定义命令/技能的 shell 扩展有 ID，并附带 Claude 别名 | 当前 Bash 路径不能靠这些变量直接识别当前 ZCode 会话，需另行设计和验证身份方式；不推断宿主没有 ID |
| 连接已有 Web/server | 有认证 `/ws`，使用自有二进制 RPC + V4；未确认可直接依赖的正式稳定外部 client SDK | 可研究受限 Web 原型，但要承担私有传输、订阅/分片、认证及生命周期维护 |
| 严格 queue/steer | 单消息 queue/guide 存在；ACK 对 queued 的报告有歧义，Highspeed 有 guide→queue fallback | 需观测实际消费并按能力明确拒绝，不能凭 ACK 宣称成功 steer |
| 仅发现/投递现有 live 主会话 | sessions-index 混合持久事实，Host send 的 getClient 可能启动 owner | live/cold 边界和禁止隐式恢复尚待实证 |
| 真实模型端无 key 验证 | 官方支持自定义 provider 地址，且有上游本地 mock 记录 | 该项可行；不解决现有桌面 attach 与身份缺口 |
| 隔离正式发行物 | Desktop 正式下载/摘要已确认，但安装/启动会写全局协议与右键菜单；独立 CLI/Web 正式下载入口未确认 | 不为探索而安装 Desktop；不把源码构建称为正式发行包通过 |

依据：[原生合同核查](../research/zcode-native-contract-20261023.md)、[发行物与模型模拟核查](../research/zcode-runtime-probe-20261023.md)、[仓库接缝与 Web 传输成本](../research/zcode-repo-seams-20261023.md)。主要一手入口为[官方当前协议](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/zcode-protocol.md)、[官方远控说明](https://zcode.z.ai/en/docs/remote-control)与研究报告内固定源码链接。

## 用户决定：暂缓 ZCode

2026-10-23，用户回复：“你的意思是找不到可以对接的方式吗？如果是就选1，暂缓”。已澄清：不是证明技术上完全无法实现，而是尚未确认符合既有 Desktop 自动收件与长期低维护要求的接入方式。按用户决定暂缓 ZCode 产品接入，保留研究和实测证据，继续已有工具兼容 CI。没有选择主动收件或限定 Web 原型，不继续这些实现；恢复 ZCode 开发需用户重新提出，或先有明确上游公开接口可供评估。

以下为决定时对照的方案，不是待选择的活动事项。

| 选择 | 结果与代价 |
| --- | --- |
| 按低维护目标暂缓 ZCode（建议） | 保留上述核查和后续接缝，等待公开 attach/身份合同或上游明确支持；不增加第五个未能兑现完整能力的 Provider。下一项可推进既有工具兼容 CI。 |
| 改为主动收件原型 | 研究 Hook 绑定身份 + MCP/mailbox 等待工具；Agent 需先进入接收状态，消息通过工具结果返回。可减少对私有聊天协议的依赖，但不是任意 idle Desktop 会话自动收件；尚未实施或验证工具超时、取消和再次等待的行为。 |
| 继续限定 Web 原型 | 只连接显式运行的 Web/server，不含已有 Desktop；接受固定源码/构建验证和私有 RPC 的维护，先证明身份、live 边界和单消息投递，再决定是否进入产品。无法预先保证原型一定能满足所有门槛。 |

用户先提出提供一个真实 ZCode 会话，据此补了实际 Desktop 验证；收到普通 Bash 结果并复核替代入口后，用户明确选择暂缓。

## 用户打开的实际 Desktop 会话

用户已打开原有 ZCode，报告会话名称为“测试会话”。这是用户预先安装的 3.15.3.8237 / build `d7ca8bee`，不是源码研究的 3.16.2。已从操作系统只读确认进程树与两个 `app-server --stdio` 子进程；`Get-NetTCPConnection` 查询成功及独立 `netstat -ano -p tcp` 均未发现该进程树的 TCP listener。会话名称目前来自用户报告，尚未映射到原生 session ID，不声称 crosschat 已发现目标。见[实际进程/监听证据](evidence/zcode-20261023/desktop-process-listeners.json)。

只读取随包代码及版本元数据，确认这个实际安装也使用 Main 内部 MessagePort attachment → Host → Agent stdio；包内某些 `/ws` 字符串属于连接外部 Source Server 的客户端，不是本机聊天 listener。调试端口代码限非 packaged 开发模式，不作为生产适配方案。实际普通 Bash request 仍只包含 trace.sessionId，没有看到自动注入身份 env；单独的 command/skill shell 扩展才注入原生 ID。见[实际安装静态核查](../research/zcode-installed-desktop-contract-20261023.md)。

用户随后回报已在“测试会话”用普通 Bash 执行只读诊断，原样输出：

```json
{"ZCODE_SESSION_ID":false,"CLAUDE_CODE_SESSION_ID":false,"CLAUDE_SESSION_ID":false,"CODEX_THREAD_ID":false,"DSH_SESSION_ID":false}
```

见[用户提供的 Bash 诊断证据](evidence/zcode-20261023/desktop-bash-identity-user-report.json)。这证明用户报告的普通 Bash 子进程中，这五个变量没有非空值；`Boolean` 不区分未定义和空字符串。没有据此推断宿主环境、trace 或其它入口不存在身份，也不推断其它启动配置永远没有 attach 能力。代理没有直接观测该工具调用或将名称映射到原生 ID。用户指出的宿主可能过滤环境这一限制成立。

该结果与实际包的静态读取一致，但只补上了普通 Bash 路径的负向证据，不算身份识别或聊天验收通过。身份传递可另行设计，例如 Hook / 自定义命令把原生 ID 提供给 Agent，再由 Agent 显式带参；那需要验证并可能改变使用方式，且不能单独解决向已有 idle Desktop 会话投递的入口缺口。

## 普通 Bash 诊断后的替代入口复核

不能仅凭环境变量为 false 就宣称 ZCode 不可能接入。复核仍固定上述官方源码提交，并与用户 3.15.3 静态副本区分；没有运行任何新增原型：

| 入口 | 可复用能力 | 对既有 idle Desktop 自动投递的限制 |
| --- | --- | --- |
| Hook / 自定义命令 | Hook stdin 含原生 `session_id`；PreToolUse 可更新当前工具输入，理论上能把真实身份绑定到专用 crosschat 调用；自定义命令 shell 扩展也可取得 ID | 必须先发生生命周期事件或命令调用；身份问题有候选解法，但 Hook 本身不会启动一个已结束的主模型回合 |
| MCP / mailbox 等待工具 | Agent 主动调用时可发送或等待收件；适合不依赖内部 RPC 的受限方案 | 尚未确认 MCP 通知可直接开启该主会话回合；保持等待工具运行改变原有使用方式，不算任意空闲会话唤醒 |
| 固定源码中的 UI Plugin `sendMessage` | 能请求向当前绑定的主会话发送 follow-up | 每次消费一次性用户手势；没有手势就等待用户确认，没有一次授权后永久自动发送的分支。尚未在用户 3.15.3 实测此能力 |
| 内置 Webhook Bot | 不只有微信/飞书；源码和用户 3.15.3 静态包均含 generic Webhook Adapter、secret 校验、入站和回传 | HTTP ingress 注册在独立 server；当前 Desktop 未确认同一公开监听。Webhook 按绑定 Bot 上下文的 activeTaskId 路由，不直接接收任意 sessionId；内部 adapter 表硬编码，没有找到公开自定义 provider 注册接口 |

一手依据：[Hooks 文档](https://zcode.z.ai/en/docs/hooks)、[MCP 文档](https://zcode.z.ai/en/docs/mcp-services)、[Bot Channel 文档](https://zcode.z.ai/en/docs/bot-channel)、[UI 每次手势/确认分支](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/ui/src/plugin-ui/adapters/pluginUiInteractions.ts#L55-L86)、[内置 Bot 表](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/bots/botsService.ts#L791-L811)、[Webhook Adapter](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/bots/providers/webhookProvider.ts)、[HTTP ingress](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/server/src/http.ts#L379-L423)。未找到公开入口不等于证明所有可能均不存在，也没有证据据此断言协议经常变化。

较符合原目标的后续上游确认点是：能否安全公开现有 Desktop Host 的 Webhook / attach，支持精确原生会话目标、idle 投递与明确回执。当前未向上游发消息或创建 issue。若用户不接受主动收件或 Web 的范围变化，建议暂缓产品接入，继续现有工具兼容 CI。

## 当前工作状态

- 三项研究及实际安装静态核查已完成；未注册 zcode Provider，未更改产品代码、现有 wire/ref、身份识别或技能；未运行产品测试，也没有以旧四工具测试计作 ZCode 验收。
- 代理没有下载可执行发行物、安装/启动/登录 ZCode 或读取个人凭据。Desktop 由用户主动打开，代理只读核对，不停止或卸载它。源码 clone、随包代码研究副本、所有权和 baseline 留在 D盘 ZCode 独占目录；没有本批软件需要卸载。源 clone 的重复下载进程已停止，未通过清理研究目录绕过之前的自动审批拒绝。
- 安装前 baseline 已记录用户 `.zcode`、AppData 和 `zcode` protocol 均预先存在。只读安装元数据随后确认用户原有 ZCode 3.15.3（程序版本 3.15.3.8237）位于 `D:\soft\ZCode`；它不属于本轮测试安装，禁止将其原有配置、注册或程序纳入本批卸载清理。当前源码/官网 3.16.2 的研究不冒充对这个用户安装的实测。
- Postman API discovery 的 Orbit 查询未找到匹配的 ZCode endpoint，只返回无关服务，未采用；合同以官方文档与固定源码核查。没有发布共享 API 资料或创建外部 issue。
- 普通 Bash 身份诊断已收到并保留；支持范围决定已完成，ZCode 开发按用户要求暂缓，没有遗留待回答的范围选择。下一项为工具兼容任务 C01，不把暂缓记作产品适配已完成。
