# 工具完整接入规范

2026-10-27，Asia/Shanghai。适用于当前工具整改及以后新增 Provider。现状和证据见[接入审计快照](tool-integration-audit-20261027.md)，实施顺序及负责人见[全量待办](tool-compatibility-ci-tasks.md)。本规范明确接入必须检查的范围，不以制定规范代替功能开发或运行验收。

C14当前技术验证通过，具体用户命令及已有行为变化待用户确认，见[待确认清单](c14-user-command-review.md)；下文类型规则须按最终批准范围收口。

## 范围与交付口径

每个工具必须分别检查其 CLI、Desktop、Web 等实际入口；共用协议、版本号或 Provider 不代表入口、owner、配置根和能力相同。当前审计覆盖 Claude Code、Codex CLI/Desktop、OpenCode CLI/Desktop、Harness npm 启动的 Web Host 及正式 Desktop。Harness Web Host 与浏览器 UI 的证据分开；ZCode 继续暂缓。

交付结论分三层，不能用前一层冒充后一层：

1. **通信接入**：原生发现、精确投递、发送者身份和回信链已有实现，并注明实际验证入口。
2. **基础完整接入**：本规范的基础检查项均有实现或有依据的复用，技能/插件维护、TUI、诊断、教学和类型寻址形成完整流程；无关能力允许按原生事实标为不适用，但缺少必需实现不能标为完成。
3. **运行与维护验收**：从零使用、原生终端/界面、平台和兼容 CI 按实际运行证据逐项通过。代码存在、工作流已配置、本机通过、GitHub 托管通过分别记录。

选择跟随、专属统一能力扩展、原生改名及其新增验收属于后续增强阶段，不反向阻塞基础 CI。它们沿用[已批准共享设计](session-selection-membership-design-20261026.md)，不另造成员制。技能安全策略、敏感信息规则和项目目录权限限制不加入本批。

## 统一验收清单

以下 INT 编号是永久检查项，不是新开发任务。实现复用时仍需注明入口、配置和证据范围。

