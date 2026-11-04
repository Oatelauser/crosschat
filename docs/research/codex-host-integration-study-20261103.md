# CodexHost 接入方式与 DSH 优先计划的补充

用户备注（2026-11-03）：本研究与[OpenBot研究](openbot-integration-study-20261103.md)一并保留，供未来crosschat Desktop开发参考；Desktop具体需求由用户后续单独沟通，本备注不启动开发或确定功能范围。

2026-11-03（UTC+8）。按用户要求研究BytePioneer-AI/codex-host，由root本人完成，worker和子代理未参与。通过GitHub第一方源码读取，固定到main当时的提交[78106589d07d3ad7af1079e3252afa30c2062477](https://github.com/BytePioneer-AI/codex-host/commit/78106589d07d3ad7af1079e3252afa30c2062477)。没有clone、安装、运行该项目或执行README命令；没有将其验证记录当成本仓库实测。本文是[OpenBot研究](openbot-integration-study-20261103.md)之后的补充，落实方向仍为[DSH优先完成计划](../development/dsh-completion-plan-20261103.md)。

## 1. 结论：有真实DSH适配器，但托管边界不同

CodexHost把外部Harness接入官方**Codex Desktop**：通过CDP/Electron Inspector扩展Desktop，在官方app-server之前放CLI Shim，已识别的外部请求交Adapter，官方请求保留透传。各Harness优先使用自身原生接口，其余才退回ACP；委派任务运行在独立原生Session中。[README架构说明](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/README.md#L255-L264)

它确有DeepSeek Harness适配器，不能与OpenBot的DeepSeek模型API条目混同。其DSH链路是**本机托管的DSH Web＋原生Remote HTTP/WebSocket＋V4会话/控制数据**，不是DSH ACP接入。源码主动启动 `dsh web --no-open --host 127.0.0.1 --port 0`，读取该child的就绪URL，再交换认证cookie；后续原生调用经 `/api/<endpoint>`，流经WebSocket。[Web进程启动](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/remote-connection.ts#L830-L858)、[就绪与认证](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/remote-connection.ts#L903-L909)、[认证交换](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/remote-connection.ts#L1014-L1044)、[Remote调用](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/remote-connection.ts#L349-L395)、[流连接](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/remote-connection.ts#L586-L684)。

| 对照 | CodexHost固定版本的已读实现 | crosschat已有合同与本轮取舍 |
| --- | --- | --- |
| 会话使用方式 | 新建/恢复外部原生Session，投影到Codex Desktop；导入只建映射，打开后resume | 精确借用用户已有live root Agent；缺目标报错，不创建/恢复替代会话 |
| DSH入口 | 本机自己托管的Web；原生Remote与V4数据 | 已有DSH Host插件＋独立Bearer loopback桥，保留现路线 |
| 认证/owner | 管理自己child的就绪URL/cookie；已有外部Web无凭据时给诊断 | 验证登记instance/PID、桥owner及token；不关闭用户已有Web来取得认证 |
| Desktop含义 | Codex Desktop呈现外部DSH会话 | 正式DSH Desktop仍需独立安装、UI和生命周期验证 |
| 安装/更新 | DSH插件安装入口使用npm；明确Desktop等安装不通过全局npm更新 | npm/Web与正式Desktop维护分别验收，不用npm通过代替Desktop |

来源：[导入及DSH范围](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/harness-session-import.md#L5-L12)、[外部Web认证诊断](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/deepseek-harness-adapter.ts#L36-L38)、[npm安装入口](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/plugin.ts#L10-L30)、[原安装方式更新边界](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/installation.ts#L56-L73)。crosschat对照为[批准合同](../development/dsh-integration-contract.md)。由这些边界推断：它可提供DSH原生协议及测试思路，不能直接替代我们附着已有UI会话或正式DSH Desktop的证据。

## 2. 可以借鉴的四项做法

### 原生接受、关联、执行完成分开判断

DSH适配器生成独立requestId，调用 `session/prompt` 的queue模式；接受回执之外，继续等待原生持久化消息关联。写出后丢回执时，源码明确不假定requestId幂等，不重发不确定prompt，而是短暂等待原生关联证据，仍不明则关闭该托管Session的接收路径。它还考虑pre-step压缩先于持久化用户消息，已接受不等于立即能观察到requestId。[请求与不明结果](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/session.ts#L1304-L1425)、[原生压缩与关联](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/harnesses/deepseek/dsh-version-validation.md#L7-L15)

落到crosschat：保留桥回执只确认收下/模式，不冒充模型已消费或回答；C11的DSH真实工具＋模型桩场景补“回执迟到/丢失、已接收后仍有原生前置工作、结果不明时不自动产生第二条写入”的证据要求。消费原桥已暴露的身份/消息事实，不引入CodexHost的全量历史投影、requestId格式或另一份账本。通信公共实现仍归既定负责人，不借研究接管。

### 能力必须落到具体Adapter和当前操作

公共插件按Host/connection上下文创建，环境、平台、远端属性由构造上下文传入；插件提供工厂，不靠全局注册副作用。DSH的 `modernSessionCapabilities` 声明模型/权限、历史和自主回合观察能力，没有声明steer。查询能力不预留执行时机，最终写入前仍需核对目标Turn。[插件构造上下文](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/harness-adapter/src/plugin.ts#L29-L46)、[DSH能力声明](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/session.ts#L149-L161)、[最终写入前复核](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/external-thread-steering.md#L12-L15)

落到crosschat：继续把DSH差异放已有Provider/Host桥，C10/C24按入口、owner/代次、版本及操作给出事实。**某Adapter没实现不等于上游没有能力**；不能据此否认我们已有npm/Web queue/steer证据，也不能把未知写成原生不支持。无需引入它整套动态插件发行系统或新增状态文件。

### 操作完成证明与资源释放证明分层

其Session close在有托管执行时发原生cancel，但回执只确认受理；源码继续消费原生历史，等 `turn/end` 才视为原生停止。Adapter随后逐层关闭Session、事件/控制流和自己管理的连接。Host删除映射也先确认连接关闭和输出消费结束；失败保留记录与资源归属。[原生停止确认](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/session.ts#L2928-L2974)、[Adapter收尾](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/packages/adapters/deepseek-harness/src/modern/deepseek-harness-adapter.ts#L897-L913)、[映射删除边界](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/official-traffic-ownership.md#L46-L50)

落到crosschat：C04-I03-C3把“本次直接child close、自然Host退出、官方卸载、桥登记与系统注册清理”分别绑定真实observer，消费既有C1/C2，不再造进程helper。**原生Turn停止不能替代Host自然退出**；它托管Session的cancel/进程树停止不能搬到借用用户Agent的桥close。我们仍只释放自己的桥/登记，保留Agent和聊天。

### 导入/选择之后重新解析身份，未知忙闲不假装空闲

其候选列表只返回有界元数据，resolveCandidate只读重新验证选中ID；目标Host切换使旧请求失效，不回退本机；running区分true/false/null。文档也明确没有resolver到resume间的跨进程所有权转移协议。[目标Host绑定](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/harness-session-import.md#L5-L11)、[新鲜解析及三态](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/harness-session-import.md#L31-L37)、[所有权限制](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/harness-session-import.md#L66-L74)

落到crosschat：C14的DSH原生补验及C09列表/操作验证保留完整工具/连接/实例/会话身份，换上下文不消费迟到结果，目标消失不换目标、不自动resume。公共来源/短柄/状态修改继续由Bug修复2负责；本会话补对应入口事实与可复现需求。

## 3. 不能直接采用的行为

| CodexHost行为/策略 | crosschat处理 |
| --- | --- |
| 无原生steer时停止当前Turn，结束后自动执行新输入 | 不采用。crosschat原queue/steer语义保留；拒绝、写入不明与待核实不改成自动停止/重发 |
| 恢复历史或委派时启动独立原生Session | 不替代已有live root目标；自动创建/恢复属于另行功能决定 |
| 只设最低版本、较高SemVer尝试连接，安装跟npm latest | 不改变本仓库已批准固定版本/窗口及安装维护策略 |
| Desktop通过CDP/Electron Inspector扩展Codex UI | 不将其当作DSH官方Desktop插件加载/系统注册/自然退出证据；不引入新的UI接入路线 |
| 关闭自有托管Web进程，或要求用户关闭无凭据的外部Web | 不转化为crosschat关闭用户工具/Agent或新增必需用户操作 |

停止后重发策略有其明确文档，DSH Adapter未声明原生steer是该实现的边界，不能推导DSH原生不支持。[steer两种策略](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/external-thread-steering.md#L3-L20)。版本及latest策略见[DSH版本门槛](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/harnesses/deepseek/dsh-version-validation.md#L19-L34)。以上均为设计比较，本轮没有修改这些产品行为。

## 4. 它的验证证据和我们的下一步

它的记录覆盖了我们同样固定过的DSH `0.2.1-rc.2` / `687f282e`：macOS arm64、隔离npm及DSH_HOME、本地SSE模型桩；没有调用真实计费模型。记录还展示了一个具体故障：新增可选thinking字段使Adapter历史解析失败，而DSH原生Turn仍正常完成。可借鉴的是按消费面比较版本协议，分开报告“适配层失败”和“原生执行失败”，不是把所有持久化事件都纳入crosschat路由器。[版本与原生/Adapter分离证据](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/harnesses/deepseek/dsh-version-validation.md#L21-L69)

这些是**该项目作者的验证记录**，我们本轮未重跑。其文档明确Desktop端到端显示尚需人工验证，0.2.1系列没有Windows/Linux复验，部分图片/子代理事件仍不接受，也不证明任意非默认profile或独立后台进程退出；因此不应称其“全部功能已适配”。当前插件运行时文档也保留完整原生/周边验收缺口，架构提案的接口示例不当成现行API。[DSH未测边界](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/harnesses/deepseek/dsh-version-validation.md#L300-L309)、[当前插件运行时边界](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/harness-plugin-runtime.md#L3-L21)、[架构提案状态](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/docs/architecture/harness-plugin-architecture.md#L3-L5)

DSH工作顺序不变：**C04真实Desktop合同/干净runner→维护→诊断/TUI→基础CI/平台→已批准增强**。当前下一单仍为C04-I03-C3，研究输入仅补充原生受理/停止证明的分层、身份再核对及测试用例；可信发布者、官方安装/卸载参数、真实GUI和干净Windows环境仍须独立证据，不能用CodexHost填补。原先被拒的五份DSH资源未重试、未换通道读取；本研究未把第三方集成说明冒充上游安装合同。

固定提交的根[LICENSE](https://github.com/BytePioneer-AI/codex-host/blob/78106589d07d3ad7af1079e3252afa30c2062477/LICENSE)为GNU LGPL v3文本。本轮仅借鉴思路、附必要事实与来源，没有复制代码或引入依赖。研究只覆盖列出的README、架构/DSH验证说明及相关Adapter源码，没有执行安全审计、测试或全功能验收，未读模块不推断为不存在。
