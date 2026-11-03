# C04-I03-C3：正式 Desktop 执行合同与独立 Windows 环境方案

2026-11-03（UTC+8）。用户要求按已借鉴的思路开始下一单，root独立完成，无worker或子代理。开工基线 `69c4e5d0bfc84d5598993c9e17037b05a73cd237`，branch `codex/core-refactor-pre-tui`；仅用户原未跟踪 `docs/代码消息投递.md`，未触碰。范围来自[DSH优先计划](../../dsh-completion-plan-20261103.md)，承接[I03安装研究](../../../research/c04-windows-installer-contract-20261102.md)及[C2组件](I03-C2-development.md)。

**第1—7节保留原方案交付时的事实；后续授权及本机原生结果见第8节起的补记。I03/C04父项仍未完成。** 原方案当轮没有下载/执行官方EXE、创建VM、注册runner、触发Actions、启停Desktop/Host、写注册表或修改产品，没有新增功能文件/依赖/用户命令。第1—7节的命令、路径和回调安排除“本机只读观察”外均为拟议，不能当作已执行结果。

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

下载时的owned根为D:/workspace/CC/multichat/node_modules/.cache/crosschat-c04-native-download-20261103-60kgZX，owner runId=71bfe4fb-b611-4b62-8f8a-f494bced8f18。此阶段只下载及签名核验，未安装/启停DSH。后续原生测试、用户保留安装的新决定和实际清理见第10—11节；下载EXE已在测试结束后删除。未新增产品脚本/workflow，不以本机人工结果冒充独立runner、托管首轮或全平台通过。


## 9. 本机准入发现的PowerShell模块环境问题：完整检查

真实准入发现Windows PowerShell 5.1继承PowerShell 7的PSModulePath后，Microsoft.PowerShell.Security导入产生重复TypeData错误，signature reader退出1；同文件在父shell签名为Valid。对照仅移除继承PSModulePath后，原生reader正确读取签名。RED `7575578` 的三项用例先失败，GREEN `2e4fdb2` 仅在签名child的环境副本中按大小写无关方式移除PSModulePath；保留其它环境、shell:false和全部准入条件，不修改父进程环境。真实shadow module用例证明未运行外来模块，未签名fixture仍被拒绝。

三项定向通过；随后本次npm run check退出码0：**2646通过/11原有跳过，231文件通过/3跳过**，lint、203模块683边导入图与build通过。max forks/threads=2、min=1，未启用CROSSCHAT_LIVE。历史失败不因本次绿追认根因已修复。

<details><summary>npm run check 原始输出</summary>

