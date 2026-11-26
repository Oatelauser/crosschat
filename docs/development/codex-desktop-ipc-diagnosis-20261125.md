# Codex Desktop 本机投递通道诊断

本文保留开发提交 `f52307d` 的原始调查与验收记录。其中端点类型、短柄格式和测试数量对应开发分支；1.13.2 的独立移植范围与验证见 [1.13.2 发布记录](release-1.13.2.md)。

2026-11-25 起，2026-11-26 更新。此次调查由用户授权，指定目标为本机 Codex Desktop 会话“多工具适配2”。用户要求通过 crosschat 的内部通信机制解决，拒绝 UI 自动化投递。

## 结论

本机 Codex Desktop `26.1120.5083.0` 没有提供当前 crosschat Codex Desktop Adapter 使用的 `\\.\pipe\codex-ipc`。解析安装包 JS 时未找到 Adapter 使用的 `thread-owner-discovery`、`thread-follower-start-turn`、`thread-follower-steer-turn` 或 `supportsUntrustedAppInput` 接口。这证明旧 Adapter 不适配该构建，不能据此断言 Desktop 没有其它内部通信能力。

调查期间 Desktop 更新为 `26.1120.6357.0`。新构建通过 app-tools 提供内部会话工具。恢复正式工具暴露后，新增的 crosschat 原生宿主入口已完成两个真实 Desktop 会话之间的双向发送；“多工具适配2”用自身真实身份回发的 crosschat 信封已直接进入当前“解决BUG”会话。默认 CLI 的旧 IPC 没有自动升级，新入口仅支持本机显式 steer；queue 和远端接入不在这次 live 验证范围。

公开的 `codex app-server` 命令可运行自建客户端协议服务；另起 CLI 服务不能当作现有 Desktop owner 后投递，否则会改变用户选择的目标端点。当前 Windows Desktop 实例使用父进程管理的 stdio；本次尚未找到其可供外部连接的原生控制端点。

## 新内部接口的实测与限制

- app-tools 使用 4 字节小端长度加 UTF-8 JSON 的 JSON-RPC 帧。`tools/list` 只读请求成功；`read_thread` 成功返回目标完整 ID `01a1a0d7-91a4-7aa0-8a2f-239e396edcb1`、标题“多工具适配2”、工作目录和 `notLoaded` 状态。该结果证明内部读取可用，不证明消息已发送。
- 当前协议的 `tools/call` 要求 `callerSource`。旧缓存 `codex-app-tools/0.1.3` 桥接没有传这个字段；当前随包版本 `26.1120.50957` 已传。旧缓存未列为已安装插件，因此不能认定它就是当前工具缺失的原因。
- 随包 `.mcp.json` 对 `send_message_to_thread` 配置 `approval_mode: "prompt"`。Desktop 启动参数已带该插件 MCP 的 `enabled=true` 覆盖；不能仅凭包内默认 `enabled:false` 判定功能被禁用。直接向管道写发送请求会绕过 MCP 执行层，未采用。
- 官方 CLI 手动注册 `openai-bundled` 返回保留市场错误；随包 CLI 直接安装 `codex-app-tools@openai-bundled` 返回找不到插件。这两次命令均失败，没有完成安装。内置插件应由 Desktop 自己的初始化流程处理，不能改名规避保留市场限制。
- 包内发送实现固定 send-now：忙时追加当前轮，空闲时启动一轮；成功只返回目标 `threadId`，没有 `turnId`。crosschat 不能伪造轮次 ID，也不能将此成功解释为目标已消费或回复。
- 新发送接口没有原子的 idle-only / expected-turn 参数，读到 idle 后再发送仍可能遇到目标变忙，因此不能据此宣称保留严格 queue 语义。用户明确指定联系目标的本次发送应使用 steer。
- 原有回执只确认用户消息记录；新原生投递可能使用 `codex_delegation` / toolOutput，需专门验证，不能放宽为任意工具输出包含正文就判定 confirmed。

## 官方插件缓存恢复

Desktop 日志 `C:\Users\yangsheng\AppData\Local\Codex\Logs\2026\11\26\codex-desktop-bff0b21a-478b-47b3-b358-9aff6cc3a02e-32416-t0-i1-012207-0.log` 记录 startup 和 focus 时反复出现 `plugin_marketplace_folder_write_failed`，阶段为 `copy_plugins`，错误为 `UNKNOWN: unknown error, copyfile .../.codex-plugin/plugin.json`。旧 runtime 的 codex-app-tools 仍为 0.1.3。

隔离复制复现：WindowsApps 源文件属性为 `Archive, Encrypted`，Node `copyFile` 失败；逐字节 read/write 成功且内容一致。包内已有 `copyDirectoryAllowDecryptedDestinationOnEncryptionFailure`，但只识别 `errno === 6000`，未覆盖此次 UNKNOWN。

本次仅将当前安装包 codex-app-tools 的 5 个原文件逐字节恢复到官方 runtime 插件目录，保留原 marketplace 清单和其它插件；逐文件 SHA-256 已核对。旧插件及过期 materialization key 移至备份，未编造新 key，未修改 MSIX 源或审批策略。备份和复制证据：`C:\Users\yangsheng\.codex\.tmp\bundled-marketplaces\crosschat-app-tools-repair-vR7W2P`。

随包 CLI 注册官方 runtime 市场成功。随后显式 plugin add 返回 `failed to back up plugin cache entry / os error 5`，不能记为安装成功；此后当前代理收到 35 个正式 `mcp__codex_app` 工具的动态更新，读取和发送实测成功。整包 materialize 的复制问题仍存在，不能据单个通信插件恢复宣称全部内置插件已修复。

## crosschat 接入与实际收发

