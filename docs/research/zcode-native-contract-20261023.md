# ZCode 原生会话接入合同核查

核查日期：2026-10-23（Asia/Shanghai）。对象是智谱 / Z.ai 的 `zai-org/ZCode`。本次只读官方文档、固定提交的源文件与远端引用，不安装、不执行上游，不读取用户配置或凭据，不创建外部 issue、不 push。结论用于决定接入边界，不能当作适配验收。

## 当前结论

**目前不能宣称已找到满足低维护要求的“附着用户已打开的 ZCode Desktop 普通会话，并自动双向通信”的公开入口。** 已确认它有足够的内部业务能力，但入口与原生调用身份仍有缺口。单独启动 `app-server`、读取历史数据库、通过自定义命令的 shell 扩展发送，均不能替代这一目标。

| 项目 | 已核实的能力 | 对 crosschat 的含义 |
| --- | --- | --- |
| 已有 Desktop runtime | 手机远控会附着现有 Window Host，复用其 CLI；本机部分使用 Electron `MessageChannelMain`、`AttachServicePort` | 产品自己能附着；尚未确认面向第三方的本机 attach API、插件 Host 注入点或可注册发现的 loopback 端口 |
| 已有 Web/server runtime | `/ws` 暴露服务 RPC，可用显式 token 鉴权，能携带会话 V4 命令与订阅 | 可研究连接用户已运行的 Web/server；不代表能连接其独立 Desktop local Host |
| 精确发送、唤醒、忙时输入 | V4 `sendText` 使用精确 `sessionId`，有单条 `requestedDelivery`；idle 开始新 turn，busy 可 queue/guide | 业务能力存在；需真实工具确认路由、回执和不创建/恢复目标 |
| 标题、运行状态 | `sessions-index` 有 `sessionId/title/phase/...`，conversation snapshot 有输入路由和活动工作 | 可用于列表和能力判断；索引并不直接提供“当前驻留的普通根 Agent”判定 |
| 普通 Bash 回信身份 | 普通 Bash 的 request 含 `trace.sessionId`，但未向 env 写入该 ID；spawn env 本身也不补 session ID | 不能假设普通模型工具调用天然有 `ZCODE_SESSION_ID` |
| 特定命令的身份 | 自定义 command/skill 的 `!` shell 扩展确实提供 `ZCODE_SESSION_ID` 及 Claude 别名 | 仅适用于该扩展执行上下文，不能泛化为所有 Bash，也不能据此宣称普通会话自动回信 |

这些结论分别依据下面固定提交的实现；“未确认”表示在本次调查范围内没有找到足以支撑产品承诺的接口，不是证明官方代码中绝无其他实现。

## 基线重新固定

本次重新执行官方远端 `git ls-remote --heads --tags https://github.com/zai-org/ZCode.git`，不是直接复用昨日报告：

