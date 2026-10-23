# DeepSeek Harness 接入：仓库实施触点与契约边界

2026-10-23。只读审查当前工作区的 crosschat 源码与测试，未安装或运行 Harness，未发送消息，未修改产品代码或旧研究。本记录分析仓库的接入位置，不是 Harness 官方接口的最新核验或功能验收。上游事实沿用 [2026-10-22 固定源码调查](crosschat-deepseek-harness-integration-20261022.md)，该调查的版本与限制不能视为已验证当前发行版。

## 建议

优先验证“用户真实 Harness runtime 内的薄 bridge → crosschat 的 Provider Adapter”，再接现有应用入口。不要用另起 headless/SDK runtime 代替用户已有 Web/Desktop 会话，不读取 Electron 私有 IPC 或搜集其他进程的令牌。旧调查提供了公开 Agent API、Cordis 插件和原生 `DSH_SESSION_ID` 的证据，同时指出它们处于预发布阶段；可连接性、版本和安装入口仍需本轮上游核验与实跑。[旧调查及其固定源码链接](crosschat-deepseek-harness-integration-20261022.md)

新 Adapter 可复用现有发现、信封、回信和连接 Context。需要改的地方比新增一个 `SessionReader` 多：发送、身份、ref/origin 校验、旧 status 和入星入口仍有显式工具分支。应把 Harness 特有的查找、鉴权、分页、状态和投递语义集中在一个模块，避免在通用页面传播上游对象。[会话模型](../../src/application/sessions/model.ts)、[发送](../../src/application/send/index.ts)、[身份](../../src/identity.ts)

Provider ID 与 wire `tool` 名称先定一次并固定。通用 `providerId` 是不透明字符串，但现有 TCP `tool` 只接受小写字母/数字、长度 1–16；带连字符的名称不能直接用作 `tool`。选择符合现有约束的名称或明确登记映射即可，不需放宽既有 wire 校验。本记录不替实施规格决定名称。[Provider 模型](../../src/application/sessions/model.ts)、[tool 校验](../../src/serve/protocol.ts)、[成员映射](../../src/application/session-membership/types.ts)

## 可以直接复用的合同

| 合同 | 当前实现 | 接入方式与限制 |
| --- | --- | --- |
| 会话标识与内部唯一键 | `SessionRef` 包含 context/provider/native ID；`sessionKey()` 编码四元组 | 保留完整原生 ID；同 ID 不同工具、不同机器 Context 不合并。它是内部键，不替代 wire/持久键。[源码](../../src/application/sessions/model.ts) |
| 分页、匿名、原始状态、取消 | `SessionReader.list/get`、`SessionPage`、`SourceError` | reader 如实区分 complete/partial/unavailable/cancelled；查询不激活冷会话，不修复配置。[源码](../../src/application/sessions/model.ts) |
| 多 Provider 查询与筛选 | `SessionCatalog` 按 reader 列表查询，保留每来源错误和游标 | 新 reader 加到组合处即可；保留取消、错误来源和跨页筛选语义。[源码](../../src/application/sessions/catalog.ts) |
| 跨 Context 发现 | Discovery DTO 与校验接受字符串 provider/native ID | 新 reader 在目标机注册，已有 local/SSH/TCP 发现传 DTO；不为 Harness另造远端发现协议。[模型](../../src/application/discovery/model.ts)、[校验](../../src/application/discovery/boundary.ts) |
| 每条消息的 queue/steer 意图 | `DeliveryMode` 默认 queue，回信不继承来信模式 | 上游能力必须实证后登记；不支持的模式明确拒绝，不能默默降级。[源码](../../src/delivery-mode.ts) |
| 信封、对话连续性、限流与发送日志 | application send 先处理共同逻辑再进 Adapter | 新目标走共同管线；接受/排队不声称模型已执行或已回信。[发送类型](../../src/application/send/types.ts)、[原生回执参照](../../src/opencode/deliver.ts) |
| TUI 列表、详情、筛选、完整引用复制 | 以 DiscoverySession 和能力登记生成 | 读页面大部分无需新工具分支；原生操作指引、可粘贴发送地址需小范围登记。[源码](../../src/tui/resources/sessions.ts) |
| 成员操作的重新核验 | 成员模块在修改前读精确原生引用、完整星/机器身份，核验其他工具同 ID | 复用核验流程；先提供 Harness 可收编判断，不能以“记录存在”推定可投递。[源码](../../src/application/session-membership/index.ts) |

## 最小实施触点

下表是具备完整通信体验时要逐项检查的文件清单，不代表全部应在首批实现，也不代表各入口已经支持任意 Provider。

