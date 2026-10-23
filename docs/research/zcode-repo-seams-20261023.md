# ZCode 接入：仓库最小接缝与回归边界

2026-10-23，Asia/Shanghai。本说明只读审查当前 crosschat 的四工具实现，供下一项 ZCode 接入决策使用；没有运行测试、安装 ZCode、修改产品代码或宣布外部协议可用。ZCode 的官方产品、发行物、已有桌面会话 attach、原生 shell 身份和模型接口合同由独立来源研究核实，本说明不作推断。依据为本仓库一手源码及其行为测试。

## 结论与先决条件

crosschat 的发现/TUI 数据模型已允许任意字符串 Provider；会话回信、CLI 和原生成员能力仍通过受控登记接入。若确认原生合同支持已有会话，添加第五个 Provider 可以沿用现有接缝，无需重做四工具架构。若选用 `zcode`，长度为 5，已满足现有工具限定词规则 `^[a-z0-9]{1,16}$`；这只是 crosschat 内部可表示性，不证明上游存在协议或能附着当前桌面窗口。[会话模型](../../src/application/sessions/model.ts)、[工具限定词](../../src/serve/protocol.ts)

必须先实证三条链路：只读列举用户真实入口持有的会话；按完整原生 ID 向该会话投递；该会话从真实原生 shell 发信时能提供可信的当前会话身份。不能以自行启动 app-server、新建 SDK 会话、猜测本地数据库字段或伪造环境变量代替已有桌面 attach。只验证 CLI、SDK 或独立服务时，结果须按那个实际入口记录。若缺少前述能力，应停在研究结论或明确较窄的接入范围，不先扩散产品 Provider 声明。

原生 ID 继续作为不透明字符串保存。发现页的内部键已经包含 context、provider、reference kind 和 native ID；原有星成员持久键、成员快照仍只按 native ID 建索引。首批应延续“发现可区分、路由限定、成员冲突拒绝”的边界，不暗中迁移持久键。[内部键](../../src/application/sessions/model.ts)、[成员快照](../../src/application/members/snapshot.ts)、[精确成员核验](../../src/application/session-membership/index.ts)

## 需要改动的接缝

下表是外部合同确认后的实施范围，不是已经批准某种 ZCode 原生 API。新 Provider/tool 名暂按 `zcode` 说明；最终命名应与接入合同一致。

