# 核心应用接口

2026-10-22。CLI 与 TUI 共用当前 npm 单包；展示入口从应用接口取数据，不解析 CLI 输出。TUI 框架仅在交互入口动态加载。

## 模块入口

| 需求 | 入口 | 契约 |
|---|---|---|
| 连接配置与选择 | `src/serve/node-config.ts`、`connect-selector.ts` | 纯解析、旧新形状归一、选择器；读取不修复，写回仍用原子同步函数 |
| 会话列表和详情 | `src/application/sessions/index.ts` | `SessionCatalog` 聚合 Provider，提供匿名名、raw 状态、完整引用、分页、采样和来源错误 |
| 远端完整只读发现 | `src/application/discovery/index.ts`、`remote-discovery/tcp.ts` | 本机/SSH/TCP共用Provider DTO，匿名、完整ID、分页、来源错误与详情；请求取消逐跳释放读取，不调用status或补投 |
| 星、服务、文件和日志读取 | `src/application/queries/index.ts` | 脱敏台账、权威 roster 组合、快照加 PID 证据、文件元数据、有界日志；不补投、不备份或修复 |
| 诊断 | `src/application/diagnostics/index.ts` | 检查/判定/formatter 分离；异步查询在独立进程执行，取消回收整棵探测进程树 |
| 本机观察 | `src/application/observations/{overview,communications,logs}.ts` | 状态组合、按需诊断、通信对/队列元数据与有界日志；安全DTO、局部错误、只读无补投 |
| 本机与远程管理 | `src/application/management/local.ts`、`remote.ts` | 稳定 starId；热/冷/拒绝/失败有结构结果，热失败不冷写；远程保留现有挑战应答与权限 |
| 服务起停 | `src/application/services/local.ts`、`background.ts` | spawn 仅代表 starting，需匹配进程与状态文件才 ready；后台停止隔离阻塞进程扫描，保留原身份与端口闸门 |
| 清理 | `src/application/cleanup/index.ts` | `planCleanup` 只读，`executeCleanup` 执行既定目标，保留原规则和 CLI 计数语义 |
| 发送 | `src/application/send/index.ts`、`types.ts` | `sendMessage` 返回 typed 结果；`format.ts` 负责旧文本/JSON，TCP 本机桥直接使用结果 |
| 成员对账 | `src/application/members/index.ts` | 有序 Provider 能力委派，保留现有活性/查名策略；unknown 不当成 absent |
| 精确册位操作 | `src/application/session-membership/index.ts` | 只读列出配置星；按完整 SessionRef 检查/收编/删册，目标变化拒绝，未确认写入不自动重试 |

## 读取与生命周期

`SessionRef` 包含 contextId、providerId、nativeId；旧登记没有原生会话 ID 时，referenceKind 为 process，其他默认 native。内部键包含引用种类，显示短值不参与寻址。详情传完整 ref，不能拿截断值或名字作唯一键。

分页结果的 complete 表示当前来源声明完整；partial/unavailable/cancelled 均不能显示成“没有会话”。Claude 目录清单变化会令游标失效并要求刷新；Codex 聚合 Desktop owner 与 CLI 来源，游标绑定上下文并按完整 ID 跨页去重，保留各来源错误。新查询保持原始未知状态；旧 CLI 的20条默认和状态校验保持。当前发现范围仍是各原生来源可发现的非归档会话，未新增历史归档扫描。

取消读取后丢弃迟到结果，Adapter 负责释放自己的连接、监听器和子进程。诊断查询在 finally 回收 owner 后再次检查取消。服务启动、管理和清理是写操作；停止等待不能表示回滚，超时应核实结果后再重试。旧 CLI 继续使用原同步 doctor/stop 边界；展示入口应使用异步应用接缝。

`stopServicesInBackground` 在专属 Worker 中完成原有停机操作并回收 owner，不提供中断写操作的取消参数。调用方可丢弃迟到结果，停机仍会执行至完成。

`queryStars` 默认只读本机脱敏台账。Context 注入现有 roster 读取能力后才能判断在线数；未注入时明确 unknown/partial，不能据静态台账推断下线。旧端没有 sessions 字段时保留机器信息并标部分结果。详见 [查询模块说明](../../src/application/queries/README.md)。

日志每次重新打开文件，以文件标识及大小识别替换/截断；载荷窗口默认64KiB、最高2MiB，额外窥读一个边界字节避免误丢完整行。文件页仅列元数据，普通结果不含 key、adminKey 或管理插座地址。

`queryLogWindow`返回完整起始行的字节offset、是否换行与边缘行省略标记；旧`queryLogTail`从同一读取器映射原返回形状。`queryManagedLog`限制登记来源、拒绝链接/特殊文件、隐藏已知秘密，最多显示最近1000行；来源、无损文件身份、观察代次和offset共同组成稳定行键。不能从两次采样推断未观察到的截断后增长过程。

`queryCommunications({baseDir,contextId,signal})`聚合已保存通信对及最近审计；`queryOutbox`只返回安全队列元数据，未知条数用null，过大或损坏不当作空。仅复制已保存且端点匹配的完整ref，不调用短柄生成或writer；机器身份不明的同原生ID不能证明本机归属。`communicationPairId`供通信和日志复用via记录的完整ref归对。

`createLocalOverview({home,discovery,...})`的`readStatus`不会运行doctor；`readDoctor`显式执行并仅缓存本TUI最近成功报告。`queryDoctorDiagnostics`提供30秒默认预算、IPC运行时校验和owner回收；显式home默认隔离原生目录，`nativeEnvironment:'inherit'`保留用户原生环境而单独绑定crosschat配置home。默认TUI使用inherit，显式隔离HOME使用isolated。旧CLI无参doctor读取和判定不变。完整合同见[观察资源规格](tui-observations-spec.md)。