| 编号 | 功能面 | 完成时必须证明的事实 | 剩余实现／验收归属 |
| --- | --- | --- | --- |
| INT-01 | 原生入口与支持范围 | 工具发行来源、实际包/版本、协议或实验窗口、OS/架构、CLI/Desktop/Web、当前会话范围明确。历史记录、loaded 会话、live root、子 Agent 不混称同一支持范围。 | 各工具合同；C04、C00/C12 |
| INT-02 | 随包交付与安装入口 | 发布包包含所需 Adapter、完整 skill 及 references、必要 bridge；命令和指南能定位随包文件。声明本地构建还是已发布版本，不要求用户靠开发目录里的未交付文件运行。 | C08/C10/C13、C11 |
| INT-03 | 配置与目标归属 | 列明默认及自定义 home、原生 profile、project、服务登记位置、实际端点/owner 和版本。安装技能、装桥、发现和投递能指向同一目标；多个实例不互相覆盖或任意选中。 | C08/C13、C04/C11；类型合同待C14用户确认 |
| INT-04 | 技能安装、更新与移除 | `install-skills`、TUI 维护和卸载使用一致的目标决策，完整保留 references。说明覆盖范围、兼容目录与原生目录、共享副本归属及生效时机；真实原生会话能加载。手工复制可记录为现状，不能冒充统一维护已实现。 | C08、C09/C10、C11 |
| INT-05 | 必需插件生命周期 | 需要桥的工具分别核实安装、加载、更新、禁用、重启/重连和移除；crosschat 包路径变化、指定 profile 和插件引用有收尾方案。只回收自己的登记/连接，不销毁借用的 Agent。原生无需插件的入口注明不适用。 | C13；Desktop C04，CI C11/C12 |
| INT-06 | 只读发现与状态 | CLI status、分页 discover、TUI 与 node 使用一致来源；完整原生 ID、匿名会话、名称、raw 状态、采样时间和来源错误保留。取消/部分/不可用不冒充完整空列表，查询不启动、恢复、修复或收编原生会话。 | 复用既有 reader；C09/C10/C11/C12 |
| INT-07 | 工具类型与精确寻址 | 同工具 CLI/Desktop 有差异则可区分，以工具类型＋名称/完整 ID 限定实际端点。发现去重、ref、内部键、册位、复制地址、回信及 SSH/TCP 不丢失类型；目标不符或歧义时拒绝，不跨类型回落。 | [当前实现](../tool-types.md)技术验证通过，用户面合同待C14确认；后续C09/C10/C11/C12消费批准结果 |
| INT-08 | 原生调用方身份 | 从实际原生 shell 取得完整会话身份，拒绝跨工具混合身份。普通终端 human 发送与 Agent 发送区分；不靠目录、进程猜测、最新记录或人为填 ID 证明原生身份。 | 复用 identity 与各工具桥；C11/C12 |
| INT-09 | 原生投递与调度 | 精确目标实际收到本条信封，idle 的 queue/steer 与 busy 的两种模式分别验证。原生受理、排队、消费和模型回答不混为一个成功状态；请求已发而回执丢失/畸形时待核实，零自动重发。缺目标不新建/恢复替代会话；保留既有正文/轮次预算、启动器传递和 Adapter 上限，不新设阈值或强加另一工具的队列机制。 | 既有 Adapter；C02/C03/C04/O06c/C05/C06/C11/C12 |
| INT-10 | 完整回信与跨机器路由 | 发送方原生 shell→收件方本条信封→按本条 hint 回信→原发送方核对，全 ID、conversation/ref、turn 与 origin 保持。SSH/TCP 在目标端解析，远端失败不改投本机；代码接线不等于各工具真实跨机已测。 | 复用类型合同；C11/C12；跨机组合范围由C00确定 |
| INT-11 | TUI 完整使用流程 | 列表、动态工具/状态筛选、详情、完整 ID/ref/地址复制、原生指引、成员状态、技能维护及诊断有正确接线；local/ssh/tcp 资源按实际能力提供。真实终端验证输入、resize、退出恢复，renderer 测试不能替代。 | 基础 C09；增强专属管理 C17/C18/C24 |
| INT-12 | 诊断、错误和教学一致 | doctor 文本/JSON/TUI 使用同一检查事实，能区分未安装、源未启动、版本/协议不支持、owner/鉴权/配置错误、技能或插件缺失/过期；给出实际位置与下一步。skill、references、help、指南、包描述与实现一致。 | C10，CI C11/C12；增强教学 C23 |
| INT-13 | 成员管理边界 | 复用既有精确收编、验活和权威星册；原生状态、机器连接、成员资格分别显示。基础接入不把“可发现”当“当前窗口选中”，也不为入星新建原生会话；新选择/声明/专属操作行为按增强任务另验。 | 既有共享层；基础 C09/C11，增强 C16—C18/C24 |
| INT-14 | 更新、停用、卸载与清理 | 区分 crosschat npm 包、skill 副本、bridge 引用、原生工具四种生命周期。保留用户其它配置和聊天；记录测试安装、进程、配置、登记与临时目录的所有权、退出和卸载证据。不会把 `crosschat uninstall` 说成卸载原生工具或自动移除 npm 包。 | C08/C13；C04/O06c/C11/C12 |
| INT-15 | 持续兼容验证 | 正式工具＋生产适配器＋同一 runner 的 loopback mock 模型，分别覆盖通信及从零完整流程；固定基线与同一候选，逐平台留证。环境/工装失败与兼容变化分开，托管首轮、定时、artifact、报告链分别验收。 | C02/C03/C04/O06c/C05/C06/C11/C12；增强 C21/C22 |
| INT-16 | 条件增强能力 | 自动选择只消费可靠原生窗口事件；改名只用公开接口及同一实际 owner，并核实原生界面、node、星册和寻址同步。逐操作报告能力和原因，暂失后只读重核，未知写入不重发。 | 后置 C15—C24；不提升为基础 CI 前置 |

## 配置和生命周期的共用约束

- 接入记录必须给出“谁读取哪份配置、哪个 profile、哪个 owner”。Harness 的 `DSH_HOME` 与 crosschat 登记所在 HOME 是两种目录；系统 npm dsh 不代管 Desktop 内置 runtime 的 profile。
- 技能目标允许有依据地复用兼容目录。OpenCode 读取 `.claude/skills` 不等于技能不可用，也不要求为形式统一再复制一份；C08 需明确默认写入范围、自定义根及共享副本的更新/删除归属。本规范不选择新参数或扩大现有自动写入范围。
- 技能与 Host bridge 分开计划，CLI 与 TUI 消费同一维护目标及结果；卸载对每类资产说明保留/移除范围。现有 TUI 的只读预览、范围变化重核、逐项结果和服务运行保护继续复用。
- 原生工具的安装、升级和卸载由其原生机制承担。兼容探测不自动升级支持基线、安装用户缺少的工具或修改用户模型设置。正式 Harness Desktop 的生命周期在独立干净 runner 验证，不在当前机器新增此前难清理的系统注册。

## 共用接口与适配接线清单

复用现有接缝，不在规范阶段另造注册框架或更换协议。下表是接新工具必须核查的接线位置，不能只改通信 client。