| 接缝 | 现有入口 | 最小增量与保留行为 |
| --- | --- | --- |
| 原生客户端与投递 | `src/opencode/*`、`src/dsh/*` | 独立 `src/zcode/*` 封装实际协议、来源发现、认证、分页、取消与投递收据。不得把 ZCode 转成 Codex thread。不得猜测 busy/queue/steer 语义，也不得自动创建或恢复目标。先核实是否需要官方插件桥；不因 Harness 用桥就要求 ZCode 也用桥。 |
| 发信身份 | `src/identity.ts` | `CallerIdentity`、`IdentityFamily`、环境家族登记及解析添加真实已核实的身份键。空身份仍 human；与四个旧家族混杂拒绝，保留当前 native identity。配置目录等设置不列作身份键，不发明默认 fallback。旧 launcher 通过登记自动剥掉新家族，且不改父 env。 |
| 对话回信引用 | `src/ref.ts` | `RefEndpoint`、mc1 validator、mc2 type-3 decoder 添加受控 Provider；编码沿用现有 named extended-provider 槽。原生 ID 既可 UUID packing，也可完整 UTF-8 字符串。旧四工具 mc2 字节、flags、字段顺序和 mc1 历史行为不变，不新增 mc3。 |
| 跨机器 origin | `src/federation.ts` | 新增 Provider 分支，按 OpenCode/DSH 的独立 ID 百分号编码保存完整 opaque ID，继承原机器/MID/SSH/TCP 信息。旧 Claude/Codex/OpenCode/DSH origin 的既有字节不变。`originDisplayName()` 是展示标签，不是路由地址。 |
| 名称与 ID 解析 | `src/resolve.ts` | 增加最小 row 类型、结果分支和可选新来源入参；空数组保留旧调用。`zcode/<完整 ID>` 优先完整 ID；限定名称/前缀多个命中报冲突。裸名称沿用旧精确名→前缀→ID 语义，同名跨工具不误投；按 ID 直达也核对跨工具/实例冲突。不要顺带重写旧四工具的选择器和诊断。 |
| 发送应用与 CLI 组装 | `src/application/send/types.ts`、`index.ts`、`src/cli.ts` | 可选 list/deliver 注入、目标分支、身份和日志键包含 Provider。限定新工具时报告该源故障，不落入 Codex 诊断。新增目标投递经过真实 Adapter；普通发现不触发发送。queue/steer 仅声明已证明能力；不明写入只发一次，不能落入 Codex outbox/补投。 |
| 正文预算 | `src/limits.ts` 与发送应用 | 默认仍 16KiB；新工具上限依据验证结果定义为 Adapter 策略或上游限制，名称不得混淆。旧工具硬顶、远端预检和超限教学不变；接入新工具不自动增加所有工具预算。 |
| 只读 SessionReader | `src/application/sessions/dsh-reader.ts`、`index.ts` | 新 reader 返回完整原生 ID、可空名称、原生状态、非秘密属性和单独能力。正确映射 missing/unreadable/malformed/unavailable/unsupported/cancelled/invalid-cursor。查询无启动、恢复、修复、投递副作用；不把进程 PID 冒充原生 ID。 |
| 默认来源组合 | `src/application/discovery/local.ts` | 添加可选来源，不在 composition 构造时发请求。显式 home 下所有路径和调用都用该 home；不得回落真实用户配置。未安装/未配置可选来源可以为空；已配置却鉴权失败、损坏、不可读或失联必须保留来源错误。 |
| status 与选段 | `src/commands/status.ts`、`src/cli.ts` | 若采用已有四工具接入范围，新增 `--zcode`、可选 JSON 段、概要/全量/名称筛选，保存完整 native ID 与 rawStatus。未配置/空来源默认旧输出逐字节不变；主动选择缺失源要有明确结果；配置故障不得伪装空数组。 |
| 旧 status 远端载荷 | `src/serve/protocol.ts`、`src/serve/node.ts`、`src/commands/status.ts` | 独立可选 `zcode` 元数据或 unavailable 段；在新段消费边界做 unknown 校验。旧字段、缺省行为与其它 `parseFrame` 分支不变，不因新增 Provider 全局升级旧帧校验。 |
| 新发现协议与 Context | `src/application/discovery/*`、`src/application/remote-discovery/tcp.ts` | DTO 的 Provider 字符串和能力已通用，通常无需新增 ZCode 专属 SSH/TCP 执行器或 wire regex。复用来源边界校验、匿名分页、完整性和取消。跨机器可传 DTO 不等于已完成真实 ZCode 跨机聊天验收。 |
| TUI 地址与指引 | `src/tui/resources/sessions.ts`、`status.ts` | 增加 Provider 地址能力登记、传入新解析来源、完整 `zcode/<native ID>` 复制、原生指引及已核实状态翻译。未知状态保留原值。匿名、同名和相同前缀不能只复制 id8；完整列表仍不证明截短地址唯一。原生指引不启动或恢复另一个 runtime。 |
| 收编与存活 | `src/application/session-membership/providers.ts`、`src/commands/session-star.ts`、`src/application/members/native-providers.ts`、`src/serve/node.ts`、`src/commands/serve.ts` | 按实际可投递状态定义收编能力；CLI、TUI、serve 透传与对账都接入。独立来源快照每轮复用。新旧工具同 ID、旧无 tool 册位与新 Provider 冒名都需拒绝/保持 unknown，不覆盖旧册位或认作幂等成功。旧工具明确可达时不因不相关新源失联而停止工作。 |
| launcher 与 skill 安装 | `src/commands/*-wrapper.ts`、`src/commands/install-skills.ts`、`skills/crosschat/*` | launcher 并非必须；原生入口足够时不为对齐工具数量强加启动器。核实官方技能路径与格式后再说明；默认 install-skills 仍只写既定目录，不能悄悄多写一个应用 home。若显式支持新安装点，安装/卸载归属和全套 references 一起验证。 |
| 官方运行与兼容 CI | `scripts/*-compat*.mjs`、`.github/workflows/*-compat.yml` | 共用基线/候选/报告安全思路，实际原生与模型工装按 ZCode 合同编写。模型 mock 只替代模型服务，不模拟 ZCode 的通信服务本身。真 CLI、桌面 UI、headless/SDK 独立列范围。CI 工具×三平台仍按 C00 后续讨论，不在此裁减或自动展开全矩阵。 |

