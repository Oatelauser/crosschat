# 工具完整接入与兼容验证待办

2026-11-03「多工具适配2」续接更新：用户要求持续推进，用户已澄清新增文件审批仅指crosschat持久数据存储（如home/.crosschat），代码/测试等开发文件直接推进；用户命令/操作流程变化仍先确认。C10技能诊断切片已完成（ae0727f、定向105/105、当轮完整2643/11），[验收与raw](dsh-validation-20261023.md#2026-11-03-c10-harness-技能诊断完整检查原始输出)保留。用户随后例外批准本机固定包的一次性人工准入，手动安装DSH并明确保留软件。正式Windows Desktop已实测skill工具加载、原生来源、两条UI会话完整回信、idle/busy queue/steer、插件开关及内置CLI移除引用；测试数据/下载包/临时根已清理，owned进程和监听0，用户安装/注册/PATH保留。三份证据已按用户批准归档，见[C3原生结果](evidence/c04-worker-20261029/I03-C3-execution-plan.md#11-正式desktop人工原生验收与运行数据清理)。**官方卸载、自然Host退出证明、干净runner/托管/其它OS未验收，C04父项继续开放。**

本轮原生准入与CI短柄修复（2e4fdb2/5dbc158）证据保留。用户随后批准C10活桥诊断：产品26fde78、定向143/143、Windows ConPTY三场通过；完整check中C2计时分类首败已稳定复现，RED6bc7ce6、修复5fe6802、原循环200/200。随后79196b2补齐C08两种home的CLI更新/卸载端到端，定向56/56；最新完整check **2675通过/11原有跳过，231文件通过/3跳过，退出0**，lint/203模块686边/build通过；[本轮批准及完整raw](dsh-validation-20261023.md#2026-11-03-c10-harness-原生桥诊断与截止计时修复)保留。root独立开发/自审，未派worker，其余历史失败不追认根因。

2026-11-03用户要求将本会话全部任务、背景与关键上下文交接至Codex Desktop「多工具适配2」，完整入口为[交接包](multi-tool-handoff-to-adaptation2-20261103.md)。后续由该会话接续本会话原有范围；原会话发送后停写。下列编号、已批准范围与Bug修复2/其它原负责人归属保持，交接不批准原生执行或新功能文件。

2026-11-03用户要求借鉴参考项目、先完成DSH，随后明确开始下一单。当前顺序以[DSH优先完成计划](dsh-completion-plan-20261103.md)为准：先收口DSH CLI/npm Host与正式Desktop的真实生命周期、维护、诊断/TUI、从零CI，再做该工具已批准增强；其它工具待办与原负责人保留。root已独立交付[C04-I03-C3执行合同与独立Windows环境方案](evidence/c04-worker-20261029/I03-C3-execution-plan.md)，worker停写。该文件第1—7节是原方案历史，第8节起记录后续授权与本机原生结果，不重复堆已完成离线组件。

上一批C04代码交付：[C04-I03-C2卸载前Host退出守卫](evidence/c04-worker-20261029/I03-C2-development.md)，产品3b3f05b，目标102/102；当轮单次完整check退出0：2632通过/11原有跳过，231文件通过/3跳过，lint/203模块682边/build通过。规范/合同为root自行审查，非独立双轴；worker及子代理未参与。[openbot研究](../research/openbot-integration-study-20261103.md)及用户追加的[codex-host研究](../research/codex-host-integration-study-20261103.md)作为后续接入设计输入；后者的真实DSH托管Web/Remote实现与本项目借用live Agent分开，不据此修改通信协议/状态，也不采用停止后重发或扩展版本窗口。C1/B此前失败与原始证据保留，未追认历史根因修复。本轮已观察固定发行物/目录/内置CLI/卸载登记和Host句柄退出，仍缺自然退出证明、自动安装/官方卸载及干净runner证据，I03/C04未完成。被拒读取/清理不重试，决定边界继续保持。

2026-11-02（UTC+8）[C04-I01离线核心已验收](evidence/c04-worker-20261029/I01-final-review.md)；[I02安装包获取与校验组件产品已验收](evidence/c04-worker-20261029/I02-final-review.md)，最终产品33f9c05、fixture6648c91、证据219a35c，root54/54、worker完整2584/11，未清理残留单独保留。I02产品不重开，其测试helper迟到owner已随I03-R3修复。I03-B最终root77/77、两轴无未决；全量17条白名单外状态/通信相关失败保留、未逐条归责，不扩通信所有权。I03整体与C04父项未完成，没有真实Desktop验收。

2026-10-28（用户端时间）**C14 已按用户“开始下一个任务”恢复整改和验证**，实施合同见[显式工具类型收敛稿](c14-explicit-tool-design-20261028.md)，逐轮决定见[批准记录](c14-user-command-review.md)，检查与续接见[本轮实施记录](c14-explicit-tool-validation-20261028.md)。所有send明示收件tool、取消公开工具前缀、保留Q8、完整复制模板及来源确认公共机制已接通；尚未完成的原生来源关联与逐入口例外审批继续保留，不能把未知入口的人工兜底默认打开。此前2281项及ConPTY三场仅是讨论前的[技术证据](tool-type-validation-20261028.md)，不替代本轮新合同验证。全量CI及其他未完成任务保留。

本轮grilling已逐项批准显式 `--tool`（含conversation回信）、取消工具前缀寻址、固定路由、端点独立记录/成员及TUI发送模板等修订；讨论前GREEN不作为这些新规则已实现的证据。用户要求的自身类型识别、用户确认兜底及多轮程序核验已有[只读研究](../research/c14-caller-identity-research-20261028.md)，随后已按批准的收敛稿恢复产品整改；具体入口若无法可靠确认或需新增安装配置，仍须逐项提交用户拍板，未默认启用人工兜底。所有原CI任务继续保留。

2026-10-28重新排序：以本页的24项主线顺序和1项独立用户验收为准，原编号及全部11个CI相关索引保留。最新[C14收敛稿](c14-explicit-tool-design-20261028.md)已包含同源跨会话确认复用、询问去重、重启先自动复核，以及无法可靠确认的入口须用户逐项过目拍板。排序时只整理计划；随后用户已要求开始下一个任务，当前恢复的是C14，不连带启动后续开发。

2026-10-23。用户在 OpenCode 桌面版开发期间要求：“把 claudecode 和 codex、codex 桌面版的维护也参考 open code 做一个 ci 验证，把这个放到任务列表里面。你现在还是按照你的开发进度来。”

本批 [DeepSeek Harness npm/Web 通信开发验收](dsh-validation-20261023.md)已完成；正式 Desktop 与 GitHub 托管 runner 首轮见 C04/C05。[Claude Code CLI 兼容 CI 开发及本地正式验证](claude-code-compat-validation-20261023.md)已完成，移除 C01 开发活动条目，托管 runner 首轮转 C06。[OpenCode 桌面版](opencode-integration-plan.md)的未完成 CI 实跑仍单独跟踪。通信验收不等于工具完整接入验收；技能、诊断、TUI维护、完整使用流程的整改见C08—C13；类型寻址按已批准C14合同实施，原生来源能力按入口分别收口。

2026-10-27：C07 规范制定与审计已完成，永久产物为[工具完整接入规范](tool-integration-standard.md)和[七类入口审计快照](tool-integration-audit-20261027.md)。完成项移出活动表，剩余依赖改指规范；这不代表任何缺失接线、待开发 CI 或未运行平台已完成。

用户在 [ZCode 接入检查点](zcode-integration-checkpoint-20261023.md)核查后明确选择暂缓 ZCode，转入已有工具兼容 CI。Claude Code 本地验证已完成，此前按顺序的下一项为 C02 Codex CLI；2026-10-26 本次会话交接后按下段分工安排。C00 的工具 × 三平台范围与成本讨论仍待用户后续讨论，不提前展开矩阵。

2026-10-26 交接、2026-10-27 状态更新：新增会话选择、永久成员保护、TUI 定向 node 实时成员管理、原生改名，以及统一操作接口与能力自动恢复要求，以[共享设计及批准记录](session-selection-membership-design-20261026.md)为准。共享基础层已由交接会话完成[开发验收](session-selection-membership-validation-20261026.md)，[原生改名补验](native-rename-validation-20261027.md)也已记录 Codex CLI 的实际支持及 Claude/Desktop 的限制；这不代表 OpenCode/Harness 专属接线已完成。Claude、Codex CLI、Codex Desktop 及共用基础模块仍由交接会话维护；本会话负责 OpenCode、Harness 及后续其他工具。共用 core/node/broker/TUI 只复用，不为每种工具另造成员制。C02/C03/C06 等原 CI 待办保留全局索引；本会话不重复领取他方工具的实施。具体工具增强任务见[专题计划](multi-tool-membership-tasks-20261026.md)，全局先后顺序以本页总表为准。

此前的测试目录约定（用户 2026-10-23 明确指示）：保留 `D:\workspace\CC\multichat\node_modules\.cache\crosschat-dsh-20261023-0975b6b93f724fec95264ad45903f291` 作为后续工具测试根，各工具在其下创建独占子目录及 ownership，配置、下载缓存和临时文件均归各自子目录。正常测试安装仍卸载、进程仍退出；该总根最终由用户统一删除，不再反复请求其删除。此决定不授权清理此前归属其它任务的残留，详见[用户决定与核对](dsh-cleanup-20261023.md)。

用户本次要求复核清理：2026-10-23 17:01（Asia/Shanghai）只读检查确认，上述总根（含 Claude 便携副本、Harness 缓存、ZCode 研究副本）、OpenCode Desktop 下载根及四个 UIA 根均不存在；本机 Temp 下 `crosschat-*` 文件和目录共 0 项。历史 171 个同前缀目录也已不存在，未在本次执行删除或重新创建测试根。准确范围见[清理复核](evidence/tool-integration-cleanup-20261023.json)。历史拒绝回执继续保留，不再把已消失的目录列为待清理。

用户随后补充：Linux、Windows、macOS 的跨平台场景必须进入 CI；担心“工具类型 × 跨平台”造成验证组合爆炸，要求先记任务，后续讨论方案，当前继续既定开发进度。下表不代表已经决定缩减覆盖范围，也不代表这些平台已经跑过。

用户再次追加：同一个工具的CLI与桌面版存在差异时，crosschat必须区分工具类型；`crosschat send` 能以“工具类型＋会话名称或ID”定位。用户已同意按实际通信端点划分，并逐轮批准send必填独立tool等规则，见[C14批准记录](c14-user-command-review.md)。类型规则作为接入规范、C09展示/复制、C10教学及C11/C12验收的共同约束；新出现的原生能力缺口、必要安装配置或行为变化仍须具体审阅。

## 全量任务与执行顺序（2026-11-03 DSH优先重排）

本表是当前这批多工具接入的全量开发与交付待办，保留原编号；包括尚未开发的 CI，不只是已配置 workflow 或已有运行结果的统计。专题文件只展开细节，不再替代总表。此前展示 C15—C24 增量时遗漏原 CI 行，属于展示范围不清，未取消这些 CI 任务。

按“**DSH真实生命周期 → DSH完整维护和诊断/TUI → DSH基础CI及平台范围 → DSH已批准增强 → 本会话其它工具**”推进。原共享父项只前置DSH切片；不要求所有工具都完成同一父项才推进DSH下一环。下表1—17为DSH优先切片，18—24为其它工具后续/原负责人项目，不表示它们被取消或由本会话接管。具体小单及出口以[DSH计划](dsh-completion-plan-20261103.md)为准；本轮没有并行派单。

C00按用户此前要求保留为待讨论：在DSH Windows基础路径准备期间形成具体平台/运行环境选项，在平台扩展前决定；不阻断已批准Windows生命周期或独立npm/Web工作。C12的Linux/macOS及跨机范围不因此消失，未决定不视为批准缩减或组合抽样。

三个依赖边界继续保持：C13已交付生命周期合同供C04/C08消费，真实Desktop部分随C04补齐，二者不互等父项关闭；C10先供C09同源诊断和教学事实，两者在DSH基础出口共同核对；C15的DSH能力核实在该入口基础及配套CI后进行，C21随C24/C18/C20准备和验证，C23同步更新，不等OpenCode增强完成。

C14已批准公共合同供DSH下游消费，剩余DSH来源/端点的原生补验随C04/C13/C11对应入口收口；公共身份/短柄/状态写入仍按用户交接由Bug修复2负责，本会话不自动领取通信实现。涉及无法可靠确认入口的具体例外，仍须用户逐项决定。缺证据不计通过，也不以整项C14其它工具未完成冻结已确定的DSH工作。

C02/C03/C06由Codex/Claude工具会话负责，原负责人可独立推进；本会话优先DSH，OpenCode的O06c/C16/C17/C19等不新增开发。DSH对应入口基础接入和配套CI先过再做其增强，受阻项保留，不等其它工具全部完成；共享父项DSH部分通过不等于父项整体关闭。O08始终是OpenCode独立用户验收，不排成DSH前置。

当前基础范围为 Claude Code、Codex CLI/Desktop、OpenCode CLI/Desktop、Harness npm/Web 和正式 Desktop 的已声明支持组合；ZCode 仍暂缓，未来工具不无限扩张本次门槛。官方不支持、尚未验证、外部环境受阻必须单列，不能用“支持”掩盖缺口。若确需调整本批范围或跳过验收，另行记录用户决定，不自动把阻塞项当完成。O08 为用户独立真实模型验收，单独跟踪，不阻塞代理可完成的开发与 CI。

C09/C10/C11/C12 的**基础接入部分不依赖 C15—C24**；后者只在增强阶段追加实现、文档和 CI 用例，避免“基础要等增强，增强又等基础”的循环。类型区分和寻址消费C14已批准合同；待补原生来源证据不因下游已消费合同而记为完成。

| 推进顺序 | 编号 | 任务与完成标准 | 负责人／必要依赖 | 当前状态 |
| --- | --- | --- | --- | --- |
| 1 | C04 | Harness正式Desktop在独立干净runner验证包/profile/插件、真实UI收发、退出、官方卸载及注册清理，保留生命周期工装；本机不新增此前难清理的系统注册。 | 本会话；C13合同、C14类型规则，技能部分消费C08；先做既定Windows范围，完整桌面workflow/托管首轮由C11/C12收口 | [I01](evidence/c04-worker-20261029/I01-final-review.md)/[I02](evidence/c04-worker-20261029/I02-final-review.md)已验收；[B](evidence/c04-worker-20261029/I03-B-review-closure.md)/[C1](evidence/c04-worker-20261029/I03-C1-review-closure.md)/[C2](evidence/c04-worker-20261029/I03-C2-development.md)代码已收口，历史raw保留。[C3第8—12节](evidence/c04-worker-20261029/I03-C3-execution-plan.md)记录本机单次人工准入及用户手动安装后保留软件的决定；正式Desktop实际skill/来源、UI回信、idle/busy两模式、插件开关/引用移除已验证，测试进程/监听0，测试home/包/临时根已清理，证据获准归档。签名修复2e4fdb2、CI短柄修复5dbc158；C2计时分类又修复5fe6802，最新完整check2675/11。自然Host退出证明、自动安装/官方卸载、干净runner和托管仍缺；人工准入不作CI默认策略，父项未完成 |
| 2 | C14 | 明确工具类型与send必填收件tool；补自动来源识别、同源跨会话复用、并发询问去重及重启自动重核。无法可靠确认/持续复用的入口先列证据与方案交用户逐项拍板；按批准范围整改寻址、引用、回信、类型隔离、TUI模板和skill教学。 | DSH类型/来源切片随原生入口验证；[收敛稿](c14-explicit-tool-design-20261028.md)及[批准历史](c14-user-command-review.md)；共用层与Codex/Claude负责人协调，公共合同供下游消费 | 公共整改2416/11、ConPTY三场及npm/Web来源两轮证据保留。本轮正式Desktop原生identity返回dsh-desktop/native/instance/verified，真实hint cA000回信通过；补齐该包的基础来源切片。Codex调用关联、OpenCode多服务及其余重启/并发组合仍待完成；逐入口例外不默认获批，整项保留 |
| 3 | C13 | Harness skill与Host bridge分开管理，先明确安装、更新、禁用、重连、移除及归属，保留其它配置；按合同补生命周期接线。 | 本会话；C14类型合同；合同先供C08/C04，Desktop验收随C04补齐 | 桥清理[最终验收](evidence/c13-worker-20261029/I01-final-review.md)及[生命周期说明](evidence/c13-worker-20261029/I02-final-review.md)保留。本轮正式Desktop内置CLI安装/移除引用、UI禁用撤登记/再启用新实例、Host及完整会话ID保留已验证。旧凭证失效、崩溃重连等额外组合未以本轮结果追认；诊断/更新及C04生命周期边界仍保留，父项未完成 |
| 4 | C08 | install-skills、更新、卸载及TUI维护共用目标计划；补Harness，明确OpenCode兼容/原生目录、自定义home/profile/project、安装卸载对应关系、覆盖更新和遗留文件语义。 | 各工具接线，共用维护入口协调；接入规范、C14合同、C13插件/技能边界 | 默认三侧计划与边界修复a77a39b已验收。本轮正式Windows Desktop实际skill工具加载通过；79196b2又补齐默认/自定义home下实际CLI安装→覆盖更新→uninstall，定向56/56、完整2675/11。源内文件覆盖、额外文件保留及当前目录卸载、历史/项目副本不扫描的现有语义已留证；Harness profile/配置/聊天和其它技能保留。npm/Web其余加载组合、其它工具与POSIX/三平台范围仍保留，父项未完成 |
| 5 | C10 | 原生服务/鉴权/版本、实际技能和插件位置诊断；统一skill references、help、工具指南、architecture和包元数据；纠正旧恢复及清理教学。CLI/JSON/TUI同源。 | 各工具负责人；接入规范、C08/C13目标与合同、C14；Desktop事实消费C04；供C09接线，基础出口共同核对 | Harness技能副本与活桥诊断切片已验收，产品ae0727f/26fde78；用户批准的info/pass/warn与同源CLI/JSON/TUI已接入，定向143/143、ConPTY三场通过；最新完整2675/11（含C2计时修复及C08 CLI补验）。技能references/help/指南/architecture已同步。静态profile插件缺失/停用/过期与原生实际加载诊断、其它工具及平台仍保留；用户README未改 |
| 6 | C09 | 补列表、筛选、详情、发送命令复制、成员展示、技能维护/诊断及错误指引；补Harness真实来源终端验收，复用共享成员页。 | 本会话做OpenCode/Harness；C08/C10、C14类型合同及相应原生入口；不等待增强C17/C18/C24 | DSH诊断页本轮增量已做真实ConPTY三场（健康详情、鉴权失败、取消及resize/退出恢复）；列表/筛选/完整发送复制/成员与其余维护/来源终端流程继续补验 |
| 7 | C05 | Harness npm/Web GitHub首轮，核实定时、artifact、报告权限和去重Issue条件；不为验收制造外部错误Issue。 | 本会话；既有工作流进入可运行分支及runner；与他方CI独立，可提前验证既定范围 | 工装及本地基线→候选通过，托管未验收 |
| 8 | C11 | 从零接入CI：隔离安装→加载技能/插件→发现/身份→原生收发→基础TUI/诊断→更新/移除。正式工具＋本机mock，不以直调Adapter代替；包含Harness正式Desktop独立workflow及托管首轮。 | 各入口工装；C14、C08/C09/C10/C13及相应正式工具与C04等入口证据；不依赖增强任务 | 待开发；既有通信探针复用，相应入口可逐项推进 |
| 9 | C00 | 讨论工具×Windows/Linux/macOS的CI支持矩阵、频率、成本与组合控制，明确是否包含源/目标跨机组合，不自行削减覆盖。 | 共用规划，用户拍板；在DSH平台扩展前决定，不冻结既定Windows基础路径 | 待讨论，未实施矩阵 |
| 10 | C12 | 按C00落地三平台基础接入与原生兼容检查，逐格留证；明确不支持、未验证、通过，macOS阻断策略待方案确定。 | 各工具工装＋共用调度；C00、相应入口与基础CI/C11；增强增量留C22 | 完整三平台尚未实现/验收 |
| 11 | C15 | 对应工具/入口基础接入及配套CI收口后，先核对Harness，再核对OpenCode窗口选择、首条输入、退出和公开原生改名等增强能力；不靠active、差分、目录或roots猜测。 | 该DSH入口基础与配套CI完成；OpenCode切片后续，接入规范和C14合同；复用共享S01—S06 | DSH基础/CI后实施；OpenCode切片保留；基础来源识别仍归C14 |
| 12 | C21 | 准备并持续补充增强隔离回归：选择/多窗多星、永久保护、未知Provider、端点差异、能力失效恢复、owner/版本变化、迟到响应、写不明零重发、资源回收。 | C15明确合同后开始，贯穿C24/C16—C20，C22前收口；复用共享测试，不复制状态机 | DSH切片优先；尚未实施；本顺序表示开始准备，不是先验收尚未开发功能；其它工具部分保留 |
| 13 | C24 | 扩展OpenCode/Harness既有Provider：端点/owner/版本、逐操作四态能力、有界只读重核与恢复，applied/rejected/uncertain；删册沿用独立精确通道。 | C15、共享S06及C21相应用例；先接框架与对应能力，不等待所有改名实现 | DSH切片优先；工具专属扩展待做，公共框架已有；其它工具部分保留 |
| 14 | C18 | Harness原Host bridge接统一手动成员管理；区分实例/profile/类型，live roots不当作选中会话，不假定有dsh wrapper。 | C15/C24、共享层、C09/C13与C14；Desktop还依赖C04，本会话先DSH，OpenCode后续 | 工具接线/专属验收待做 |
| 15 | C20 | Harness原Host接sessionTitle.rename，核实exact live session、原生界面、node及路由同步，不换owner或改数据库。 | C15、C18目标核验、C24和共享名称链；npm/Web、Desktop分别验证 | 条件能力待核实，未实施 |
| 16 | C22 | 新选择/成员/改名/能力恢复的真实受控验收及CI增量，多node/操作端，正式工具＋本机mock，平台复用基础矩阵。 | 对应增强接线及C21收口；复用C11/C12/O06c/C04，不反向阻塞基础CI | DSH切片优先；尚未实施；旧通信/TUI结果不算本批通过；其它工具部分保留 |
| 17 | C23 | 同步自动/手动管理、恢复规则、逐操作能力与改名限制、实际平台证据及新Provider接入门槛。 | C15起草，随接线更新，C22等对应增强证据齐备后最终收口；基础教学仍由C10完成 | DSH切片优先；尚未实施，不等所有代码完成才写文档；其它工具部分保留 |
| 18 | C02 | 开发Codex CLI正式工具＋runner本机mock兼容CI，覆盖发现、完整thread ID、身份/回信、忙闲、服务重启与清理。 | Codex/Claude工具会话负责；相应入口实现与隔离合同；平台扩展按C00，可并行 | 原负责人独立推进，本会话不接管；CI待开发 |
| 19 | C03 | 开发Codex Desktop正式包、真实窗口/原生owner的独立兼容CI，覆盖收件回信和生命周期，不以CLI替代。 | Codex/Claude工具会话负责；桌面测试入口与隔离合同；平台扩展按C00，可并行 | 原负责人独立推进，本会话不接管；CI待开发 |
| 20 | C06 | Claude Code GitHub首轮，核实托管、定时、证据及独立Issue job；未跑的原生负向配置不列为通过。 | Codex/Claude工具会话负责；保留全局跟踪，可并行 | 原负责人独立推进，本会话不接管；工装及本地正式序列通过，托管未验收 |
| 21 | O06c | 完成OpenCode CLI Windows/Linux、Desktop Windows的GitHub首轮；验证桌面基线→候选串行安装/卸载、artifact和报告链。 | 本会话；[OpenCode原计划](opencode-integration-plan.md)；默认分支/runner等外部条件单列；可提前验证既定范围 | 本会话DSH收口后再推进；工装已有，完整桌面序列及托管首轮待验收 |
| 22 | C16 | OpenCode CLI可靠选择信号接共享监督：空白等待、首条输入、恢复/切换、多窗口、逐星模式和永久＋--rm。 | C15事件证据、C24对应能力、S01/S02/S06及C14；无可靠事件先记缺口，不阻断手动分支 | 本会话DSH收口后再推进；待实施；直接原生resume不自动归队 |
| 23 | C17 | OpenCode CLI/Desktop接TUI定向node入星/退星，补原生精确核验、实时效果、权威确认及失败边界，不改聊天和其他星。 | C15/C24框架、S02/S03/S05/S06、基础C09与C14；不依赖C16自动跟随 | 本会话DSH收口后再推进；工具接线/专属验收待做，共享通道已验收 |
| 24 | C19 | 核实并接OpenCode公开HTTP/client原生改名及活前端同步，重读名称并核实node/星内寻址；无法核实仅禁对应改名。 | C15/C24、S03/S04/S05/S06；不要求先实现C16自动跟随 | 本会话DSH收口后再推进；条件能力待核实，未实施 |
| 独立用户验收 | O08 | 用户重新安装 OpenCode CLI/Desktop，用自己的真实模型从零验证；不要求提供 key 或放入 CI。 | 用户；基础能力就绪后可独立进行，代理开发/CI不等待其时间安排 | 等待用户独立结果 |

当前25项活动索引：C00、C02—C06、C08—C24、O06c、O08。已验收的Claude本地CI开发及规范制定按约定移出活动表；C14实施验证中，Claude的GitHub首轮仍由C06跟踪，所有CI待办保留。ZCode暂缓单列，不计为完成或本批阻塞项。

每次开始实施前先向用户说明任务编号和本次范围。每批交付包含相应隔离验证、必要原生验收、测试软件退出/卸载、临时数据归属与清理记录，以及文档和证据更新；沿用用户统一清理约定，不扩大删除范围。C04-I03-C3方案已交付，尚未实际安装/卸载或触发Actions；已批准普通细节不重复审批，必需用户操作、新功能文件及原生执行仍按既定边界决定。

CI 不缺项：**C00 方案、C02/C03 两类 Codex、C04 Harness Desktop 生命周期、O06c OpenCode 实跑、C05 Harness 首轮、C06 Claude 首轮、C11 从零接入、C12 三平台，以及增强阶段的 C21 回归/C22 CI 增量**。同一工装/工作流可承载不同检查层，复用不代表删除验收事项。

按剩余工作性质区分：**CI 待开发为 C02、C03、C11、C12，增强 CI 待开发为 C22；Harness Desktop 专用生命周期工装与独立验证为 C04，桌面 workflow 与托管首轮由 C11/C12 接续；C21 为增强隔离回归开发。O06c、C05、C06 已有工装，仍须完成各自未通过的完整序列或托管首轮，不笼统重标成全部待开发。** C00 是这些工作的平台范围与成本方案，不是一次 CI 运行。

C15—C24 的详细完成标准与阶段内依赖见[增强任务计划](multi-tool-membership-tasks-20261026.md)，不能用该专题清单代替本表。C09/C10/C11/C12 已完成的基础部分不因后续增强而重新挂为未完成；增强新增证据由 C21/C22/C23 保存。安全 skill、敏感信息规则、项目目录权限不加入本批。

类型合同已覆盖内部唯一键、发现去重、实际投递端点、成员定位/删除、会话引用、回信、队列及本地/SSH/TCP传递，不只是标签和参数。原生工具与平台CI仍按下列范围分别验收，不能用类型隔离开发验收替代正式工具从零流程。

## 接入审计摘要

完整逐入口矩阵、源码依据及证据边界见[2026-10-27 审计快照](tool-integration-audit-20261027.md)，下表只列待整改摘要。

| 功能面 | 现状与缺口 | 后续任务 |
| --- | --- | --- |
| 技能安装/更新/卸载 | C08-I01默认三侧计划及R1/R2边界已验收，产品a77a39b；OpenCode复用Claude，DSH_HOME与隔离根分别处理。DSH实际加载及覆盖/遗留语义收口仍待B阶段；历史自定义根/项目副本未自动扫描删除，不新增清理行为。 | C08 |
| TUI 会话与成员 | OpenCode/Harness 已接入列表、动态筛选、状态、详情、地址、原生指引、成员及收编；OpenCode CLI 已有真实终端证据。Harness 尚无真实来源加终端的完整验收，技能维护与诊断也未形成新工具闭环。 | C09 |
| 诊断 | `checks.ts` 已共用Claude/Codex/Harness三侧技能维护目标；Harness相对home有明确告警、隔离诊断不继承宿主DSH_HOME。原生版本/服务/桥/鉴权及来源身份的其它工具专项检查仍缺，副本匹配不证明实际加载。 | C10 |
| 技能教学与文档 | 技能正文已列四家族，但 `references/remote.md` 等仍有两家族残留；其它教学和包描述需统一核对。 | C10 |
| 插件生命周期 | Harness 通信桥已实现，用户仍手工部署/管理；技能与插件不可当作同一安装目标。 | C13 |

源码依据：[技能目标](../../src/application/maintenance/skills.ts)、[卸载目标](../../src/application/maintenance/uninstall.ts)、[维护入口](../../src/application/maintenance/operations.ts)、[诊断](../../src/application/diagnostics/checks.ts)、[TUI 会话](../../src/tui/resources/sessions.ts)、[成员 Provider](../../src/application/session-membership/providers.ts)。已有范围见 [OpenCode CLI](../opencode-cli.md)、[OpenCode Desktop](../opencode-desktop.md)、[Harness 指南](../deepseek-harness.md)及[原 Harness 合同](dsh-integration-contract.md)。本次仅完成规范及审计，不修改产品行为、不安装原生工具或恢复生产远端验收。

## CI 当前平台事实

| 检查 | Windows | Linux | macOS | 验收边界 |
| --- | --- | --- | --- | --- |
| 普通 `npm run check` | 已配置 | 已配置 | 已配置，失败不阻断 | 是仓库代码与受控测试，不代表真实工具兼容 |
| OpenCode CLI | 原生 probe 已配置 | 原生 probe 已配置 | 未配置 | Windows 本机通过；托管/本轮 Linux 首轮待验收 |
| OpenCode Desktop | 原生 probe 已配置 | 未配置 | 未配置 | Windows GUI 通过；完整串行 CI 生命周期未实跑 |
| Harness npm/Web | 原生 probe 已配置 | 未配置 | 未配置 | Windows 本机通过；托管首轮待验收 |
| Claude Code CLI | 原生 probe 已配置 | 未配置 | 未配置 | Windows 本机通过；托管首轮待验收 |
| Codex CLI/Desktop、Harness Desktop | 待开发 | 待开发/支持矩阵待核实 | 待开发/支持矩阵待核实 | C02/C03/C04/C00 |

三个专用 workflow 中的 Ubuntu `report` job 仅处理 artifact 和 Issue，不运行对应工具，不能计入 Linux 原生兼容覆盖。目前没有已保存并验收的专用 GitHub 托管 run；本次未查询远端 Actions，也未触发或推送工作流。

共同方案参考 [OpenCode CLI 已实现的兼容工作流](../../.github/workflows/opencode-compat.yml)：官方构建来源与摘要校验、隔离 HOME/数据/进程、本机 HTTP/SSE 脚本模型、基线与同一候选复现、下载/环境故障和兼容失败分开、去重 issue 与留存证据。模型凭据不放入 CI。

每项先核实对应工具的协议和自动化入口，再决定具体工装；不假定它们可以直接复用 OpenCode 的模型响应格式或桌面测试方式。探测任务和具有 issue 写权限的报告任务分离；不自动升级支持基线或改写用户软件。仅清理本次有明确归属的测试安装、进程与数据，保留规格、批准决定和验收证据。

兼容告警只在良好基线通过、同一候选重复出现同项失败且释放/清理证据完整时，按既有规则去重报告；下载、环境或工装失败单独归类。不得为验收制造外部错误 Issue，也不得将本地序列通过写成 GitHub 托管首轮已验收。

C00 后续还需明确：“跨平台”只要求每种工具在各操作系统上的原生接入，还是同时要求源工具/系统 × 目标工具/系统的跨机端到端组合。该层范围、公共协议测试与平台专属行为如何分层、PR/定时/发布检查如何分配，以及是否采用有依据的组合筛选，均留待讨论后决定；本轮不自行缩减为某一种抽样方案。
