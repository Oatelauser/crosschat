# C04-I03-C3：正式 Desktop 执行合同与独立 Windows 环境方案

2026-11-03（UTC+8）。用户要求按已借鉴的思路开始下一单，root独立完成，无worker或子代理。开工基线 `69c4e5d0bfc84d5598993c9e17037b05a73cd237`，branch `codex/core-refactor-pre-tui`；仅用户原未跟踪 `docs/代码消息投递.md`，未触碰。范围来自[DSH优先计划](../../dsh-completion-plan-20261103.md)，承接[I03安装研究](../../../research/c04-windows-installer-contract-20261102.md)及[C2组件](I03-C2-development.md)。

**本单交付的是执行方案及待决定事项；I03/C04和正式Desktop验收仍未完成。** 没有下载/执行官方EXE、创建VM、注册runner、触发Actions、启停Desktop/Host、写注册表或修改产品。没有新增功能文件/依赖/用户命令。下面的命令、路径和回调安排除“本机只读观察”外均为拟议，不能当作已执行结果。

## 1. 本轮核对与订正

上游固定 `687f282e8625c6b8d11ff58211a90524be2e4317`，只读允许的README、packaging说明、builder配置、installer.nsh、uninstall.nsh、windows-sign.mjs及Desktop main/Host/退出源码。以下链接都是该固定版本。没有打开此前被拒的五个资源；宽泛检索意外出现的签名说明/社区证书摘要未继续打开或用于填充可信策略。

| 执行事实 | 本轮证据与结论 | 尚不能声明的部分 |
| --- | --- | --- |
| 固定Windows发行物 | 现有[baseline](../../../../scripts/dsh-compat-baseline.json)固定0.2.1-rc.2、官方版本化URL、289385456字节及完整SHA-512；复用I02 | 没有真实下载或核验正式EXE |
| 安装目录 | builder的allowToChangeInstallationDirectory为false；同一版本README明确自定义安装UI可编辑目录，installer.nsh保留custom welcome选中的目录 | **订正旧推断**：不能把该builder配置等同“用户不能改安装目录”。实际包是否符合说明、默认根和命令行目录参数仍待测 |
| 当前用户安装 | 固定配置perMachine:false/allowElevation:false，customInit拒绝all-users和既有HKLM安装 | 不等于我们已证明目的地、所有HKCU冲突和跨目录升级无影响 |
| 首次交互安装 | README说明finish页的启动勾选默认选中；安装器先退出再启动应用，运行中同路径程序阻止安装 | **订正旧范围**：交互式finish的启动行为有文档依据；静默安装是否自启动、`/S`/`/D=`拼写和实际效果仍未知 |
| 插件与内置runtime | README规定首次启动初始化后完整退出，再用内置resources/runtime/cli/bin/dsh.cmd管理desktop profile；npm dsh不能代管 | 实际文件清单、加载成功、skill可读及正式GUI回信仍须实测 |
| 关闭窗口 | 主窗口×/Alt+F4隐藏到托盘，Host与任务继续；菜单/托盘Quit才走退出流程 | 不把关窗当Host退出；不自动给用户新增关窗/强退步骤 |
| Host进程身份 | Host由Electron以Node模式spawn；entry为安装runtime内dsh-desktop-host/lib/index.js，stdio含私有IPC | 进程名称相同、PID相同或桥端口消失，均不足以单独证明本次Host及自然退出 |
| 退出完成 | stop发送shutdown，最多等10秒，再可能SIGTERM/SIGKILL；requireGraceful分支还检查exitCode和shutdown-complete | 普通Quit不自动提供外部runner可读取的完整自然退出证明；不能只填forced:false |
| 卸载与残留 | 原生卸载保留Harness home；`/KEEP_APP_DATA`/更新分支跳过数据移除；锁定残留不使卸载失败 | 尚无固定卸载器实际路径、完整命令及系统注册撤销的正式包证据；退出0不证明无残留 |
| 发布者策略 | windows-sign源码由发布环境证书派生身份；所查GitHub rc.2发布页无附件，也没有subject/thumbprint策略 | 仍缺独立可信发布者材料；不从待核验EXE或社区指纹回抄期望值，缺失即零安装 |

