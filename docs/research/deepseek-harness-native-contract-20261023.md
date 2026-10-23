# DeepSeek Harness 原生接入契约核查

核查日期：2026-10-23（Asia/Shanghai）。只读访问官方文档、GitHub 源码和 refs；没有安装或运行 Harness，没有读取用户凭据，没有验证真实 Web/Desktop 往返。

## 版本与结论

官方发行页最新条目仍为预发布 `dsh-v0.2.1-rc.2`（2026-10-17）。本次 `git ls-remote` 核对 `HEAD`、`refs/heads/master` 和该 tag 均指向 **`687f282e8625c6b8d11ff58211a90524be2e4317`**；CLI 与 Agent 包版本均为 `0.2.1-rc.2`。下列源码链接全部固定该提交。[发行页](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)、[CLI manifest](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/package.json)、[Agent manifest](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/package.json)

**可以沿官方扩展机制接入已有会话；建议使用同进程 Host 插件作为薄桥。** 不应把“新启一个 SDK/ACP 进程”当作“接入用户已打开的桌面会话”。没有找到可让第三方自动发现现有 Desktop 实例、取得其认证并承诺兼容的统一 attach 接口；这是本次调查范围内的否定结果，不等于官方保证永远不存在此入口。

| 路径 | 已有会话发现、投递 | 前置条件与判断 |
|---|---|---|
| 同进程 Cordis Host 插件 | 原生 `ctx.agents.get/list/roots`，`followup/steer` | 用户将桥安装到实际运行的 Web/Desktop profile；最窄原生依赖面。 |
| Web 公共 RPC | `session/list`、`session/prompt`，支持 queue/steer | 调用者已获该实例的启动 URL/合法 cookie；可人工配置，不能仅凭端口免认证连接。 |
| Desktop 公共 RPC | Desktop 复用 Web Host，具备上述业务能力 | 随机 loopback 端口与认证由 Desktop carrier 管理；本次未找到面向第三方的自动发现/凭据交接机制。 |
| SDK/ACP stdio | 适合外部控制自己启动的 runtime | 会话所有权与恢复规则不同；不能据此宣称支持已运行的 GUI 会话。 |

前两条的依据分别是 [Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/README.md)、[Session Controller](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/README.md)；Desktop 与自动化边界见下文。

## 原生 Agent 契约

