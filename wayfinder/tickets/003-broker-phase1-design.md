# 一期 broker 架构设计

label: wayfinder:grilling
status: closed
blocked-by: 001, 002
claimed-by: 主会话（2026-10-01，用户令开票；grilling/domain-modeling 技能本会话已加载）

## Question

一期 broker 的设计决策集（grilling + domain-modeling）：

- 进程模型：前台 `serve` / 按需拉起 / 常驻（一期不做 launchd 等价服务安装）
- 控制通道：named pipe（CLI ↔ broker 协议最小子集）
- 状态：纯内存 + 崩溃可接受？还是最小存档（会话引用表）
- 命令面：send / status / wait-delivery / register 的最小集
- 投递失败语义一期简化到什么程度（embassy 的 no-replay/ambiguous 纪律哪些必须保留、哪些可推迟）
- 溯源信封与回复提示：直接抄 embassy 的 `provenance-envelope` 格式？
- 从 embassy 逐模块借鉴清单（对应 `docs/embassy-main/src/gateway/` 的文件映射）
- Codex 侧若需降级轮询：收件箱文件格式与检查频率（依赖 001 的结论）
- 平台抽象接缝清单（为 Q7b 三平台预留的接口面）
- agent 侧使用形式（用户已给出硬约束，2026-10-01）：**低入侵**——不得依赖题词逐字执行协议；教学/收发尽量内建。候选决策点：教会方式（纯题词 / skill / 信封自带教学）、别名配对方式、broker 启动方式、对话终止归属（协议层 or 题词层）。注意 Claude 接收方需 `crossSessionInbound:"accept"` 是上游硬约束（002 实测），设计应设法把启动摩擦包掉（如包装命令），而不是写进题词让用户/agent 记忆。

## Resolution

**核心结论：一期不需要 broker 守护进程——无状态 CLI。** 全局俯瞰复核后推翻了制图期"保留 broker 形状"的初始判断：真正要保的接缝是模块边界与命令面，不是进程拓扑。

### 命令面（4 条）

| 命令 | 职责 |
|---|---|
| `multichat send --to <name> \| --conversation <ref>` | 发消息（body 参数或 stdin）；同步阻塞返回 delivered/failed；失败绝不自动重试，报错原文交发送方 |
| `multichat status` | 实时查两侧：读 `~/.claude/sessions` 注册表 + codex `thread/list` |
| `multichat install-skills` | 装 skill 到 `~/.claude/skills` 与 `~/.codex/skills`（不存在则建） |
| `multichat claude` | 包装命令：注入 `crossSessionInbound:"accept"` 启动真 claude，其余参数透传 |

（制图期讨论过的 `up`/`down` 随 broker 一起消失。）

### 决策记录

1. **教学**：skill 常驻（一次性 install）+ 信封 reply-hint 兜底，双保险；题词只写角色——满足低入侵约束
2. **发现**：双侧自动发现（claude sessions 注册表 / codex `thread/list`），别名 = 原生会话名，重名报错并列出候选；无 register 命令
3. **无状态化的支撑机制**：发送方身份从环境变量反查（`CLAUDE_CODE_MESSAGING_SOCKET`/`_TOKEN`；`CODEX_THREAD_ID` + `CODEX_SESSION_ID` 双读）；会话引用**自包含**（两端 native UUID + nonce，base64 编码，回复时 CLI 比对身份路由另一端）；codex 忙时 CLI 阻塞至空闲或超时
4. **失败语义**：同步返回；不自动重试（保留 embassy 唯一纪律）
5. **信封**：照抄 embassy `provenance-envelope` 格式 + 一行新话题发送示例
6. **终止**：协议层不管；skill 行为准则含"目标达成→发总结→停止"；轮数预算归 004/题词
7. **防乒乓限流**：文件级（每对端点 30 条/60s，常量借 embassy `ledger.ts:40-41`）
8. **运行时**：Node 22 + TypeScript（逐模块借鉴的前提）
9. **考虑并否决**：Claude 原生 `ListAgents`/`SendMessage` 伪 peer 广告（embassy v1.0.0 实现过、v4.0.0 主动移除——helper 进程、注册表残留、配对簿记；见 `docs/embassy-main/.github/release-notes/v4.0.0.md` "Gone" 一节）
10. **broker 回归条件**（记入雾区）：忙时持久队列 / 异步回执 / 跨机投递不占线——任一到来时常驻 broker 成为必要；联邦 v1 可先 `ssh <对端> multichat send …`（无 broker、同步语义）

### 借鉴清单（docs/embassy-main/src/gateway/ → 一期模块）

| embassy 源 | 一期去向 |
|---|---|
| `claude-peer.ts`（帧编码 `encodeClaudePeerUserFrame`、注册表解析） | `adapters/claude-pipe.ts` + Windows 适配（named pipe、`<pid>.<sha256>.key` 的 peerToken auth 行——embassy 没有的新增） |
| `codex-stateless-transport.ts` + `codex-app-server.ts` + `codex-local-transport.ts`（spawn proxy、ws-over-stdio、JSON-RPC 白名单） | `adapters/codex-appserver.ts`（三元组/路径换 Windows） |
| `provenance-envelope.ts` | `envelope.ts`（照抄 + 新话题示例） |
| `ledger.ts` | 不抄（一期无账本）；限流常量参考 |
| `local-control.ts` / `coordinator.ts` / `runtime.ts` / `service-agent.ts` | 不抄（无 broker） |
| `mutex.ts` 思路 | `rate-limit.ts`（文件级） |

### 平台接缝清单（Q7b，二期 mac/linux 的适配面）

- `PipeTransport`：win = named pipe + auth 行；posix = UDS（embacy 原路径）
- `ProcessInspector`：win = CIM/`Get-CimInstance`；posix = `ps`
- `PathLayout`：注册表/技能/状态目录的平台布局
- 命令面稳定承诺：`send`/`status` 对外形状不随内部架构（无状态→broker）变化

### 首日验证清单（实施第一天补验，研究只读边界未覆盖）

1. 用户 `codex` TUI 会话是否出现在 daemon `thread/list` 且可 `thread/resume`
2. `turn/start` 对真实 TUI 线程的活体投递
3. `~/.codex/skills` 目录创建后 codex 能发现 skill
4. 管道注入对用户真实交互会话生效（002 用的是自建会话）