| 面向 | 新增/修改位置 | 最小行为与风险 |
| --- | --- | --- |
| Harness 原生通信 | 新建单独 Harness Adapter 目录；参考 `src/opencode/service.ts`、`client.ts`、`deliver.ts` 的职责划分 | 只在此处理 bridge 实例登记、配置归属、协议版本、鉴权、超时、分页、原生 ID、精确投递和回执校验。不能照抄 OpenCode 的 HTTP 路由/鉴权/数据结构当作 Harness 事实。 |
| 发现 reader 与默认组合 | `src/application/sessions/<harness>-reader.ts`、`index.ts`；`src/application/discovery/local.ts` | 新增 reader。未安装/未配置的可选来源与“显式配置但失效”分开；隔离 home 不越界查真实用户目录。可参照 `optionalOpenCodeSource()`，但先决定缺席语义。 |
| 原生发送与目标解析 | `src/application/send/types.ts`、`index.ts`；`src/resolve.ts`；`src/cli.ts` 的真实依赖组合 | 增加列表/投递依赖及限定目标；完整 ID 优先于该工具内同名，名称碰撞不能静默挑工具。限定 Harness 目标故障不能掉进 Codex 专属诊断；写结果不明不自动重试。现有 resolve 并非通用 Provider registry。 |
| 调用者身份 | `src/identity.ts` | 增加经核实的 `DSH_SESSION_ID` 家族；空值保持 human，跨工具环境冲突拒绝。不要伪造 Codex/OpenCode 身份，不将 `DSH_HOME/PROFILE` 作为身份键删除。注册家族后旧启动器会自动清理继承的外族身份。 |
| ref 与对话端点 | `src/ref.ts`；`src/application/send/index.ts` 中端点类型 | 仅扩展受支持端点类型/allowlist，使用已有 mc2 type=3 provider 字段；保留旧编码字节、nonce、计数、机器和星字段。见下一节。 |
| origin 与回信来源显示 | `src/federation.ts` | 新工具的 opaque ID 要独立安全编码；保留 Claude/Codex/OpenCode origin 既有字节与语义，保留 host/mid/via。原生 ID 含 `/@:%` 或 Unicode 不能被当成显示名或机器字段。 |
| 对话别名和身份标签 | `src/commands/status.ts` 的 `endpointDisplayNames()`；检查 `src/conversation-summary.ts` 的 `shortEndpoint()` 和 `src/conversations.ts` 的连续性/短柄存储 | identityKey/ref 保留工具+完整 ID，名字只是展示/选择句柄，不作身份。通用对话别名、短柄分配与存储不应为 Harness 重写；仅在既有标签/名字翻译遗漏时补登记。 |
| CLI 命令面 | `src/cli.ts` | 增加相应 status 选段和 help；仅在有必要且实证过原生启动/参数透传后才加启动器。接入已有桌面会话不要求先另开 CLI。 |
| status 本机/远端/概要 | `src/commands/status.ts`；`src/serve/node.ts` 的 `buildStatusPayload()`；`src/serve/protocol.ts` 的 `StatusPayload` | 旧 status JSON 是显式工具分段，新增段会涉及现有 wire 载荷，须先记录批准范围。保留旧工具字段、空/失效区别和默认扫描范围；不能借此把整份 status 改成另一种 schema。若首批只做 discover，不宣称 status 已完成。 |
| TUI | `src/tui/resources/sessions.ts`；必要时 `src/tui/resources/status.ts` | 原始状态兜底已通用；只为已核实状态加翻译。补原生工具指引与精确地址登记；不启动、恢复或占用会话，不把 desktop 强行引导成 CLI。 |
| 手动收编/删除册位 | `src/application/session-membership/providers.ts` | 新增 provider→tool 映射与 `canAdopt()`；保持完整引用、原生状态、投递能力和同 ID 跨工具核验。不得默认收编所有持久历史/子 Agent。 |
| 会话启动入星与 serve --adopt | `src/commands/session-star.ts` 的 `realStarJoinDeps()`/`StarJoiner`/`runAdopt()`；如确有启动器则新 wrapper 及 `src/cli.ts` 路由 | 现有 `StarJoiner.side`、快照差分和 adopt 列表有显式三工具分支。先核实能唯一定位此次启动的真实会话；并发新会话时不能认领他人。已有 GUI 接入优先精确 adopt，不依赖猜测。 |
| 成员对账/复活/名字跟随 | `src/application/members/native-providers.ts`；`src/serve/node.ts` | 新增 Harness liveness/name reader 的注入。来源失败应为 unknown，暂停本轮对账，不能误当 absent 导致删册/下线。保留既有永久/临时册位语义。 |
| skill installer/卸载 | `src/application/maintenance/skills.ts`、`src/commands/install-skills.ts`；`src/cli.ts` 的卸载 skillDirs | **目前只安装 .claude/.codex 两处。**先核实 Harness 官方技能发现路径/格式和 profile 归属。默认 install-skills 增加目录会改变已有写入面；应先明确授权，优先显式选项，不能猜 `.dsh/skills`。新增安装点同时检查卸载对应点，不删其他内容。 |
| agent 使用说明 | `skills/crosschat/SKILL.md`、`references/send.md`、`errors.md`、必要时 `remote.md`/`stars.md`；独立 Harness 使用文档 | 只宣布实测过的入口与能力；教会原生身份、限定目标、queue/steer 与不明写回执。现有 remote/stars 文案仍有双工具描述，不能只改主 skill 简介便算完。 |
| 兼容验证 | 参考 `scripts/opencode-compat-ci.mjs` 与 workflow 的分离结构，新增 Harness 自己的基线/探测 | 运行官方真实 runtime + bridge + Adapter，脚本模型只模拟模型端。上游 API 与模型协议均需先核实，不能靠只测自造 bridge 证明官方兼容。工具×OS 的成本范围仍在 C00 后续讨论。 |

