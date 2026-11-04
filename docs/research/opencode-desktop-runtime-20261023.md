# OpenCode Desktop 运行时与 crosschat 复用边界

2026-10-23。只读研究，未安装或运行上游二进制，未修改产品代码。官方桌面 manifest 当前为 2.1.3，metadata.github.sha 为 `37d973754ba6cc31732f93421c0c18b675841573`；以下源码固定到该提交，不能拿 CLI v2.1.3 的 `bb25a2f...` 代替桌面发布源码。GUI 包版本、桌面源码 SHA、捆绑 CLI 版本和摘要应分别记录。[官方更新元数据](https://opencode.ai/update/api/latest/desktop/opencode)

本文保留通信、UI 和测试入口研究；安装器、注册项、缓存与卸载细节由另一位研究者独立保留在[安装与清理调查](opencode-desktop-installation-20261023.md)，两份记录互补。本文件当前不构成运行验收证据。

## 结论与可复用合同

默认本机 sidecar 可以复用已实现的 OpenCode Provider、公开服务发现、HTTP 会话与原生 shell 身份，无需套用 Codex 桌面 IPC。但发布桌面 UI 的收件、显示、回信、忙时行为和重连仍须单独验证；CLI PASS 不构成桌面 PASS。

官方第三方 client 提供只读 Service.discover()；桌面本身负责 Service.ensure()、runtime 版本选择及后台启动。crosschat 继续只连已有服务，不负责启动、替换或恢复宿主。[官方客户端](https://opencode.ai/v2/docs/build/client/)、[桌面后台](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/service/background-service.ts)

| 范围 | 可复用能力 | 桌面还须证明什么 |
| --- | --- | --- |
| 服务发现 | 默认 XDG state 下 opencode/service.json；注册 PID/version 与 /api/info 核对，Basic opencode:password。 | 注册对应当前桌面实际使用的服务，而非另起的 headless server。 |
| 会话投递 | session list/get、按完整 ID prompt；durable inbox 的 queue/steer 与唤醒。 | 消息出现在已经打开的桌面会话；回执、记录和可见 UI 属于同一 ID。 |
| 原生身份 | shell 每次覆盖 OPENCODE_SESSION_ID=context.sessionID；现有 Ref/origin 与回信可复用。 | 桌面会话实际执行 crosschat 回信，不手工伪造身份。 |
| 事件与重连 | 桌面使用公开客户端事件流，sidecar 可通过 reconnectService() 重新解析 endpoint。 | UI 显示更新；后台更替后 UI 与 crosschat 连接同一新 owner，不明写入不重发。 |

上表依据：[原生发现](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/client/src/service-probe.ts)、[原生 session](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/core/src/session/session.ts)、[shell 身份](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/core/src/tool/plugin/shell.ts)、[桌面客户端连接](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/app/src/runtime/server/client.tsx)、[sidecar 重连](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/renderer/startup/initialization.ts)。

初次连接以 bundled CLI version 约束 ensure；重连没有同样的精确版本参数，桌面可能替换不兼容后台。发布包把内置 CLI 暂存到 userData/cli/<version>-<arch>/。须分别记录后台 PID、实际 exe、版本、注册与更替前后归属。[连接策略](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/service/background-service.ts)、[CLI 暂存](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/service/desktop-cli.ts)

## Windows 隔离：TEST_ROOT 不够

OPENCODE_DESKTOP_TEST_ROOT 为发布包设置 GUI userData、sessionData 及 XDG data/config/cache/state；自动添加 remote-debugging-port 的代码只在非 packaged 分支执行。外部显式 Chromium 调试参数是否被正式发布包接受，仍要实际验证。[configure](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/configure.ts)

后续 DesktopInitialization 调 preferApplicationEnvironment；Windows 无 shellEnv，因此删除 XDG_STATE_HOME。早期 sidecarProbe 在 configure 后、其余主模块之前启动，可能读 TEST_ROOT/state；后期 ensure 则可能落回 homedir()/.local/state。早期探测成功时桌面会先收养该 endpoint，再异步 ensure。[环境处理](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/environment.ts)、[初始化顺序](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/desktop-initialization.ts)、[入口](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/index.ts)、[早期探测](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/service/sidecar-probe.ts)

工装应同时隔离 HOME/USERPROFILE、APPDATA/LOCALAPPDATA、TEMP/TMP、数据库、模型配置与 TEST_ROOT，并清除继承的真实模型凭据和其他 Agent 身份。可用 installation 研究的 profile/.local 布局，让初始 XDG_STATE_HOME 与删变量后的 home fallback 指向同一受控 state。启动前两种范围均须无旧注册，并验证 Electron app.getPath('home') 与 runtime homedir 均处于本次根。运行后再按真实注册核对 owner，不能靠显式 endpoint 掩盖自动发现接错实例。

OPENCODE_DESKTOP_SERVER_CHANNEL=local 才显式选 service-local.json。现适配器可显式指定 registrationFile，不应为此自动扫描所有 service 文件。

发布包 prepareDesktop 无条件设置 opencode:// 默认协议客户端；OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION=1 对 packaged 分支不起禁用作用。TEST_ROOT 不能隔离系统协议注册，启动/卸载仍需系统注册基线与最终恢复。[协议注册条件](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/environment.ts)

## 首启会自动创建 Documents 项目

新 profile、initialUrl='/'、home、无 tabs 且仅 builtin server 时，renderer 自动 shouldTrigger=true，调用 finishFirstLaunchOnboarding(true)，并非等待用户点击创建按钮。main 随即在 app.getPath('documents') 下建默认项目。单设 HOME/TEST_ROOT 不证明 Windows 已知 Documents 目录已被重定向。[首启 renderer](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/renderer/onboarding/index.tsx)、[首启 main](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/onboarding.ts)

安全的通信 fixture 可以在 spawn 前为本次 TEST_ROOT/desktop/opencode.settings 写合法 JSON：`{"firstLaunchOnboardingComplete":true}`。官方 initialize 读到该 boolean 会直接返回；这是受控原生配置种子，不修改发布包、不操作 Solid 内部状态。必须记录跳过首次 onboarding，不能宣称覆盖用户首次安装引导。[settings 文件](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/storage/store.ts)、[键名](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/storage/keys.ts)、[既有状态判定](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/storage/install-state.ts)

## 当前桌面会话与真实 UI 选择

桌面用 MemoryRouter；当前 route 为 /server/:serverKey/session/:id 等，不是 Electron 文档 URL 的 path。每 window 的最后路由另存 localStorage，仅读 location.href 不能证明当前会话。默认 server key 为 sidecar，route 的 server 段由 sessionHref 使用 base64Encode 编码。[MemoryRouter](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/renderer/window/router.tsx)、[路由存储](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/renderer/window/route-storage.ts)、[server key](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/app/src/runtime/server/registry.tsx)、[sessionHref](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/app/src/shell/routes/session.ts)

/api/session/active 仅描述运行 drain，不描述窗口当前选择。不要据此标 desktop owner。首批限定默认本机 sidecar；用户手工 HTTP server、WSL/SSH 扩展有不同 server key，不会自动因桌面 UI 打开就成为本机默认服务。

推荐的正式 UI 路径：可以在桌面实际 owner 的公开 API 预置唯一标题的 session，然后在真实 Home 列表按完整 ID 选中。Home 未选目录时通过 session.list 取全局会话；其原生行容器是 `[data-component="home-session-row-container"][data-session-id="<id>"]`，内部 `[data-component="home-session-row"]` 按钮点击会执行原生 addSessionTab/select 并打开对应工作区。这避免注入 Solid router，也避免纯 CDP 操作 OS 文件夹 chooser。[Home 列表与打开逻辑](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/app/src/home/sessions/controller.tsx)、[真实 DOM 行](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/app/src/home/sessions/view.tsx)

另一条 UI 路径是 data-action=home-add-project 打开工作区，但可能进入原生文件夹选择器；不要把它当成浏览器 DOM 弹窗。已读 lifecycle 只把 opencode:// 参数转交 renderer，不足以证明发布桌面提供 CLI --session 参数或任意会话 deep link。[项目入口](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/app/src/home/projects/view.tsx)、[deep-link 生命周期](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/index.ts)、[renderer deep-link](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/renderer/startup/deep-links.ts)

发布 UI 可在 root 先核实调试端口/进程归属后使用本仓库 test/helpers/opencode-desktop-cdp.mjs。helper 只做 JSON-RPC over WebSocket、按 ID 配对、受限等待、evaluate 与 PNG 截图；不读取或修改 Solid 内部对象。真实连接和端到端结果尚待 root 执行。UI route/存储仅作隔离验收辅助，不变成生产发现协议。

## 最小产品增量与验收矩阵

| 现状 | 建议增量 |
| --- | --- |
| TUI OpenCode 指引只说 CLI 原生窗口 | 实际发布桌面通过后使用 OpenCode 原生窗口/界面中性指引，不伪造 owner 标签。 |
| 未配置错误要求启动 OpenCode CLI | 使用 OpenCode 已有客户端/服务中性表述，避免桌面用户误另起 CLI。 |
| skill/README/使用说明仅声明 CLI | 单独记录桌面支持范围与使用方式；crosschat opencode 仍明确是 CLI 启动器。 |
| CLI 兼容 CI 只测 CLI/server | 复用脚本模型，但桌面 UI 独立留证，不能冒用 CLI PASS。 |

目前未发现必须新增桌面私有通信适配器、第二 Provider 或共享上下文系统。上述产品改动须在桌面实际验收后执行，本研究没有修改它们。

建议必验：

1. 正式桌面 UI 打开 session 后，crosschat 发现、按完整 ID 投递、可见 UI 和持久记录一致，无替代 headless 会话。
2. 空闲 queue/steer 均唤醒；忙时 queue 保持待处理边界，steer 在原生执行边界进入，结合 inbox/回合及 UI 核对。
3. 当前桌面原生 shell 实际执行 crosschat 回信，再由 Ref 返回原会话；同时检查真实身份及消息次数。
4. 分别重启窗口与实际后台，核对 owner 更替、同一 session、UI 恢复及新一轮送达；不明回执不自动重发。
5. 收口本次所有 GUI/runtime/tool/mock 进程、安装文件、协议、配置和下载，只保留源码与脱敏证据供用户重新安装。

本文件只说明源码可复用性、风险与验收设计，不声明桌面运行行为已经通过。