```text

> @oatelauser/crosschat@1.10.0 check
> npm run lint && npm run check:imports && npm run build && npm test


> @oatelauser/crosschat@1.10.0 lint
> eslint src test


> @oatelauser/crosschat@1.10.0 check:imports
> node scripts/runtime-import-graph.mjs

Runtime import graph: 203 modules, 683 edges; no cycles or boundary violations.

> @oatelauser/crosschat@1.10.0 build
> tsc


> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/conversation-state-concurrency.test.ts (11 tests) 9367ms
   ✓ conversation state cross-process writes > independent processes allocating at once never share a handle and each resolves to its own ref  359ms
   ✓ conversation state cross-process writes > a live writer on an aliased path blocks every other write path until it releases  2173ms
   ✓ conversation state cross-process writes > a send that cannot take the lock delivers nothing, then succeeds once released  1136ms
   ✓ conversation state cross-process writes > a stuck holder still exits within its barrier deadline  5122ms
 ✓ test/session-star.test.ts (40 tests) 6361ms
   ✓ 018 批二：启动器入星链路 > spawn 会话→自动拉聚合器→attach→三段直达；退出即 detach  659ms
   ✓ 018 批二：启动器入星链路 > 多星：--connect 可重复，两会话成员表各自 attach（win 带杠 mid 形态）  680ms
   ✓ 018 批二：启动器入星链路 > 021 断连静默：聚合器被杀→重连提示落日志、控制台零输出、成员籍自动恢复  1588ms
   ✓ 统一恢复入口（启动器重声明或显式管理，册落盘不丢） > 聚合器重启保留离线册位，存活的原生会话也须明确重声明（linux 32-hex 形态）  300ms
   ✓ 018 批二：9b 降级告警（不只日志） > NodeClient.warn 直打一行；warnIfBrokerLacksSessionCaps 对老 broker 出声、新 broker 静默  338ms
   ✓ 028 双模式与命令面 > 双模式集成：永久退出留册、裸 resume 不归队、明确选择恢复；--rm 退出清册  864ms
 ✓ test/serve-star-lifecycle.test.ts (11 tests) 17053ms
   ✓ 033 热加星：不重启即托管即收发 > 在跑 serve + CLI --add-star 经管理插座：回执生效、自登记落位、聚合器播种、新星上 node/sender 完整收发  1572ms
   ✓ 033 删星：即时收尾 + 直报已删 + 最后一颗可删 > 热删 beta：在跑连接收"星已删除"断开、node.json 摘条、死钥直报、邻星零中断  2372ms
   ✓ 033 插座冷热路径与 stop 收口 > 回执超时绝不回落直写：插座连上但无回执 → 报错重试、台账零改动  10020ms
   ✓ 033 插座冷热路径与 stop 收口 > stop 收口：serve 停机后状态 stopped、插座随进程撤（CLI 退冷路径）  1521ms
   ✓ 036 按星机器名（--star --show-name）热闭环 > 按星只重挂该星：条目覆盖落 node.json、注册表该星 machineName 更新、邻星回落全局不变；--list 显示随条目；'' 清除回落全局  1530ms
probe failed: root-not-exclusive:C:\Users\YANGSH~1\AppData\Local\Temp\c14w05-test-1oDUzu\previous-run
 ✓ test/serve-admin-key.test.ts (7 tests) 6204ms
   ✓ 034 挑战应答全链与角色矩阵 > admin 握手（钥匙永不过线）→ 读/发/删全过 → 成员/星管逐格 → 重放拒绝 → 被吊钥 BAD_AUTH → 审计在场  2898ms
   ✓ 034 挑战应答全链与角色矩阵 > CLI 远程管理路由：--via tcp:<星> 成员读（星钥）+ 星管写（adminKey 挑战应答）  1541ms
   ✓ 034 set-port 无命令回归（旗标+插座 op 全删） > 管理插座 set-port op 已删（未知 op 拒绝、台账零改动）  1517ms
usage: node scripts/codex-call-correlation-probe.mjs --root <owned temp dir> [--evidence <json>]
 ✓ test/codex-call-correlation-probe.test.ts (56 tests) 5335ms
   ✓ codex call correlation probe: bounded reads and processes > kills a timed-out child together with its descendant and waits for close  1783ms
   ✓ codex call correlation probe: bounded reads and processes > stops a cancelled child through the abort signal  405ms
   ✓ codex call correlation probe: run root and main chain > keeps the root when the run is cancelled  591ms
   ✓ codex call correlation probe: run root and main chain > keeps the run root when the launched process never closed  1549ms
 ✓ test/serve-sessions.test.ts (37 tests) 4663ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 028 claude 活性：扫描核验——死 claude 成员转下线（教学）、活成员续投  530ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > C14 Codex 活性：核实实际 CLI 端点后续投，原生不存在的同类成员转下线  539ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 029 临时成员异常死亡：对账验死报 member-remove 清册零痕迹（不留下线态）  733ms
   ✓ 028 册（roster）：落盘/跨机拒绝/extends 胜复活/member-remove > 028 下线成员随 roster 帧下发（offlineSessions 单列；sessions 保持活成员语义）  439ms
   ✓ 018 9b：老 broker（proto:1）降级的协议侧 > connect 携带 caps；info.caps 缺端点能力时拒绝类型化 attach，且不发 sessions 帧  318ms
 ✓ test/endpoint-protocol.test.ts (5 tests) 5473ms
   ✓ endpoint identity capability guard > does not replay an uncertain lifecycle removal while readonly roster still reports the same temporary member  5424ms
 ✓ test/serve-multistar.test.ts (20 tests) 4408ms
   ✓ 032 多星握手与星域隔离 > 钥匙不属任何星 → BAD_AUTH（跨星错钥匙不放行）  511ms
   ✓ 032 bootstrap 与 CLI > 033 serve 永不造星：空表首启零星合法（不建星、不写 node.json），教学指 --add-star  1524ms
   ✓ 032 bootstrap 与 CLI > 内挂聚合器不写 status-node 文件（非独立进程）  1509ms
 ✓ test/broker-revocation.test.ts (12 tests) 3962ms
   ✓ broker credential revocation > local remove-node immediately revokes every node/sender using that credential and retains offline permanent members in its star  895ms
   ✓ broker credential revocation > remote remove-node has the same immediate effect while members and star admins retain their three-layer limits  658ms
   ✓ broker credential revocation > local remove-admin-key closes only authenticated sessions of the removed credential, including unique-prefix selection  1072ms
   ✓ broker credential revocation > marks a revoked session unusable before close completes without affecting another credential  319ms
 ✓ test/local-service-owned-stop.test.ts (6 tests) 2955ms
   ✓ TUI owned service stop process trees > releases a hung OS scanner and its helper before completing cancellation without claiming the external stop was undone  436ms
   ✓ TUI owned service stop process trees > bounds a nonresponding stop job and reclaims its full scanner tree on timeout  1365ms
   ✓ TUI owned service stop process trees > runs the actual stop process wrapper and prior stop worker with the same fixed target, then releases the wrapper  416ms
   ✓ TUI owned service stop process trees > retains prior request validation inside the real wrapper before any stop business call  325ms
   ✓ TUI owned service stop process trees > uses the owned stop default from the managed task and waits for tree cleanup before returning an uncertain issued result  406ms
 ✓ test/local-service-inspection.test.ts (6 tests) 3233ms
   ✓ owned service inspection and guard workers > reclaims an inspector blocked in spawnSync, including its owned probe child, before cancellation returns  539ms
   ✓ owned service inspection and guard workers > uses the real process wrapper for successful inspection/guard IPC and releases it before returning  693ms
   ✓ owned service inspection and guard workers > reclaims a real wrapper and its controlled blocked probe when its read timeout expires  1780ms
 ✓ test/maintenance-boundaries.test.ts (5 tests) 2712ms
   ✓ TUI maintenance source and copy boundaries > closes unreadable sources and bounds directory enumeration before accepting a skill plan  2595ms
 ✓ test/serve-node.test.ts (30 tests) 2646ms
   ✓ B0 starId handshake > 036 无 id 星（手编形状）：连接按 BAD_AUTH 拒——broker 机跑一次 serve 补 id  588ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker queue self-delivery: the receipt ref carries the registry starId  671ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker steer self-delivery: the receipt ref carries the registry starId  495ms
 ✓ test/core-code-standards.test.ts (2 tests) 2003ms
   ✓ progressive typed lint rules > rejects floating promises, async void callbacks and value imports used only as types  1982ms
 ✓ test/opencode-desktop-fixture.test.ts (13 tests) 3420ms
   ✓ official desktop test environment > reports an unregistered executable under the owned run before allowing cleanup  2834ms
 ✓ test/ssh-native-authentication.test.ts (3 tests) 2323ms
   ✓ SSH application native ASKPASS integration > reuses authentication across refreshes, retains strict host checking and forgets credentials when configuration changes  1315ms
   ✓ SSH application native ASKPASS integration > preserves full Windows ASKPASS fingerprints and offers no approval for a changed known host  486ms
   ✓ SSH application native ASKPASS integration > cancels a pending native authentication helper when the active connection closes  521ms
 ✓ test/doctor-json-cli.test.ts (3 tests) 1955ms
   ✓ doctor JSON CLI extension > diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it  917ms
   ✓ doctor JSON CLI extension > returns the structured checks and preserves the existing default report and exit severity  431ms
   ✓ doctor JSON CLI extension > emits valid structured findings with exit one for a failed check and rejects extra options  606ms
 ✓ test/send-log.test.ts (10 tests) 1786ms
   ✓ appendSendLog > rotates past 5MiB instead of truncating: the bulk moves whole to .old, the new entry starts a fresh file  1642ms
 ✓ test/tui-controller.test.ts (25 tests) 1939ms
 ✓ test/runtime-import-graph.test.ts (9 tests) 1333ms
   ✓ core source architecture > has no runtime dependency cycle or broken local import  489ms
   ✓ core source architecture > keeps node configuration and connection selection independent of commands and clients  376ms
   ✓ core source architecture > keeps every application adapter independent of command and UI entry points  403ms
 ✓ test/ssh-askpass-bridge.test.ts (3 tests) 1408ms
   ✓ owned native SSH ASKPASS bridge > uses a real local helper to pass one bounded prompt without storing the password in files, argv or environment  482ms
   ✓ owned native SSH ASKPASS bridge > closes a pending helper and cancels its challenge when the owned bridge is disposed  498ms
   ✓ owned native SSH ASKPASS bridge > rejects an oversized or cancelled answer without writing any secret material to stderr  426ms
 ✓ test/core-diagnostics.test.ts (13 tests) 1484ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (inherit)  328ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  491ms
 ✓ test/session-membership.test.ts (16 tests) 1678ms
   ✓ session membership application boundary > adopts an anonymous full native ref through the shared aggregator and verifies broker roster authority  532ms
   ✓ session membership application boundary > adopts and removes a typed Codex member without overwriting the same native ID on another endpoint  531ms
 ✓ test/tui-cli.test.ts (11 tests) 1419ms
 ✓ test/revocation-pause.test.ts (13 tests) 1619ms
   ✓ explicit credential revocation pauses this star > stops one launcher supervisor without restarting it or disrupting another star  1187ms
 ✓ test/caller-source-confirmations.test.ts (21 tests) 1645ms
   ✓ source classification shared across native sessions > reports bounded busy without mutating state when an unrelated listener occupies its mutex port  1042ms
 ✓ test/via-tcp.test.ts (36 tests) 1135ms
   ✓ runViaTcpSend against a real broker > times out with TCP_TRANSPORT_FAILED and the 勿盲目重发 wording  416ms
 ✓ test/ssh-target-lifecycle.test.ts (4 tests) 1278ms
   ✓ SSH target identity and process completion > bounds a child that never closes, reports incomplete cleanup, and removes its owned listeners  1070ms
 ✓ test/tui-send-command.test.ts (5 tests) 949ms
   ✓ TUI send command templates > round-trips opaque arguments through the current platform shell  945ms
 ✓ test/tui-workspaces.test.ts (10 tests) 1161ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (updated)  350ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (failed)  342ms
 ✓ test/maintenance.test.ts (21 tests) 946ms
   ✓ owned maintenance worker lifecycle > runs actual plans and filesystem effects through the default built worker using only isolated fixture paths  572ms
 ✓ test/remote-discovery-cli.test.ts (2 tests) 759ms
   ✓ built discover CLI endpoint > rejects invalid JSON and oversized input before provider execution  553ms
 ✓ test/tui-composition.test.ts (15 tests) 1195ms
 ✓ test/outbox.test.ts (24 tests) 830ms
   ✓ park > refuses honestly at the per-thread cap and leaves the file untouched  568ms
 ✓ test/ssh-application.test.ts (15 tests) 974ms
 ✓ test/tui-main-observations.test.ts (3 tests) 739ms
   ✓ default local observation wiring > installs the five real readonly resources lazily and preserves exact related routes  351ms
 ✓ test/status-remote.test.ts (16 tests) 849ms
   ✓ CLI：runViaTcpStatus 传输腿 > 版本偏差：旧 broker 对 status-query 无行为 → 超时教学  413ms
 ✓ test/tui-filters.test.ts (9 tests) 902ms
 ✓ test/serve-broker.test.ts (33 tests) 783ms
 ✓ test/observation-overview.test.ts (18 tests) 872ms
   ✓ safe isolated diagnostics for observation pages > binds the isolated process environment to explicit HOME instead of inherited native data overrides  345ms
   ✓ safe isolated diagnostics for observation pages > retains native data environment overrides in inherit mode while binding crosschat sources to the requested HOME  314ms
 ✓ test/dsh-adapter.test.ts (44 tests) 764ms
 ✓ test/c14-conversation-refinement.test.ts (24 tests) 434ms
 ✓ test/tui-observation-navigation.test.ts (4 tests) 815ms
   ✓ observation resource routes > keeps related route caches separate, canonicalizes query order, clears associations on direct commands and restores the source  376ms
 ✓ test/local-service-worker-boundary.test.ts (8 tests) 331ms
 ✓ test/dsh-cli.test.ts (4 tests) 1457ms
   ✓ DeepSeek Harness CLI composition > connects real send dependencies to Harness delivery with an explicit mode  1447ms
 ✓ test/dsh-bridge.test.ts (32 tests) 639ms
 ✓ test/remote-discovery-tcp.test.ts (6 tests) 465ms
 ✓ test/tcp-peer-naming-transport.test.ts (8 tests) 487ms
 ✓ test/codex-session-events.test.ts (2 tests) 562ms
   ✓ Codex per-window native protocol selection > only successful native selection and first accepted input affect this window, never global notifications or failed resume  349ms
 ✓ test/tui-form.test.ts (5 tests) 523ms
 ✓ test/claude-session-events.test.ts (2 tests) 537ms
 ✓ test/cli-args.test.ts (18 tests) 381ms
 ✓ test/tui-main-sessions.test.ts (3 tests) 433ms
 ✓ test/smoke.test.ts (2 tests) 412ms
 ✓ test/tcp-session-operations.test.ts (7 tests) 358ms
 ✓ test/tui-sensitive-result.test.ts (2 tests) 433ms
 ✓ test/install-skills.test.ts (12 tests) 277ms
 ✓ test/send-command.test.ts (57 tests) 296ms
 ✓ test/claude-compat-ci.test.ts (15 tests) 314ms
 ✓ test/revocation-auth-race.test.ts (2 tests) 349ms
   ✓ revocation during current process lifecycles > a corrupt self-aggregator pause does not become an unhandled rejection in the broker  311ms
 ✓ test/serve-b21.test.ts (29 tests) 297ms
 ✓ test/conversations.test.ts (26 tests) 251ms
 ✓ test/tui-follow.test.ts (6 tests) 372ms
 ✓ test/serve-f0.test.ts (19 tests) 267ms
 ✓ test/pipe-transport.test.ts (6 tests | 3 skipped) 374ms
   ✓ WindowsNamedPipeTransport > reports PIPE_WRITE_UNCERTAIN when the server cuts the connection mid-write  305ms
 ✓ test/opencode-adapter.test.ts (26 tests) 264ms
 ✓ test/tui-layout-paging.test.tsx (3 tests) 319ms
 ✓ test/tui-context-source.test.ts (7 tests) 317ms
 ✓ test/broker-discovery.test.ts (17 tests) 250ms
 ✓ test/serve-cli.test.ts (32 tests) 200ms
 ✓ test/claude-compat-fixture.test.ts (19 tests) 234ms
 ✓ test/caller-source-providers.test.ts (14 tests) 245ms
 ✓ test/tui-clipboard.test.ts (5 tests) 209ms
 ✓ test/caller-source-state-lock.test.ts (2 tests) 237ms
 ✓ test/remote-discovery-node.test.ts (8 tests) 268ms
 ✓ test/core-sessions-readers.test.ts (13 tests) 217ms
 ✓ test/tcp-exact-transport.test.ts (3 tests) 248ms
 ✓ test/conversation-handle-ring.test.ts (9 tests) 168ms
 ✓ test/core-services-background.test.ts (5 tests) 201ms
 ✓ test/tcp-application.test.ts (13 tests) 131ms
 ✓ test/tool-type-routing-state.test.ts (32 tests) 166ms
 ✓ test/tcp-configuration-management.test.ts (7 tests) 157ms
 ✓ test/c14-explicit-send.test.ts (29 tests) 155ms
 ✓ test/session-membership-exact.test.ts (9 tests) 142ms
 ✓ test/dsh-compat-ci.test.ts (105 tests) 18321ms
   ✓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause  1025ms
   ✓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause  1000ms
   ✓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot  1009ms
   ✓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes  1010ms
   ✓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release  1114ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation  442ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline  655ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned  1110ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return  2022ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return  371ms
   ✓ DeepSeek Harness desktop installer admission > uses native Windows signature modules rather than executing an inherited shadow module  362ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes  1008ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation  1059ms
   ✓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early  1021ms
   ✓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error  1017ms
   ✓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline  1017ms
 ✓ test/serve-tool-type-bridge.test.ts (6 tests) 193ms
 ✓ test/tui-view.test.tsx (13 tests) 181ms
 ✓ test/watchdog.test.ts (10 tests) 160ms
 ✓ test/tui-session-view.test.tsx (8 tests) 148ms
 ✓ test/dsh-node-members.test.ts (1 test) 211ms
 ✓ test/file-channel.test.ts (10 tests) 176ms
 ✓ test/tcp-transport.test.ts (7 tests) 156ms
 ✓ test/observation-logs.test.ts (11 tests) 115ms
 ✓ test/codex-aggregate-discovery.test.ts (11 tests) 185ms
 ✓ test/send-handle.test.ts (10 tests) 143ms
 ✓ test/core-queries.test.ts (17 tests) 141ms
 ✓ test/discovery-service.test.ts (10 tests) 142ms
 ✓ test/claude-compat-lifecycle.test.ts (4 tests) 120ms
 ✓ test/tui-mutation-navigation.test.ts (1 test) 144ms
 ✓ test/tui-workspace-layout.test.tsx (8 tests) 142ms
 ✓ test/tcp-configuration.test.ts (8 tests) 132ms
 ✓ test/via-send.test.ts (42 tests) 119ms
(node:23120) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/desktop-metadata.test.ts (5 tests) 123ms
 ✓ test/dsh-live-fixture.test.ts (18 tests) 110ms
 ✓ test/tui-main-preferences.test.ts (2 tests) 129ms
 ✓ test/tui-terminal.test.ts (8 tests) 121ms
 ✓ test/tui-contexts.test.ts (13 tests) 98ms
 ✓ test/status-doctor-tcp.test.ts (27 tests) 106ms
 ✓ test/outbox-ownership.test.ts (15 tests) 94ms
 ✓ test/local-services.test.ts (11 tests) 101ms
 ✓ test/codex-deliver.test.ts (26 tests) 123ms
 ✓ test/tool-type-observations.test.ts (7 tests) 110ms
 ✓ test/ssh-managed-profiles.test.ts (5 tests) 112ms
 ✓ test/status-conversations.test.ts (20 tests) 105ms
 ✓ test/tui-input.test.tsx (21 tests) 86ms
 ✓ test/tcp-management-exact.test.ts (8 tests) 77ms
 ✓ test/tcp-machine-transaction.test.ts (9 tests) 98ms
 ✓ test/tcp-cold-management.test.ts (5 tests) 90ms
 ✓ test/opencode-compat-fixture.test.ts (7 tests) 97ms
 ✓ test/dsh-runtime-driver.test.ts (3 tests) 118ms
 ✓ test/caller-source-service.test.ts (11 tests) 134ms
 ✓ test/core-cleanup.test.ts (5 tests) 92ms
 ✓ test/tcp-snapshot-transport.test.ts (2 tests) 110ms
 ✓ test/dsh-mock-model.test.ts (5 tests) 106ms
 ✓ test/desktop-ipc.test.ts (21 tests) 91ms
 ✓ test/observation-communications.test.ts (11 tests) 116ms
 ✓ test/state-paths.test.ts (9 tests) 87ms
 ✓ test/dsh-send.test.ts (16 tests) 103ms
 ✓ test/opencode-desktop-ci.test.ts (13 tests) 60ms
 ✓ test/tui-sessions.test.ts (22 tests) 81ms
 ✓ test/conversation-summary.test.ts (15 tests) 76ms
 ✓ test/claude-wrapper.test.ts (16 tests | 2 skipped) 63ms
 ✓ test/tui-context-actions.test.ts (3 tests) 65ms
 ✓ test/codex-target-diagnostics.test.ts (13 tests) 77ms
 ✓ test/identity-command.test.ts (7 tests) 62ms
 ✓ test/dsh-members.test.ts (13 tests) 48ms
 ✓ test/uninstall.test.ts (10 tests) 81ms
 ✓ test/session-operations.test.ts (4 tests) 68ms
 ✓ test/codex-rpc.test.ts (11 tests) 64ms
 ✓ test/opencode-desktop-probe.test.ts (9 tests) 68ms
 ✓ test/core-management.test.ts (12 tests) 53ms
 ✓ test/native-rename-providers.test.ts (6 tests) 44ms
 ✓ test/codex-routing.test.ts (15 tests) 76ms
 ✓ test/tui-registry.test.ts (5 tests) 52ms
 ✓ test/serve-registry.test.ts (10 tests) 68ms
 ✓ test/opencode-members.test.ts (7 tests) 64ms
 ✓ test/session-selection.test.ts (3 tests) 70ms
 ✓ test/tcp-local-management.test.ts (6 tests) 44ms
 ✓ test/status-summary.test.ts (14 tests) 51ms
 ✓ test/clean.test.ts (10 tests) 47ms
 ✓ test/status-filters.test.ts (20 tests) 51ms
 ✓ test/tui-tcp.test.ts (24 tests) 41ms
 ✓ test/rollout-meta.test.ts (13 tests) 47ms
 ✓ test/c14-native-send-seams.test.ts (17 tests) 35ms
 ✓ test/delivery-mode.test.ts (15 tests) 45ms
 ✓ test/discovery-ssh.test.ts (7 tests) 34ms
 ✓ test/tcp-management-boundaries.test.ts (4 tests) 33ms
 ✓ test/tui-table.test.ts (23 tests) 33ms
 ✓ test/core-services.test.ts (5 tests) 28ms
 ✓ test/rate-limit.test.ts (6 tests) 31ms
 ✓ test/opencode-send.test.ts (9 tests) 30ms
 ✓ test/node-config.test.ts (9 tests) 23ms
 ✓ test/tui-text.test.ts (52 tests) 26ms
 ✓ test/core-send-diagnostics.test.ts (6 tests) 18ms
 ✓ test/doctor.test.ts (20 tests) 24ms
 ✓ test/core-send.test.ts (4 tests) 20ms
 ✓ test/tcp-management.test.ts (15 tests) 20ms
 ✓ test/tui-communications.test.ts (13 tests) 14ms
 ✓ test/tui-ssh.test.ts (7 tests) 15ms
 ✓ test/native-endpoint-types.test.ts (10 tests) 14ms
 ✓ test/serve-management-errors.test.ts (6 tests) 19ms
 ✓ test/tui-tcp-targets.test.ts (2 tests) 17ms
 ✓ test/session-star-logging.test.ts (2 tests) 18ms
 ✓ test/tui-star-audit.test.ts (2 tests) 15ms
 ✓ test/opencode-tui.test.ts (9 tests) 16ms
 ✓ test/codex-pagination.test.ts (5 tests) 13ms
 ✓ test/tcp-machine-workspace.test.ts (8 tests) 13ms
 ✓ test/tui-logs.test.ts (5 tests) 13ms
 ✓ test/c14-tool-addressing.test.ts (8 tests) 18ms
 ✓ test/star-snapshot.test.ts (1 test) 11ms
 ✓ test/tcp-empty-node-config.test.ts (3 tests) 13ms
 ✓ test/dsh-reader.test.ts (11 tests) 8ms
 ✓ test/deliver.test.ts (5 tests) 7ms
 ✓ test/session-membership-ipv6.test.ts (2 tests) 12ms
 ✓ test/tcp-node-naming-lifecycle.test.ts (6 tests) 20ms
 ✓ test/session-membership-machine.test.ts (4 tests) 16ms
 ✓ test/dsh-identity.test.ts (19 tests) 14ms
 ✓ test/tool-type-discovery-state.test.ts (6 tests) 10ms
 ✓ test/ref.test.ts (25 tests) 15ms
 ✓ test/tui-overview.test.ts (4 tests) 12ms
 ✓ test/key-file.test.ts (6 tests) 7ms
 ✓ test/tui-page-presentation.test.ts (3 tests) 11ms
 ✓ test/codex-proxy-env.test.ts (2 tests) 10ms
 ✓ test/tui-ssh-management.test.ts (3 tests) 11ms
 ✓ test/dsh-composition.test.ts (5 tests) 11ms
 ✓ test/tui-connections.test.ts (7 tests) 10ms
 ✓ test/tui-maintenance.test.ts (6 tests) 13ms
 ✓ test/ssh-interaction.test.ts (6 tests) 7ms
 ✓ test/core-sessions.test.ts (8 tests) 11ms
 ✓ test/opencode-composition.test.ts (4 tests) 12ms
 ✓ test/discovery-command.test.ts (2 tests) 6ms
 ✓ test/registry.test.ts (6 tests) 7ms
 ✓ test/opencode-identity.test.ts (18 tests) 10ms
 ✓ test/core-members.test.ts (8 tests) 10ms
 ✓ test/codex-launcher-owner.test.ts (2 tests) 4ms
 ✓ test/core-local-discovery.test.ts (3 tests) 9ms
 ✓ test/dsh-status.test.ts (7 tests) 9ms
 ✓ test/c14-discovery-tui.test.ts (3 tests) 8ms
 ✓ test/envelope.test.ts (20 tests) 6ms
 ✓ test/codex-caller-source-probe.test.ts (14 tests) 8ms
 ✓ test/tui-services.test.ts (4 tests) 8ms
 ✓ test/resolve.test.ts (24 tests) 7ms
 ✓ test/codex-wrapper.test.ts (6 tests) 6ms
 ✓ test/dsh-tui.test.ts (3 tests) 8ms
 ✓ test/opencode-status.test.ts (6 tests) 9ms
 ✓ test/tui-ssh-authentication-prompt.test.ts (1 test) 2ms
 ✓ test/opencode-desktop-process-race.test.ts (3 tests) 5ms
 ✓ test/local-service-stop-target.test.ts (3 tests) 5ms
 ✓ test/tcp-management-state.test.ts (3 tests) 6ms
 ✓ test/opencode-wrapper.test.ts (3 tests) 6ms
 ✓ test/compat-reply.test.ts (9 tests) 5ms
 ✓ test/limits.test.ts (11 tests) 4ms
 ✓ test/tui-status.test.ts (4 tests) 3ms
 ✓ test/frame.test.ts (5 tests) 3ms
 ✓ test/claude-compat-evidence.test.ts (5 tests) 4ms
 ✓ test/serve-protocol.test.ts (3 tests) 3ms
 ✓ test/local-service-readiness.test.ts (1 test) 4ms
 ✓ test/remote-discovery-protocol.test.ts (10 tests) 4ms
 ✓ test/c14-envelope-tool.test.ts (3 tests) 3ms
 ✓ test/opencode-ref-boundary.test.ts (2 tests) 3ms
 ✓ test/credential-revoked-protocol.test.ts (6 tests) 3ms
 ↓ test/live/claude-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/codex-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/status-live.test.ts (2 tests | 2 skipped)

 Test Files  231 passed | 3 skipped (234)
      Tests  2646 passed | 11 skipped (2657)
   Start at  21:40:08
   Duration  113.55s (transform 3.20s, setup 0ms, collect 22.42s, tests 153.91s, environment 37ms, prepare 18.37s)

```