上述源码链接分别见：[身份](../../src/identity.ts)、[ref](../../src/ref.ts)、[origin](../../src/federation.ts)、[解析](../../src/resolve.ts)、[发送合同](../../src/application/send/types.ts)、[发送实现](../../src/application/send/index.ts)、[预算](../../src/limits.ts)、[默认发现](../../src/application/discovery/local.ts)、[CLI](../../src/cli.ts)、[status](../../src/commands/status.ts)、[远端 status](../../src/serve/protocol.ts)、[Node](../../src/serve/node.ts)、[TUI 会话](../../src/tui/resources/sessions.ts)、[TUI 状态](../../src/tui/resources/status.ts)、[原生存活](../../src/application/members/native-providers.ts)、[TUI 收编登记](../../src/application/session-membership/providers.ts)、[CLI 收编](../../src/commands/session-star.ts)、[serve 组装](../../src/commands/serve.ts)、[任务范围](../development/tool-compatibility-ci-tasks.md)。

## 最容易重犯的四类问题

**展示短名不等于发送地址。** Harness 的 `session-` 共同前缀已经导致过 from-addr 歧义，现有发送应用为 DSH 保留完整 ID；`originDisplayName()` 仍允许短标签，它只供人读。ZCode 的 ID 形状未确认前，一律保存完整值，测试用两个共享前 8 字符的 ID。信封回信 ref、from-addr、复制地址、rate-limit/日志目标、远端 origin 的路由值都要核验，而不是只测 reader。[完整 DSH from-addr](../../src/application/send/index.ts)、[对应回归](../../test/dsh-send.test.ts)、[展示与 origin 用例](../../test/dsh-identity.test.ts)

**opaque ID 不应被某个旧工具解析器截断。** UTF-8、`/@:%`、控制字符和选择器是不同层的约束。数据层/ref/origin 应无损往返；HTTP/URI 单个 path segment 应独立编码；终端复制需既有安全字符检查；远端 shell 参数仍服从现有注入防护。不要为了支持一个含特殊符号的 ID，放宽全局 tool regex、直接拼 shell，或把全体旧工具的 ID 规则改掉。受限的人读 selector 不能表达时，完整 conversation ref 仍是独立回信通道。[ref](../../src/ref.ts)、[origin/远端参数边界](../../src/federation.ts)、[TUI 复制](../../src/tui/resources/sessions.ts)

**成员册仍存在 native-ID 单键限制。** `readMemberSnapshot()` 按 Provider 顺序取首个 present；既有 DSH 包装旧 Provider 的 probe，避免新来源碰撞被 first-present 隐藏。Node 的 tool 匹配目前也有 DSH 专门保护。新增 ZCode 时，必须覆盖“ZCode 对四旧工具”和“DSH 对 ZCode”两个方向，防止新源把退出的旧成员维持在线，或新工具 live 后继承旧无 tool 条目；不能只在 resolve 加判定便声称成员安全。来源不明时保留旧成员，不作确认死亡清册。[成员快照](../../src/application/members/snapshot.ts)、[原生 Provider 包装](../../src/application/members/native-providers.ts)、[Node 对账](../../src/serve/node.ts)、[受控 Node 回归](../../test/dsh-node-members.test.ts)

