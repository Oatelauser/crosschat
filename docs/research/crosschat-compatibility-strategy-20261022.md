# crosschat 新工具接入与低维护兼容方案

核对日期：2026-10-22。状态：调查与建议，尚未实现或验收适配器、CI、版本准入。本轮不改变 T06、现有产品功能、用户工具或账户配置。

## 用户目标与已表达偏好

- 评估 OpenCode CLI / Desktop、DeepSeek Harness、Z.ai ZCode 能否与 crosschat 互聊。
- 用户单人维护，较少使用这些工具，优先低维护；希望升级兼容验证自动完成，失败自动提 issue。
- 用户不接受把真实大模型 API key 放到 CI；本方案无需这种密钥，也无需个人登录凭据。
- 本项目既有目标是向用户已打开的原生交互会话投递；另起 headless 会话不能冒充对当前桌面聊天的支持。

## 工具接入判断

以下为源码与官方文档支持的工程判断，不是 crosschat 已支持这些工具的声明；均未进行本项目实际往返验收。

| 工具 | 接入已有交互会话 | 单人维护建议 |
| --- | --- | --- |
| OpenCode 2 CLI / Desktop | 官方共享 service、发现/认证和 session API 有基础；queue/steer 有公开参数。桌面及 CLI 必须定位实际兼容 service，不能假定所有版本共用实例。 | 优先候选，先限一条版本渠道和主要平台。 |
| DeepSeek Harness | 有 live Agent API 和 queue/steer；同进程原生 bridge 插件有接入基础。ACP/SDK resume 不能替代活跃桌面 attach。 | 后续实验候选，先验证 bridge 与宿主版本边界。 |
| Z.ai ZCode | 自有 CLI/app-server 有基础；当前桌面由 Host 持有 stdio，未确认面向第三方的稳定已有实例 attach 接口。 | 暂缓完整桌面收件适配。 |

细节与固定源码链接分别见 [OpenCode 研究](crosschat-opencode-integration-20261022.md)、[DeepSeek Harness 研究](crosschat-deepseek-harness-integration-20261022.md)、[ZCode 研究](crosschat-zcode-integration-20261022.md)。

