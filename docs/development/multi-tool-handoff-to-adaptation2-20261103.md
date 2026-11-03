# 多工具适配 → Codex Desktop「多工具适配2」完整交接

2026-11-03（UTC+8）。用户明确要求“把所有的任务，以及关键上下文信息，和任务背景，全部交接给codex desktop的会话[多工具适配2]”。本文件是持久交接包，可用于新上下文续接；不依赖worker记忆。

## 1. 接手范围、现场与第一步

- 接收会话：多工具适配2；本机status只读核实唯一命中id8 **01a1a0d7**，originator=Codex Desktop，工作目录为同一仓库。实际发送仍由生产CLI重新解析目标。
- 仓库：D:/workspace/CC/multichat；branch：codex/core-refactor-pre-tui。交接前HEAD **100933d33b6a45c2e38602c5a6a27101eb7e8908**；本文件及交接索引会在此后单独本地提交，接手请重新核实真实HEAD/dirty，不切回旧基线。
- 工作树只有用户原未跟踪docs/代码消息投递.md；未作为本包资料来源，不修改、stage或删除。所有既有产品及证据提交均在当前共享历史，勿amend/push/checkout/pull/reset/clean/stash，不全仓stage。
- 转移本会话原有OpenCode/Harness、多工具完整接入与任务跟踪责任，**既定通信公共线及其它工具负责人不因交接改变**。原会话发送交接后停止开发，避免同文件双写。
- 用户当前要求root独立开发，先不交worker；最后worker为cworker1（Claude），最后来信短柄cA006仅作历史，不复用猜路由。worker已停写，没有活动派单。交接时collaboration只列root，无运行中的子代理。
- 当前停点：**C04-I03-C3方案完成，正式DSH Desktop原生执行尚未获环境决定/执行范围确认。** 先读本包、第2节入口和C3方案；不要立即安装/启动Desktop或触发Actions。用户尚未回答“提供独立VM还是先继续npm/Web”的最后问题。
- 第一轮向用户说明已经接手和当前停点；继续工作遵循已有授权，不重问已经批准的普通实现细节。原生环境/新功能文件/必需用户操作的决定仍保留，不能把本次交接视为批准这些事项。

## 2. 最小阅读顺序与权威文档

1. [AGENTS.md](../../AGENTS.md)及[代码规范](code-standards.md)。
2. [全量任务总表](tool-compatibility-ci-tasks.md)、[DSH优先完成计划](dsh-completion-plan-20261103.md)：当前排期/父项/完成口径的权威入口。下表快照用于交接核对，后续状态更新以总表为准。
3. [C04-I03-C3执行合同与独立Windows方案](evidence/c04-worker-20261029/I03-C3-execution-plan.md)：现在最直接的续接入口。新模块接线前按需查[C2开发验收](evidence/c04-worker-20261029/I03-C2-development.md)、[安装合同研究](../research/c04-windows-installer-contract-20261102.md)。
4. [工具完整接入规范](tool-integration-standard.md)、[七类入口审计](tool-integration-audit-20261027.md)、[DSH批准合同](dsh-integration-contract.md)、[DSH指南](../deepseek-harness.md)。
5. 涉及TUI先读[tui-progress.md](tui-progress.md)；续核心先读[core-refactor-progress.md](core-refactor-progress.md)。原核心/TUI已通过验收，不重建旧活动队列。
6. 改工具类型/来源先读[C14收敛稿](c14-explicit-tool-design-20261028.md)、[批准记录](c14-user-command-review.md)、[短柄已批准规格](c14-short-handle-ring-20261029.md)；增强先读[专题计划](multi-tool-membership-tasks-20261026.md)及[共享设计](session-selection-membership-design-20261026.md)。
7. 通信归属及W08历史见[Bug修复2交接](communication-handoff-bugfix2-20261029.md)。旧记录可能保留“当时未实现/未批准”，必须同时读后续补记、当前总表和批准记录，不把历史当现状。

无需开工就通读多轮raw或重跑旧反例；遇到对应实现/证据问题再按链接查。规格、批准决定、RED首败、完整原始输出都保留，不覆盖为新结果。