| 接缝 | 现有实现 | 接入要求 |
| --- | --- | --- |
| 原生发现与来源完整性 | [SessionReader/SessionRef](../../src/application/sessions/model.ts)、[本机组合](../../src/application/discovery/local.ts)、[发现边界](../../src/application/discovery/boundary.ts) | 原生读取器接同一模型、分页、取消和来源错误；未安装的可选工具不阻断旧工具。SessionRef 的可选 endpointType、端点去重和严格寻址采用[统一类型合同](../tool-types.md)，未知端点保持未知。 |
| 身份、解析、投递与回信 | [identity](../../src/identity.ts)、[resolve](../../src/resolve.ts)、[send](../../src/application/send/index.ts)、[ref](../../src/ref.ts)、[federation](../../src/federation.ts) | 完整 ID、身份冲突、模式、错误/待核实及跨机 origin 贯穿；寻址语法按实际工具能力记录，不照抄另一个工具示例。 |
| 册位与验活 | [成员 Provider](../../src/application/session-membership/providers.ts)、[原生验活](../../src/application/members/native-providers.ts) | 复用同一册位和逐星属性；来源暂不可读不擅自删册。 |
| 原生操作能力 | [describe/apply](../../src/application/session-operations.ts)、[默认 Provider 组合](../../src/application/native-operation-providers.ts) | OpenCode/Harness 已复用默认入星 Provider，不是完全未注册；专属端点/owner/版本核验及改名扩展仍须另接。当前统一操作为 adopt/rename，精确删册沿既有管理通道，不假称已是同一接口。 |
| TUI 与远端上下文 | [TUI 组合](../../src/tui/composition.ts)、[会话资源](../../src/tui/resources/sessions.ts)、[TCP 管理](../../src/application/tcp/management.ts) | 工具事实留在 Adapter；通用动作能力可扩展。已有工具指引/地址登记逐一核查，未来能力扩展不得再加通用页面的工具名称分支。 |
| 技能及维护 | [技能目标](../../src/application/maintenance/skills.ts)、[维护操作](../../src/application/maintenance/operations.ts)、[卸载目标](../../src/application/maintenance/uninstall.ts) | 共用目标方案供 CLI/TUI/诊断使用，必要插件另有生命周期；不各自维护互相矛盾的目录列表。 |
| 诊断、文档与发布 | [诊断](../../src/application/diagnostics/checks.ts)、[CLI](../../src/cli.ts)、[包清单](../../package.json)、[skill 源](../../skills/crosschat/SKILL.md) | 检查实际工具/端点/位置和交付物；保留旧命令合同。reader 的能力布尔值不替代真实 doctor 接线或验收。 |

能力核验复用现有有界 fresh probe、revision 与取消机制，不把“已有一套通用能力缓存服务”当作事实。若以后缓存，按批准设计隔离连接/node/Provider/会话/端点/owner/版本并正确失效。查询、入星、删册、改名分别判断；缺少改名不能连带禁用本来可用的其它操作。结果保持 `applied / rejected / uncertain`，恢复只重新启用动作，不自动提交旧表单或重发写入。

## 验收证据与完成规则

每份入口验收至少记录下列信息，可以沿用现有报告字段，不在本任务规定新的 wire/schema：

| 信息 | 要求 |
| --- | --- |
| 身份与范围 | Provider、实际 CLI/Desktop/Web 入口、OS/架构、原生版本/发行来源、crosschat 构建、home/profile/端点归属；测试声明不扩大到其它入口。 |
| 检查与结果 | 对应 INT 检查项、执行方式、实际观测、失败分类及未覆盖内容。代码已有/复用/缺失/原生不适用，与未验证/已通过分别记录。 |
| 原生与界面 | 真实 shell 身份、精确信封和本轮回复证据；CLI/GUI/Web UI 的可见结果只计实际运行者。模型 mock 证明协议行为，不宣称模型智能或真实服务商配置通过。 |
| 维护与清理 | 安装/加载技能或插件的实际结果、更新/移除范围、owned 进程正常退出、登记撤销及临时安装清理结果；未知释放不能报告完整通过。 |
| CI 与平台 | workflow、probe job 的真实 OS、基线/候选版本及独立运行记录、Actions URL/证据。Ubuntu report job 不计 Linux 原生测试，普通三平台 `npm run check` 不计三平台工具兼容。 |

CI 不需要个人模型 API key，也不访问开发者电脑的模型服务。mock 在 runner 自己的 `127.0.0.1` 运行；工具调用真实原生 shell 执行 crosschat，不能用直接调用 Adapter 或模拟原生服务代替正式工具。桌面 CI 使用正式桌面包与实际 owner，不以 CLI 的 app-server 通过替代。

基础兼容、从零接入、平台扩展及后续增强可复用同一工装，但检查范围各自留证。只在良好基线通过、同一候选重复同项兼容失败且释放完整时按既有规则去重报告；下载、环境、工装或清理错误单独记录，不为验收创建外部错误 Issue。三平台和跨机组合的频率/成本方案仍由 C00 决定，不能提前缩为未经同意的抽样方案。

制定规范的完成条件是：检查项覆盖所有接入面，当前各入口有可追溯的事实/证据/缺口矩阵，每个缺口映射到保留的后续任务，基础与增强没有反向依赖。工具“基础完整接入”的完成还需相应实现及 C11/C12 等证据，不能因本规范完成而一并关闭。
