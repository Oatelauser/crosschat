# OpenCode 接入与交付计划

2026-10-23。状态：OpenCode CLI 开发验证及用户清理已完成，[验收证据与清理核对](opencode-cli-validation-20261023.md)已归档。用户指示“已经清理了，开始下一个”，按既定顺序授权桌面正式包；Windows 桌面 11/11、当批全仓 1782 项检查已通过，应用已卸载，[桌面验证与清理历史](opencode-desktop-validation-20261023.md)已归档。17:01 的[本机只读复核](evidence/tool-integration-cleanup-20261023.json)确认外层下载及四个 UIA 目录均不存在，旧残留清理关闭。完整 CI 实跑和用户真实模型的从零安装验收仍独立待验证；完整接入以[统一规范](tool-integration-standard.md)为准，剩余整改与类型寻址见[总表 C08—C14](tool-compatibility-ci-tasks.md)。

2026-11-10 更新：O06c 的 PR #10 本地候选已补强 Windows Desktop 生命周期工装。当前实现对既有 HKCU `opencode` 协议注册做两次完整值/Owner/Group/DACL 稳定采样；安装后的卸载仅在当前值与 ACL 匹配本次安装快照时移除，未知差异拒绝覆盖；ACL 回滚恢复 Owner、Group、DACL，并先打开全部子键句柄、从叶到根应用。Windows 注册表没有条件式整树删除/导入，代码在破坏操作前重读并拒绝已观察到的差异，但无法排除其他进程恰在最终复核后并发写入的窗口。

最终本机完整 runner 已按用户批准的 v2.1.3→v2.2.6 范围完成 baseline→candidate，分类为 `compatible`（`notify=false`）：两个版本各 11/11 原生行为检查通过。正式 Desktop 均经官方卸载器卸载，退出码为 0；安装/卸载登记、副作用文件、探测进程和运行根均清除，原协议注册恢复；下载根清理结果为 `removed`。最终报告见[完整重跑证据](evidence/opencode-o06c-local-20261110/desktop-v213-to-v226-final/summary.json)。先前长下载轮次因官方安装器生成的 NSIS 卸载器 `NotSigned` 被旧 runner 错误拒绝，且留有两项隔离 profile 文件；修复 `9c3e1b0` 保留签名校验，并将未签名卸载器限制为精确安装路径、安装后 SHA-256 未变化且卸载登记仍指向该安装。该轮及其手动卸载记录保留为历史，不覆盖最终完整重跑。定向 22/22、全量 248 文件/2940 项通过（3 文件和 11 项跳过；导入图 206 模块/699 边）。最终卸载报告确认原协议注册恢复；ACL 快照/恢复保护已在工装实现中，但这组最终摘要未单独归档原始 SDDL 对比值。

随后独立代码复核发现两个清理边界：原生 probe 后才采集安装协议快照，以及安装命令失败但已生成卸载器时未保存其身份摘要。测试检查点 `42ddd9b` 先以 3 项 RED 暴露这些路径，修复提交 `76e8101` 将卸载器身份、精确卸载登记和协议快照验证移到 probe 前，并对不完整归属拒绝重试清理；Node 22.23.4 完整 `npm run check` 通过（248 个文件通过/3 跳过，2944 项通过/11 跳过，导入图 206 模块/699 边）。针对修复后的再次原生重跑在请求官方 latest 元数据时超时，runner 分类为 infrastructure，下载根正常删除，未安装 Desktop；故前述 `compatible` 证据适用于修复前 runner 候选，修复后的原生生命周期重跑仍待通过。