**缺席、故障和别人的目标是不同分支。** 默认 discovery 的 `optionalSource()` 只吞未显式配置来源的单个 missing，不能吞坏配置或连接错误。发送与 CLI adopt 的既有策略略有不同：发送容许新可选源失联时解析旧工具；adopt 还需复用旧解析器证明原目标确实可解析，不能只检查旧精确名字，否则已知的 OpenCode 限定地址和旧工具唯一前缀会被新源故障挡住。新 Provider 限定目标必须报告自己的原始源错误，不引导去启动 Codex。[可选来源组合](../../src/application/discovery/local.ts)、[发送错误边界](../../src/application/send/index.ts)、[adopt 旧回归](../../test/dsh-members.test.ts)

## 补充：正式 Web `/ws` 的运输层成本

以下只读核查固定官方源码提交 `3c5b227649371507ddc4eb46ac5133afe6db1cab`，未执行上游、安装软件或连接用户会话。它说明“若用户已运行正式 `zcode --web`，crosschat 另写客户端需要承担什么”，不证明这个进程与已打开的 Desktop Host 共享会话 owner；桌面已有 Host 的可接入性须按独立原生研究判断。

**这是产品内部二进制 RPC，不能直接发 JSON-RPC。** 官方 Web client 的链路是 WebSocket → `ISocket` → `SocketProtocol` → `ChannelClient` → `ProxyChannel`/服务。WebSocket 数据还套一层 13 字节帧头（type、id、ack、length，整数 big-endian），payload 则连续编码 typed/VQL 的 RPC header 与 body。参数数组由 ProxyChannel 展开为实际 service 方法参数；动态事件的参数则直接传给事件工厂，不能把两者统一当作同一种 JSON object。[官方 Web client](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/client/src/websocket.ts)、[SocketProtocol](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/rpc/src/protocol.ts)、[序列化](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/rpc/src/serialization.ts)、[ProxyChannel](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/rpc/src/proxy-channel.ts)

最小生产客户端至少面对以下几层：