</details>


## 10. 用户手动安装后的归属决定（当前有效）

用户告知已手动装好DSH于D盘soft目录；实际HKCU记录定位D:/soft/DeepSeek Harness、0.2.1-rc.2，官方卸载命令有/currentuser及/S登记。随后用户明确选择“保留 DSH，只清理本次测试数据”。**D:/soft/DeepSeek Harness及其程序/安装登记/快捷方式属于用户保留资产，不获准卸载或删除；本轮只清理owned测试数据和进程。** user-install-retention-baseline.json已保存用户安装后的基线，旧安装前不存在基线不再用于撤销这份用户安装。因用户保留软件，本次不计官方卸载与系统注册撤销验收。

初始化实例PID28588、HostPID3440；CDP58798与Main inspector58799均实测监听于127.0.0.1、owner为28588。插件安装后第二次实例PID15720、HostPID39856，renderer55396/main55397同样核实loopback及owner。app.getPath观测userData/logs/appData及DSH_HOME位于本轮native根；app.getPath('home')仍返回真实用户home，因此未把单个路径参数当作隔离证明，另行核对实际默认工作区/写入位置和用户安装后baseline。模型端点为本机fixture61847，未使用个人key。

实际发行包内dshBuildCommit=332895e0f7c9d4dbfb29729f5eb367fa263ff986，与旧源码研究687f282e不同，不能追认源码和发行物一一对应。内置dsh.cmd真实内容已读取：ELECTRON_RUN_AS_NODE=1、Electron --expose-internals加内置cli.js；直接复用该入口shell:false、独立参数运行--version返回0.2.1-rc.2，child正常退出0。未将.cmd拼入不受控shell，也未改官方发行物。安装由用户手动完成，不能记为自动安装CI成功。