## 3. 任务背景与用户约束

crosschat的主线是让用户已有Claude Code、Codex CLI/Desktop、OpenCode CLI/Desktop及DSH npm/Web/正式Desktop的会话准确互通，配本机/SSH/TCP管理和CLI/TUI。通信“能发”不等于完整工具接入：还要技能/插件实际加载、维护、来源身份、诊断/TUI、从零CI和各平台验收。ZCode已由用户明确暂缓，不偷偷恢复。

用户多轮要求保留原有CI任务与编号；不要只列增强而漏原CI，不用测试通过率/表格位置编造总体完成百分比。原核心重构、TUI及授权的真实SSH/TCP检查已验收；跨机TCP实际经SSH隧道，不代表公网直连、多节点和全平台都通过，远端不安装Codex。具体范围见[真实远端验收](tui-remote-validation-20261023.md)。

用户先要求一单完成继续推进、遇必须拍板才停；后来明确本会话独立开发，先不交worker，并要求**先把DSH完成**。当前顺序：DSH正式Desktop生命周期 → DSH skill/插件维护 → 诊断/TUI → 从零基础CI与平台范围 → DSH已批准增强 → 本会话OpenCode等后续。共享父项先完成DSH切片即可向下推进，不等所有工具；其它负责人可以独立推进。

- **必需用户操作变化或新增非skill功能文件先等用户拍板。** skill新增已获明确允许，Harness作为默认第三技能目标已批准；不代表允许新增运行账本、任意源码/驱动/workflow或自动修改原生配置。
- DSH正式Desktop在独立干净runner/VM验证，**不在当前开发宿主试装**。真实安装/卸载、新文件、外部Actions/发布沿各自批准边界；交接不扩大授权。
- 技术事实缺证据由代理调查，不让用户编造证书值；用户决定用于真实授权、环境、产品行为变化。先完成可审阅方案再请求最终决定。
- 普通开发使用npm/Vitest、隔离fixture，有价值行为/失效路径先RED再GREEN；保留既有CLI/JSON、路由、默认扫描、权限、册位和清理语义。正式工具＋loopback模型桩，不索取个人模型key。
- 已验收子单移出活动项，长期合同和历史证据保留；不要无限重开离线helper而不推进真实流程。
- 不用其它项目的自动创建/恢复会话替代我们的已有live目标；不静默queue/steer互换，不把“停止当前轮后重发”当steer，写入不明零盲重发。

## 4. 已完成成果、提交与真实边界

