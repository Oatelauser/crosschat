# OpenCode 接入与交付计划

2026-10-23。状态：OpenCode CLI 开发验证及用户清理已完成，[验收证据与清理核对](opencode-cli-validation-20261023.md)已归档。用户指示“已经清理了，开始下一个”，按既定顺序授权 OpenCode 桌面正式发布包的开发验证与清理；用户真实模型的从零安装验收仍独立进行。

## 目标与用户要求

- 首批 CLI 已完成；当前实施桌面正式发布包。发现、原生投递、调用方身份和回信必须一起接通。
- 单人低维护：建立真实工具与适配器的自动行为回归，模型服务使用本地脚本响应，无真实模型 API key。
- 用户无需提前下载软件。执行时由代理从官方渠道下载，记录具体版本、来源和文件摘要。
- 用户要求开发验证完成后卸载本次测试软件、清理测试数据，再自行重新安装进行完整验证。这项清理要求贯穿每批交付。
- 本次任务计划不自动扩大为 DeepSeek Harness、ZCode 实施，也不恢复此前暂停的真实远端验证。禁止在远端 Linux 安装 Codex。
- 涉及既有功能变化仍按代码规范先确认具体范围；本计划不视为对任意默认行为变更的批准。

## 剩余事项

已完成的接入合同、公共链路、CLI 适配、开发验证及 CI 工装任务已从活动列表移除，其范围、行为与证据见[开发验证记录](opencode-cli-validation-20261023.md)。

| 任务 | 内容 | 出口 |
| --- | --- | --- |
| O08 用户从零验证 | 提供正式安装、配置模型、安装 crosschat skill、发现/投递/回信/忙闲/卸载的顺序与预期结果。 | 用户自行重新安装并在 OpenCode 中配置真实模型凭据，覆盖真实使用；不要求把 key 发到聊天或放入 CI。 |
| O06a 发布包与隔离基线 | 固定官方桌面构建摘要和对应源码，核实安装/卸载归属、Windows 环境与内置 service；记录注册表、配置目录与进程基线。 | 正式发布包可在独立环境启动；不借用个人模型凭据、已有服务或用户配置。 |
| O06b 桌面行为验证 | 复用原生 Adapter，验证桌面当前已有会话的发现、精确收件、busy queue/steer、shell 身份回信、重连/重开。只为实证发现的差异改代码。 | 同一正式桌面窗口与原生会话 ID 的证据齐全；CLI server 测试不能替代桌面 UI。 |
| O06c 自动回归与交付清理 | 保留可重复工装、适用的兼容检查和安装使用说明；用实际卸载器停止并卸载本次桌面包，核对进程、安装项、协议/快捷方式、下载及测试目录。 | 开发检查与桌面实测留证，支持边界明确；仅清理本次新增且归属确认的内容。 |

每批交付都执行所属软件的清理，不能仅因代码完成就把测试安装留给用户。若工具再次拒绝清理，准确记录未完成项及拒绝原因；不绕过拒绝，也不视为用户已接受残留。

## API 如何配置

开发机和 GitHub CI 使用相同原则：在各自机器启动一个临时 HTTP/SSE 脚本服务，然后把隔离的 OpenCode 测试 provider 指向该机器的 `127.0.0.1` endpoint。脚本返回合法的固定文本、工具调用或可控延迟，客户端若要求 key 则使用无权限的测试字符串。测试 provider 显式选择，不回落真实云模型。

真实运行的是 crosschat、OpenCode、会话状态、投递、工具执行和持久化；预设的是模型响应。此方案不验证模型的理解质量、个人登录流程或厂商云服务。用户最终从零验证时，在自己的 OpenCode 中填写模型 endpoint/key 或登录账户；crosschat 不负责保存这些模型凭据。

[官方自定义模型 provider](https://opencode.ai/v2/docs/providers/)；[上游 CLI 与本地脚本模型测试先例](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/cli/test/acp/subprocess.ts)。

## 下载、桌面与精确清理

- CLI：用[官方 Windows 独立 ZIP](https://opencode.ai/v2/docs/)解压到本次测试目录，绝对路径调用，避免全局安装和长期 PATH 修改。
- 桌面：用[官方发布安装包](https://opencode.ai/download)，安装前记录既有安装项、目录、快捷方式、协议注册及服务基线。当前 v2.1.3 [打包配置](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/desktop/electron-builder.config.ts)采用按用户 NSIS 安装；实际权限/UI 行为执行时核验。
- 隔离：v2.1.3 [发布源码](https://github.com/anomalyco/opencode/blob/bb25a2f4a3f3f04d7c344bec0c0574ea3510b3b1/packages/desktop/src/main/lifecycle/configure.ts)允许 `OPENCODE_DESKTOP_TEST_ROOT`，可作为该精确版本的候选入口，必须先验证实际文件与服务归属；CDP 调试入口仍限开发版。不能直接沿用前期其他提交中的限制或把此变量当跨版本保证。
- 卸载：桌面使用本次安装产生的实际卸载记录/官方卸载器。CLI 的 `opencode uninstall` 会涉及共享缓存并保留会话等数据，不能代替桌面卸载或精确还原测试环境。[官方卸载说明](https://opencode.ai/v2/docs/cli/commands/#uninstall)
- 清理：只终止本次记录的进程和服务；删除前解析、核对绝对路径及本次归属。已有用户软件或资料不作测试残留处理。测试安装和测试配置要清理，crosschat 成果与验收证据保留。
- 若安装或卸载遇到必须由用户操作的系统权限窗口，届时说明具体操作；不要求用户提前自行下载。

## 后续候选

DeepSeek Harness 另立原生插件桥接与兼容测试范围；ZCode 先确认第三方连接已有会话的稳定入口。二者均不计入本轮 OpenCode 交付，不因安装方便就先装到用户机器上。

用户另要求将 Claude Code、Codex CLI、Codex 桌面版的同类兼容验证 CI 放入后续列表，见[工具兼容 CI 待办](tool-compatibility-ci-tasks.md)。当前先按本计划完成 OpenCode 桌面版，不切换开发进度。