| 层次 | 源码已确认的行为与实现要求 |
| --- | --- |
| HTTP/WS 认证 | 使用用户显式提供的已有服务 URL/令牌；源码接受 Bearer，也支持 query/cookie。优先避免令牌进入 URL/日志。先读 `/api/server-info` 核对服务/版本/workspace/能力，再升级 `/ws`；没有额外 JSON-RPC 登录消息。普通 `/ws` 固定是 terminal-client、web-remote-replayable，不能通过自填 mode 冒充可信 Desktop。`/ws/host` 另需一次性 host capability，不作为普通聊天接入的捷径。 |
| 连接/RPC 初始化 | 先完成 WS 与二进制帧解码，再等待 ChannelServer 的 Initialize=200。调用 header 是 `[100, requestId, channelName, methodName]`，响应 201/202/203 分别为成功/Error/非 Error 异常；请求 ID 与 pending promise 必须有独立 deadline。断开要 reject 未完成请求和初始化等待，不让请求永久挂起。 |
| 服务能力与 v4 握手 | 服务按 descriptor channelName 经 ServiceCollection 暴露；主要通道是 `zcode-agent`，不能把惰性 proxy 存在理解为服务存在。先 `helloConversationV4()` 验证可信 mode/profile/协议，再 `initializeConversationV4(clientHello)`；只声明本客户端实际支持且 Host 已公布的可选能力。workspacePath/workspaceIdentity 必须使用该服务的真实身份，不能由磁盘文件名自行猜。 |
| 只读列表的选择 | 有 `listSessions` 的 `runtimePolicy: 'existing-only'` 和被动 `readSession`，也有 v4 sessions-index。前者可能比驻留投影短，但仍需核实调用实现与结果完整性，不将历史列表称作可投递 live 会话。后者需 `onDynamicSessionsIndexFrame(workspace)` 先安装事件监听、`subscribeSessionsIndexV4` 取得 subscriptionId，接受快照/增量，完成后 `unsubscribeSessionsIndexV4`。不能为了读列表无条件调用 initializeWorkspace/create/resume；订阅的 runtimePolicy/潜在启动行为应作为独立 gate 核实。 |
| 事件与物理帧 | Channel 事件使用 102 订阅、204 下发、103 释放；动态事件名与 method call 分开处理。v4 下发又有 topic wire 层：物理 frame/fragment、base64 字节、校验和与有界重组，再得到 logical snapshot/deltas。只读取当前少量会话恰好不分片，不代表省略 fragment 后仍是可靠列表。按 subscriptionId、logEpoch、fromSeq/toSeq 防止旧连接、丢序和代际混入；无完整快照不能报告 complete。 |
| 发送命令 | 新代码应使用 `sendConversationCommandV4({ workspace..., envelope })` 的 `sendText`，旧 `sendPrompt` 已被源码标 deprecated。信封包含 commandId、clientId、完整 sessionId、type、payload、issuedAt；服务 ACK 有 accepted/duplicate/noop/rejected/stale/failed。payload requestedDelivery 是 startNow/queue/guide，不能仅按拼写把 guide 宣称 crosschat steer；需要真实忙时边界验证。缺目标不得替换为 createSession。 |
| 取消与释放 | RPC PromiseCancel=101 只请求停止等待/处理；经 ProxyChannel 暴露的方法没有自动把 CancellationToken 传入业务形参，不能声称服务已撤销写入。事件释放与 topic unsubscribe 都要有 owner/finally。命令发出后断线/取消应返回写入待核实，不能生成新 commandId 自动重发；若以后使用 queryConversationCommandsV4 核实，需单独验证其幂等与保留边界。 |
| 重连 | 这个本机 `/ws` 明确使用 SocketProtocol，未使用 PersistentProtocol；帧头里有 ack 字段不代表本链有 ACK/replay。断开后建全新 WS/ChannelClient、重新 v4 hello/init/监听/订阅。只有客户端确实持有一致状态时才携带 base；否则重新要 snapshot。CLI runtime 换代同样会使内存订阅失效，不能仅等待旧事件流。普通只读 CLI 可用“一次请求结束即释放”的策略减少驻留复杂度，但仍要正确处理帧和取消。 |

认证/注册的依据是[HTTP 服务](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/server/src/http.ts)、[服务集合](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/collection.ts)、[Channel 类型](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/rpc/src/channels.shared.ts)、[ChannelClient](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/rpc/src/channelClient.ts)、[通道名](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/channels.ts)。服务方法/生命周期依据[Agent 接口](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/zcode-agent/zcodeAgent.ts)、[连接级 facade](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/zcode-agent/zcodeAgentConnectionScope.ts)；物理/逻辑层依据[transport schema](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-protocol-v4/transport.ts)、[wire 编码](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-protocol-v4/wire-codec.ts)、[命令 schema](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-protocol-v4/command.ts)、[host 命令工厂/ACK](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/services/src/zcode-agent/zcodeV4HostCommand.ts)。

**尚未确认有面向外部集成的正式稳定 client SDK。** 已确认 `@zcode/client` 的源码 package 为 `private: true`、exports 指向 TypeScript，并依赖多个 `workspace:*` 包；这不能直接当成外部 npm runtime 依赖。`@zcode/rpc` package 没有 private 标记，版本写 1.0.0，但 default export 也是 `src/index.ts`，types 指 dist；源码自带示例只证明框架在仓库内可复用。此次未取得其正式发布渠道、外部使用承诺或兼容政策的发布文档，因此不声称“rpc 一定未发布”，也不把文件内版本当成协议稳定承诺。[client package](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/client/package.json)、[rpc package](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/rpc/package.json)、[rpc 导出](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/rpc/src/index.ts)