| 成果 | 证据与版本 | 不要扩大为 |
| --- | --- | --- |
| 原核心、TUI及远端检查 | 上述progress及[tui-final-validation](tui-final-validation-20261022.md)、真实远端记录 | 各新工具从零流程/所有平台已验收 |
| DSH npm/Web基础通信 | [dsh-validation](dsh-validation-20261023.md)；真实npm runtime/Host桥、精确发现/发送、busy queue/steer、native shell回信、本地基线候选序列已验证 | 正式DSH Desktop、托管GitHub首轮已通过 |
| C13桥生命周期及文档 | [I01最终验收](evidence/c13-worker-20261029/I01-final-review.md)、[I02最终验收](evidence/c13-worker-20261029/I02-final-review.md)；桥产品4f8b6c2等，指南80ef1f5等 | 所有Host崩溃/真实Desktop组合都已验证，或C13父项关闭 |
| C08默认三侧skillPlan | 产品a77a39b，root定向87/87；[最终验收](evidence/c08-worker-20261029/I01-final-review.md) | 真实Harness加载、POSIX分支、历史/项目副本和三平台已验收 |
| C14公共类型/短柄 | 303e7ce产品；[短柄规格/证据](c14-short-handle-ring-20261029.md)及总表C14 | 全部调用来源自动关联、正式Desktop来源、W08已验收 |
| C04-I01离线Desktop报告/串行序列 | [最终验收](evidence/c04-worker-20261029/I01-final-review.md)；后续报告身份/假值/归属边界已闭合 | 报告字段等于原生事实；或有Desktop原生执行 |
| C04-I02固定元数据/流式下载校验 | 产品33f9c05、fixture6648c91；[最终验收](evidence/c04-worker-20261029/I02-final-review.md)，root54/54，worker完整2584/11 | 真正下载过官方EXE、签名/安装已通过 |
| C04-I03-B只读签名准入 | 最终产品/证据6fb9ac1；[代码收口](evidence/c04-worker-20261029/I03-B-review-closure.md)，root77/77，双轴无未决 | 整仓当轮全绿、原子执行授权或实际可信publisher已取得 |
| C04-I03-C1受控直接child执行 | 最终e13e04f；[代码收口](evidence/c04-worker-20261029/I03-C1-review-closure.md)，目标93/93 | 任意外部Host已自然退出、所有子孙释放或官方安装成功 |
| C04-I03-C2卸载前守卫 | 产品3b3f05bf9bfd576267e52acd6e42b2c65cd526b7；root独立开发、自审，102/102，单次完整check2632通过/11跳过、退出0，231文件/3跳过，lint/导入图203模块682边/build通过；raw为[I03-C2-check](evidence/c04-worker-20261029/I03-C2-check.txt) | 双人独立复审、真实Host observer或官方卸载器已接通 |
| C04-I03-C3真实执行方案 | 最新100933d；[执行方案](evidence/c04-worker-20261029/I03-C3-execution-plan.md)，89个文档内链/25父项/11CI索引核验，纯文档 | 原生安装/GUI/自然退出/卸载/系统注册验收已完成 |

最后产品完整绿是C2的2632/11，之后只有研究/计划/本交接文档，没有重新跑全量。C1历史11/7/14条失败、B最终17失败/2590通过/11跳过等原始证据不能擦除；当时失败集中于未改的状态/会话/发送文件。独立锁探针曾见EADDRINUSE/acquired=false，但**不证明每条失败同因**，C2后来绿也不证明历史根因已修复。通信状态归Bug修复2。

C01（Claude本地兼容CI开发）和C07（接入规范/审计）已完成并移出活动表。C08/C13等子项完成但父项仍开放；当前不是“零项工作完成”，也没有按工作量计算的总百分比。

## 5. 当前最重要停点：C04-I03-C3后续

C3已把download/admit → 官方安装 → 内置runtime/profile和实际加载 → 正式UI投递/回信 → Host自然退出观测 → C2 → 官方卸载 → bridge/系统注册对账 → 删除自有根连成可审阅方案。

新核实/订正：
- builder的allowToChangeInstallationDirectory:false不能推断自定义UI不可编辑目录；同版本README说明可编辑，installer.nsh保留自定义welcome的目录。交互finish默认勾选启动有文档，但**实际包/静默参数与自启动仍未测**。
- ×/Alt+F4隐藏到托盘，Host继续。正式Host是Electron Node子进程，shutdown-complete走私有IPC；stop可升级SIGTERM/SIGKILL。普通Quit的外部无强停证据尚缺，不能拿PID消失、桥消失或shell/helper的C1记录充当Host自然退出。
- C2只消费可信runner回调，仍须实现真实observer/官方卸载调用；官方卸载在probe生命周期内，sequence.remove仅在完整cleanup后删自有根，不把官方卸载挪到remove制造循环。
- publish policy没有可信默认值；必须独立取得subject/thumbprint，不从待核验EXE自己回抄，不用社区指纹作策略。真实安装参数/目的地/卸载器/注册key还待获准guest事实。
- 内置dsh.cmd与C1的shell:false尚须Windows启动接线核实；不要拼不受控shell或假装已经接通。

环境建议为可销毁Windows11 x64交互VM，4vCPU/8GiB/100GiB（建议值），干净检查点、guest独占home/loopback模型、各阶段baseline和证据。当前宿主Windows11、31.6GiB总内存，C3查询时空闲约3.4GiB、D盘约392.8GiB可用；Hyper-V模块/vmms存在，但Get-VMHost权限不足。**没创建VM、没提供guest、没批准原生执行**；数字只是当时观察，应重新核实，不能自动关闭用户应用或提权。