## 11. 正式Desktop人工原生验收与运行数据清理

本轮使用用户已安装的0.2.1-rc.2正式Windows应用、独占fixture home/profile与loopback模型桩；在实际UI创建两条会话，以前端原生prompt请求绑定完整sessionId。没有用另启Web会话或直调Adapter冒充Desktop。

| 范围 | 实际证据与结论 | 保留边界 |
| --- | --- | --- |
| 内置CLI与插件/skill加载 | 官方内置CLI为desktop profile离线安装本仓库bridge，pnpm退出0；既有skillPlan拷贝技能到fixture home。真实模型请求出现skill目录，原生skill工具读取crosschat成功且包含必填--tool说明 | 不是三平台或所有历史副本维护验收 |
| 正式Desktop来源 | 原生pwsh调用生产identity，返回identified、sourceTool=dsh-desktop、basis=native、scope=instance、association=verified | 不是全部工具来源关联收口 |
| UI完整回信 | 两条UI会话分别为session-9230a824-378b-4276-9594-05c20b244912、session-d617e6b6-b486-45c2-a7ba-8f30df5a4499；原生pwsh生产send发请求，另一会话按真实typed hint cA000回信。模型请求、生产回执turn1/2及可见UI互相对账 | native name为null，from-name回落为dsh/session-；完整ID路由正确，名称显示留待C09/C10核对 |
| idle queue/steer | 各自发送前生产status为idle；两种模式的新nonce均被实际模型请求消费并在UI回答 | 只记录这次正式Windows包 |
| busy queue/steer | fixture gate阻塞真实模型请求，生产status确认running；queue回执queued=true、steer为false。gate释放后经原生pwsh步骤，下一模型请求只消费steer，之后请求再消费queue；UI有两条ACK | 受理、消费和回答分别核实，没有停止后重发 |
| 插件禁用/启用 | 实际插件UI禁用后自有登记消失；观察到UI确已关闭后再启用。新instanceId=d3d0d17b-1f50-42a9-93fd-22c2765d5fec，Host39856与两条完整sessionId保留 | 未据此证明同一Agent对象或旧凭证失效；未替代所有崩溃重连组合 |
| 退出与移除插件引用 | 两次正常app.quit请求；Quit前持有精确Host OS句柄及创建时间，两个Host均退出0。第二次主应用C1 closed=true、code=0、无timeout/cancel/failure/releaseUnclear。退出后内置CLI普通plugin remove成功，profile无bridge引用 | **未观察私有shutdown-complete/强停升级事实，Host自然退出证明仍未知，不向C2填forced:false** |
| owned运行数据回收 | 22:34（UTC+8）对账owned原生进程0、已知测试监听0、bridge登记0、profile桥引用0；核实realpath及runId后删除native测试home/profile、下载EXE和两份环境JSON。用户批准证据归档后，核对副本摘要及RED/GREEN完整raw均已持久保存，再删除整个本次临时证据根 | 仅本次owned测试资源；用户安装、PATH、卸载登记、原default .dsh状态保留。未触碰历史被拒缓存 |

用户保留软件后的只读对账为UserSoftwarePreserved/UninstallRegistrationPreserved/UserPathPreserved/DefaultDshHomePreserved均true，未发现本轮外泄DSH数据目录。本次**没有执行官方卸载/系统注册撤销，没有干净runner/托管首轮/其它OS验收**，不关闭C04父项。临时loopback模型两个外部进程及最初REPL listener均已关闭。

夹具失败一并保留：自定义安装按钮不支持UIAutomation InvokePattern，安装最终由用户完成；初始UI切会话后立即输入发生渲染竞态，首个receiver marker落到先前会话，随后使用新nonce并绑定实际UI请求；初始REPL callback未随后续cell变更，改为本次owner的外部模型进程；插件登记先于UI开关刷新，等确认disabled后才重新启用；plugin remove错误附加offline/ignore-scripts被pnpm明确拒绝，保留失败后按普通remove成功。没有把结果不明的消息盲重发。错误的首次桌面区域截图含后台窗口，排除归档；实际DSH截图使用其页面截图。

用户明确批准三份证据文件后，已归档[验证摘要](../c04-native-20261103/validation.json)、[脱敏原始证据包](../c04-native-20261103/native-evidence-redacted.zip)及[实际UI回信截图](../c04-native-20261103/roundtrip.png)。包含45份脱敏JSON及3张实际DSH截图，952677字节，SHA-256=b1ea7b7936c2d788983f8f37f7ea27cca8f1a7be92acbc6fb1631f54d2a5cab6。脱敏两个fixture鉴权URL、用户home及77处owned根路径，排除完整安装基线、环境配置、错误截图和原生数据。zip完整性、JSON逐项摘要及三个副本摘要均核对通过。随后仅对本次固定runId、已realpath核实且只含普通证据文件的根执行回收，目录已不存在；D:/soft/DeepSeek Harness/DeepSeek Harness.exe仍在。安装/原始失败/签名策略等边界不因归档改变。

本次证据及任务文档核验75个本地链接均存在，25个开放父项顺序与11个CI索引保留；git diff --check通过。归档后只有文档/证据修改，没有重跑产品全量冒充另一轮验证。用户原未跟踪文档未触碰，未push。

