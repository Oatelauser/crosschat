# Claude Code 兼容 CI：正式工具与脚本模型合同

核查日期：2026-10-23。范围：C01 Claude Code CLI；不扩展三平台矩阵，也不把此报告当作真实工具已通过的证明。本次仅访问官方公开文档、官方 npm 元数据和仓库既有实现，没有安装、启动或读取用户的 Claude 配置、凭据、历史。

## 结论与实施边界

可用真实 Claude Code CLI，令模型端只连接 CI 内部的 loopback HTTP 脚本服务；模型密钥使用固定假值。crosschat 的会话发现、原生 inbox 投递、真实 Bash 调用身份及回信继续运行真实实现。mock 只取代模型推理，不能取代 Claude 的注册表、管道、认证或 shell。

**不能使用 `--bare` 或 `CLAUDE_CODE_SIMPLE=1` 验证现有收件能力。** 官方明确说明：普通 `-p` 会话会建立 inbox，bare 会话不建立 inbox，也不出现在会话列表。普通非交互会话应显式传入 `--settings '{"crossSessionInbound":"accept"}'`，不修改用户全局设置。关闭 feature-flag fetching 后，本机消息在 v2.1.248 及以后仍可用。[官方同机会话消息文档](https://code.claude.com/docs/en/cross-session-messaging#non-interactive-sessions)、[可用范围](https://code.claude.com/docs/en/cross-session-messaging#availability)

## 版本与正式发行

2026-10-23 通过官方 npm registry 实时读取，而非搜索缓存：

| 项目 | 核查值 |
| --- | --- |
| `@anthropic-ai/claude-code` latest / next | `2.1.309` |
| stable | `2.1.308` |
| Node engines | `>=22.0.0` |
| bin | `claude` → `bin/claude.exe` |
| postinstall | `node install.cjs` |
| optionalDependencies | 同版本 Linux x64/arm64、musl x64/arm64、Windows x64/arm64、macOS x64/arm64 原生包 |
| wrapper tarball | `https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-2.1.309.tgz` |
| wrapper integrity | `sha512-+lBYZRuXOJpiKJcRv/CK7gF+5UFNWyJE7hSxkgGUKDZOWgANl9MAabfTkrJk183Tp3B0Nv4xF/DU1t0BaKXOPw==` |

这是 wrapper 的 integrity，**不是 Windows 原生可执行文件或对应原生 tarball 的校验值**。执行者必须另取当前平台正式原生包的元数据、核对下载内容，再使用绝对路径启动，不能落到用户 PATH 的 `claude`。[官方 registry latest](https://registry.npmjs.org/@anthropic-ai%2Fclaude-code/latest)、[官方 dist-tags](https://registry.npmjs.org/-/package/@anthropic-ai%2Fclaude-code/dist-tags)

官方安装文档仍提供 npm 安装，同时推荐原生安装；本项目 CI 可选择正式 npm 原生包，在隔离目录使用，避免全局安装、自更新、PATH 和用户 native install 的修改。官方 changelog 当前也含 2.1.309 条目。已有仓库 Windows 实测基线是 2.1.286，不能把它当成本轮 mock 已通过基线。[官方安装与版本管理](https://code.claude.com/docs/en/setup#install-with-npm)、[官方 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)、[既有实测](claude-windows-pipe.md)

## 最小启动形态

下列为实现建议，参数组合仍须真实执行确认；不是本次已运行的命令：

```text
<owned absolute claude binary>
  -p
  --input-format stream-json
  --output-format stream-json
  --verbose
  --replay-user-messages
  --session-id <fresh UUID>
  --setting-sources ""
  --settings <owned fixture settings JSON file>
  --strict-mcp-config
  --mcp-config <owned empty mcpServers JSON file>
  --model <explicit fixture model>
  --tools Bash
  --allowedTools Bash
```

`--setting-sources` 只控制 user/project/local 设置来源，不是关闭一切自动发现的总开关；managed policy 仍可能适用。本地存在有效组织策略时，应报告环境约束，不修改或绕过策略。`--safe-mode` 可以跳过自定义内容且保留认证，但它与 inbox 的组合还需实际证明，不能直接替换 bare 并宣称已安全隔离。[CLI 参数参考](https://code.claude.com/docs/en/cli-reference)、[设置优先级](https://code.claude.com/docs/en/settings#settings-precedence)

stdin 使用 UTF-8 JSON Lines，首条建议提供 `uuid`、固定 session ID、`parent_tool_use_id: null` 和普通 `message`：

```json
{"type":"user","uuid":"<fresh UUID>","session_id":"<fixture session UUID>","parent_tool_use_id":null,"message":{"role":"user","content":"CC_CI_START_<nonce>"}}
```

维持 stdin 打开使普通 `-p` 会话在完成第一轮后继续收件；按 `system/init`、`assistant`、`user`、`result` 类型解析 stdout，不以某一行文本或日志字符串替代结果。`--replay-user-messages` 可确认 stdin 被接收，但不能证明 peer 管道消息进入模型。[程序化运行](https://code.claude.com/docs/en/headless#stream-responses)、[官方 SDKUserMessage 类型](https://code.claude.com/docs/en/agent-sdk/typescript#sdkusermessage)

## 环境、凭据与项目隔离

建议子进程使用明确允许的环境白名单，再加入以下测试值：

| 配置 | 用途 |
| --- | --- |
| `ANTHROPIC_BASE_URL=http://127.0.0.1:<ephemeral-port>` | 不加 `/v1`；SDK 会拼接完整 endpoint。服务器仅 bind loopback |
| `ANTHROPIC_API_KEY=mock-key` | 非交互模式显式使用假 key；服务端只接受此固定测试值 |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | 关闭自更新、遥测、错误上报、部分可用性检查和 feature-flag fetching |
| `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1` | 单独关闭官方 marketplace 首次自动注册；上一变量不涵盖它 |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | 不创建或加载 auto memory |
| `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false` | 避免提示建议分支影响脚本确定性 |
| `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`XDG_CONFIG_HOME`、`XDG_CACHE_HOME` | 分别指向本次拥有的隔离子目录；保留必要 OS 系统环境和 shell 可执行路径 |
| `CLAUDE_CONFIG_DIR=<owned home>/.claude` | 与 crosschat 默认 `homedir()/.claude/sessions` 发现目录对齐，避免只改变 CLI 一方 |
| `TEMP`、`TMP`、`TMPDIR`、`CLAUDE_CODE_TMPDIR` | 测试独占目录；Unix socket 路径有长度限制，后续跨平台时单独处理 |

这些变量的作用来自[官方环境变量参考](https://code.claude.com/docs/en/env-vars)；网关 URL 与假 key 方案利用受支持的自定义 endpoint 配置。[连接网关](https://code.claude.com/docs/en/llm-gateway-connect#set-the-base-url-and-credential)

不要把当前 `process.env` 整体复制给被测进程。排除真实 `ANTHROPIC_*`、OAuth、AWS/Azure/GCP provider、代理、OTel 以及继承的会话 socket/token/ID，防止串会话、读个人账户或将请求引向外部。不要从用户设置提取 apiKeyHelper。另排除 `NODE_OPTIONS`、`NODE_PATH`、`BASH_ENV`、shell profile 注入等影响子进程的环境配置；只保留本次明确需要的 shell、Node、Git 路径。这是测试工装设计，不宣称这些均由 Claude 自动清理。

使用独占空白项目与合成 `.claude` 设置，不在真实项目目录运行工具，不复制真实 `.env`、`.mcp.json`、CLAUDE.md、skills 或 credentials。若测试 cwd 位于当前仓库的子目录，必须考虑祖先目录的自动发现；`--setting-sources ""` 不能证明 CLAUDE.md 等内容未加载。本次未找到官方承诺的通用“忽略全部 `.env`”开关，故应以环境白名单、空白 fixture、禁止读取真实文件及真实启动验证落实隔离，不能虚构 `SKIP_DOTENV` 配置。[普通 `-p` 的自动发现行为](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode)

## 模型 HTTP 与 SSE 合同

官方网关合同：Anthropic Messages 格式由 `ANTHROPIC_BASE_URL` 选择；核心推理请求路径为 `/v1/messages`，真实 URL 可含 `?beta=true`。按 `new URL(request.url, base).pathname` 匹配，不拿完整 URL 做等值判断。`/v1/messages/count_tokens` 为可选，缺失时退回字符估算；`HEAD /api/hello` 是可拒绝的连接预热探测。mock 可以实现 count_tokens 的 `{"input_tokens": N}` 和 hello 的空响应以减少噪音。额外未知路径应记录类别并明确响应，不无条件全部成功。[官方网关协议：endpoint](https://code.claude.com/docs/en/llm-gateway-protocol#api-formats)、[辅助请求](https://code.claude.com/docs/en/llm-gateway-protocol#optional-endpoints-and-startup-traffic)

请求 body 至少识别 `model`、`messages`、`tools`、`stream`；允许新增字段和 beta 头，不把完整 tools schema、model alias 或 beta 列表做死板快照。以合成 nonce、实际发来的工具 schema 和 tool_result 驱动状态机。不要只按 HTTP 请求次数返回下一步：启动分支、重试或后台小模型调用可能使次数变化。保存脱敏事件摘要与关联 ID，不存 auth 头或 raw secrets。[官方开放字段原则](https://code.claude.com/docs/en/llm-gateway-protocol#forward-as-open-lists)

`stream:false` 返回普通 Message JSON：`id`、`type:"message"`、`role:"assistant"`、与请求一致的 `model`、`content`、`stop_reason`、`stop_sequence:null`、`usage`。纯文本使用 text block 与 `end_turn`。工具调用使用 `tool_use` block（唯一 `id`、实际 Bash 工具名称、符合本次 schema 的 `input`）与 `stop_reason:"tool_use"`；工具结果应由真实 CLI 在后续请求中携带 `tool_result`，mock 检查对应 tool_use_id 和实际命令输出。[Messages API](https://platform.claude.com/docs/en/api/messages/create)、[官方工具回合](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)

`stream:true` 返回 `Content-Type: text/event-stream`，每个 `event:` 与 `data.type` 对应：`message_start`（空 content 的 Message）→ 每个块的 `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta`（含 stop_reason、累计 usage）→ `message_stop`。文本 delta 类型为 `text_delta`；工具输入为 `input_json_delta.partial_json`，块开始时工具 input 使用空对象。SSE 每帧用空行结束，包含最终 delta 与 stop；普通 JSON/只发 text delta 不足以模拟真实工具调用。长时间 barrier 可发送 ping 防止 idle timeout。[官方 SSE 序列](https://platform.claude.com/docs/en/build-with-claude/streaming)

脚本模型用于合同测试，不验证模型推理质量、真实 Anthropic 服务可用性或价格。其 HTTP 故障属于模型替身工装/协议问题，不能直接当作 crosschat 原生消息协议损坏。

## 原生身份、管道认证与忙时语义

官方现已公开 `CLAUDE_CODE_MESSAGING_SOCKET`、`CLAUDE_CODE_MESSAGING_TOKEN`：宿主在 inbox bind 后注入 Bash/Hook，不能通过 settings.env 设置。Windows 必须先认证；Unix auth 可选且以 OS 用户边界约束。CI 应只读取本次新建会话在隔离目录的 registry/key；不得从用户现有会话获取 token。crosschat 实际发送方识别以原生 socket 与注册条目反查为准，不把一个手动设置的 session ID 当作证明。[官方 inbox 与认证](https://code.claude.com/docs/en/cross-session-messaging#the-sessions-inbox-socket)

官方 `CLAUDE_CODE_SESSION_ID` 会注入普通 Bash、PowerShell、Hook 和 stdio MCP；某些 MCP 启动/无显式 ID 的恢复场景可能保留初始 ID。因此真正端到端测试必须由 mock 下发真实 Bash tool_use，让 Bash 自己调用 crosschat 回信，核对返回的完整 session ref 与 socket 归属，不能由外部测试进程伪造发送方环境。[官方身份变量说明](https://code.claude.com/docs/en/env-vars#variables)

官方 SDK 输入优先级：`next` 或省略表示当前工具完成后尽早在同一 turn 读取；`later` 保留到 turn 结束后作为新 turn；`now` 还涉及中断或后台移交。对应仓库现有 `steer → next`、`queue → later` 应以真实 busy barrier 验证。官方 SDK 文档并未为任意第三方 peer frame 的每个内部字段提供稳定性承诺；已有 peerProtocol=1、msgV/msg_id、Windows peerToken key 命名规则仍需实测保守维护，不能仅凭 SDK priority 文档判定 peer 路径通过。[SDKUserMessage 优先级](https://code.claude.com/docs/en/agent-sdk/typescript#sdkusermessage)、[仓库 frame 实现](../../src/claude/frame.ts)、[既有 Windows 实测](claude-windows-pipe.md)

用真实 Bash 工具执行测试工装的可控等待命令，收到 ready 事件后再投递。`queue` 应在当前 turn 的确定结束证据之后才进入下一 turn；`steer` 应在 barrier 释放、工具结果已返回后进入当前 turn 的下一次模型请求，不能等到 turn 结束。不能仅以两次请求数量判断 turn 边界，需关联 result/user/assistant、nonce、tool_use_id 与 mock 收到的内容。只保持模型 SSE 未结束不等于“工具执行中”，不要用它冒充真实 busy shell 场景。

原生管道当前成功写入仅证明字节写出，不是模型已消费。拒绝、hold、坏 token 可静默丢弃，应以实际消费/拒绝事件或超时分类验证，保留当前产品回执含义，不在 CI 中把底层未承诺的 ACK 发明出来。

## 本轮最小端到端验收

以下为研究阶段建议的检查清单；最终实际执行范围与未覆盖项见[本地验收记录](../development/claude-code-compat-validation-20261023.md)。其中第7项的原生 refuse / 无或错误 peerToken 负向场景尚未实跑，不记为通过。

1. 指定版本正式包：记录 npm version、平台包 URL/integrity、本次可执行路径与 `--version`；启动前后核对不触及用户已有程序与配置。
2. 隔离启动：两个真实 CLI 共用本次隔离 home，不用 bare；stdin 保活。由原生注册条目确认 PID、native session ID、cwd、kind、socket，且没有混入用户会话。
3. 空闲接收：从 crosschat 生产投递路径发送带 nonce 的消息；mock 实际收到该文本，真实 CLI 完成对应轮次。
4. 双向回信与身份：mock 返回真正的 Bash tool_use；Bash 内调用 crosschat 回复第二个真实会话；核对真实 socket 解析得到的发送方 ref、目标 ref、文字原样与工具成功结果。覆盖中文、换行、引号。
5. queue：可控真实 Bash barrier 期间投递，释放后确认原 turn 先结束，消息作为后续 turn 消费且仅一次。
6. steer：真实工具 barrier 期间投递，释放后确认消息在原 turn 的续请求内消费，当前任务没有被错误取消；不能用 stdin priority 测试代替生产 peer frame。
7. 原生边界：本次 Windows 的无/坏 peerToken 不消费消息；显式 `crossSessionInbound:"refuse"` 不消费；目标进程退出后不再可路由。不要求底层静默拒绝时 crosschat 神奇返回确定“拒绝”。
8. 生命周期：测试停止、超时、中途异常都退出本次 PID 树、关闭 mock/barrier、卸载本次独立安装（若有），保留用户指定 D 盘证据目录；只处理已记录 ownership 的资源。

基线与候选必须按相同验收串行执行；先让固定 2.1.309 首轮通过，再把它记为新的 good baseline。候选安装失败、mock合同变化、CLI无法启动、原生发现/投递变化分开归类；不得重试不确定投递，也不自动改动现有产品行为。本轮 Windows 通过不代表 Linux/macOS 已验证，C00 后续再讨论矩阵。

## 尚需实际运行确认

- `--safe-mode` 是否保留所需原生 inbox，且是否完整满足本轮 shell/插件隔离目标；若未知，不能把它写成已验证路径。
- 本次正式版本实际请求的 Bash schema、辅助调用与 feature/capability 集合；报告按公开合同给出最小形状，需以真实工具捕获的合成请求确认。
- Windows 原生进程对 HOME/USERPROFILE/CLAUDE_CONFIG_DIR 组合的实际落盘与 crosschat `homedir()` 是否一致。
- 2.1.309 的 peerProtocol 注册字段、key/auth 名称与 next/later 语义是否仍与既有 2.1.286 证据一致。
- mock 的非流式与流式分支都应正确，但真实 CLI 本轮究竟使用哪种，只能由运行证据陈述。
- 官方没有承诺 crosschat 所依赖的全部 peer 内部字段永久稳定；CI的价值正是探测这些差异，而非证明“永远不变”。