## ref、origin 与 wire：本轮必须保留的边界

`SessionRef`（发现/TUI 的完整引用）与 `ConversationRef`（`mc1_`/`mc2_` 消息回信路由）是两套合同。不能把前者的字符串型 `providerId` 直接理解成后者已经接受任何工具。当前 ref 的 union、mc1 校验和 mc2 type=3 decoder 都只接受已登记三工具。[完整引用](../../src/application/sessions/model.ts)、[对话引用](../../src/ref.ts)

现有 mc2 已预留 type=3 并携带 length-prefixed provider 名，原生 ID 也支持非 UUID 字符串。新增 Harness 只需使用这条已有编码路径并扩充受控校验；不新增 `mc3_`、不重新分配 type code、不改 UUID/raw 位、不改变已有端点字段顺序，也不把 queue/steer 塞进 ref。保留 mc1 历史解码及旧工具 byte-exact fixture；旧版客户端对不认识的新 Provider 给版本偏差提示，不能冒充另一工具。[ref 编码实现](../../src/ref.ts)、[OpenCode 既有回归用例](../../test/opencode-identity.test.ts)

新增受支持 Provider/ref/origin 语义、status 可选 wire 段应写入实施规格并明确属于本轮授权范围。若需要改变持久键、身份推断、默认扫描范围、旧工具寻址或 wire 结构，则超出普通 additive 接入，必须按仓库规范先说明现状、行为与影响，再获得用户同意。[代码规范](../development/code-standards.md)

成员模型另有硬限制：`readMemberSnapshot()` 仍按 native ID 建 Map、按 Provider 顺序取首个 present；Node 的 members 与持久册位也以 native ID 寻址。TUI membership 会拒绝“同原生 ID 跨工具”收编，精确 send 也有冲突保护，但不能由此声称所有旧成员路径都支持复合唯一键。首批应保持冲突拒绝并测试，不在本轮悄悄迁移成 `(provider,id)` 持久键。[快照](../../src/application/members/snapshot.ts)、[收编核验](../../src/application/session-membership/index.ts)、[Node 对账](../../src/serve/node.ts)、[精确目标](../../src/resolve.ts)

## 应先明确的行为范围

用户授权继续下一个工具接入，可推进公开入口核验、隔离 mock 运行、Adapter 与已约定能力的增量实施。下列选择会直接改变产品行为，不能以“内部重构”带过；实施前应把决定写入规格，遇到超出既有授权的选择再征求确认：

- 发现范围：真实 live root 会话、子 Agent、冷历史是否列出；冷记录是否可投递、投递是否恢复会话。旧研究表明查询、live Agent 与冷恢复不是同一能力。
- bridge 安装：用户显式安装/启用到哪个 runtime/profile；是否需要重启；不默认修改所有 Harness 用户配置或依赖其他工具的实验 hook 兼容层。
- 发送语义：原生 followup/steer 是否满足现有 queue/steer，回执表示接受还是实际执行；不支持时明确拒绝，不能改全局默认或自动重试。
- 新命令/默认输出：是否新增 launcher、status 选段/JSON 字段、默认 optional source、skill 安装目录；保留既有三工具输出和写入范围。
- 跨机器：复用已授权 Context 与星成员，不增加公开监听、远端自动安装或令牌抓取；“发现跨机可传 DTO”不代表已实测 Harness 跨机端到端。
- 共享上下文不属于此次工具适配。现有消息正文、信封和回信合同足以传递 agent 自组装的上下文，不顺带添加自动历史同步或后台摘要。