C3列出尚未批准/创建的可选功能文件：scripts/dsh-desktop-compat.mjs和.github/workflows/dsh-desktop-compat.yml。可先做无需这些文件的guest交互合同探测；仍须有环境/执行授权和准入资料，手工探测不算自动化CI。环境未就绪时DSH npm/Web的C08/C13维护证据或C10诊断核对可独立推进，不用Desktop阻断所有DSH工作。

## 6. 全量任务快照：24条主线＋O08，共25个未关闭父项

这是交接前总表的逐行快照；每行都保留原负责人/依赖及完成边界。共享父项完成DSH切片不等于所有工具完成。11个CI相关索引为C00、C02、C03、C04、O06c、C05、C06、C11、C12、C21、C22。

| 推进顺序 | 编号 | 任务与完成标准 | 负责人／必要依赖 | 当前状态 |
| --- | --- | --- | --- | --- |
| 1 | C04 | Harness正式Desktop在独立干净runner验证包/profile/插件、真实UI收发、退出、官方卸载及注册清理，保留生命周期工装；本机不新增此前难清理的系统注册。 | 本会话；C13合同、C14类型规则，技能部分消费C08；先做既定Windows范围，完整桌面workflow/托管首轮由C11/C12收口 | [I01](evidence/c04-worker-20261029/I01-final-review.md)/[I02](evidence/c04-worker-20261029/I02-final-review.md)已验收；[I03-B](evidence/c04-worker-20261029/I03-B-review-closure.md)/[C1](evidence/c04-worker-20261029/I03-C1-review-closure.md)代码收口。[C2](evidence/c04-worker-20261029/I03-C2-development.md)root独立完成，产品3b3f05b、目标102/102，单次完整check2632通过/11原有跳过；历史失败保留。[C3执行方案](evidence/c04-worker-20261029/I03-C3-execution-plan.md)已交付，目录/交互启动订正、调用链和VM方案明确；独立guest/执行范围待决定，publisher、实际参数/自然Host退出observer等待证。无原生Desktop验收，父项未完成 |
| 2 | C14 | 明确工具类型与send必填收件tool；补自动来源识别、同源跨会话复用、并发询问去重及重启自动重核。无法可靠确认/持续复用的入口先列证据与方案交用户逐项拍板；按批准范围整改寻址、引用、回信、类型隔离、TUI模板和skill教学。 | DSH类型/来源切片随原生入口验证；[收敛稿](c14-explicit-tool-design-20261028.md)及[批准历史](c14-user-command-review.md)；共用层与Codex/Claude负责人协调，公共合同供下游消费 | 本轮公共整改最终check 2416通过/11原有跳过，Windows ConPTY三场及Harness正式npm/Web来源两轮通过，记录收口。Codex调用到CLI/Desktop关联、OpenCode多服务来源和正式Desktop专属增量仍未完成；逐入口例外不默认获批，整项继续保留 |
| 3 | C13 | Harness skill与Host bridge分开管理，先明确安装、更新、禁用、重连、移除及归属，保留其它配置；按合同补生命周期接线。 | 本会话；C14类型合同；合同先供C08/C04，Desktop验收随C04补齐 | 桥清理[最终验收](evidence/c13-worker-20261029/I01-final-review.md)：root定向80项、包含R1的共享全量2527通过/11跳过（最多2 worker）；[生命周期说明已验收](evidence/c13-worker-20261029/I02-final-review.md)，未增用户步骤/功能文件。合同可供C08/C04，C04及诊断边界保留，C13未完成 |
| 4 | C08 | install-skills、更新、卸载及TUI维护共用目标计划；补Harness，明确OpenCode兼容/原生目录、自定义home/profile/project、安装卸载对应关系、覆盖更新和遗留文件语义。 | 各工具接线，共用维护入口协调；接入规范、C14合同、C13插件/技能边界 | 默认三侧维护接线及两轮边界修复已[最终验收](evidence/c08-worker-20261029/I01-final-review.md)，产品a77a39b；root定向87通过，worker完整check第二次2544/11、首次machines断言失败保留且根因未确认。正式加载/平台验证、历史与项目副本/额外文件语义的后续收口保留，整项未完成 |
| 5 | C10 | 原生服务/鉴权/版本、实际技能和插件位置诊断；统一skill references、help、工具指南、architecture和包元数据；纠正旧恢复及清理教学。CLI/JSON/TUI同源。 | 各工具负责人；接入规范、C08/C13目标与合同、C14；Desktop事实消费C04；供C09接线，基础出口共同核对 | 待整改；保留已有用户README修改 |
| 6 | C09 | 补列表、筛选、详情、发送命令复制、成员展示、技能维护/诊断及错误指引；补Harness真实来源终端验收，复用共享成员页。 | 本会话做OpenCode/Harness；C08/C10、C14类型合同及相应原生入口；不等待增强C17/C18/C24 | 部分已有代码与证据，完整接入补验待做 |
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