## 12. 兼容CI回信解析器对齐已批准短柄

正式Desktop真实hint为cA000，既有test/helpers/compat-reply.mjs却仍只接受退役的数字短柄c13，导致复用工装无法解析当前hint。RED `23eed39`：19项中6失败/13通过，包含新短柄、序列化原生文本、历史选择及拒旧格式；不是新增用户命令或修改公共通信状态。GREEN `5dbc158`只将该helper短柄规则改为c[A-Z][0-9]{3}，完整ref、来源类型核对、歧义拒绝和正文参数原样传递保持。

定向实际3文件139/139；命令中另有不存在的opencode-compat-ci.test.ts筛选名，Vitest未将其计为文件，故不称定向覆盖了OpenCode。随后单次完整check已实际覆盖opencode-compat-fixture及opencode-desktop-ci等：**2656通过/11原有跳过，231文件通过/3跳过，退出0**；lint、203模块683边导入图、build均通过。max forks/threads=2、min=1，未启用CROSSCHAT_LIVE。下方转录仅归一换行并移除终端代码片段空行的行尾空格。

<details><summary>RED 原始输出</summary>

```text

> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test --run test/compat-reply.test.ts


 RUN  v3.2.7 D:/workspace/CC/multichat

 ❯ test/compat-reply.test.ts (19 tests | 6 failed) 11ms
   ✓ real tool compatibility reply command > copies the actual reference and explicit recipient tool while preserving body bytes 1ms
   × real tool compatibility reply command > uses the approved short handle cA000 from a native Desktop reply hint 3ms
     → The incoming reply hint has no complete explicit recipient command
   × real tool compatibility reply command > uses the approved short handle cZ999 from a native Desktop reply hint 0ms
     → The incoming reply hint has no complete explicit recipient command
   × real tool compatibility reply command > selects the owned incoming envelope and tolerates repeated identical history 0ms
     → The incoming reply hint has no complete explicit recipient command
   × real tool compatibility reply command > reads a typed current hint inside serialized native model text blocks 0ms
     → The incoming reply hint has no complete explicit recipient command
   × real tool compatibility reply command > rejects a retired or malformed short handle c13 2ms
     → expected [Function] to throw an error
   ✓ real tool compatibility reply command > rejects a retired or malformed short handle c0 0ms
   ✓ real tool compatibility reply command > rejects a retired or malformed short handle ca000 0ms
   ✓ real tool compatibility reply command > rejects a retired or malformed short handle cA00 0ms
   ✓ real tool compatibility reply command > rejects a retired or malformed short handle cA0000 0ms
   ✓ real tool compatibility reply command > rejects a retired or malformed short handle cAA000 0ms
   ✓ real tool compatibility reply command > rejects a retired or malformed short handle cZ1000 0ms
   × real tool compatibility reply command > rejects two different verified current reply targets 2ms
     → expected [Function] to throw error including 'ambiguous' but got 'The incoming reply hint has no comple…'
   ✓ real tool compatibility reply command > rejects an unverified, missing, conflicting or ambiguous reply hint: <cross-session-message from-tool="pending"><crosschat-reply-hint>回复收件类型待核实；保留会话引用 mc2_aB-9</crosschat-reply-hint>owned-request</cross-session-message> 0ms
   ✓ real tool compatibility reply command > rejects an unverified, missing, conflicting or ambiguous reply hint: <cross-session-message from-tool="dsh"><crosschat-reply-hint>crosschat send --conversation mc2_aB-9 --body "<正文>"</crosschat-reply-hint>owned-request</cross-session-message> 0ms
   ✓ real tool compatibility reply command > rejects an unverified, missing, conflicting or ambiguous reply hint: <cross-session-message from-tool="dsh"><crosschat-reply-hint>crosschat send --conversation mc2_aB-9 --tool claude --body "<正文>"</crosschat-reply-hint>owned-request</cross-session-message> 0ms
   ✓ real tool compatibility reply command > rejects an unverified, missing, conflicting or ambiguous reply hint: <cross-session-message from-tool="pending"><crosschat-reply-hint>crosschat send --conversation mc2_aB-9 --tool dsh --body "<正文>"</crosschat-reply-hint>owned-request</cross-session-message> 0ms
   ✓ real tool compatibility reply command > rejects an unverified, missing, conflicting or ambiguous reply hint: <cross-session-message from-tool="dsh"><crosschat-reply-hint>crosschat send --conversation $(untrusted) --tool dsh --body "<正文>"</crosschat-reply-hint>owned-request</cross-session-message> 0ms
   ✓ real tool compatibility reply command > rejects an unverified, missing, conflicting or ambiguous reply hint: crosschat send --conversation mc2_aB-9 --tool dsh --body "<正文>" 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/compat-reply.test.ts > real tool compatibility reply command > uses the approved short handle cA000 from a native Desktop reply hint
 FAIL  test/compat-reply.test.ts > real tool compatibility reply command > uses the approved short handle cZ999 from a native Desktop reply hint
Error: The incoming reply hint has no complete explicit recipient command
 ❯ replySendArgs test/helpers/compat-reply.mjs:14:27
     12|     for (const [, hint] of envelope.matchAll(/<crosschat-reply-hint\b[…
     13|       const command = /crosschat send --conversation (mc[12]_[A-Za-z0-…
     14|       if (!command) throw new Error('The incoming reply hint has no co…
       |                           ^
     15|       const [, reference, recipientTool] = command;
     16|       if (recipientTool !== tool) throw new Error('The reply hint sele…
 ❯ test/compat-reply.test.ts:14:12

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  test/compat-reply.test.ts > real tool compatibility reply command > selects the owned incoming envelope and tolerates repeated identical history
Error: The incoming reply hint has no complete explicit recipient command
 ❯ replySendArgs test/helpers/compat-reply.mjs:14:27
     12|     for (const [, hint] of envelope.matchAll(/<crosschat-reply-hint\b[…
     13|       const command = /crosschat send --conversation (mc[12]_[A-Za-z0-…
     14|       if (!command) throw new Error('The incoming reply hint has no co…
       |                           ^
     15|       const [, reference, recipientTool] = command;
     16|       if (recipientTool !== tool) throw new Error('The reply hint sele…
 ❯ test/compat-reply.test.ts:22:12

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  test/compat-reply.test.ts > real tool compatibility reply command > reads a typed current hint inside serialized native model text blocks
Error: The incoming reply hint has no complete explicit recipient command
 ❯ replySendArgs test/helpers/compat-reply.mjs:14:27
     12|     for (const [, hint] of envelope.matchAll(/<crosschat-reply-hint\b[…
     13|       const command = /crosschat send --conversation (mc[12]_[A-Za-z0-…
     14|       if (!command) throw new Error('The incoming reply hint has no co…
       |                           ^
     15|       const [, reference, recipientTool] = command;
     16|       if (recipientTool !== tool) throw new Error('The reply hint sele…
 ❯ test/compat-reply.test.ts:27:12

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  test/compat-reply.test.ts > real tool compatibility reply command > rejects a retired or malformed short handle c13
AssertionError: expected [Function] to throw an error
 ❯ test/compat-reply.test.ts:33:54
     31|     'rejects a retired or malformed short handle %s', (reference) => {
     32|       const incoming = envelope('dsh', `crosschat send --conversation …
     33|       expect(() => replySendArgs(incoming, options)).toThrow();
       |                                                      ^
     34|     },
     35|   );

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  test/compat-reply.test.ts > real tool compatibility reply command > rejects two different verified current reply targets
AssertionError: expected [Function] to throw error including 'ambiguous' but got 'The incoming reply hint has no comple…'