不能承诺随上游升级一直兼容：OpenCode 的 [V2 迁移](https://opencode.ai/v2/docs/migrate-v1/)与 [2.1 changelog](https://opencode.ai/changelog)均有公开契约 breaking change；Harness [SDK 限制](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/README.md)明确无兼容承诺；ZCode [当前协议](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/zcode-protocol.md)记录旧命令删除。没有测量过各版本的实际失效率，不能据发布频率编造“每几周会坏一次”。

## 推荐：自动行为验证，再按已验证能力使用

仅在 CI 检测失败后提 issue，还不能保证本地发送可控。建议将自动行为测试与本地能力检查配合，兼容记录先作为一个小型 JSON 证据索引，无需先建独立平台。

1. CI 定期查询各工具选定的官方发行渠道；发现新构建后，在临时用户目录/配置中安装并启动真实工具。预发布渠道需单独声明；不能假定 GitHub `releases/latest` 就是所有产品当前分发渠道。
2. 用同一版 crosschat 和同一组测试，分别检查固定良好基线与新候选。适配器、工具 runtime、IPC/HTTP、会话身份、持久化都真实运行；只有模型响应来自本机脚本服务。
3. 测试已有测试会话的发现/准确寻址、空闲收件与唤醒、忙时 queue 与 steer、真实 shell 工具调用 crosschat 回信、断线后的状态核验及退出清理。测试会话属于受控 fixture，不向用户生产会话发探测消息。
4. 通过后自动记录这个组合支持的能力及证据；确定失败则不将其登记为通过，并在本仓库创建或更新去重 issue。无需每个正常升级都人工审批。
5. 本地识别目标 owner 实际 runtime、必要协议版本/能力，再使用匹配的兼容证据。未知不等于不兼容；只能读到 CLI 版本时，不能据此为桌面内置 runtime 放行。

兼容记录至少绑定工具/发行渠道、实际 runtime build 或摘要、适配器与测试版本、OS/架构、CLI/Desktop、已测能力及证据 URL。官方稳定且可协商的协议可以按协议及能力判断；私有/实验接口应采取更严格的构建限制，不因版本号看起来相近就推定兼容。

记录随包带一份并可缓存更新；发消息不依赖每次实时访问 GitHub。已验证组合继续使用既有证据，未覆盖能力保持未验证。对新工具的未准入写能力可选择阻止投递；这属于后续产品行为设计，尚未获实施批准。不得擅自升级/降级用户工具、换会话或自动重发写入结果不明的消息。

## 无真实模型密钥的自动测试

测试中的模型服务是临时本地 HTTP/SSE 程序，返回预设文本、工具调用及可控延迟；不运行大模型，也不调用云端。若客户端要求非空 API key，使用没有任何权限的假字符串。工具必须显式选择测试 provider，并限制模型请求只去本地测试 endpoint，避免默认模型回退到云端。

这不是只 mock crosschat 的 adapter：真实工具仍需处理投递、调度、执行工具调用及保存记录。可控模型响应允许测试精确制造“忙碌中”“新一轮”“工具调用回信”等时序。

已有官方依据：

- OpenCode [自定义 provider](https://opencode.ai/v2/docs/providers/)允许 OpenAI-compatible endpoint；[上游真实 CLI 子进程 fixture](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/cli/test/acp/subprocess.ts)已用隔离环境、localhost endpoint、假 key、文本和 tool-call stream。将其扩展为 crosschat 行为回归是可行方案，尚未实施。
- Harness [模型插件](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm-pi-ai/README.md)支持自定义/self-hosted endpoint；[Web 测试](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/web/tests/README.md)保留真实 composition、浏览器、HTTP、Agent loop、工具和持久化，仅替换模型响应；[Desktop 测试](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/tests/README.md)有受控真实 Host 的先例。

这些先例不能证明本项目适配器已通过，也不能证明任意发布安装包的 GUI 都能直接套用。尤其 OpenCode 的 [桌面测试配置](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/desktop/src/main/lifecycle/configure.ts)部分仅开发版启用。CLI/server、开发桌面、发布桌面必须分别记录覆盖。

本组测试不检验真实模型质量、个人账户登录或厂商云服务状态。通信兼容测试不需要每次调用真实模型；若未来另加云端测试，须独立决定，不能偷偷引入真实密钥。

## GitHub CI 与通知

现有 [.github/workflows/ci.yml](../../.github/workflows/ci.yml)只在 push/PR 跑仓库检查；不会自动下载上游新版本验证。建议单独的 schedule + workflow_dispatch 监测任务，保留现有日常 CI。

- 分类区分：覆盖范围内通过、确认协议/行为回归、安装/网络错误、需要认证、未覆盖。固定良好版本也失败时先排查检测环境，不能直接归因上游。
- 确定性失败复跑确认；按工具/构建/能力与错误签名去重，同一问题只更新原 issue，状态无变化不反复评论。附准确版本、crosschat commit、测试步骤、日志和重现命令。
- 下载并运行工具的 job 不拿写仓库 token。独立报告 job 只处理校验过的结果，使用 GitHub 内置短期 `GITHUB_TOKEN` 和 `issues: write` 发本仓库 issue；无需个人 PAT，更无需模型 key。[GitHub 官方 token/建 issue 示例](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)、[Issue API](https://docs.github.com/en/rest/issues/issues)
- 发布兼容索引需另定存放方式及最小写权限；只运行测试成功并不等于索引已经发布或客户端已经使用。无需把这些步骤做成独立服务。
- GitHub 定时任务在默认分支运行、可能延迟；公开仓库长期无活动会停用 schedule。这意味着无人照看不等于保证永久运行，应展示最后检测时间。[官方 schedule 规则](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 本项目的首次扩展成本

[会话模型](../../src/application/sessions/model.ts)与 Catalog 已支持可扩展 Provider；但 [发送依赖](../../src/application/send/types.ts)、[调用者身份](../../src/identity.ts)和 [回信引用](../../src/ref.ts)仍有 Claude/Codex 固定结构。首次完整接入要同时贯通发现、发送、身份与回信，不是只增加查询 Reader。原生差异保留在 Adapter，必要时为 Harness 做薄同进程 bridge；bridge 能缩小变动面，但其宿主 API 仍需测试。

推荐首个范围：OpenCode、一个主要平台、一个当前候选渠道和一个固定良好基线；建立自动行为回归后再扩桌面及其他工具。目标是正常升级自动通过，出现真实协议变化时才需要修复。CI 能自动验证和限制未确认能力，不能自动保证上游永远不变或自动修复所有 breaking change。