## 7. 不能接管或误判的通信上下文

- 用户明确由现有Codex Desktop「Bug修复2」处理公共通信/状态/短柄，用户亲自对接。C02/C03/C06及Claude/Codex公共基础也按原负责人，不因本交接自动转给你实施；你接全量索引和本会话原有工作。
- C14已批准：send明示收件--tool、端点独立、原生ID不透明、完整ref保留；来源无法可靠确认的具体入口要逐项交用户决定，不能默认开启人工兜底。
- 短柄不是旧c数字：当前cA000～cZ999，最近1000次分配窗口、原LRU8、进度复用现有分片；到Z999不回A，不能安全读写则完整ref；普通清理保最高进度，强清/手动删除是重置。用户已批准删除19个旧分片及直接升级，不恢复旧全局/数字柄兼容，不新增独立账本。不要按旧W07报告重新要求讨论已批准方案。
- W08 OS来源研究交付到1066e30，仍无root最终验收；逻辑owner不是PID，采样只能称instance-unverified，创建时间有窗口。不能把研究接入identified生产或追加用户Hook配置。
- worker以前“找不到会话”是Claude会话内ListAgents/SendMessage只能看Claude通道，不能据此判断Codex Desktop不在；仓库crosschat链路可用。新上下文/clear后会话ID和短柄会变化，按status与typed hint核实，不猜旧号。
- worker无法用agent工具执行Claude内置/clear，只有用户手动输入；不得用cls、删会话文件、口头声明或新建会话伪装清空。将来使用worker每单发独立最小包，不要求记旧聊天。

## 8. 两个参考项目与未来crosschat Desktop

[OpenBot研究](../research/openbot-integration-study-20261103.md)：固定21369e1eec420772a7db9f6bbfeae2ef9b3ab83a；自己托管Agent、原生App Server/SDK与ACP混合；DeepSeek条目是Pi模型API，不是DSH Harness。可借鉴driver/flavor、明确能力、未确认零重发、异步后再核对、回信合同和资源owner。

[CodexHost研究](../research/codex-host-integration-study-20261103.md)：固定78106589d07d3ad7af1079e3252afa30c2062477；扩展Codex Desktop＋CLI Shim，有真正DSH托管Web/Remote/V4适配器；DSH这条路径不用ACP。它创建/恢复托管会话，不证明附着已有用户UI会话或正式DSH Desktop。可借鉴requestId关联和原生停止证明，不采用缺steer时停止后重发、自动恢复替代目标或其latest/版本策略。

crosschat目前**未实现ACP**，不能宣称包含全部ACP功能或为ACP超集。DSH当前为Host插件＋Bearer loopback HTTP，借用已有live root Agent。用户明确两份研究以后也供**crosschat自己的Desktop**参考，具体需求会另行沟通；此产品Desktop尚未开工，不与当前C04“适配DSH正式Desktop”混淆。没有复制第三方代码/依赖或自动授权新架构。

## 9. 被拒操作、清理和文件归属