官方 server-info 带 product/minCompatibleVersion manifest，可帮助在连接前拒绝不合版本，但这是官方 Controller/Source Server 的产品兼容判定，不能单独为 crosschat 自己实现的二进制 codec、某几个方法或旧桌面附件提供兼容保证。[manifest](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/source-server/compatibility.ts)

**维护评估属于推断：成本高于已完成的 OpenCode 原生 HTTP 接入。** 若没有可直接消费的正式外部 SDK，选择是维护一套受限 binaryRPC/v4 客户端，或按固定提交带入所需官方源码并承担打包、许可、升级差异和兼容测试；不是简单写几条 HTTP 请求。为聊天适配仅实现必要只读/命令面能缩小范围，但上述多层 codec、认证、生命周期和结果完整性仍不可省略。更符合“一个人长期少维护”的决策，是先与已有 Desktop attach、原生身份能力一起审查价值；不应仅因为源码能读就立刻扩成第五工具正式支持。该结论不声称协议经常变化，只说明当前公开证据不足以支持“写一次长期无维护”。

## 建议先 RED 的行为

先用受控连接、临时目录和依赖注入写有意义的业务失败，再实施；首轮不要通过新增空 Provider、吞全部异常或硬编码测试值让用例转绿。实际 ZCode 合同尚未核实时，下表原生能力部分只作候选验收项，不猜具体方法名。

| 层次 | 首批应固定的业务结果 |
| --- | --- |
| 最小原生可行性 | 官方正常入口持有的同一真实会话：只读发现完整 ID→精确投递独有 nonce→原生 shell 产出该会话 ID→用 crosschat 回信。若只有自建服务可行，明确证明该较窄入口，不能记作桌面支持。 |
| 身份 | 真实已核实身份键→ZCode；空→human；与四旧家族每一种同时在场→冲突；三种现有 launcher 剥新身份但保留配置，不修改父 env。没有核实的 fallback 键不识别。 |
| ref/origin | 新 Provider 两端含非 UUID/Unicode/`/@:%`/UUID ID 和 machine/MID/star/turn 往返；mc1 可用；未知 Provider、空 ID、坏转义/截断拒绝；四旧工具固定字节全部不变。 |
| 解析 | 新完整限定 ID 优先于同值名称；同名/同前缀跨五工具冲突；同 ID 跨工具裸寻址拒绝；限定新工具可找到唯一原生目标；空新源保留旧四工具结果/错误。 |
| 发送与回信 | 真 Adapter 被精确调用一次；首次发信与回复 ref 的 Provider/native ID/nonce/turn 正确；回复仍默认 queue；两个共享前 8 字符 ID 的 from-addr 保持全 ID。目标不存在不创建替代，写不明不重试/不落 Codex outbox；不支持 mode 明确拒绝。 |
| 原生读取 | 匿名/同名/同 ID 多实例、未知状态、所有页/游标失效、取消/超时、读不可达/鉴权失败/载荷损坏分类；只读 list/get 不启动、不恢复、不修复配置或删别人的登记。secret 不进入 DTO/错误。 |
| 默认组合 | 构造不查询；显式 fixture home 完全隔离；默认未配置返回完整空来源；已配置故障保留；存在两个好来源和一个坏来源时仍呈 partial/来源错误而不是谎称 complete。 |
| status/远端 | 缺新源/空新源默认旧输出不变；主动选段、本地/远端、JSON/概要/--all/--name 保留全 ID 与匿名语义；只损坏新远端段时旧段仍能看，新段报错且不回显秘密载荷。 |
| TUI | 复制完整限定 ID；未知状态保留；仅提供实测过的原生操作指引；上下文/取消后迟到结果不覆盖新页；源不完整时不声称短地址唯一。页面保持现有资源和动作布局。 |
| 成员 | 新 Provider 只收编可验证的既有会话；与任一旧工具同 ID 拒绝，旧不同 tool/无 tool 册位不认作幂等；临时/永久成员保留旧清理契约。来源失联 unknown 不清册；旧已证实来源可用时不被新源的无关故障阻塞。真实受控 Node 中证明旧进程退出后相同 ID 的 ZCode 不把旧成员续命。 |
| 故障回归 | 新源失联下，旧工具裸全名、唯一前缀、OpenCode/DSH 限定完整 ID 的发送与 adopt 保留；限定 ZCode 的发现/发送/adopt 则报告新源故障。 |
| 真实兼容探测 | 正式真实运行时+模型 mock，验证实际工具 schema、原生 shell 环境、队列/steer 步边界与清理。工装加载/模型脚本/下载错误与生产 Adapter 不兼容分开。不能仅靠 Adapter 对自造 HTTP server 的测试证明官方兼容。 |
| CI 生命周期 | 每次独占 root/run ID/report，退出码/信号/超时与新鲜报告一致；基线完整通过后同一候选重复同一兼容失败才可提 issue；不明退出、强杀、残留进程或清理失败保留证据并停下一轮。探测只读 token，issue 报告独立 job 且不执行上游。 |