- 新增 `src/codex/app-tools.ts`：完整本机分页、严格结果校验、发送前状态复核；由注入的正式宿主调用器执行工具。仅支持显式 Desktop steer；无旧 IPC/CLI 回退，无写入重试。
- 新增 `src/codex/app-tools-stdio.ts` 和 `integrations/codex-desktop-native/bridge.mjs`：单个关联请求、8 MiB 上限、超时/EOF/错误释放；桥输出工具请求，宿主通过正式 MCP 执行并回传原始结果。
- `src/integrations/codex-desktop-native.ts` 复用现有 sendMessage、信封、限流、短柄、通信对续话与日志；原生核验真实发送方后细化为 Desktop。受理结果允许没有 native turnId，不虚构轮次。使用说明见 [原生宿主接入](../../skills/crosschat/references/codex-desktop-native.md)。
- 第一条直接原生探针 `CC-NATIVE-20261126-01`：目标回复“已收到 CC-NATIVE-20261126-01。实际 CODEX_THREAD_ID：01a1a0d7-91a4-7aa0-8a2f-239e396edcb1。”
- 完整 crosschat 探针 `CC-CROSSCHAT-20261126-01`：桥依次请求发送方读取、完整 history、目标 fresh read、官方发送；返回 `delivered`、`steer`、`queued:false`、短柄 `cA010`，进程退出 0。目标轮次 `01a2159f-20cc-79f1-b72f-773f309567e4` 完成，回复“收到 CC-CROSSCHAT-20261126-01。能看到 cross-session-message 与 crosschat-reply-hint，标签以转义文本形式呈现。”
- 反向探针 `CC-ROUNDTRIP-20261126-02`：第二条 crosschat 消息受理、轮次 2。目标先通过官方读取独立核对“解决BUG”里的真实人类授权，再使用自己的原生宿主桥向当前会话发送。当前会话直接收到 `codex_delegation`，`source_thread_id` 为目标完整 ID，内容包含 `from-tool="codex-desktop"`、轮次 3、同一短柄 `cA010` 以及 `CC-REPLY-20261126-02`。这次回发是目标实际调用，未借用或伪造目标环境身份。
- 程序回执仍为 `unconfirmed`，没有把原生工具受理冒充 rollout 确认。目标回复和当前会话收到的反向信封是独立的实际消费证据。验证后没有继续发送纯确认消息。

## 复现与改动

- 全局安装的 crosschat `1.12.0` 对 `多工具适配2` 发送 steer 探针时，错误地返回 `CODEX_DESKTOP_OWNER_UNAVAILABLE`；消息在本机目标探测时即停止，没有发出。
- 根因是 Desktop IPC 连接层把 Windows named pipe 缺失（同步及异步 ENOENT/ECONNREFUSED）和成功连接后返回 `no-client-found` 都折成 `null`。
- 新增 `requireTransport` 诊断选项。Desktop 发现和显式选择 `codex-desktop` 的发送在管道缺失时返回 `CODEX_DESKTOP_UNAVAILABLE`；通道存在但目标没有 owner 仍保持 `CODEX_DESKTOP_OWNER_UNAVAILABLE`。未显式选端点的既有路径仍可按原规则回退 CLI；绑定后失败不回退。
- 以本仓库构建的 CLI 重跑目标发送：`CODEX_DESKTOP_UNAVAILABLE: The selected Codex Desktop discovery or IPC transport is unavailable; no other endpoint was selected.` 未向 Desktop 或 CLI 写入。

## 验证

- RED：`npm test -- --run test/desktop-ipc.test.ts` 首次增加的缺失通道断言失败（实际解析为 `null`）；目标诊断断言也先失败（被归为 `CODEX_TARGET_PROBE_FAILED`）。
- GREEN：定向运行 `test/desktop-ipc.test.ts`、`test/codex-target-diagnostics.test.ts`、`test/codex-aggregate-discovery.test.ts`、`test/codex-routing.test.ts`、`test/native-endpoint-types.test.ts`、`test/send-command.test.ts` 和 TUI 发送命令测试，共 137 项通过。
- `npm run check` 退出 0：ESLint、205 个模块/693 条运行时依赖边（无环/边界违规）、TypeScript build 均通过；全量 Vitest 为 2,816 通过、12 跳过，238 文件通过、4 跳过。
- 2026-11-26 修正异步连接失败 fixture：不发出 connect，覆盖 ENOENT/ECONNREFUSED 与 requireTransport 开启/默认配置，验证零写入、socket 销毁及监听释放；定向 `test/desktop-ipc.test.ts` 26 项通过。
- 原生接入新增三组隔离测试，共 91 项：Adapter 51、stdio 29、发送集成 11。未知 active flag 与缺少发送方类型均先 RED，再实现 GREEN；所有测试使用受控 MCP 响应和临时状态目录。
- 最终 `npm run check` 退出 0：lint/build 通过，208 模块/702 条依赖边无循环与越界；2,910 项通过、12 项既有跳过，241 文件通过、4 跳过。`git diff --check` 通过。

## 边界

本机原生宿主入口的实际 crosschat 双向发送已验证。代码在当前工作区构建，未发布 npm 包、未覆盖全局 crosschat 二进制。本机已安装技能增加了原生入口引用，旧技能有备份；原生使用说明指向 `D:/workspace/CC/multichat`。新入口依赖当前宿主实际暴露的官方工具；不替代旧 CLI 的通道，不声称支持 queue、`--conversation` 或远端投递。打包 dry-run 已确认新桥、编译模块和技能说明均包含在包中。

用户拒绝 UI 自动化前曾在目标编辑框放入一条未发送的 UIA 测试草稿；没有执行发送。停止 UI 路径时未能确认清除该草稿，不能报告已清理，也不能将其当成通信成功证据。