五个历史被拒DSH资源固定在687f282e...：apps/desktop/tests/windows-installer-smoke.ps1、apps/desktop/tests/windows-uninstall-smoke.ps1、apps/desktop/installer/pages.nsh、apps/desktop/windows-signing/README.md、apps/desktop/scripts/installed-update-qualification.ts。**不重试、不换URL/工具/分支/委托绕读。** C3宽泛搜索曾意外返回签名说明/社区摘要，没有继续打开或作为可信策略；不要接续绕行。

交接本轮只读lstat核对，没有删除：
- node_modules/.cache/crosschat-w05-root-check-20261029-1793262269226.log仍在，33064字节；历史删除被自动审批以blocked by policy拒绝。
- node_modules/.cache/crosschat-c14-caller-research-20261028仍在（历史研究缓存）；删除同样被拒。不换工具再试。
- node_modules/.cache/c14-regression-results-20261028.json仍在，874794字节；是否唯一副本/已归档未核实，不能自动认定可删。
- 旧node_modules/.cache/crosschat-dsh-20261023-0975b6b93f724fec95264ad45903f291及TEMP/crosschat-dsh-ci-test-ijFbEi本轮均不存在；TEMP中crosschat-dsh-ci-test-*、crosschat-c04-i03-*匹配0项。不要继续列旧45字节合成EXE为现存垃圾，不能说本会话删除了它们；检查不代表全机TEMP干净。
- 旧远端fixture/隧道已回收。真实远端验收文档后续17:01补记确认原两个本机测试凭证根亦已不存在，早先blocked是历史，别重开远端测试/清理。永不在远端Linux安装Codex。
- 保留docs/development/evidence、批准规格、原始失败/日志和本交接包；用户未跟踪文档不是垃圾。不得借D盘统一清理约定扩大到不明目录。

## 10. 续接开发、验证和沟通操作

- 代码遵从AGENTS与code-standards；Provider差异留Adapter、传输差异留Context，CLI/TUI展示共用事实；不造第二套状态/队列/成员机制，不按任意行数拆生命周期owner。
- npm run check = lint → imports → build → test。必要时沿既定VITEST_MAX_FORKS=2、VITEST_MIN_FORKS=1、VITEST_MAX_THREADS=2、VITEST_MIN_THREADS=1，未启用CROSSCHAT_LIVE；用例隔离、有意义RED、finally实际close/释放gate。新失败原样留raw，不连续全量追绿、不靠skip/放宽断言掩盖。
- 定向绿、全仓绿、Windows原生、真实UI、托管runner首轮、三平台是不同证据。普通文档交接只检查diff/链接/任务完整性，不重新跑产品全量冒充验证。
- 使用仓库node dist/cli.js，先status确认会话名和工具；send必须明示--tool。用户让代发用--delivery steer，普通自主协作默认queue，回复逐条独立选择。长文走stdin，PowerShell用ReadAllText/单引号here-string，不在命令里插用户正文。
- delivered只说明通道受理，confirmed说明历史看见，均不等于对方已实施。queued/parked/unconfirmed不能据此重发，结果不明先核实。发送成功后不轮询等回复，不接纯确认循环。
- 本交接发送由原会话承担一次；接收方读包后可一次回报已接手及有无关键缺项。**不要重新向worker派单；不要未经新决定安装Desktop、创建VM/功能文件或触发Actions。** 用户后续在「多工具适配2」安排实际继续事项。

## 11. 交接核验与停止

本包任务快照与总表25行/顺序一致，11个CI索引齐全；本包及三份更新索引共129个本地相对链接存在性检查通过，git diff --check通过。原产品/测试/raw不修改，本次不重跑npm/Vitest；新文档提交后真实HEAD由git核实，不在本文件循环写自身SHA。发送回执以原会话实际crosschat工具结果为准，文档预先落盘不等于对方已读。

原会话发送本包后停止开发；无活动worker/子代理、原生进程或未完工具任务需要迁移。接收会话从上述停点接手，历史约束、外部负责人、未获决定和未完成事项都继续有效。