- `@deepseek-ai/dsh-agent` 的 package root 提供 runtime 类型；`Agent.id` 与 Session ID 为同一身份。`ctx.agents.get(id)` 只返回当前进程的 live Agent，`list()` 返回新的数组，`roots()` 限运行时根 Agent。不存在时为 `undefined`，不会因查询新建或恢复会话。[registry 实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/index.ts#L535)、[身份类型](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/types.ts#L11)
- `followup(UserMessage): void` 提交下一轮并唤醒；`steer(UserMessage): void` 在忙时进入下一个 step 边界、空闲时启动一轮；`inject()` 不唤醒。`whenIdle()` 表示整个 Agent 静止，不能证明某一条消息已得到对应回复。[精确运行时签名](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/runtime-types.ts#L169)
- `UserMessage` 需要稳定 `id`、`role`、`content`、`source`；不能照抄 README 的简化对象而遗漏身份。官方 `@deepseek-ai/dsh-llm` 导出的 `createUserMessage({ content, source })` 创建并冻结完整消息；`createMessage` 可见其随机身份生成逻辑。[消息构造](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/src/message.ts#L148)、[公开 export](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/src/index.ts#L48)
- `agent/created` 是串行且等待的初始化事件，监听器失败可使创建失败；不要在其中等待 `whenIdle()` 或自己的卸载。`agent/disposed` 在驱动静止、作用域注册撤销后发出；`agent/status` 提供 idle/running。桥只借用已有 Agent，不持有创建者的 `AgentHandle.dispose` 权限。[事件声明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/runtime-types.ts#L224)、[handle 所有权](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/index.ts#L138)
- 每次模型 shell 调用原生提供 `DSH_SESSION_ID`、`DSH_HOME`、`DSH_SHELL=1`，profile 启动时另有 `DSH_PROFILE/DSH_PROFILE_DIR`。桥无需伪造会话环境变量；这些身份仅在 Harness 管理的 shell 中成立。[Shell environment](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/shell/shell-env/README.md)

字段补充：Agent 本体没有 `name/title/cwd`。`agent.session.header.cwd` 是不可变的创建目录；只读当前目录使用 `ctx.workingDirectory.get(agent.session)`，无文件系统 I/O。`ctx.sessionTitle.get(agent.session)` 返回带 `title` 的 snapshot 对象并扫描历史；列表优先使用 `ctx.sessionProjections.stateOf(agent.session, 'title')`，其值是 `string|null|undefined`。能力未挂载时应保留未知，而不是把创建目录标成当前目录。[Session header](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/types.ts#L87)、[WorkingDirectory.get](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/working-directory/src/index.ts#L107)、[snapshot getter](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-title/src/index.ts#L358)、[title 状态类型](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-title/src/types.ts#L71)、[投影读取](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-projection/src/index.ts#L295)

## 外部 Web/Desktop RPC 的能力与限制

`SessionPromptRequest` 为 `{ requestId, sessionId, mode: 'queue' | 'steer', content, clientTimeZone? }`，回执仅 `{ accepted: true }`。原实现先解析/恢复目标，再检查已排队或持久化的 requestId，随后调用 Agent 的 `followup` 或 `steer`。[请求类型](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/types.ts#L316)、[投递实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/commands.ts#L308)

`session/list` 读取持久化概要，不激活冷会话；prompt 等操作可能恢复普通会话。列表含 `agentAvailable`，必须区分“历史记录存在”和“用户当前 live Agent 存在”。Remote 的业务 namespace 为 `session`；HTTP unary 使用 JSON envelope，路由为 `/api/<namespace>/<method>`，另有 `/api/remote.mux` 承载逻辑流。[控制器公开方法](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/session-controller/src/index.ts#L254)、[HTTP route 与 envelope](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/rpc-host.ts#L284)、[Gateway](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/api/gateway/README.md)

Web 启动链接的 `?token=` 只在入口交换 cookie；没有 Authorization-header token 通道。`/connect?token=...&interactions=none` 可交换独立 API Peer cookie，HTTP 与 WebSocket 均需该合法认证；Host/Origin 检查也独立生效。`none` 适合不替用户回答交互的外部客户端；API Peer 的生命周期与运行中 Host 关联，cookie 不是模型 API key。[认证文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/README.md#browser-authentication-and-request-trust)、[connect 交换源码](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/browser-auth.ts#L284)、[Peer 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/rpc-host.ts#L118)

Desktop 的 Host 明确以 `--host 127.0.0.1 --port 0` 启动，启动 URL 和 injections 经私有 Node IPC 交给 Electron。可以证明其底层业务 API 存在，不能推出第三方能发现或安全获得凭据；不应遍历进程或凭据文件取得 token。[Desktop Host 启动源码](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop-host/src/index.ts#L14)

没有找到 Web Remote 的独立稳定协议版本协商承诺；应将发布版本、所用 Agent/Remote 能力和测试结果分别记录。SDK 更明确声明没有版本协商、预发布阶段没有兼容承诺，不能用它的 `serverInfo.version` 判断 Web/插件兼容性。[SDK 限制](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/README.md#known-limitations-and-deferred-work)

## 官方插件安装和生命周期

**推荐安装入口**为 Web/Desktop 的 Plugins 页面，或 Harness 内 `plugin_manager` 的 `install_bundle`（target 为绝对工作区包目录）。安装会影响同一 profile 的所有会话并持久化；配置是否即时应用取决于 HMR，必须读取安装结果的 `application/warnings`，不能把保存依赖当作已经生效。[官方插件开发指引](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md)、[Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/plugin-manager/README.md)

Host-only bundle 可使用普通 ESM `index.js`、`exports['.']`、`dsh.bundle.patch` 指向 YAML；patch insert 独立 id/name。内置模块从 Harness 安装解析，无需复制一份 Agent runtime。发布物应包含 patch、运行文件、可辨识的中英文 metadata 和自有/获许可图标。[Host bundle 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md)

Desktop 还有官方离线管理路径：先运行一次初始化 profile，**完整退出**后使用 Desktop 自带的 `dsh plugin --profile desktop add <package>`，完成再重开。npm 安装的 `dsh` 拒绝管理该保留 profile，不能混用可执行环境；可通过自带的 `resources/runtime/cli/bin/dsh.cmd`（Windows）或 `dsh` 脚本调用，命令 PATH 注册本身不是必需条件。[Desktop bundled command runtime](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#bundled-command-runtime)、[CLI profile 边界](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/README.md)

插件导出 `inject = ['agents']` 和 `apply(ctx)` 即可等待原生 Agent 服务。经 `ctx` 注册的事件/工具随插件撤销；自行打开的 HTTP server、socket、登记租约等必须在 `ctx.effect()` 返回的 disposer 中关闭。启动时应订阅生命周期并补登记已有 live Agents；移除桥只撤销桥的资源，不调用 borrowed Agent 的销毁能力。这一桥生命周期建议依据官方作用域规则推导，尚未实测。[基础插件与 effect](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/develop/basic/index.md#automatic-cleanup)

DSH 安装/启动会检查 `engines.dsh`；声明该字段后以它为准，不再以 DSH peer ranges 作决定。预发布参与 range 匹配。建议首版限定 `0.2.1-rc.2`，CI 验证候选版后再扩大范围；拒绝旧版本加载与检测新版本坏在哪里是两个独立能力。不要用 `allow-version` 豁免掩盖未知兼容状态。[版本准入语义](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/README.md#profiles)

运行中版本可通过公开 `@deepseek-ai/dsh-app-boot` 的 `getDshRuntimeVersion(): string` 取得；它读取所在 app-boot manifest，并验证 semantic version，适配源码与打包运行时。桥无需硬编码声称自己的运行时版本，也无需在 Electron 私有目录中搜索文件。[公开 export](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/src/index.ts#L20)、[版本读取实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/app-boot/src/plugin-compatibility.ts#L34)

## SDK/ACP 为什么不能代替 attach

SDK `session/resume` 依赖原 store 并拒绝 occupied session；服务控制自己创建的 Agent，prompt 回执是 messageId，没有逐 prompt 的最终结果。[SDK server](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/server/README.md)

ACP 的官方定位是 automation-only，`session/resume` 针对 persisted inactive session；`session/load`、历史 replay 等不支持。即使 ACP v1 有标准协商，也不改变它对现有交互会话的所有权限制。[ACP contract](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md#protocol-contract)

## 进入实现前后的验证边界

建议实现：独立 Host bridge 包，仅调用已核实的 registry/message/lifecycle API；crosschat provider 只依赖桥自有、带版本号的本地契约。桥只暴露已有 live 根会话；缺失目标直接拒绝，不创建或恢复替代会话。自行控制的端口应绑定 loopback、持实例认证、限制请求大小和方法；无需取得模型凭据。上述为设计建议，不能当成已实现能力。

必须通过真实官方 runtime + 本地模型 stub 验证：原生 profile 安装和版本拒绝、已有 Agent 补登记/创建/销毁、精确 ID、空闲投递、忙时 queue/steer 边界、模型 shell 原生身份回信、Web/Desktop 可见记录、桥重载/禁用/卸载、应用退出无残留。纯 fake Agent 单元测试只能证明桥逻辑，不能证明官方 runtime 或 Desktop 已兼容。本次未执行这些检查，未安装任何待清理软件。