可复用行为范式见：[身份/ref](../../test/dsh-identity.test.ts)、[发送](../../test/dsh-send.test.ts)、[默认组合](../../test/dsh-composition.test.ts)、[TUI](../../test/dsh-tui.test.ts)、[status](../../test/dsh-status.test.ts)、[收编](../../test/dsh-members.test.ts)、[原生成员](../../test/dsh-node-members.test.ts)、[Harness Adapter](../../test/dsh-adapter.test.ts)、[兼容编排](../../test/dsh-compat-ci.test.ts)。这里复用的是边界和断言，不把 DSH 的具体 API、模型 SSE 格式或实验版本窗口复制成 ZCode 合同。

## 实施顺序与暂不扩的范围

1. 先合并官方外部研究结论，写清真实支持入口、会话 owner、身份、模型 mock 可行性、平台与发行物/版本证据；用最小原生探测决定是否能做已有会话集成。
2. 锁定新工具的 scope、Provider/tool 名、无副作用发现范围、回执和写不明语义。优先最薄原生 Adapter；只有官方扩展点确实需要时才加自有桥。
3. 先做 Adapter/reader/身份/ref/origin/发送的 RED→GREEN，再接默认 composition。逐段保留已有四工具字节和旧源故障回归锚点。
4. 按已核实能力接 status/TUI/精确 adopt/成员对账，特别检查 ZCode 与 DSH 的同 ID 双向碰撞。任何持久键迁移、默认技能写路径或全局监听变更须按仓库规范单独说明与确认。
5. 跑真实入口+脚本模型端到端，保存失败与成功证据后做兼容 CI，再跑 `npm run check`。源码行为测试、Web/CLI/SDK、桌面 UI、GitHub 托管 runner 与三平台必须各自记录实际范围。
6. 所有新测试安装、home、缓存和临时文件放用户指定 D 盘总根下的 ZCode 独占子目录并登记所有权；正常软件卸载、受控进程退出。总根按用户决定最终统一删除，不重复请求清除此根，不绕过此前自动审批拒绝。

本项不包含共享上下文自动同步、四工具通用重构、修改原生用户配置、远端自动安装、新全平台矩阵或完成其它工具未验收事项。真实 SSH/TCP 已验收范围按[独立远端记录](../development/tui-remote-validation-20261023.md)保留，不能自动扩记为 ZCode 跨机已通过。仓库测试/审批边界依据[代码规范](../development/code-standards.md)。