2026-11-10再次复核发现安装阶段仍须比较完整注册表树：只核验 protocol command 会把同期其它注册表改动误收为安装器所有。新增测试后 RED 2 项、GREEN 30/30；安装前后及探测前后现均比较完整 registry values 与 Owner/Group/DACL，只接受完全不变或仅精确默认命令切到本次 `OpenCode.exe`。完整 Node 22.23.4 `npm run check` 通过（248 文件通过/3 跳过，2948 项通过/11 跳过；导入图 206 模块/699 边）。首次修复后原生轮次 baseline 11/11 通过，但官方 candidate 下载超时且未安装；随后使用从官方固定 URL 下载并逐个复核 SHA-256/size 的 v2.1.3 与 v2.2.6 包重跑，baseline/candidate 各 11/11，分类 `compatible`（`notify=false`）。两次官方卸载退出码均为 0，安装/卸载登记和副作用文件均清除，协议值及 ACL 恢复，runner 自有根删除；最终报告见[修复后完整原生重跑](evidence/opencode-o06c-local-20261110/desktop-v213-to-v226-review-rerun-final/summary.json)。

当前仍有两处本机测试临时根需要清理：较早一次失败轮的 `C:\Users\yangsheng\AppData\Local\Temp\crosschat-opencode-desktop-ci-NkUyHW`（原 protocol 已按完整值/Owner/Group/DACL 基线精确恢复，OpenCode 安装器、卸载器和相关进程均不存在），以及本轮两个官方 SHA-256 固定安装包的临时缓存 `C:\Users\yangsheng\AppData\Local\Temp\crosschat-opencode-installer-cache-20261110`。递归删除请求被自动审批拦截，代理未改用其它路径删除；在这两处目录清除前，不能把本机临时数据清理标为完成。用户此前确认删除的 `jWxwnO` 两个 profile 残留与该旧轮根均无关，已单独核验不存在。

## 目标与用户要求

- 首批 CLI 已完成；当前实施桌面正式发布包。发现、原生投递、调用方身份和回信必须一起接通。
- 单人低维护：建立真实工具与适配器的自动行为回归，模型服务使用本地脚本响应，无真实模型 API key。
- 用户无需提前下载软件。执行时由代理从官方渠道下载，记录具体版本、来源和文件摘要。
- 用户要求开发验证完成后卸载本次测试软件、清理测试数据，再自行重新安装进行完整验证。这项清理要求贯穿每批交付。
- 本次任务计划不自动扩大为 DeepSeek Harness、ZCode 实施，也不恢复此前暂停的真实远端验证。禁止在远端 Linux 安装 Codex。
- 涉及既有功能变化仍按代码规范先确认具体范围；本计划不视为对任意默认行为变更的批准。

## 剩余事项

已完成的接入合同、公共链路、CLI 适配、桌面发布包/隔离基线及桌面行为验证已从活动列表移除；范围、行为、批准和验证证据分别见 CLI 与桌面开发验证记录。

| 任务 | 内容 | 出口 |
| --- | --- | --- |
| O08 用户从零验证 | [CLI](../opencode-cli.md)和[桌面](../opencode-desktop.md)指南已提供。等待用户重新安装，配置自己的模型并验证发现、投递、原生 shell 回信及忙闲行为。 | 真实使用独立验收；不要求把 key 发到聊天或放入 CI。 |
| O06c 完整 CI 实跑 | CLI Windows/Linux 8/8 托管通过；PR #10 的 Desktop 诊断修复及精确协议注册恢复候选位于本地分支 `codex/opencode-desktop-ci-diagnostics-20261109`。修复后 Node 22.23.4 `npm run check` 通过（248 文件/3 跳过，2948 项/11 跳过）；Windows Desktop v2.1.3→v2.2.6 原生 runner 两版本各 11/11，分类 `compatible`，完整安装/官方卸载/协议恢复结果见[修复后完整原生重跑](evidence/opencode-o06c-local-20261110/desktop-v213-to-v226-review-rerun-final/summary.json)。较早超时与协议改动拒绝轮次保留为历史，用户已删除的 `jWxwnO` 残留未复现。 | 本地候选新增安装前后完整 registry values 与 Owner/Group/DACL 所有权快照，拒绝探测前未知变更；本机代码与验收现已通过。仍有旧失败轮运行根和两包临时缓存待清理，删除请求被自动审批拦截，故清理状态未关闭。当前分支本地提交尚未推送，本轮新改动的 hosted CI 尚未运行；PR #10 既有 hosted Ubuntu send-handle 失败与重跑通过证据保留在原始记录中。推送更新 PR #10/运行新托管 CI 需要针对当前具体候选另行决定。 |

