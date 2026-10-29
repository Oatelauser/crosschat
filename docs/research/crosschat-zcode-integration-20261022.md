# ZCode 与 crosschat 接入评估

核对日期：2026-10-22。对象暂按智谱 / Z.ai 的 [ZCode](https://zcode.z.ai/en/docs/welcome) 解释；用户尚未给出产品链接，不能排除其他同名工具。本报告只调查，不实现适配、不改现有功能、不调用真实会话。源码基线为官方 `zai-org/ZCode` 的 `3c5b227649371507ddc4eb46ac5133afe6db1cab`。

## 结论

ZCode 有技术上的接入基础，但现阶段不符合“写一次、以后基本不用管”的高确定性要求。适合先保留为候选；如果本人很少使用它，不建议现在承担完整桌面原生收件适配。

需要区分三件事：ZCode Agent 通过 shell 调用 crosschat 发送/回复、crosschat 管理自己启动的 ZCode Agent，以及向用户已经打开的 ZCode 桌面会话投递。前两种已有清楚的文档依据；第三种虽然官方产品自身能做到远程控制，但尚未确认有给第三方使用、并承诺兼容的 attach 接口。

本仓库 [README](../../README.md) 已说明：具备 shell 的其他 agent 可以调用 crosschat 发送，原生接收要单独适配和验收；[核心应用接口](../development/core-api.md) 也明确真实 ZCode 尚未接入。因此以下“可行”均不是 crosschat 当前已经支持的声明。

## 能力与限制

| 能力 | 官方证据与含义 |
| --- | --- |
| 产品与源码 | 官方仓库包含桌面、浏览器、后端、CLI/runtime；README 记录 2026-10-19 更新 v3.16.2。不能继续按“仅有闭源桌面”的旧印象判断。[仓库](https://github.com/zai-org/ZCode/tree/3c5b227649371507ddc4eb46ac5133afe6db1cab) |
| Headless | CLI 有 `--prompt`、JSON / stream-json 输出、显式 `--resume <sessionId>`；可以写启动器调用，并保存 ID 连续交互。[命令行](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/02-cli-reference.md)、[会话](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/06-sessions.md) |
| Agent server | 有 `zcode app-server --stdio`，NDJSON 协议。设计文档称其为桌面集成的“私有 agent server”；这不等于第三方长期稳定 API。[Agent Server](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/design/v2/zcode-protocol-agent-server.md) |
| 列举、读取与发送 | 当前 V4 包含 `sessions-index`、conversation snapshot/delta、`sendText`、创建/改名/停止及队列操作。可为 crosschat 自己拥有的进程编写客户端。[当前协议](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/zcode-protocol.md) |
| 现有桌面会话 | 桌面 Host 持有 CLI 的 stdio；手机远控 attach 同一 Host/CLI，能列任务并继续发送。另开 `app-server` 或 `--resume` 不能直接当作已连接桌面当前 runtime；后者是否安全共享活跃会话也未实测。[通信分层](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/architecture/communication-protocol-layers.md)、[远控](https://zcode.z.ai/en/docs/remote-control) |
| Web/server 入口 | `zcode --web` 提供本机 Web 服务；源码 `/ws` 暴露服务 RPC，并具有令牌鉴权。技术上可另建受控连接，仍需处理 ZCode 自有 RPC 与产品版本；不是一个通用 REST 聊天接口，也不能据此保证接入已有桌面窗口。[README](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/README.md)、[HTTP/WS 实现](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/server/src/http.ts) |
| MCP | ZCode 是 MCP 客户端，支持 stdio/HTTP/SSE，并可导入其他 agent 的 MCP 配置。可让它调用 crosschat 的工具封装；不等于 crosschat 自动获得对 ZCode 会话的控制权。[MCP](https://zcode.z.ai/en/docs/mcp-services) |
| Hooks 与插件 | 有 SessionStart、工具生命周期、Stop 等 hook，可运行进程并注入上下文。hook 发生在既有生命周期事件上，不能仅凭此宣称任意闲置会话可以立即被外部消息唤醒。[Hooks](https://zcode.z.ai/en/docs/hooks) |
| SDK / ACP | 本次未确认面向第三方的稳定 Agent SDK 或 ACP server 契约；官方代码有自有协议和内部服务类型。这个结论是“没有确认”，不是“不存在任何可能”。 |

## 为什么维护风险偏高

1. 当前协议文档明确以 V4 为主，旧 session schema 仅供残余兼容调用，不作为新功能入口；还明确 `session/steer`、`session/rewind` 等已删除。这是接口变动的直接证据，但不能由此统计未来每月会破坏多少次。[当前协议](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/zcode-protocol.md)
2. 官方 CLI 文档说 JSON 示例字段可随构建变化；指南要求保存构建提交/二进制摘要，不要只凭 `0.16.x` 版本号判断能力相同。`--resume` 是有文档的入口，但输出解析仍须能力探测和回归验证。[命令行](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/02-cli-reference.md)、[指南](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/README.md)
3. 存储文档直接把 SQLite schema 列为实现细节。扫描/修改数据库不是值得单人长期维护的稳定接入面；尤其不能用写数据库冒充唤醒。[会话](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/usage/06-sessions.md)
4. 源码确有协议版本、能力位、`minCompatibleVersion` 检查，说明官方在处理自身客户端/服务端兼容；但未找到面向外部适配器的长期支持期限。默认未注入最小兼容版本时，它退回产品当前版本，不能把该机制解释成永久兼容承诺。[版本检查](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/source-server/compatibility.ts)、[握手 schema](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/packages/shared/src/zcode-protocol-v4/transport.ts)

## 能否复用 Claude Code / Codex / OpenCode 适配

当前主产品强调自研 ZCode Agent。旧版会话迁移、Claude 风格插件/hook 字段兼容、导入其他工具的 MCP 配置，都不代表原生收件协议兼容。官方 Agent Server 设计甚至明确后续不再通过多 agent 兼容层集成，而是使用 zcode-cli 私有 server。因此应按独立 Provider 评估，不能直接挂到现有 Claude/Codex 适配器。[产品说明](https://zcode.z.ai/en/docs/welcome)、[安装与旧版迁移](https://zcode.z.ai/en/docs/install)、[Agent Server 设计](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/apps/zcode-cli/docs/design/v2/zcode-protocol-agent-server.md)

## 对单人维护的建议

- 只需要偶尔让 ZCode 主动发消息：先用 shell 调 crosschat，必要时补一份技能/插件教学；成本最低，仍须验证权限和回复身份。
- 需要自动收件：先决定是否接受“由 crosschat 启动和持有 ZCode 会话”，再对固定构建做最小双向原型；不能把原型成功当作桌面已有会话全部支持。
- 需要现有桌面窗口立即收件且希望长期免维护：暂缓，等待明确的外部 attach/控制 API 与兼容政策，或先获得上游支持。

未执行 ZCode 安装、登录、真实模型调用、Windows/Linux roundtrip、活跃桌面 attach、忙时队列/steer、退出重连或多版本兼容测试。本次结果足以判断维护优先级，不是接入验收。