Expected: "ambiguous"
Received: "The incoming reply hint has no complete explicit recipient command"

 ❯ test/compat-reply.test.ts:40:52
     38|     const incoming = envelope('dsh', 'crosschat send --conversation cA…
     39|       + envelope('dsh', 'crosschat send --conversation cA002 --tool ds…
     40|     expect(() => replySendArgs(incoming, options)).toThrow('ambiguous'…
       |                                                    ^
     41|   });
     42|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯


 Test Files  1 failed (1)
      Tests  6 failed | 13 passed (19)
   Start at  22:40:27
   Duration  332ms (transform 46ms, setup 0ms, collect 49ms, tests 11ms, environment 0ms, prepare 106ms)
```

</details>

<details><summary>定向 GREEN 原始输出</summary>

```text

> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test --run test/compat-reply.test.ts test/dsh-compat-ci.test.ts test/opencode-compat-ci.test.ts test/claude-compat-ci.test.ts


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/compat-reply.test.ts (19 tests) 7ms
 ✓ test/dsh-compat-ci.test.ts (105 tests) 18438ms
   ✓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause  1014ms
   ✓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause  1002ms
   ✓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot  1009ms
   ✓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes  1016ms
   ✓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release  1139ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation  422ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline  623ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned  1113ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return  2023ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return  377ms
   ✓ DeepSeek Harness desktop installer admission > uses native Windows signature modules rather than executing an inherited shadow module  544ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes  1020ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation  1041ms
   ✓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early  1015ms
   ✓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error  1016ms
   ✓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline  1010ms
 ✓ test/claude-compat-ci.test.ts (15 tests) 328ms

 Test Files  3 passed (3)
      Tests  139 passed (139)
   Start at  22:40:38
   Duration  19.75s (transform 358ms, setup 0ms, collect 612ms, tests 18.77s, environment 1ms, prepare 350ms)
```

</details>

<details><summary>完整 check 原始输出</summary>

```text

> @oatelauser/crosschat@1.10.0 check
> npm run lint && npm run check:imports && npm run build && npm test


> @oatelauser/crosschat@1.10.0 lint
> eslint src test


> @oatelauser/crosschat@1.10.0 check:imports
> node scripts/runtime-import-graph.mjs

Runtime import graph: 203 modules, 683 edges; no cycles or boundary violations.

> @oatelauser/crosschat@1.10.0 build
> tsc


> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/serve-star-lifecycle.test.ts (11 tests) 17001ms
   ✓ 033 热加星：不重启即托管即收发 > 在跑 serve + CLI --add-star 经管理插座：回执生效、自登记落位、聚合器播种、新星上 node/sender 完整收发  1566ms
   ✓ 033 删星：即时收尾 + 直报已删 + 最后一颗可删 > 热删 beta：在跑连接收"星已删除"断开、node.json 摘条、死钥直报、邻星零中断  2338ms
   ✓ 033 插座冷热路径与 stop 收口 > 回执超时绝不回落直写：插座连上但无回执 → 报错重试、台账零改动  10016ms
   ✓ 033 插座冷热路径与 stop 收口 > stop 收口：serve 停机后状态 stopped、插座随进程撤（CLI 退冷路径）  1521ms
   ✓ 036 按星机器名（--star --show-name）热闭环 > 按星只重挂该星：条目覆盖落 node.json、注册表该星 machineName 更新、邻星回落全局不变；--list 显示随条目；'' 清除回落全局  1525ms
 ✓ test/dsh-compat-ci.test.ts (105 tests) 18181ms
   ✓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause  1025ms
   ✓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause  1007ms
   ✓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot  1026ms
   ✓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes  1009ms
   ✓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release  1119ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation  452ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline  632ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned  1112ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return  2027ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return  390ms
   ✓ DeepSeek Harness desktop installer admission > uses native Windows signature modules rather than executing an inherited shadow module  325ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes  1009ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation  1050ms
   ✓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early  1004ms
   ✓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error  1015ms
   ✓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline  1011ms
 ✓ test/session-star.test.ts (40 tests) 6319ms
   ✓ 018 批二：启动器入星链路 > spawn 会话→自动拉聚合器→attach→三段直达；退出即 detach  629ms
   ✓ 018 批二：启动器入星链路 > 多星：--connect 可重复，两会话成员表各自 attach（win 带杠 mid 形态）  694ms
   ✓ 018 批二：启动器入星链路 > 021 断连静默：聚合器被杀→重连提示落日志、控制台零输出、成员籍自动恢复  1573ms
   ✓ 018 批二：9b 降级告警（不只日志） > NodeClient.warn 直打一行；warnIfBrokerLacksSessionCaps 对老 broker 出声、新 broker 静默  326ms
   ✓ 028 双模式与命令面 > 双模式集成：永久退出留册、裸 resume 不归队、明确选择恢复；--rm 退出清册  866ms
 ✓ test/conversation-state-concurrency.test.ts (11 tests) 9370ms
   ✓ conversation state cross-process writes > independent processes allocating at once never share a handle and each resolves to its own ref  362ms
   ✓ conversation state cross-process writes > a live writer on an aliased path blocks every other write path until it releases  2183ms
   ✓ conversation state cross-process writes > a send that cannot take the lock delivers nothing, then succeeds once released  1146ms
   ✓ conversation state cross-process writes > a stuck holder still exits within its barrier deadline  5114ms
 ✓ test/serve-admin-key.test.ts (7 tests) 6141ms
   ✓ 034 挑战应答全链与角色矩阵 > admin 握手（钥匙永不过线）→ 读/发/删全过 → 成员/星管逐格 → 重放拒绝 → 被吊钥 BAD_AUTH → 审计在场  2893ms
   ✓ 034 挑战应答全链与角色矩阵 > CLI 远程管理路由：--via tcp:<星> 成员读（星钥）+ 星管写（adminKey 挑战应答）  1546ms
   ✓ 034 set-port 无命令回归（旗标+插座 op 全删） > 管理插座 set-port op 已删（未知 op 拒绝、台账零改动）  1520ms
 ✓ test/endpoint-protocol.test.ts (5 tests) 5467ms
   ✓ endpoint identity capability guard > does not replay an uncertain lifecycle removal while readonly roster still reports the same temporary member  5423ms
probe failed: root-not-exclusive:C:\Users\YANGSH~1\AppData\Local\Temp\c14w05-test-yyjOaa\previous-run
usage: node scripts/codex-call-correlation-probe.mjs --root <owned temp dir> [--evidence <json>]
 ✓ test/codex-call-correlation-probe.test.ts (56 tests) 5207ms
   ✓ codex call correlation probe: bounded reads and processes > kills a timed-out child together with its descendant and waits for close  1801ms
   ✓ codex call correlation probe: bounded reads and processes > stops a cancelled child through the abort signal  422ms
   ✓ codex call correlation probe: run root and main chain > keeps the root when the run is cancelled  536ms
   ✓ codex call correlation probe: run root and main chain > keeps the run root when the launched process never closed  1474ms
 ✓ test/serve-sessions.test.ts (37 tests) 4653ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 028 claude 活性：扫描核验——死 claude 成员转下线（教学）、活成员续投  527ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > C14 Codex 活性：核实实际 CLI 端点后续投，原生不存在的同类成员转下线  534ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 029 临时成员异常死亡：对账验死报 member-remove 清册零痕迹（不留下线态）  735ms
   ✓ 028 册（roster）：落盘/跨机拒绝/extends 胜复活/member-remove > 028 下线成员随 roster 帧下发（offlineSessions 单列；sessions 保持活成员语义）  418ms
   ✓ 018 9b：老 broker（proto:1）降级的协议侧 > connect 携带 caps；info.caps 缺端点能力时拒绝类型化 attach，且不发 sessions 帧  316ms
 ✓ test/serve-multistar.test.ts (20 tests) 4430ms
   ✓ 032 多星握手与星域隔离 > 钥匙不属任何星 → BAD_AUTH（跨星错钥匙不放行）  513ms
   ✓ 032 bootstrap 与 CLI > 033 serve 永不造星：空表首启零星合法（不建星、不写 node.json），教学指 --add-star  1522ms
   ✓ 032 bootstrap 与 CLI > 内挂聚合器不写 status-node 文件（非独立进程）  1513ms
 ✓ test/broker-revocation.test.ts (12 tests) 3985ms
   ✓ broker credential revocation > local remove-node immediately revokes every node/sender using that credential and retains offline permanent members in its star  881ms
   ✓ broker credential revocation > remote remove-node has the same immediate effect while members and star admins retain their three-layer limits  657ms
   ✓ broker credential revocation > local remove-admin-key closes only authenticated sessions of the removed credential, including unique-prefix selection  1073ms
   ✓ broker credential revocation > marks a revoked session unusable before close completes without affecting another credential  306ms
   ✓ broker credential revocation > finishes target pending work and file routes on revocation before the close callback, ignoring late target results  348ms
 ✓ test/opencode-desktop-fixture.test.ts (13 tests) 3420ms
   ✓ official desktop test environment > reports an unregistered executable under the owned run before allowing cleanup  2857ms
 ✓ test/local-service-inspection.test.ts (6 tests) 3184ms
   ✓ owned service inspection and guard workers > reclaims an inspector blocked in spawnSync, including its owned probe child, before cancellation returns  486ms
   ✓ owned service inspection and guard workers > uses the real process wrapper for successful inspection/guard IPC and releases it before returning  667ms
   ✓ owned service inspection and guard workers > reclaims a real wrapper and its controlled blocked probe when its read timeout expires  1806ms
 ✓ test/local-service-owned-stop.test.ts (6 tests) 2658ms
   ✓ TUI owned service stop process trees > releases a hung OS scanner and its helper before completing cancellation without claiming the external stop was undone  353ms
   ✓ TUI owned service stop process trees > bounds a nonresponding stop job and reclaims its full scanner tree on timeout  1227ms
   ✓ TUI owned service stop process trees > runs the actual stop process wrapper and prior stop worker with the same fixed target, then releases the wrapper  380ms
   ✓ TUI owned service stop process trees > retains prior request validation inside the real wrapper before any stop business call  326ms
   ✓ TUI owned service stop process trees > uses the owned stop default from the managed task and waits for tree cleanup before returning an uncertain issued result  366ms
 ✓ test/maintenance-boundaries.test.ts (5 tests) 2617ms
   ✓ TUI maintenance source and copy boundaries > closes unreadable sources and bounds directory enumeration before accepting a skill plan  2502ms
 ✓ test/ssh-native-authentication.test.ts (3 tests) 2233ms
   ✓ SSH application native ASKPASS integration > reuses authentication across refreshes, retains strict host checking and forgets credentials when configuration changes  1281ms
   ✓ SSH application native ASKPASS integration > preserves full Windows ASKPASS fingerprints and offers no approval for a changed known host  475ms
   ✓ SSH application native ASKPASS integration > cancels a pending native authentication helper when the active connection closes  476ms
 ✓ test/serve-node.test.ts (30 tests) 2552ms
   ✓ B0 starId handshake > 036 无 id 星（手编形状）：连接按 BAD_AUTH 拒——broker 机跑一次 serve 补 id  576ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker queue self-delivery: the receipt ref carries the registry starId  561ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker steer self-delivery: the receipt ref carries the registry starId  515ms
 ✓ test/core-code-standards.test.ts (2 tests) 2389ms
   ✓ progressive typed lint rules > rejects floating promises, async void callbacks and value imports used only as types  2365ms
 ✓ test/doctor-json-cli.test.ts (3 tests) 2347ms
   ✓ doctor JSON CLI extension > diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it  1053ms
   ✓ doctor JSON CLI extension > returns the structured checks and preserves the existing default report and exit severity  510ms
   ✓ doctor JSON CLI extension > emits valid structured findings with exit one for a failed check and rejects extra options  783ms
 ✓ test/send-log.test.ts (10 tests) 1681ms
   ✓ appendSendLog > rotates past 5MiB instead of truncating: the bulk moves whole to .old, the new entry starts a fresh file  1554ms
 ✓ test/tui-controller.test.ts (25 tests) 2041ms
 ✓ test/session-membership.test.ts (16 tests) 1639ms
   ✓ session membership application boundary > adopts an anonymous full native ref through the shared aggregator and verifies broker roster authority  534ms
   ✓ session membership application boundary > adopts and removes a typed Codex member without overwriting the same native ID on another endpoint  534ms
 ✓ test/caller-source-confirmations.test.ts (21 tests) 1640ms
   ✓ source classification shared across native sessions > reports bounded busy without mutating state when an unrelated listener occupies its mutex port  1048ms
 ✓ test/revocation-pause.test.ts (13 tests) 1655ms
   ✓ explicit credential revocation pauses this star > stops one launcher supervisor without restarting it or disrupting another star  1188ms
 ✓ test/core-diagnostics.test.ts (13 tests) 1407ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  460ms
 ✓ test/dsh-cli.test.ts (4 tests) 606ms
   ✓ DeepSeek Harness CLI composition > connects real send dependencies to Harness delivery with an explicit mode  593ms
 ✓ test/tui-cli.test.ts (11 tests) 1598ms
   ✓ CLI TUI command isolation > keeps "--help" independent from TUI and Ink modules  362ms
 ✓ test/ssh-askpass-bridge.test.ts (3 tests) 1579ms
   ✓ owned native SSH ASKPASS bridge > uses a real local helper to pass one bounded prompt without storing the password in files, argv or environment  507ms
   ✓ owned native SSH ASKPASS bridge > closes a pending helper and cancels its challenge when the owned bridge is disposed  581ms
   ✓ owned native SSH ASKPASS bridge > rejects an oversized or cancelled answer without writing any secret material to stderr  489ms
 ✓ test/runtime-import-graph.test.ts (9 tests) 1435ms
   ✓ core source architecture > has no runtime dependency cycle or broken local import  610ms
   ✓ core source architecture > keeps node configuration and connection selection independent of commands and clients  369ms
   ✓ core source architecture > keeps every application adapter independent of command and UI entry points  383ms
 ✓ test/ssh-target-lifecycle.test.ts (4 tests) 1312ms
   ✓ SSH target identity and process completion > bounds a child that never closes, reports incomplete cleanup, and removes its owned listeners  1069ms
 ✓ test/tui-composition.test.ts (15 tests) 1144ms
 ✓ test/tui-workspaces.test.ts (10 tests) 1192ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (updated)  367ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (failed)  362ms
 ✓ test/via-tcp.test.ts (36 tests) 1101ms
   ✓ runViaTcpSend against a real broker > times out with TCP_TRANSPORT_FAILED and the 勿盲目重发 wording  413ms
 ✓ test/ssh-application.test.ts (15 tests) 998ms
 ✓ test/tui-send-command.test.ts (5 tests) 1080ms
   ✓ TUI send command templates > round-trips opaque arguments through the current platform shell  1075ms
 ✓ test/maintenance.test.ts (21 tests) 1083ms
   ✓ owned maintenance worker lifecycle > runs actual plans and filesystem effects through the default built worker using only isolated fixture paths  663ms
 ✓ test/tui-filters.test.ts (9 tests) 918ms
 ✓ test/observation-overview.test.ts (18 tests) 751ms
 ✓ test/outbox.test.ts (24 tests) 783ms
   ✓ park > refuses honestly at the per-thread cap and leaves the file untouched  521ms
 ✓ test/status-remote.test.ts (16 tests) 863ms
   ✓ CLI：runViaTcpStatus 传输腿 > 版本偏差：旧 broker 对 status-query 无行为 → 超时教学  417ms
 ✓ test/tui-observation-navigation.test.ts (4 tests) 769ms
   ✓ observation resource routes > keeps related route caches separate, canonicalizes query order, clears associations on direct commands and restores the source  368ms
 ✓ test/serve-broker.test.ts (33 tests) 749ms
 ✓ test/dsh-adapter.test.ts (44 tests) 793ms
 ✓ test/remote-discovery-cli.test.ts (2 tests) 875ms
   ✓ built discover CLI endpoint > rejects invalid JSON and oversized input before provider execution  632ms
 ✓ test/dsh-bridge.test.ts (32 tests) 485ms
 ✓ test/tui-main-observations.test.ts (3 tests) 817ms
   ✓ default local observation wiring > preserves native environment paths when the caller has not requested an isolated home  317ms
   ✓ default local observation wiring > installs the five real readonly resources lazily and preserves exact related routes  366ms
 ✓ test/codex-session-events.test.ts (2 tests) 581ms
   ✓ Codex per-window native protocol selection > only successful native selection and first accepted input affect this window, never global notifications or failed resume  370ms
 ✓ test/claude-session-events.test.ts (2 tests) 533ms
 ✓ test/tui-form.test.ts (5 tests) 564ms
 ✓ test/tcp-peer-naming-transport.test.ts (8 tests) 460ms
 ✓ test/remote-discovery-tcp.test.ts (6 tests) 448ms
 ✓ test/c14-conversation-refinement.test.ts (24 tests) 456ms
 ✓ test/tui-sensitive-result.test.ts (2 tests) 432ms
 ✓ test/tui-main-sessions.test.ts (3 tests) 417ms
 ✓ test/smoke.test.ts (2 tests) 396ms
 ✓ test/cli-args.test.ts (18 tests) 422ms
 ✓ test/pipe-transport.test.ts (6 tests | 3 skipped) 375ms
   ✓ WindowsNamedPipeTransport > reports PIPE_WRITE_UNCERTAIN when the server cuts the connection mid-write  304ms
 ✓ test/tui-follow.test.ts (6 tests) 368ms
 ✓ test/tcp-session-operations.test.ts (7 tests) 329ms
 ✓ test/revocation-auth-race.test.ts (2 tests) 418ms
   ✓ revocation during current process lifecycles > a corrupt self-aggregator pause does not become an unhandled rejection in the broker  370ms
 ✓ test/local-service-worker-boundary.test.ts (8 tests) 409ms
 ✓ test/claude-compat-ci.test.ts (15 tests) 346ms
 ✓ test/tui-context-source.test.ts (7 tests) 329ms
 ✓ test/tui-layout-paging.test.tsx (3 tests) 316ms
 ✓ test/serve-b21.test.ts (29 tests) 352ms
 ✓ test/send-command.test.ts (57 tests) 490ms
 ✓ test/install-skills.test.ts (12 tests) 410ms
 ✓ test/remote-discovery-node.test.ts (8 tests) 288ms
 ✓ test/opencode-adapter.test.ts (26 tests) 308ms
 ✓ test/serve-f0.test.ts (19 tests) 295ms
 ✓ test/conversations.test.ts (26 tests) 343ms
 ✓ test/broker-discovery.test.ts (17 tests) 337ms
 ✓ test/tcp-exact-transport.test.ts (3 tests) 277ms
 ✓ test/caller-source-providers.test.ts (14 tests) 304ms
 ✓ test/claude-compat-fixture.test.ts (19 tests) 265ms
 ✓ test/caller-source-state-lock.test.ts (2 tests) 255ms
 ✓ test/core-sessions-readers.test.ts (13 tests) 252ms
 ✓ test/dsh-node-members.test.ts (1 test) 184ms
 ✓ test/tui-clipboard.test.ts (5 tests) 234ms
 ✓ test/core-services-background.test.ts (5 tests) 248ms
 ✓ test/serve-cli.test.ts (32 tests) 282ms
 ✓ test/serve-tool-type-bridge.test.ts (6 tests) 221ms
 ✓ test/codex-aggregate-discovery.test.ts (11 tests) 188ms
 ✓ test/tui-view.test.tsx (13 tests) 183ms
 ✓ test/file-channel.test.ts (10 tests) 167ms
 ✓ test/conversation-handle-ring.test.ts (9 tests) 217ms
 ✓ test/tool-type-routing-state.test.ts (32 tests) 205ms
 ✓ test/watchdog.test.ts (10 tests) 166ms
 ✓ test/tcp-configuration-management.test.ts (7 tests) 193ms
 ✓ test/tcp-transport.test.ts (7 tests) 146ms
 ✓ test/c14-explicit-send.test.ts (29 tests) 184ms
 ✓ test/tui-session-view.test.tsx (8 tests) 142ms
 ✓ test/tui-mutation-navigation.test.ts (1 test) 137ms
 ✓ test/send-handle.test.ts (10 tests) 167ms
 ✓ test/discovery-service.test.ts (10 tests) 147ms
 ✓ test/session-membership-exact.test.ts (9 tests) 271ms
 ✓ test/tui-workspace-layout.test.tsx (8 tests) 204ms
 ✓ test/core-queries.test.ts (17 tests) 177ms
 ✓ test/caller-source-service.test.ts (11 tests) 101ms
 ✓ test/tcp-configuration.test.ts (8 tests) 137ms
 ✓ test/tcp-application.test.ts (13 tests) 168ms
 ✓ test/tui-main-preferences.test.ts (2 tests) 126ms
 ✓ test/codex-deliver.test.ts (26 tests) 118ms
(node:27968) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/desktop-metadata.test.ts (5 tests) 148ms
 ✓ test/tui-terminal.test.ts (8 tests) 111ms
 ✓ test/claude-compat-lifecycle.test.ts (4 tests) 139ms
 ✓ test/dsh-runtime-driver.test.ts (3 tests) 88ms
 ✓ test/via-send.test.ts (42 tests) 127ms
 ✓ test/observation-communications.test.ts (11 tests) 85ms
 ✓ test/observation-logs.test.ts (11 tests) 114ms
 ✓ test/ssh-managed-profiles.test.ts (5 tests) 93ms
 ✓ test/tool-type-observations.test.ts (7 tests) 88ms
 ✓ test/tcp-snapshot-transport.test.ts (2 tests) 84ms
 ✓ test/dsh-live-fixture.test.ts (18 tests) 107ms
 ✓ test/dsh-mock-model.test.ts (5 tests) 82ms
 ✓ test/status-doctor-tcp.test.ts (27 tests) 99ms
 ✓ test/status-conversations.test.ts (20 tests) 96ms
 ✓ test/dsh-send.test.ts (16 tests) 83ms
 ✓ test/local-services.test.ts (11 tests) 107ms
 ✓ test/tui-contexts.test.ts (13 tests) 103ms
 ✓ test/tcp-machine-transaction.test.ts (9 tests) 93ms
 ✓ test/opencode-compat-fixture.test.ts (7 tests) 85ms
 ✓ test/outbox-ownership.test.ts (15 tests) 103ms
 ✓ test/core-cleanup.test.ts (5 tests) 69ms
 ✓ test/desktop-ipc.test.ts (21 tests) 84ms
 ✓ test/tcp-cold-management.test.ts (5 tests) 61ms
 ✓ test/state-paths.test.ts (9 tests) 78ms
 ✓ test/tui-sessions.test.ts (22 tests) 75ms
 ✓ test/tui-input.test.tsx (21 tests) 87ms
 ✓ test/tcp-management-exact.test.ts (8 tests) 79ms
 ✓ test/uninstall.test.ts (10 tests) 64ms
 ✓ test/codex-target-diagnostics.test.ts (13 tests) 68ms
 ✓ test/codex-routing.test.ts (15 tests) 66ms
 ✓ test/conversation-summary.test.ts (15 tests) 71ms
 ✓ test/session-selection.test.ts (3 tests) 60ms
 ✓ test/opencode-desktop-probe.test.ts (9 tests) 60ms
 ✓ test/session-operations.test.ts (4 tests) 69ms
 ✓ test/serve-registry.test.ts (10 tests) 59ms
 ✓ test/tui-context-actions.test.ts (3 tests) 64ms
 ✓ test/codex-rpc.test.ts (11 tests) 56ms
 ✓ test/opencode-members.test.ts (7 tests) 59ms
 ✓ test/identity-command.test.ts (7 tests) 58ms
 ✓ test/claude-wrapper.test.ts (16 tests | 2 skipped) 67ms
 ✓ test/opencode-desktop-ci.test.ts (13 tests) 69ms
 ✓ test/core-management.test.ts (12 tests) 60ms
 ✓ test/tui-registry.test.ts (5 tests) 64ms
 ✓ test/status-filters.test.ts (20 tests) 46ms
 ✓ test/status-summary.test.ts (14 tests) 51ms
 ✓ test/dsh-members.test.ts (13 tests) 40ms
 ✓ test/clean.test.ts (10 tests) 53ms
 ✓ test/rollout-meta.test.ts (13 tests) 58ms
 ✓ test/delivery-mode.test.ts (15 tests) 57ms
 ✓ test/tcp-local-management.test.ts (6 tests) 54ms
 ✓ test/native-rename-providers.test.ts (6 tests) 41ms
 ✓ test/tui-tcp.test.ts (24 tests) 39ms
 ✓ test/discovery-ssh.test.ts (7 tests) 39ms
 ✓ test/c14-native-send-seams.test.ts (17 tests) 37ms
 ✓ test/tui-table.test.ts (23 tests) 33ms
 ✓ test/tcp-management-boundaries.test.ts (4 tests) 33ms
 ✓ test/rate-limit.test.ts (6 tests) 25ms
 ✓ test/opencode-send.test.ts (9 tests) 27ms
 ✓ test/core-services.test.ts (5 tests) 26ms
 ✓ test/tui-text.test.ts (52 tests) 25ms
 ✓ test/doctor.test.ts (20 tests) 21ms
 ✓ test/node-config.test.ts (9 tests) 26ms
 ✓ test/tcp-management.test.ts (15 tests) 27ms
 ✓ test/core-send.test.ts (4 tests) 22ms
 ✓ test/tcp-node-naming-lifecycle.test.ts (6 tests) 15ms
 ✓ test/serve-management-errors.test.ts (6 tests) 38ms
 ✓ test/c14-tool-addressing.test.ts (8 tests) 19ms
 ✓ test/core-send-diagnostics.test.ts (6 tests) 19ms
 ✓ test/tui-tcp-targets.test.ts (2 tests) 21ms
 ✓ test/session-star-logging.test.ts (2 tests) 18ms
 ✓ test/opencode-tui.test.ts (9 tests) 18ms
 ✓ test/session-membership-machine.test.ts (4 tests) 15ms
 ✓ test/tui-ssh.test.ts (7 tests) 15ms
 ✓ test/tui-star-audit.test.ts (2 tests) 17ms
 ✓ test/ref.test.ts (25 tests) 13ms
 ✓ test/native-endpoint-types.test.ts (10 tests) 15ms
 ✓ test/tui-communications.test.ts (13 tests) 12ms
 ✓ test/dsh-identity.test.ts (19 tests) 11ms
 ✓ test/codex-pagination.test.ts (5 tests) 14ms
 ✓ test/tui-logs.test.ts (5 tests) 14ms
 ✓ test/tcp-empty-node-config.test.ts (3 tests) 15ms
 ✓ test/tcp-machine-workspace.test.ts (8 tests) 15ms
 ✓ test/tui-maintenance.test.ts (6 tests) 11ms
 ✓ test/tui-overview.test.ts (4 tests) 12ms
 ✓ test/session-membership-ipv6.test.ts (2 tests) 12ms
 ✓ test/opencode-composition.test.ts (4 tests) 9ms
 ✓ test/dsh-composition.test.ts (5 tests) 10ms
 ✓ test/tui-page-presentation.test.ts (3 tests) 11ms
 ✓ test/tui-ssh-management.test.ts (3 tests) 10ms
 ✓ test/star-snapshot.test.ts (1 test) 11ms
 ✓ test/core-sessions.test.ts (8 tests) 10ms
 ✓ test/tui-connections.test.ts (7 tests) 13ms
 ✓ test/tool-type-discovery-state.test.ts (6 tests) 10ms
 ✓ test/codex-proxy-env.test.ts (2 tests) 9ms
 ✓ test/core-members.test.ts (8 tests) 8ms
 ✓ test/opencode-identity.test.ts (18 tests) 11ms
 ✓ test/core-local-discovery.test.ts (3 tests) 10ms
 ✓ test/dsh-status.test.ts (7 tests) 9ms
 ✓ test/codex-caller-source-probe.test.ts (14 tests) 8ms
 ✓ test/opencode-status.test.ts (6 tests) 6ms
 ✓ test/dsh-reader.test.ts (11 tests) 8ms
 ✓ test/dsh-tui.test.ts (3 tests) 6ms
 ✓ test/tui-services.test.ts (4 tests) 8ms
 ✓ test/c14-discovery-tui.test.ts (3 tests) 9ms
 ✓ test/key-file.test.ts (6 tests) 8ms
 ✓ test/compat-reply.test.ts (19 tests) 6ms
 ✓ test/registry.test.ts (6 tests) 8ms
 ✓ test/deliver.test.ts (5 tests) 7ms
 ✓ test/ssh-interaction.test.ts (6 tests) 8ms
 ✓ test/resolve.test.ts (24 tests) 8ms
 ✓ test/envelope.test.ts (20 tests) 6ms
 ✓ test/tcp-management-state.test.ts (3 tests) 5ms
 ✓ test/codex-wrapper.test.ts (6 tests) 4ms
 ✓ test/opencode-wrapper.test.ts (3 tests) 4ms
 ✓ test/discovery-command.test.ts (2 tests) 7ms
 ✓ test/local-service-stop-target.test.ts (3 tests) 5ms
 ✓ test/opencode-desktop-process-race.test.ts (3 tests) 5ms
 ✓ test/local-service-readiness.test.ts (1 test) 3ms
 ✓ test/codex-launcher-owner.test.ts (2 tests) 5ms
 ✓ test/remote-discovery-protocol.test.ts (10 tests) 3ms
 ✓ test/claude-compat-evidence.test.ts (5 tests) 4ms
 ✓ test/limits.test.ts (11 tests) 4ms
 ✓ test/serve-protocol.test.ts (3 tests) 4ms
 ✓ test/frame.test.ts (5 tests) 5ms
 ✓ test/opencode-ref-boundary.test.ts (2 tests) 2ms
 ✓ test/tui-status.test.ts (4 tests) 3ms
 ✓ test/c14-envelope-tool.test.ts (3 tests) 3ms
 ✓ test/credential-revoked-protocol.test.ts (6 tests) 3ms
 ✓ test/tui-ssh-authentication-prompt.test.ts (1 test) 2ms
 ↓ test/live/claude-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/codex-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/status-live.test.ts (2 tests | 2 skipped)

 Test Files  231 passed | 3 skipped (234)
      Tests  2656 passed | 11 skipped (2667)
   Start at  22:41:24
   Duration  115.36s (transform 3.36s, setup 0ms, collect 23.72s, tests 154.63s, environment 39ms, prepare 19.16s)
```

</details>