每批交付都执行所属软件的清理，不能仅因代码完成就把测试安装留给用户。若工具再次拒绝清理，准确记录未完成项及拒绝原因；不绕过拒绝，也不视为用户已接受残留。

## API 如何配置

开发机和 GitHub CI 使用相同原则：在各自机器启动一个临时 HTTP/SSE 脚本服务，然后把隔离的 OpenCode 测试 provider 指向该机器的 `127.0.0.1` endpoint。脚本返回合法的固定文本、工具调用或可控延迟，客户端若要求 key 则使用无权限的测试字符串。测试 provider 显式选择，不回落真实云模型。

真实运行的是 crosschat、OpenCode、会话状态、投递、工具执行和持久化；预设的是模型响应。此方案不验证模型的理解质量、个人登录流程或厂商云服务。用户最终从零验证时，在自己的 OpenCode 中填写模型 endpoint/key 或登录账户；crosschat 不负责保存这些模型凭据。

[官方自定义模型 provider](https://opencode.ai/v2/docs/providers/)；[上游 CLI 与本地脚本模型测试先例](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/cli/test/acp/subprocess.ts)。

## 下载、桌面与精确清理

- CLI：用[官方 Windows 独立 ZIP](https://opencode.ai/v2/docs/)解压到本次测试目录，绝对路径调用，避免全局安装和长期 PATH 修改。
- 桌面：用[官方发布安装包](https://opencode.ai/download)，安装前记录既有安装项、目录、快捷方式、协议注册及服务基线。本次桌面 v2.1.3 对应源码为 `37d973754ba6cc31732f93421c0c18b675841573`，与同版本 CLI 的构建来源分别记录；正式包采用按用户 NSIS 安装，实际无提权静默安装及官方卸载器已实测。
- 隔离：[桌面发布源码](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/configure.ts)允许 `OPENCODE_DESKTOP_TEST_ROOT`；本轮同时隔离 HOME、USERPROFILE、XDG、临时目录和模型配置，并实际核对服务/进程归属。源码只在开发版自动添加 CDP 参数；正式包显式传入 loopback 调试参数已实测有效，未修改 app.asar。该入口、首次引导种子和安装隔离都属于具体构建的测试合同，不能当跨版本保证。
- 卸载：桌面使用本次安装产生的实际卸载记录/官方卸载器。CLI 的 `opencode uninstall` 会涉及共享缓存并保留会话等数据，不能代替桌面卸载或精确还原测试环境。[官方卸载说明](https://opencode.ai/v2/docs/cli/commands/#uninstall)
- 清理：只终止本次记录的进程和服务；删除前解析、核对绝对路径及本次归属。已有用户软件或资料不作测试残留处理。测试安装和测试配置要清理，crosschat 成果与验收证据保留。
- 若安装或卸载遇到必须由用户操作的系统权限窗口，届时说明具体操作；不要求用户提前自行下载。

## 后续候选

DeepSeek Harness 另立原生插件桥接与兼容测试范围；ZCode 先确认第三方连接已有会话的稳定入口。二者均不计入本轮 OpenCode 交付，不因安装方便就先装到用户机器上。

用户另要求将 Claude Code、Codex CLI、Codex 桌面版的同类兼容验证 CI 放入后续列表，见[工具兼容 CI 待办](tool-compatibility-ci-tasks.md)。当前先按本计划完成 OpenCode 桌面版，不切换开发进度。
