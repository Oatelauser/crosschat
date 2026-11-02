# C04-I03：Windows 正式包准入与安装/卸载执行层

2026-11-02（UTC+8）。用户明确“开始下一个任务”，本次启动I03及必要复审；I02结束后的停止已执行，此次恢复来自用户指令。执行者Claude cworker1，root为Codex Desktop「多工具适配」。先交合同，再由root在同单内明确最小实现范围；不能把启动I03理解为可以猜参数运行安装器或新增功能文件。

## 独立续接包

仓库D:/workspace/CC/multichat，branch codex/core-refactor-pre-tui。I02产品33f9c05、fixture6648c91、worker证据219a35c，root归档ac7af67755efd7a769f2d3ac5f681d82b9a05693。I02最终root54/54、worker完整2584/11，两轴通过，仍无正式Desktop实际安装/UI证据。收到root消息所给完整新基线SHA后核对HEAD/branch/dirty再执行；不依赖旧聊天，不要求清空上下文成功。

最小读取AGENTS.md、docs/development/code-standards.md、本单、I02-final-review.md、I01-final-review.md、docs/research/deepseek-harness-runtime-probe-20261023.md相关Desktop部分，以及scripts/dsh-compat-ci.mjs的Desktop sequence/下载接口。原未跟踪docs/代码消息投递.md不动不stage。其它工具/通信产品仍归Bug修复2，不认领。

新增非skill功能文件或必需用户操作变化仍须先交具体方案等用户决定；任务和研究证据文档可以新增。普通内部实现无需重复问用户，但应先把可核实合同交root审定。真实安装验证沿既定独立干净runner边界，不在本机启动正式Desktop。

## 当前下发阶段A：合同证据与拟接线

阶段A仅研究和方案，不改产品/测试。白名单：

- docs/research/c04-windows-installer-contract-20261102.md（单一研究产物，逐项引用第一方证据）
- 本目录I03-review-input.md（基线、交付、已知/未知、最窄后续实现建议和边界）

完成以下具体交付后回报root；root据证据确认阶段B白名单/保证，阶段B尚未下发：

1. **安装合同**：固定Windows x64发行物及可信准入链，静默开关、目录选择、当前用户/提权限制、安装是否启动应用、安装产物和官方卸载入口。每项分“固定源码直接证实”“仅依赖模板/通用推测”“待真实包或runner验证”，不把NSIS常识或OpenCode的参数/GUID当Harness事实。
2. **签名合同**：签名状态/发布者/文件摘要分别证明什么，预期发布者的可信来源是什么；若源码无法固定，明确缺少哪份独立证据。不能编造DeepSeek主体、thumbprint，不能从同一个待校验文件/报告回抄期望值。可提出由调用方提供已核实策略的最窄接口，但必须标注当前尚无可信默认值。
3. **生命周期和归属**：部分安装失败保留root/installationId/owner；Host退出未确认不卸载、不进入下一构建；官方卸载和本次新增系统注册清理分开核对，不能只凭退出码0称完成。沿I01已有合同，probe报告本身已要求uninstalled与注册清理证明；sequence的remove是在释放证明后清理自有目录，不能把官方卸载移到remove再要求probe事先声称已卸载。
4. **最小实施方案**：拟用既有scripts/dsh-compat-ci.mjs与test/dsh-compat-ci.test.ts实现准入/安装/卸载执行边界，区分可立即实现与缺证据应保留的部分。复用I02下载与I01串行合同，不重写下载器/超时框架，不夹带UI driver、main/workflow/reporter、真实用户命令或全局安装。若职责确实需要新功能文件，先说明必要性和影响，不塞进既有文件规避决定。
5. **验收入口**：给出少量关键行为反例与接线点，包括签名/摘要不符零安装、已有/外来安装不触碰、部分安装保留、未确认退出零卸载、卸载失败停止序列。拟定的真实验证必须写明需要独立干净runner和安装前baseline，不把注入测试当Desktop原生验收。

不为凑接口写猜测实现。当前若只能确证部分合同，按事实交付具体缺口和可继续的最小部分，不无限扩展调研。

## root预核事实与第一方来源

固定上游提交`687f282e8625c6b8d11ff58211a90524be2e4317`，permalink前缀为`https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/`。以下是root独立只读审查者已取得的事实，供复核和引用，不等于实际发行包已验证：

- apps/desktop/scripts/electron-builder-config.mjs:238–261：NSIS、oneClick:false、perMachine:false、allowElevation:false、allowToChangeInstallationDirectory:false；108行声明dsh协议。不能由UI目录选项推断所有命令行目录行为。
- apps/desktop/scripts/installer.nsh:32–44：拒绝all-users及已有HKLM安装；70行有静默分支；242行写InstallLocation。本轮未确证/S、/D=、静默自启动与固定卸载器名。
- apps/desktop/installer/uninstall.nsh:12–35：更新或KEEP_APP_DATA跳过数据清理，否则处理Electron APPDATA/updater缓存，保留Harness home；锁定残留不令卸载失败。
- apps/desktop/scripts/windows-sign.mjs:76–93：发布者由发布环境证书CN/O/C派生，源码没有可信固定主体/指纹。
- apps/desktop/README.md:131–141：内置resources/runtime/cli/bin/dsh.cmd，插件管理前初始化并完整退出，命令结束后才更新/卸载。

## 已被拒的读取与清理边界

root审查者的PowerShell Invoke-WebRequest读取文本并内存筛行请求被自动审批拒绝，仅返回blocked by policy，无更细理由。以下固定提交资源不要重试，也不换工具/URL形式/委托别的agent绕行；可以依已存在本仓库文档/证据给出当前已知与缺口，缺失保持待核实：

- apps/desktop/tests/windows-installer-smoke.ps1
- apps/desktop/tests/windows-uninstall-smoke.ps1
- apps/desktop/installer/pages.nsh（较早片段曾读取成功，后续请求被拒，不再请求）
- apps/desktop/windows-signing/README.md
- apps/desktop/scripts/installed-update-qualification.ts

被拒的请求前缀为`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/687f282e8625c6b8d11ff58211a90524be2e4317/`，上列为其完整后缀。阶段A优先消费已有证据，非必要不发新增网络请求。不得下载官方EXE/安装/卸载/启停Desktop、Host或daemon、写注册表/协议/用户配置/skill/auth、调用模型、真实试发、触发Actions或push。

I02保留的C:/Users/yangsheng/AppData/Local/Temp/crosschat-dsh-ci-test-ijFbEi和W05被拒cache日志不属本单清理，均不碰不代删。任何新被拒操作如实回报，不换机制重试。阶段A不需要新临时软件或测试根。

## 检查、提交与通信

本阶段无产品变化，不跑npm全量或原生probe；核对固定引用、事实与推断分界、git diff --check即可。只显式路径本地commit，禁止全仓stage、checkout/pull/reset/clean/stash/amend/push或回退共享文件归责。起止报告真实HEAD/branch/dirty，无关共享提交核对祖先和白名单后继续。

交付给出研究文件、合同缺口、拟实施接口/白名单、是否触发用户拍板及理由。固定仓库node dist/cli.js send、正文stdin，保留本轮程序typed hint的conversation/tool、显式--delivery steer；不用Claude ListAgents/SendMessage判断Codex可达性。只有明确路由失败才按repo skill恢复，queued/parked/unconfirmed不盲重发，不轮询。完成阶段A停写等root复审，不自行进入阶段B或下一个功能任务，不关闭C04。
