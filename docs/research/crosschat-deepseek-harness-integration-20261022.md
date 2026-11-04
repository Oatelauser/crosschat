# DeepSeek Harness 接入 crosschat：可行性与维护成本

调研日期：2026-10-22（Asia/Shanghai）。仅文档及源码调查，未安装 Harness、未发送真实消息、未验证桌面往返。官网链接到的官方仓库主分支调查时为 `687f282e8625c6b8d11ff58211a90524be2e4317`，对应 2026-10-17 的 `dsh-v0.2.1-rc.2`。下列源码链接固定于该提交。

## 结论

- **产品身份已确认**：DeepSeek Harness 是 DeepSeek 官方开源 agent harness，有 Web 和 Windows/macOS Desktop；不是 DeepSeek 模型 API 的别名。[官网](https://www.deepseek.com/en/harness/)
- **接入已有交互会话：有条件可行**。官方公开 Agent API 能查找同进程 live Agent，并向同一会话投递 followup/steer；可制作原生 Cordis bridge 插件。Web/Desktop 的 session RPC 也具备 sessionId、queue/steer 和请求去重能力。[Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/README.md)、[请求类型](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/types.ts)、[prompt 实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/commands.ts)
- **不是现成 crosschat 支持，也不能承诺一次编写长期免维护**。SDK 协议文档明确声明预发布阶段无兼容承诺，且无协议版本协商；官方首页也称核心插件及 API 持续演进。[SDK 协议限制](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/README.md)、[官方预览说明](https://www.deepseek.com/harness/en/)
- **维护建议（判断）**：对于单人维护、很少亲用的工具，将它列为低优先级实验接入；若确需支持，优先做薄 Cordis bridge，并限制验证过的版本范围。不要承诺对自动升级后的任意版本持续可用。

## 已有会话互通需要的能力

| 能力 | 官方事实 | 对 crosschat 的含义 |
|---|---|---|
| live 会话发现 | `ctx.agents.get(id)/list()/roots()` 查询当前进程 Agent。[Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/README.md) | 同进程 bridge 能登记当前交互会话；不必扫描私有历史文件。 |
| 空闲唤醒、忙时排队/追加 | `followup()` 投递下一轮并唤醒；`steer()` 投递下一步并唤醒；`inject()` 不主动唤醒。[Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/README.md) | 原语与 crosschat 的 queue/steer 基本对应，但仍须实测边界及回执。 |
| Web/Desktop 同一 Session 寻址 | `SessionPromptRequest` 携带 `sessionId/requestId/mode/content`；`commands.prompt()` 解析 Agent，并用 `requestId` 检查已排队或记录的输入，随后调用 followup/steer。[请求类型](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/types.ts)、[实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/commands.ts) | 有原生投递基础；接收成功仅是入队回执，不等于 AI 已回信。 |
| 历史、事件与状态 | session-controller 提供 list、history page、follow 和 projections；列表不激活冷会话，prompt 等操作可能恢复会话。[Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/README.md) | 可以研究用原生查询发现及核验投递；必须显式区分 live、cold 和 resumed。 |
| Agent 自主回信身份 | 每次模型 shell 调用有 Harness 管理的 `DSH_SESSION_ID`、`DSH_HOME`；有 profile 上下文时还有 `DSH_PROFILE/DSH_PROFILE_DIR`。[Shell environment](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/shell-env/README.md) | 可以扩展 crosschat 调用者身份识别；目前不是仅安装现有 crosschat skill 就能自动支持。 |
| 扩展机制 | 官方推荐自定义行为采用原生 Cordis 插件；兼容 Claude/Codex 的 hook bridge 属实验模块。[Hook protocol](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/hook-protocol/README.md) | 适合将薄桥装入用户真实 Desktop/Web runtime；避免借别家 hooks 兼容层作为长期主通道。 |

## 为什么 ACP、SDK、headless 不能直接算作桌面 attach

ACP、SDK、headless 都是真实的官方能力，但运行对象和所有权不同。

- **ACP**：官方定位是 automation-only 标准 ACP v1。能 list/resume/close；其中 resume 明确要求持久化的**非活动会话**。不支持 `session/load`、历史 replay 等交互特性。[ACP 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md)
- **SDK**：客户端启动自己的 stdio JSON-RPC runtime；resume 从原持久化 store 恢复，会拒绝 occupied session。prompt 回执只有 messageId，官方明确没有每次 prompt 对应的最终结果。[SDK 协议](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/README.md)、[SDK server](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/server/README.md)
- **Headless**：每次运行一个任务后退出；支持 `--session-id` 续用持久化会话，但会验证 cwd、preset 等条件并拒绝当前进程已被其他 Agent 驱动的身份。它不是向已打开 GUI 会话投递的 API。[Headless 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/headless/README.md)

因此，“用 ACP/SDK/headless 创建一个 Harness agent”可以成立，但不能据此宣称“已支持用户桌面上正在聊的那个会话”。

## Desktop 已有实例的连接边界

Desktop 是共享 Web application 的 Electron 外壳，Host 默认在 `127.0.0.1` 的系统分配端口监听。启动 URL、注入与关闭通过私有 Node IPC 交给 Electron；认证由 desktop carrier 持有。[Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md)、[Desktop Host 源码](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop-host/src/index.ts)

Web RPC/stream 全部需要认证；单独知道端口、Session ID 或 loopback 地址不授予访问。Connection 文档支持 non-page client carrier，但要求调用者提供认证 cookie；query token 仅用于入口交换。[Connection 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/README.md)

**调查范围内未找到**一个向第三方承诺长期稳定的“列举本机正在运行的 Desktop 实例并 attach”接口。由此建议（推断）先用同进程 plugin bridge 自行向 crosschat 登记实例与 Session，而不是逆向 Electron 私有 IPC、遍历进程取令牌或硬编码端口。此方案的安装、插件热更新、认证、queue/steer 与真实往返仍未实测。

## 协议究竟变得多不多

官方承诺和实际变化都不支持“基本不变”的假设：

1. 官方预览说明明确称核心插件/API 会演进；SDK 文档明确无版本协商、无兼容承诺。ACP 标准本身提供了较明确的语义面，但不能替代该实现的已有 UI 会话 attach 能力。[预览说明](https://www.deepseek.com/harness/en/)、[SDK 限制](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/README.md)、[ACP 约束](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md)
2. 2026-10-17 的 0.2.1-rc.1 发布说明记载需要开发者调整的变化：custom SDK runtime 需支持 `session/wait`；Agent Team 改直接 Inbox 投递，删除独立 outbox/自动重试/重发去重，相关配置及结果字段需迁移；网关身份授权与连接机制调整；第三方插件兼容性改优先判断 `engines.dsh`。[发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)
3. 持久化格式另有 V4 compatibility baseline 和相邻版本迁移纪律。**保存的数据有迁移承诺，不等于第三方 RPC/插件 API 冻结**；直接解析历史文件仍需承担格式适配。[Session 格式状态](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/session-format-status.md)

不能仅凭发布频率给出“每 N 周一定坏一次”的数值；调查未对各发行版运行同一第三方集成。但现有证据足以评为**较高维护风险、可试验、暂不适合免维护承诺**。
