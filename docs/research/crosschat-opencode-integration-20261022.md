# OpenCode CLI / Desktop 接入 crosschat 评估

核验日期：2026-10-22。仅评估；未安装、启动或操控 OpenCode，未修改实现。对象是向用户已经启动的交互会话发信，而不是新建一个替代会话。

## 结论

**技术上可接，优先考虑 OpenCode 2 的官方本地 service / HTTP client；不能承诺写一次后随上游更新永久有效。**这是根据下列官方接口、源码和破坏性变更记录得出的工程判断，尚未完成 crosschat 双向实测。

OpenCode CLI 与桌面版在同一兼容 service 下可望共用一个原生会话适配器。若个人维护且平时很少用，建议仅承诺经过验收的具体版本范围；不要同时追踪 V1、V2、桌面私有进程和所有实验接口。这是维护策略建议，不是上游兼容性承诺。

## 已核实事实：现有交互会话有官方接入路径

- OpenCode 2 默认由同一用户的本地客户端发现或启动共享后台 server，server 拥有 sessions、permissions、tools；`--standalone` / `--server` 可改变连接方式。[官方 CLI](https://opencode.ai/v2/docs/cli/)
- 官方 Build 文档明确：第三方可以连接 TUI 和桌面版使用的同一种 client。[官方 Build](https://opencode.ai/v2/docs/build/)
- 桌面源码调用 `@opencode/client/service` 的 `Service.ensure()`，采用已发现的兼容 service；默认打包版本不走开发用 isolated 分支。其版本选择与桌面捆绑 CLI 有关，故不能假定所有桌面 / CLI 版本无条件共享同一实例。[桌面 service 源码，固定 commit](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/desktop/src/main/service/background-service.ts)
- `@opencode/client/service` 提供 `Service.discover()`（只发现健康 endpoint，不启动进程）和 `Service.headers(endpoint)`。`ensure()` 则可能启动进程；crosschat 若坚持不拥有用户会话生命周期，应优先 discover。[官方 JavaScript client](https://opencode.ai/v2/docs/build/client/)

官方 V2 API 已列出以下能力，参数直接指定已有 `sessionID`；并不限于新建 headless 会话：[官方 API reference](https://opencode.ai/v2/docs/api)

| crosschat 需要的能力 | 官方接口事实 |
|---|---|
| 枚举、详情、历史 | `session.list`、`session.get`、`session.message.list`；列表与历史有游标分页 |
| 向已有会话送信 | `session.prompt(sessionID, text, delivery)` 将输入持久收入 inbox 并调度 agent 执行；`delivery` 有 `queue` / `steer` |
| 异步结果 | `event.subscribe`；另有等待 idle 和读取 durable session log 的实验接口 |
| 恢复观察 | 事件流是 live-only；断线期间会漏事件，不能只靠 SSE 证明回复完成 |

上述 API reference 的 session 和 event 资源说明仍标注 Experimental。公开列出接口不等于长期稳定承诺。[官方 API reference](https://opencode.ai/v2/docs/api)

## 已核实事实：存在真实破坏性变更

1. V1 → V2：官方迁移指南明确要求调用旧 server API 的 integrations 迁移；V1 `@opencode-ai/sdk` 与 V2 `@opencode/client` 不是同一套契约。V2 保留许多配置兼容，不代表 server API 兼容。[官方 V2 迁移指南](https://opencode.ai/v2/docs/migrate-v1/)
2. 2.0 → 2.1：2026-10-20 的官方记录明确列为 Breaking changes，涉及公开 SDK、HTTP message/event、plugin contracts；例如 replay 字段改为 `native`、compaction 形状调整、删除 `session.compacted` 事件。这里有同一 major 内破坏公开契约的实证。[官方 changelog：v2.1.0](https://opencode.ai/changelog)
3. 这些变化不等于最小 `list` / `prompt` / 文本读取适配器全部失效。不能据此统计“协议每几天坏一次”，也不能用发布频率替代 breaking rate；本次没有完成历次版本兼容率测量。

核验时，官方 changelog 已列 v2.1.2（2026-10-21），但 GitHub `releases/latest` 指向 V1 v1.19.3；评估和后续支持声明应明确系列与发布渠道。[官方 changelog](https://opencode.ai/changelog)、[GitHub latest release](https://github.com/anomalyco/opencode/releases/latest)

## V1 的边界

V1 本身已有 HTTP server、OpenAPI、SDK、session/history/message/prompt_async 等接口。TUI 可指定 `--port` / `--hostname`，外部 client 连接其已有 server；再运行一遍 `serve` 会新开 server，不能把它当成当前 TUI server。[V1 Server](https://opencode.ai/docs/server/)、[V1 SDK](https://opencode.ai/docs/sdk/)

本次不把 V1 桌面内部 server 的自动发现 / 凭证获取认定为稳定公共契约。维护成本结论不能直接从 V2 的共享 service 反推到 V1。

## 发出消息、接收消息不是同一项能力

OpenCode 的 MCP 文档描述的是 OpenCode **连接外部 MCP server 并使用其工具**；这不能单独证明 crosschat 可从外部唤醒它。[官方 MCP 文档](https://opencode.ai/v2/docs/mcp-servers/)

工程推断：OpenCode 内的 shell / 自定义工具可以调用 crosschat 命令发信；原生收信则应使用上述 session API。双向通信还需要 crosschat 侧正确识别发送会话、生成和解析回复引用、安装协议教学、处理 queue / steer / 重试；不能把“会调用一条 CLI”标成完整双向支持。项目侧扩展面另见主评估。

## 对个人维护者的建议与未验证项

建议：只支持一条经验证的 OpenCode 2 版本线，CLI / 桌面按真实 server 归属寻址；固定 client 依赖，只用完成发信、历史和身份所必需的契约，忽略未知字段；不要读取其数据库或抓桌面随机私有端口。把未知版本报告为未验证，不伪装为兼容。

未来实施前的验收项：Windows 真机上发现 CLI / desktop 同一 service；固定已有 sessionID 后外部送信在原 UI 出现；idle / busy 的 queue 和 steer；原会话 shell 发信时的 caller identity；按信封回信；事件断线后补读历史；CLI / desktop 版本不匹配以及 standalone 模式。以上均**未实测**。

按用户“一个人维护、很少使用、希望长期少维护”的目标，推荐定位为**可选、有明确版本范围的集成**，不推荐作为“写一次永久兼容”的承诺。

## 补充：GitHub CI 兼容性哨兵可覆盖什么

工程建议：可以定期下载目标系列最新发布版，用隔离 HOME / XDG / 数据目录和一次性 workspace 启动真实 server，对比已支持基线；失败后去重创建 issue。CI 使用真实上游二进制，才能发现 mock 不知道的变更。它把问题发现自动化，不能自动保证任意未来版本兼容，也不会消除修复工作。

无付费模型 key 的第一层可测 server 启动、认证、service discovery、session create / list / get，以及历史读写格式。上游自己的 server 测试以内存数据库创建 session 并列举；历史测试关闭模型 catalog 网络拉取后，使用导入 fixture 验证真实 HTTP handler / generated client。它们是可行性证据，不代表本项目已跑过发布二进制。[官方 session-create 测试](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/server/test/session-create.test.ts)、[官方 message 测试](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/server/test/message.test.ts)

还可设计纯文本 `prompt(..., resume:false)` → 读 inbox 的入队契约检查，避免调用模型。固定 commit 的实现先 prepare / admit，只有 `resume !== false` 才 wake execution；纯文本 prepare 本身不调用模型。这个判断来自源码，尚未使用发布二进制实测。[session.prompt 实现](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/core/src/session/session.ts)、[纯文本 prepare 实现](https://github.com/anomalyco/opencode/blob/4617210822bdbb31e5749751afbfb4584ccedac8/packages/core/src/session/prompt.ts)

真正生成回复需要可用 provider：可用受控本地假 provider 或本地模型补做自动执行检查；带真实云模型的 CI 则需要其凭证与成本预算。官方云模型 CI 示例显式传 API key；不能把 `prompt` 入队成功当成模型已读、已执行、已回信。[官方 CI 示例](https://opencode.ai/v2/docs/cli/commands/)

queue / steer 真正发生在当前 busy 回合哪个边界、原桌面 / TUI 是否显示同一消息、重连后是否误投，以及原 agent 是否能携带正确 caller identity 调 crosschat 并完成回复，都需要真实进程集成验证；完整桌面链还需要桌面客户端。受控 provider 可以验证部分执行语义，mock HTTP 响应和 schema diff 单独不能证明这些行为。以上是验收设计建议，本次均未运行。