`createSessionMembershipService({baseDir,discovery})` 的 `baseDir` 为 `~/.crosschat`。`listTargets` 只读本机配置；`check` 只做有界身份/权限核验；`apply` 在写前重新核验。请求携带 `op:'adopt'|'remove'`、完整 `ref`、完整 `starId` 和可选 `signal`；结果为 `applied/rejected/uncertain`，不含配置凭证。工具映射和收编条件通过 `MembershipProvider` 登记，原生 ID 的跨工具冲突不得被当前星册的单 ID 键掩盖。

收编核对最新安全发现、实际 broker 握手星及在线聚合器的完整机器/工具身份；确认中说明可能启动聚合器，明确撤权暂停不被自动绕过。attach 只发送一次，随后只读核对权威星册。精确删册采用独立 `member-remove-exact`，broker 在同一步验证完整 ID、机器和工具；原名字/前缀 CLI 分支保持。丢回执、已发写取消和内存已变但落盘失败均为待核实，不盲目重发；不增加旧端降级。

## 远端发现与撤权

`crosschat discover` 接收stdin上的单个JSON请求并输出单个JSON结果；空输入默认`{"op":"list"}`。列表支持`limit`（每Provider默认100、1—1000）、`cursor`和`filter:{providerIds?,text?}`；详情请求为`{"op":"detail","providerId":"claude","nativeId":"完整ID","referenceKind":"native"}`。结果保留Provider能力、原生状态、元数据、采样时间与每来源错误，不读取聊天正文，不回传投递插座或凭证。请求/响应最多2MiB，元数据有深度/数组/节点数量边界。

`createSshDiscoveryClient({host}).execute(request,{contextId,signal})` 用固定远端命令`crosschat discover`，请求通过stdin JSON传递，超时/取消回收自己的SSH子进程；只读登录用户可见的来源。`createTcpDiscoveryClient({broker,targetMachine,admin?}).execute(...)` 使用新`discover-query/result/cancel`，可选管理钥挑战认证；按当前连接的星与目标节点授权，含该节点未入册的可发现会话。两端须使用本轮新版，不做旧端协商、status回退或自动升级。

远端游标绑定连接上下文、端点/星/机器和筛选条件，不能换目标继续使用；详情核对完整Provider/原生ID/引用种类。broker给转发请求分配独立ID，核验回程实际socket与当前星内owner，每连接最多8个并发发现。取消、超时、断线、撤权和停机取消源读取并丢弃迟到响应。发现不读取原生归档；“完整”只指当前来源非归档集合。

删除节点和吊管理钥现按星及实际认证凭证立即撤权，包含无机器ID的瞬态sender；同机器不同凭证、其他星不受影响。明确`credential-revoked`先使连接无权处理后续帧，再清路由并断开；永久成员册保留。节点收到明确撤权后暂停该星重连和启动器自动拉起，保存无裸钥的凭证指纹暂停记录；换钥后显式重连。普通断网和一般`BAD_AUTH`不当作明确撤权。暂停记录写失败时保留暂停IPC owner，读取损坏记录报错并停止自动拉起。

## 扩展边界

发送支持逐条 `SendArgs.delivery?: 'queue' | 'steer'`，默认 queue。Provider 第三参数为 `DeliveryOptions.mode`；SSH、TCP、broker 本机桥与文件通知原样传递。`SendResult.deliveryMode` 表示请求意图，与实际投递结果、历史回执分开；`deliveryModes` 能力须有对应原生验收证据，不能由 `delivery: true` 推断。

Desktop 投递绑定真实 owner，不依赖 CLI daemon；owner 绑定后的失败不改投其他通道。忙时 queue 本机寄存，空闲后交给原宿主；steer 追加当前轮，明确无活跃轮且新快照证实空闲时才允许启动新轮。写入不明不重放，outbox 持久认领与未知状态阻止并发/崩溃恢复重复发送；回执摘要绑定目标与实际完整输入。

`SendDeps.diagnoseCodexTarget` 仅在普通 `--to` 解析报 `NAME_NOT_FOUND` 后提供只读补查；已命中、歧义、`targetSessionId` 和 conversation/ref 路径不变。`src/codex/discovery.ts` 的 `diagnoseCodexTarget` 遍历当前非归档 metadata，仅探测匹配候选，区分真实未找到、保存记录、歧义和来源失败；保存记录不加入可发送列表。结构结果保留 owner/snapshot/metadata 阶段与安全错误码，不携带原生错误正文；`scope: 'desktop'`、`cliStatus: 'not-checked'` 明确结果不能推断 CLI 不可达。补查不恢复原生会话、不调整既有超时、不自动发送或换路由。

第三工具的读取接入实现 SessionReader，注册进 SessionCatalog；ContextReader 提供连接描述。工具能力声明与实现分开，第三测试 Provider 已验证通用筛选/详情/成员委派无需添加工具分支。

真实 OpenCode/zcode 尚未接入。第三工具可复用上述发现传输，核心不按工具分支分发；投递、启动和诊断能力分别登记。原有身份/ref/origin/成员持久键尚未迁移，未来功能变化仍须用户确认；本次直接升级，不增加旧版适配。

`npm run check` 包含现有 lint、AST 导入图、构建与测试。应用模块禁止运行时依赖 commands/TUI，配置模块禁止依赖命令/NodeClient；新增应用模块自动继承门禁。迁移模块启用类型导入、未处理 Promise 和异步回调检查，合法与违规 fixture 均验证规则生效。实施与验收证据见 [核心改造记录](core-refactor-progress.md)。