来源：[配置](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/scripts/electron-builder-config.mjs#L238-L261)、[自定义目录保留](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/scripts/installer.nsh#L79-L100)、[当前用户检查](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/scripts/installer.nsh#L32-L44)、[交互目录与finish启动](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L250-L260)、[内置CLI](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L129-L141)、[关窗及Quit](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L67-L77)、[Host启动/退出](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/src/host-process.ts#L186-L233)、[自然收尾与强停分支](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/src/host-process.ts#L282-L307)、[卸载数据规则](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/installer/uninstall.nsh#L1-L36)、[签名身份派生](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/scripts/windows-sign.mjs#L76-L94)、[rc.2发布记录](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)。

## 2. 推荐环境及已核实的可用性

**推荐先做独立、可销毁Windows 11 x64 VM中的交互式合同探测，再接自动化CI。** 首轮不依赖新增workflow，也不要求给日常用户添加配置。首轮可记录真实GUI步骤；该结果不冒充自动化/托管通过。已有安装器UI允许选目录的说明可供探测，不能在参数未证实时拼猜静默命令。

| 项目 | 具体安排 | 当前状态 |
| --- | --- | --- |
| 虚拟机 | 拟用独立Hyper-V二代VM，名称crosschat-dsh-c04，建议4 vCPU/8 GiB/100 GiB动态磁盘、Secure Boot/vTPM；建议值为本项目工装选择 | 未创建，无Windows镜像/已配置guest的可用证明 |
| 创建位置 | 若选本机Hyper-V，拟用D:/crosschat-test-vms/c04-dsh；只存该VM磁盘/检查点，工作区不向guest提供可写共享 | 目录不存在性/所有权需创建前核实，本轮不创建；不使用已拒TEMP/cache |
| 身份及GUI | guest专用测试账户、可交互且未锁定的桌面；记录Windows session ID、分辨率和runner PID | 账户/会话均未配置。首先人工保持测试会话；不在宿主启用自动登录 |
| 代码与依赖 | guest独立工作副本固定到待验提交，Node22/npm ci/build；模型只用guest自身loopback桩和fixture凭据 | 不挂载宿主个人home、原生配置或模型key；不安装Codex到远端Linux |
| 隔离数据 | guest内C:/crosschat-c04/<runId>/分别放下载、工作目录、DSH_HOME、crosschat HOME、证据；Electron/安装器实际APPDATA等系统位置另做baseline | 不假设重设环境变量就能拦住所有Electron/安装器写入；VM才是外层隔离 |
| 网络 | 下载/依赖阶段允许所需官方服务；模型请求限定guest loopback并留桩记录；不依赖宿主本机端口 | 尚未配置。首次欢迎/更新界面可能需额外网络事实，遇阻记录，不自动改用户账号或更新策略 |
| 本地与托管 | 第一轮在guest交互终端运行；后续才考虑同一guest内GitHub runner以run.cmd交互运行，新增独立workflow | 未注册runner、未触发Actions；授权与GUI可用性分开验证 |
| 初始快照 | 操作系统/依赖准备好且未装DSH时，关机建立clean-c04检查点；每个新完整序列前核对该基线 | 检查点只用于环境回收，不是官方卸载证明；不靠回滚跳过失败进入候选 |

Windows 11 VM的官方下限是二代、2 vCPU、4 GB、64 GB及相应Secure Boot/TPM要求；上表8 GiB/100 GiB是建议余量。[Microsoft VM要求](https://learn.microsoft.com/en-us/windows/whats-new/windows-11-requirements#virtual-machine-support)。有Hyper-V管理模块不证明具备hypervisor权限或足够并发内存。[Hyper-V要求](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/host-hardware-requirements?pivots=windows)

GUI测试需要交互桌面，服务方式不能当作已具备可见桌面；Microsoft对此给出明确配置约束。该文针对Azure Pipelines，**不据此断言GitHub所有Windows runner都不能GUI测试**；GitHub的Windows 11 larger image是否适合本工装、账户/费用/桌面能力仍待独立验证。GitHub官方runner支持run.cmd交互启动。[Microsoft GUI说明](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/ui-testing-considerations?view=azure-devops#visible-ui-testing-using-self-hosted-windows-agents)、[GitHub runner设计](https://github.com/actions/runner/blob/main/docs/design/auth.md#start-and-listen)、[GitHub larger runner规格](https://docs.github.com/en/actions/reference/runners/larger-runners)。

**本机只读观察（本轮实际执行）**：Windows 11专业工作站版，10.0.26200，64位；Win32_OperatingSystem报告总物理内存约31.6 GiB、查询时空闲约3.4 GiB；D盘查询时可用约392.8 GiB。Get-Command能找到Get-VM/New-VM，vmms服务为Running；Get-VMHost返回权限不足。本轮未提权、未枚举其它VM、未关闭用户应用。模块/服务存在不能写成“环境已就绪”；当前不能直接承诺本机创建并启动8 GiB guest。其它机器或现成干净VM均尚未提供。

只读命令为Get-CimInstance Win32_OperatingSystem、Get-PSDrive -Name D、Get-Command Get-VM/New-VM、Get-Service vmms、Get-VMHost（异常捕获并如实记录）。上述内存/磁盘是当时观察，不是持久资源预留。检查点的回退行为参见[Microsoft检查点说明](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/checkpoints)。

## 3. 整条调用链及现有接线位置

以下只复用[现有CI模块](../../../../scripts/dsh-compat-ci.mjs)，不新增另一套下载、进程或资源框架。

| 步骤 | 现有组件/接线 | 必须补齐的真实事实与失败出口 |
| --- | --- | --- |
| 0. 环境与安装前baseline | runDshDesktopSequence的install前置 | 确定guest/账户/本次owner；只读记录本次相关目录、HKCU/HKLM卸载项两种注册表视图、dsh协议与命令PATH、DSH进程/启动时间。已有安装或外来注册时拒绝该序列，不清理外来项 |
| 1. 下载/准入 | parseDshDesktopWindowsManifest→downloadDshDesktopInstaller→admitDshDesktopInstaller | 精确元数据、真实字节/签名与独立publisher策略；不明即零安装。临近spawn再调用准入，执行本次私有文件并限制外来写入；仍不声称消除Windows路径执行TOCTOU，证据记录实际路径/摘要/ACL和执行前后状态 |
| 2. 官方安装 | sequence.operations.install＋runDshDesktopProcess | 首次仅在获准guest按官方交互界面观察目录/finish，记录真实退出与目标；参数证实后才自动化。部分安装一旦有root即分配installationId/owner，异常挂error.installation并保留；没有身份也如实记录未知，不猜根/补卸载 |
| 3. 初始化/配置/加载 | Desktop首次启动→完整Quit→内置dsh.cmd plugin --profile desktop add→匹配skillPlan目标→重开 | 保留官方发行物不打包替代；launch前配置guest的loopback模型和独占home。记录runtime descriptor、内置CLI/插件管理结果、实际profile和skill加载，不能只看复制成功 |
| 4. 固定实际UI与桥身份 | probe(installation,artifact,label,context)，其中context.runId已由sequence分配 | 在runDshDesktopAttempt前完成真实启动/GUI建会话及launch采样；绑定本次bridge instanceId、Host PID/创建时间/安装路径、profile=desktop、完整sessionId。不得从待验证report回抄launch；不能用另起Web会话代替UI |
| 5. 投递/回信 | runDshDesktopAttempt({installation,artifact,launch,runId:context.runId},execute) | 正式Desktop可见会话＋生产crosschat发送，idle、busy queue/steer、native shell来源和完整回信；截图/可访问树＋模型桩/桥回执相互对账。受理、消费、回答分开；结果不明不盲重发，不采用“停止后重发” |
| 6. 请求退出/观察 | 正式菜单/托盘Quit→真实observeHostExit | observer须持续拥有准确Host的OS句柄/生命周期，不只事后按PID扫描；同时确认进程身份/退出结果与无强制终止。普通Quit内部可升级kill，缺自然收尾证据就保留未知，不能把shell/探针进程的C1记录充当Host |
| 7. 官方卸载 | runDshDesktopUninstall({installation,launch,runId,...},{observeHostExit,uninstall})；uninstall使用C1 | 真正进入C2前observer已能证明自然退出；再次核对安装归属、卸载入口、取消/截止；参数/路径未证实则不spawn。C2正常返回仍只证明进程事实，不生成uninstalled |
| 8. 对账/报告 | probe形成六项desktopChecks与独立cleanup，attempt核验 | 分别核对官方安装已移除、bridge登记、dsh协议/卸载项/快捷方式等本次增量、数据保留和本次命令注册。退出0、桥404、原生turn/end、VM回滚都不代替这些证明 |
| 9. 删除自有工作根/下一构建 | hasDesktopCleanupProof通过后sequence.operations.remove | remove只删经绝对路径和owner核实的本次根，不执行官方卸载、不递归删除任意DSH_HOME/系统目录。失败保留路径/身份/reason并停止；基线→候选→必要重试仍串行 |

runDshDesktopAttempt的execute返回值是**报告执行进程**的退出事实；C2内observeHostExit的process必须是**本次真实Host**的观测。两者有独立PID和责任，不能为了适配结构拿同一个正常helper记录充数。C1目前只负责自己spawn的child，无法直接替外部Host生成天然可信记录；真实OS observer如何取得无强停证据是未实现前置。

内置CLI还有独立接缝：C1明确shell:false，不能假定把dsh.cmd作为binary就已完成Windows启动适配。guest需要先核实正式launcher的调用方式/参数往返和实际进程归属，再决定显式解释器或内置Electron分发器的启动方式；不拼接不受控shell字符串，也不借此改C1或Web的既有合同。

最窄自然退出策略：先核实正式包是否对外提供可归属的shutdown-complete/强停诊断或其它等效证据，并在Quit前绑定Host生命周期。固定源码的shutdown-complete当前走Electron父子私有IPC，普通Quit未自动导出它；这次没有找到可直接消费的公开外部完成证明。若只能看到PID消失/exit code，保持自然退出未知并阻止官方卸载；不得注入/篡改官方包、假造确认或偷偷放宽forced:false。是否需要原生测试观察扩展，应依据guest实际观测提出最小独立方案后再实现。

## 4. 首次探测、后续自动化与拟改文件

采用分段交付，避免再次只堆离线helper。**第一次是环境内合同探测，第二次才是固定合同后的自动化接线。** 首次探测也要先有执行授权及可信publisher资料；同意环境方案不自动放宽签名准入。

| 范围 | 拟改/拟增路径 | 本轮状态与替代 |
| --- | --- | --- |
| 首次原生合同探测 | 不要求新增功能文件；使用既有下载/准入/C1及交互GUI，结果落本目录证据 | 可先取得实际目录/卸载项/启动/GUI/退出事实；手工证据不算自动CI |
| 自动化编排 | 修改scripts/dsh-compat-ci.mjs、test/dsh-compat-ci.test.ts；按实际需要复用现有dsh mock/fixture helper | 未改。Web默认main保留；Desktop显式单独入口/选择方式须先写清内部runner合同，不新增面向用户命令 |
| 如确需独立报告/GUI执行进程 | **拟增scripts/dsh-desktop-compat.mjs**：附着调用方已固定的本次Desktop/会话，执行UI收发和退出/卸载对账，写独立报告 | 尚未创建/批准；替代是既有CI模块内部实现一次attempt。正式包的UI可访问性和observer先核实，再决定是否必须拆文件 |
| 托管首轮 | **拟增.github/workflows/dsh-desktop-compat.yml**：仅选已核实交互guest，手动触发、串行、独立Desktop artifact，初期不建Issue | 尚未创建/批准/运行；替代是guest本地执行。不得复用当前Web reporter来声称Desktop回归已分类 |

新增两份功能文件不是本次完成条件，也没有自动授权。选择本地首次探测可暂不增加它们；决定独立脚本/workflow时再以实际路径审阅。现有Web workflow的windows-latest、75分钟和Web报告范围不证明正式Desktop GUI能力；不改它来掩盖缺口。

## 5. 基线、失败归属与回收证据

先在guest保留runId、installationId、owner和固定版本/摘要，再对本次相关位置记录安装前、安装后、退出后、卸载后快照。注册表实际key/卸载器路径从真实差异中读取，并与本次安装路径/签名对账；不猜GUID，不把HKCR合并视图当作HKCU/HKLM来源。安装/卸载命令不把注册表里的字符串拼成shell；路径/参数解析和归属核实后才允许C1。

每个attempt建议保留baseline、artifact/signature、install-process、installed-layout、launch/Host身份、UI截图/可访问树、消息/桩回执、退出观测、uninstall-process、注册/文件差异及最终report；只保留本次fixture资料，普通证据不输出token/credential。原始stdout/stderr与实际退出值随阶段即时留存，接受/超时/未决字段不能用人工摘要替代。

任一步失败停止对应序列，保留retainedInstallation/root/reason；没有确认释放不删安装根、不继续候选。guest失败现场先向隔离证据目录导出可读材料，再申请回收/恢复检查点；如果最终只能销毁VM，则标记“环境已回收、原生卸载未证实”，不能追填cleanup为true。成功也先完成官方卸载/增量对账，导出证据后再回收guest。VM镜像/检查点的删除只限新建且归属明确的路径，并需满足所选环境的实际授权；不触碰历史被拒清理。

## 6. 现在需要决定的最窄事项

| 事项 | 建议与明确影响 | 当前能否继续 |
| --- | --- | --- |
| 独立Windows环境和执行范围 | 优先使用用户提供的可销毁Windows 11 x64 VM，允许仅在guest安装、启动和官方卸载本次DSH；无现成环境时，再决定本机Hyper-V创建权限/资源或其它专用VM | **待用户决定/环境提供**。本机不能凭现有权限创建，当前宿主仍不试装 |
| 发布者及真实合同资料 | 由获准的独立官方/发布方材料补subject/thumbprint，之后在guest验证实际目录/卸载参数/自然退出事实 | **技术事实待证**；不要求用户编造证书、不借执行授权绕过准入；未补齐不安装 |
| 新脚本/workflow | 先做无需新功能文件的guest合同探测；必要时再单独审批上表准确路径 | 这轮无需决定；没有创建或预先批准 |

Desktop环境等待期间可独立推进既定DSH npm/Web的C08/C13实际skill/插件维护证据或C10诊断核对；它们保持原编号，不重复开发已验收计划层，不冒充正式Desktop结果。本单不自动领新项或派worker。

## 7. 本单核验与收尾

root对已读源码、既有接口、未实现observer/执行层、环境与用户决定做规范/合同自审；没有独立审查代理，不称双人复审。五份变更文档89个本地相对链接存在性检查通过，25个父项编号/顺序和11个CI相关索引保留；git diff --check通过。本单不改代码或测试，因此不重跑npm/Vitest，不借旧2632/11称本单原生通过。C3方案交付从活动实施项移出，原生执行前置和C04/I03父项仍开放。

未创建临时根、VM磁盘、下载包或后台进程；没有新的待清理软件/登记。只读工具的GitHub响应留在会话工具结果，资料以固定permalink续接；历史TEMP/cache、五份被拒资料和用户未跟踪文档均未操作。


## 8. 2026-11-03 多工具适配2续接：本机下载与新增用户决定

本节是后续执行事实，上文C3方案当轮未下载/未执行的历史保持原意。用户要求持续推进至暂停或需拍板；用户命令/交互变化与新增非skill文件仍需具体决定。

用户先授权独立Windows guest内安装、启动、官方卸载，但未提供guest连接；随后询问WSL、本机下载验证。WSL是Linux环境，从WSL启动Windows EXE仍在宿主执行，不能替代Windows安装隔离。

21:21:55—21:22:40（UTC+8）实际调用既有I02下载器，固定版本0.2.1-rc.2官方URL、289385456字节及sha512-39POl5osl9PKMqrPXQA52dh/bCV0Z02vOV9cTjOJDHE6gsJwp5bv7lfgB3mVWAKspX7a/w1iTi+8Listdhq45g==均匹配；下载进程退出0。仅落盘校验，没有执行安装器。

Windows Get-AuthenticodeSignature实际返回Valid；签名主体中的公司名为Hangzhou DeepSeek Artificial Intelligence Co., Ltd.，issuer为CN=GlobalSign GCC R45 EV CodeSigning CA 2020, O=GlobalSign nv-sa, C=BE。观测证书指纹为84032578657219876E273E0D1BD303CFE1B82E6F，有效期2026-08-31T08:49:44.0000000Z至2027-09-01T08:49:44.0000000Z。这是从文件读取的观测，**不冒充官方独立公布的预期指纹**。DeepSeek官网[Harness条款](https://deepseek.com/en/harness/terms-of-use/)独立确认相同运营公司，但未给出证书指纹。

本机只读baseline：HKCU/HKLM及WOW6432Node卸载项中按DeepSeek/Harness/DSH匹配0项；HKCU/HKLM Software/Classes/dsh均不存在；默认.dsh不存在、当前DSH_HOME未设置、命令搜索无dsh、按deepseek/dsh进程名匹配0项。名称匹配不等于完整进程所有权调查；正式启动前还须绑定实际安装根、Host PID及创建时间。Windows11专业工作站版25H2/10.0.26200，查询时总31.6GiB/空闲16.8GiB、D盘空闲393.6GiB，均为当时观察。

用户随后对具体提议答复：“同意本机，但是必须要保证完成之后清理干净”。提议范围为：本机受控安装→真实UI/收发→官方卸载，以及仅对本次固定文件采用“官方固定URL＋固定摘要＋Windows有效签名＋官网确认主体”的一次性人工准入；例外于原开发宿主不试装及必须独立取得指纹的要求。实测指纹仅绑定本次已批准文件，不自动生成未来CI的可信发布者默认值、不推广到其它版本。**完整清理为本次验收条件**：先保存安装前baseline，结束后核对软件、进程、协议/卸载项、快捷方式与owned测试数据；有未决残留不报完成，保留证据继续处理。

当前下载根：D:/workspace/CC/multichat/node_modules/.cache/crosschat-c04-native-download-20261103-60kgZX，owner runId=71bfe4fb-b611-4b62-8f8a-f494bced8f18；内含官方EXE及ownership/download/signature-observation生成证据，尚未删除。下载及签名核验未安装/启停DSH，未修改协议/用户模型/插件配置。下一步先准备原生测试隔离、UI操作和官方卸载回收路径，再执行已授权安装；未新增产品脚本/workflow。C04/I03尚未验收，不以本机人工结果冒充独立runner、托管首轮或全平台通过。