- `main`：`3c5b227649371507ddc4eb46ac5133afe6db1cab`。
- 当前 `main/package.json` 产品版本：`3.16.2`。[固定提交 package.json](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/package.json#L1-L5)
- `v3.15.1` annotated tag：`9ab8a647f03fbb3d0690c828a9d8edbfe8c588ff`；peeled commit：`aac4755666d09fdcd70272fcf063c077a639015f`。[官方 tag](https://github.com/zai-org/ZCode/releases/tag/v3.15.1)
- GitHub Releases 页面仍将 `v3.14.3`（commit `29628c9acdb81b703bbd4080c207a0e7ce5e276e`）标记 Latest；不能将 GitHub latest release、当前源码产品版本和 CDN 正式安装包自动视为同一构建。[官方 Releases](https://github.com/zai-org/ZCode/releases)

GitHub connector 本次返回 unavailable，匿名 REST API 触发出口 rate limit；因此版本引用通过只读 Git 远端核实，内容通过官方 raw 固定提交读取。没有调用用户 GitHub 凭据绕过限制。

## 已有 Desktop 和新 app-server 的边界

官方当前协议明确：手机 `/remote` 只 attach 已有 Host/CLI，不新建 Agent runtime。Desktop renderer 通过 MessagePort RPC 到 Window Host，Host 通过 stdio NDJSON 到 `zcode-cli app-server`；另起一个进程并不持有这个 stdio owner。[协议事实](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/zcode-protocol.md#L3-L25)

实际 `attachLocalHost(windowId)` 从 `windowHostProcessMap` 查找已存在的 Electron UtilityProcess；不存在即 `DESKTOP_HOST_MISSING`。它创建 `MessageChannelMain`，发送 `HostMessageTypes.AttachServicePort`，以 `web-remote-replayable` 模式获得独立 attachment。释放只关该端口。这是已有 Host 的真实接缝，但当前只看到 Desktop Main 内部函数，未看到第三方 Node Host 插件能直接调用它的公开注册合同。[shared-host attachments](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/desktop/src/main/webRemoteControlSharedHostAttachments.ts#L70-L105)

官方用户文档要求用户在 Desktop 启用手机远控，以 QR/link 授权，窗口保持运行在线；链接本身拥有窗口控制权。这个远控入口依赖产品的配对与 relay，并非已经证实可供 crosschat 无账户本机自动发现的 endpoint。不能复制用户临时远控 token、占用唯一手机连接、或依赖登录云服务作为默认接入方案。[Remote Control](https://zcode.z.ai/en/docs/remote-control)

通信分层也明确：手机 → Relay → Main 使用 relay envelope + `rpc-frame`，再由 shared-host attachment 进入 Window Host；Web/server 的普通 WebSocket 是另一条通道。[通信分层](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/architecture/communication-protocol-layers.md#L122-L155)

## Web/server 的认证 RPC

`createHttpServer(services, port, options)` 的服务集合是该 server 自己的 services。`authToken` 非空时，`/ws` 和 `/api/*` 受保护；接受 Bearer、query token 或专用 cookie。普通 `/ws` 强制 `web-remote-replayable` / `terminal-client`，伪造旧 mode header 不会升为 trusted Host。另一个 `/ws/host` 要求单次 host capability；普通接入不应主动索取 Host 权限。连接关闭会释放本连接 scope，而非销毁所有会话。[HTTP/WS 实现](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/server/src/http.ts#L85-L135)、[路由与认证](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/server/src/http.ts#L342-L401)

这不是直接把 JSON-RPC JSON 发到 WebSocket：外层是 `@zcode/rpc` 的 SocketProtocol/ChannelClient/ChannelServer 二进制序列化，内层才是 `zcodeAgentService` 对 V4 的服务转发。若实现，需要固定或审查该传输依赖，以及握手、channel、服务参数、订阅水位和断线释放；不能只 mock 一个 `sendText` JSON 后宣称生产兼容。[RPC IPC](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/rpc/src/ipc.ts)、[服务接口](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/zcode-agent/zcodeAgent.ts#L929-L997)

每个连接 scope 拥有独立 subscription；伪造的 `connectionId/clientMode/deliveryProfile/subscriberScope` 会清除后再写入 Host 真值。实现应连接现有 endpoint、以 terminal-client 最小权限操作，不能通过私有 trusted 字段模拟 Desktop。[connection scope](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/zcode-agent/zcodeAgentConnectionScope.ts#L87-L121)

## sendText 的单消息 queue / guide

`sendText` payload 的 `requestedDelivery` 是 `startNow | queue | guide`。注释明确该字段只覆盖本次 busy input，不修改 session 的 followup mode；旧 `session/steer` 被删除本身不表示单消息 guide 能力消失。[command schema](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-protocol-v4/command.ts#L92-L105)

真实路径为：handler 写入 canonical intent → `prompt-turn.ts` 将 requested guide 转为 `queueDelivery: guide` → Core admission 对可 steer 的 active turn 调 `steerTurn`，否则把该输入作为 guide deferred input；idle 则创建并开始普通新 turn。这不要求设置全局 followup mode。`startNow` 在 busy 时会抢占当前轮，不能被当作 crosschat 的普通 steer 代用品。[prompt-turn](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/prompt-turn.ts#L185-L218)、[Core admission](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/core/src/runtime/methods/prompt-admission.ts#L52-L110)、[steerTurn](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/core/src/runtime/methods/steering.ts#L60-L178)

有三个不能省略的验证边界：

1. 当前 `sendText` handler 对 `admission.kind=queued` 返回 `inputAccepted.delivery=queue`，即使请求是 guide。因此 ACK 只能证明接纳，不能单凭这个字段证明已按 guide 消费；要观察权威 intent / `TurnSteerQueued` 等实际事实。[handler](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/session-flow.ts#L278-L289)
2. Highspeed 等执行材料有显式 guide → queue fallback。若产品承诺严格 steer，不能把 fallback 回执静默解释为成功 steer，亦不能靠先改变用户会话模式来规避。[Highspeed 入队分支](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/handlers/session-flow.ts#L95-L173)
3. held 队列 `inputRouting.mode=choice` 下，没有 `heldQueueDisposition` 会明确拒绝。适配器不能自动清空、保留后抢占或者发送队列项来代替用户决定。[input admission](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/input-admission.ts#L29-L108)

V4 command 有稳定 `commandId/clientId/sessionId/issuedAt`，查询命令结果也有协议支持；accepted 并不承诺跨 CLI 进程存活。网络断开后的 uncertain write 不能盲目另开进程恢复或生成新 commandId 重投。[envelope、ACK、query](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-protocol-v4/command.ts#L334-L487)

## 列表、live / cold 与 subagent

`sessions-index` summary 提供精确 session ID、workspace ID、父会话 ID、标题及来源、phase、sessionEnded、后台工作和交互摘要。snapshot 本身还含 logEpoch；reconcile 的注释明确查询持久事实不创建、不恢复运行实例。所以“索引存在”“有 parentSessionId”“phase completed”都不能单独等同于当前已打开的普通主 Agent。[sessions-index](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-protocol-v4/sessions-index.ts#L29-L109)

conversation snapshot 的 phase 有 draft/prewarming/running/completedSuccess/completedInterrupted/error；另有 `activeWorks`（含 foregroundSubagent 等）和 `inputRouting`（startNow/enqueue/guide/reject/choice）。标题位于 `meta.title/titleSource`。这些是可观测事实，但本次尚未确认一个外部 API 能无副作用地枚举“当前 resident 根会话”并在发送前原子禁止冷恢复；没有为 subagent 自动收件或冷会话唤醒作支持声明。[snapshot](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-protocol-v4/snapshot.ts#L27-L182)

Host 的 `sendConversationCommandV4` 会先调用 `getClient(params)`，因此不能只见精确 sessionId 就推断完全没有进程启动/恢复副作用；要对实际 composition 单独验证。[Host send 实现](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/zcode-agent/zcodeAgentService.ts#L6127-L6174)

## 原生回信身份：不能泛化 ZCODE_SESSION_ID

普通 `Bash` 工具构建 `ExecutionRequest` 时，`sessionId` 只放在 `trace` 内，没有 `env` 字段。下层 spawn 的环境是 `buildExecutionEnv(request.env, { processEnv, ... })`，再做 shell overlay；当前两个明确入口没有给每个会话补 `ZCODE_SESSION_ID`。故不应把偶然继承的同名环境变量认定为可信原生调用身份。[Bash request](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/core/src/tool/handlers/bash.ts#L418-L473)、[spawn env](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/adapters/src/exec/node-execution-adapter-process.ts#L62-L128)、[env 合并](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/adapters/src/exec/execution-command.ts#L28-L75)

官方确有一个不同上下文：自定义 command/skill 的 shell 扩展显式设置 `ZCODE_SESSION_ID`，并同时设置 `CLAUDE_CODE_SESSION_ID/CLAUDE_SESSION_ID`；缺原生 session context 时相关变量会拒绝展开。这是实际存在的接口，可以作为将来的独立使用方式研究，不能变成“所有 ZCode shell 自动带 SID”的文档承诺，也要防止被误识别为 Claude。[shell expansion](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/packages/bootstrap/src/custom-command-shell-expansion.ts#L155-L206)

Hooks 是本地子进程协议，stdin JSON 有原生 `session_id`、cwd 等；它们在生命周期事件发生时被调用，并非可随时获取主 runtime owner 的 Host 插件。用 SessionStart hook 增加上下文也不能自动解决 idle 外部唤醒或普通后续 Bash 的身份注入。[官方 Hooks](https://zcode.z.ai/en/docs/hooks)

## 维护决策建议

在用户很少使用工具、希望长期低维护的约束下，建议先不为当前 ZCode 发布“完整 Desktop 原生适配”。下一步应形成具体决策，而不是先写一个新进程 launcher 再补名称：

- 若只接受已有 Desktop 普通会话：需要先取得或确认公开 local attach / Host 扩展合同，以及普通工具调用的可信 session 身份入口；现阶段这些是合同缺口。
- 若用户接受仅连接显式运行的 Web/server：可另行定义受限接入，但应明确启动方式、用户提供 endpoint/token、现有会话边界、严格 delivery 和身份机制；需用户知悉这个范围与原始 Desktop 目标不同。
- 若上游补足公开接口，再用固定构建的真实工具＋本地模型 mock 做基线/候选 CI；认证、发现、精确发送、idle、queue/guide、身份往返、unload/reconnect、失败不创建目标都要覆盖，工装失败和兼容失败分开。

官方有 source-server compatibility manifest 和最低兼容版本比较；缺省最低版本退回产品当前版本。这是其内部兼容机制，不构成第三方适配器的长期兼容保证。[compatibility](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/source-server/compatibility.ts#L4-L32)

本次没有实测 Desktop/Web 会话、模型调用、busy guide 消费或跨平台，也没有更改 crosschat Provider、协议、技能、默认行为。源码只读工件保留在用户授权的 D 盘测试总根下；不会借清理研究目录去绕过以前的删除审批拒绝。
