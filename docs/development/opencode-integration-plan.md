# OpenCode 接入与交付计划

2026-10-23。状态：OpenCode CLI 开发验证及用户清理已完成，[验收证据与清理核对](opencode-cli-validation-20261023.md)已归档。用户指示“已经清理了，开始下一个”，按既定顺序授权桌面正式包；Windows 桌面 11/11、当批全仓 1782 项检查已通过，应用已卸载，[桌面验证与清理历史](opencode-desktop-validation-20261023.md)已归档。17:01 的[本机只读复核](evidence/tool-integration-cleanup-20261023.json)确认外层下载及四个 UIA 目录均不存在，旧残留清理关闭。完整 CI 实跑和用户真实模型的从零安装验收仍独立待验证；完整接入以[统一规范](tool-integration-standard.md)为准，剩余整改与类型寻址见[总表 C08—C14](tool-compatibility-ci-tasks.md)。

2026-11-10 更新：O06c 的 PR #10 本地候选已补强 Windows Desktop 生命周期工装。当前实现对既有 HKCU `opencode` 协议注册做两次完整值/Owner/Group/DACL 稳定采样；安装后的卸载仅在当前值与 ACL 匹配本次安装快照时移除，未知差异拒绝覆盖；ACL 回滚恢复 Owner、Group、DACL，并先打开全部子键句柄、从叶到根应用。Windows 注册表没有条件式整树删除/导入，代码在破坏操作前重读并拒绝已观察到的差异，但无法排除其他进程恰在最终复核后并发写入的窗口。

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
| O06c 完整 CI 实跑 | CLI Windows/Linux 8/8 托管通过；PR #10 的 Desktop 诊断修复及协议值/ACL 精确恢复候选现位于本地分支 `codex/opencode-desktop-ci-diagnostics-20261109`，提交 `ec038c2`、`bb4fa9d`、`1f89462`。RED 用例曾复现未知 ACL 被覆盖；修复后定向 20/20、完整 `npm run check` 通过（248 个文件通过、3 个跳过，2938 项通过、11 项跳过；导入图206模块/699边）。 | Desktop runner 的本机 baseline→candidate 原生安装尚未运行：官方 latest 端点当前报告 v2.2.6，而之前明确批准的本机 Desktop 版本为 v2.1.3；不得把 v2.1.3 原生增强验收当作该 runner 对 v2.2.6 的证据。按 Windows 注册表并发写入的非原子窗口说明，须先取得版本与残余竞态范围决定。没有推送 PR 新提交，也没有触发 Actions；PR #10 的 hosted Ubuntu send-handle 失败与重跑通过证据仍分别保留在既有 raw 文件。 |

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