## 建议行为测试与验收证据

用临时目录、受控连接和注入依赖先验证 crosschat 合同；后续运行官方 Harness 时再用本地脚本模型验证上游，不使用个人模型 key。下列是行为清单，不以测试数量代替验收。[仓库测试规范](../development/code-standards.md)

| 测试层 | 关键行为 |
| --- | --- |
| Adapter 发现 | 多页完整读取/取消；匿名与未知状态保留；同名不同 ID 不丢；明确 live/cold/child 范围；查询不创建、不恢复、不修改文件；缺席/损坏/鉴权/失联分类；受控错误不泄露令牌或完整响应。 |
| 精确投递 | 完整 opaque ID 中的 `/@:%`、Unicode 可达；目标 ID 不存在、收据错 ID、错误 mode 不接受；queue/steer 明确映射；请求超时/连接中断写不明只发一次；不创建替代会话。 |
| 发送应用 seam | 限定 Harness 目标精确命中，同 ID/同名跨工具不误投；旧 Claude/Codex/OpenCode 名称与默认扫描范围不变；回信保持完整原生 ID 和同一 nonce，turn 递增，回复默认 queue。参考 [OpenCode send 测试](../../test/opencode-send.test.ts)。 |
| 身份与启动环境 | 原生 `DSH_SESSION_ID` 来自真实 shell；空值 human；与任一已登记身份同时在场拒绝；三种已有 launcher 清理继承的 Harness 身份但保留配置；若新 launcher 获批，同样清理外族且不污染父环境。 |
| ref/origin | 新 Provider 两端 round-trip，包括 opaque ID 与机器/星/turn；旧 ref/origin 固定字节不变；mc1 历史有效；未知 Provider/坏转义/截断拒绝，错误无终端控制字符。参考 [ref 错误测试](../../test/opencode-ref-boundary.test.ts)。 |
| Discovery 与 TUI | 默认组合真的包含新 reader；未配置可选工具不拖垮旧列表，显式配置失败可见；完整读取前不声称地址唯一；切换 Context/取消丢弃迟到结果；指引不启动原生 runtime；未知状态可展示。 |
| status/远端 | 若获批新增选段：本机、SSH/TCP、JSON、概要、--name/--all 一致；旧 payload 字段不变；工具未安装不出现虚假故障，配置故障不伪装空列表。 |
| 入星与成员 | 精确 adopt 只改选定星/机器/工具/完整 ID；来源未完整或同 ID 跨工具拒绝；鉴权/断线/取消后正确区分未写与不明；原生来源失联不清册；永久/临时、同 ID 恢复、改名行为保留。若有 launcher，增加并发启动差分不认错人。 |
| 技能安装（若获批） | 显式目标 profile/目录正确、父 home 隔离；现有默认目录列表不意外变化；安装幂等、失败不越界写；卸载只移除本次归属。技能内容宣称与实测能力一致。 |
| 官方 runtime + mock 模型 | 真实用户入口持有的会话可在 UI 看到新消息和本次独有 ACK；agent 从原生 shell 回信，ref 身份正确；忙时 queue/steer 步边界；runtime/bridge 重启重登记；无真实密钥；结束后按所有权清理。Desktop UI、Web 与 headless 分开记录，不能相互冒充。 |
| 兼容 CI | 固定良好版本与候选使用同一真实探测；失败重现；下载/环境故障不同于协议不兼容；新鲜结果与退出状态绑定，超时保留故障证据且不误报 PASS；检测与 issue 权限分离。跨平台组合按 [C00 后续任务](../development/tool-compatibility-ci-tasks.md) 另议，不自减覆盖。 |

## 推荐实施顺序

1. 核实当前官方 runtime/插件装载/原生身份/模型 mock 入口；用最小探测证明“同一个真实交互会话能收信与原生回信”，再决定是否进入产品实现。
2. 确定 Provider/tool 名称、live/cold/child 范围、安装归属和回执语义；锁定允许的 ref/origin allowlist 扩展与是否新增 status 段。
3. 先测 Adapter 与会话 reader，再接默认发现和应用 send/identity/ref/origin；保留旧工具回归锚点。
4. 接 TUI 指引/地址、status、精确 adopt 与对账。launcher 与技能安装只做已核实且获批的入口，避免为了对齐 OpenCode 而强加。
5. 独立运行真实工具+脚本模型验收，留下 UI/消息/身份/重启/清理证据，随后建立候选兼容探测。不把静态合同测试或新建 headless agent 当作已有 Desktop 接入已完成。

以上只读审查没有执行测试；所列用例都是实施建议。仓库当前已存在的 OpenCode 验收结果不能转记为 Harness 已通过。
