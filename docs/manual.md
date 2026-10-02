# multichat 一期操作手册

> 面向操作者的实战手册：怎么装、怎么开、怎么看、出错怎么办。
> 参考资料型文档见 [README.md](../README.md)；设计决策见 `wayfinder/map.md`。

---

## 1. 心智模型（30 秒版）

multichat 是本机 agent 之间的**邮差**：无守护进程、无驻留服务，每次发送就是一条命令。

```
claude 会话 ⇄ multichat send ⇄ codex 线程
     ↑命名管道（Claude 自带）      ↑App Server daemon（Codex 自带）
```

- **Claude 侧**收消息 = 会话里出现一条"来自另一会话"的用户消息（需 `multichat claude` 启动开启接收）
- **Codex 侧**收消息 = 线程被投一个新 turn（headless 执行，不需要窗口）

## 2. 环境与一次性安装

| 依赖 | 要求 |
|---|---|
| Node | ≥ 22 |
| Claude Code | 已安装（npm 布局或 PATH 均可） |
| Codex CLI | 已安装；**app-server daemon 可用** |

```powershell
cd D:\workspace\CC\multichat
npm install && npm run build && npm link    # 装 multichat 到 PATH
multichat install-skills                    # 装协议教学到两侧 agent
```

**daemon 注意**：从**干净终端**启动（别在 Claude 会话内或带 `CLAUDE_CODE_*` 环境变量的终端里启动，否则其派生的所有 shell 身份污染，codex 回信会撞 `CALLER_IDENTITY_CONFLICT`）：

```powershell
codex app-server daemon start    # 一次性；status 里 codex 段 unavailable 时先查它
```

## 3. 每日标准流程（claude ↔ codex 协作）

**第 0 步 · 环境检查**（任意终端）：
```powershell
multichat status
# 期望：claude 段列出会话；codex 段列出线程（名字/目录/时间）
# codex 段 unavailable → daemon 没跑，见上节
```

**第 1 步 · 启动 claude 侧**（要用 `multichat claude`，不是裸 `claude`——接收许可靠它注入）：
```powershell
cd <工作目录>
multichat claude
```
题词只写**角色**，不用教协议（skill 已装）：
> 你是评审"mc-claude"。和 codex 侧的「<线程名>」协作：把任务发给它、验收它的回复，10 轮内完成并总结收尾。

**第 2 步 · 启动 codex 侧**：
```powershell
cd <同一工作目录>
codex            # 沙箱受限机器可加： -c 'windows.sandbox="unelevated"'
```
题词（同样只写角色）：
> 你是实现者。等待「mc-claude」的消息，收到后按要求干活并用信封里的回复命令回信，完成后停止。

**第 3 步 · 关掉 codex 窗口**（信箱语义：关窗 = 可投递；想围观就看 claude 窗口，两边消息都在那里直播）。

**第 4 步 · 对话进行中**：不需要人做任何事。claude 发任务 → codex headless 干活并回信 → 循环。偶尔想看 codex 细节：开窗 resume 那个线程看完即关（开着 = 新消息进不来，发着的那条会等你关）。

**第 5 步 · 收尾**：轮次接近题词预算时 agent 会按 skill 准则总结收尾；人随时可 Ctrl+C 强停。

## 4. 场景速查

| 场景 | 操作 |
|---|---|
| **人手动插话**（给任一 agent 发消息） | 任意终端：`multichat send --to <名字> --body "..."`（你的身份是 human，能发不能被回复） |
| **claude ↔ claude** | 双方都用 `multichat claude` 启动即可，其余同上 |
| **向开着的 codex 窗口投递** | 直接发：multichat 会**等待**（默认至多 120s），你关窗的瞬间自动送达；不关窗到点报 `CODEX_THREAD_LOCKED`（指引重发） |
| **看 codex 侧历史** | 开 codex 窗口 resume 该线程；看完关掉恢复收信 |
| **新开一个话题** | agent 用 `--to` 新发，不续旧会话引用 |
| **超长内容** | 写进文件、消息里只发路径（接收方按需读，也是省上下文的正道） |

## 5. 命令速查

```
multichat send --to <名字> --body "<正文>"        # 新消息（名字含空格要加引号）
multichat send --conversation <ref> --body "<正文>"  # 回复（ref 照抄收到的信封）
echo ... | multichat send --to <名字>             # 正文走 stdin
multichat status [--json]                         # 双侧在线总览（含目录/时间）
multichat install-skills [--dir <根>]             # 安装/更新 skill
multichat claude [任意 claude 参数...]             # 带接收许可启动 claude（参数透传）
```

发送输出：`delivered to <名字> (turn N)` + 下轮回复用的 reply-ref。

## 6. 投递语义矩阵（最终版）

| 接收方 | 窗口/状态 | 行为 |
|---|---|---|
| claude（`multichat claude` 启动） | 开着 | ✅ 秒达，会话内出现信封消息 |
| claude（裸 `claude` 启动） | 任何 | ❌ 无接收许可（重启换 `multichat claude`） |
| codex | 关窗 | ✅ 立即 headless 执行并回信 |
| codex | 开窗 | ⏳ multichat 等待，关窗瞬间送达；120s 超时报错 |
| codex | 忙（turn 进行中） | ⏳ 排队等空闲（同一等待机制） |

## 7. 错误码排障

**使用类**
| 码 | 处置 |
|---|---|
| `NAME_NOT_FOUND` | 错误信息里列出全部可用名；照抄（含空格加引号） |
| `NAME_COLLISION` | 两侧重名，用 `status --json` 看 id 精确指定 |
| `MESSAGE_TOO_LARGE`（>16KiB） | 内容写文件，消息只发路径 |
| `RATE_LIMITED`（30 条/60s/对端点） | 等一会儿或直接收尾；系统从不静默丢弃 |
| `TARGET_*` / `BODY_*` / `USAGE` | 参数用法错误，按提示改 |

**身份类**
| 码 | 处置 |
|---|---|
| `CALLER_IDENTITY_CONFLICT` | 环境双身份残留。临时：命令前缀 `env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID`；根治：干净终端重启 daemon |
| `CALLER_NOT_IN_CONVERSATION` | 你不是该对话参与者，不能借引用回复 |
| `CANNOT_REPLY_TO_HUMAN` | 对话由人发起，无处回信 |

**通道类**
| 码 | 处置 |
|---|---|
| `CODEX_PROXY_SPAWN_FAILED` | 看 stderr 摘录；通常是 daemon 未跑 → `codex app-server daemon start` |
| `CODEX_THREAD_LOCKED` | 等待超时：关闭对方 codex 窗口后重发，立即送达 |
| `CODEX_THREAD_BUSY_TIMEOUT` | 对方忙满 120s；稍后重发 |
| `CODEX_APPROVAL_REQUIRED` | codex 在等人工审批；**multichat 永不代答**，去窗口处理 |
| `CLAUDE_PIPE_*` / `CODEX_*UNCERTAIN` | 写入中途失败，状态不明——**不要盲目重发**（可能重复），先 `status` 确认对方是否已收到 |

## 8. 边界与限制

- 单条正文 ≤ 16KiB；每对端点 30 条/60s；开窗/忙等待上限默认 120s
- 信任边界 = 同一 Windows 用户（管道与注册表按用户隔离）
- 接收许可只授予 `multichat claude` 启动的会话（你手敲的 `claude` 不会突然能收消息）
- 长对话上下文：轮次计数显示在信封上（`turn="N"`）；接近预算让 agent 总结收尾；重活让它们互发文件路径而非贴全文

## 9. FAQ

**Q：为什么 codex 窗口开着收不到？** A：codex 单写者锁（上游设计），开着=线程被窗口独占。multichat 的处理是等你关窗再投（见矩阵）。二期研究 remote 形态 TUI 以取消此限制。

**Q：为什么必须要 `multichat claude`？** A：它注入 Claude 的跨会话接收许可（`crossSessionInbound:accept`），裸启动的会话收不到。

**Q：发消息的人可以是我吗？** A：可以（场景表第一条），身份是 human，能发不能被回复。

**Q：消息历史在哪看？** A：claude 侧=会话 transcript；codex 侧=开窗 resume 线程。

**Q：`codex queue` 不是能开窗收吗？** A：实测对本地 TUI 是黑洞（exit 0 但永不送达），已弃用（B7）。

## 10. 故障恢复

| 症状 | 恢复动作 |
|---|---|
| status 的 codex 段 unavailable | 干净终端 `codex app-server daemon start` |
| codex 回信撞身份冲突 | 同上（重启 daemon 即根治） |
| skill 被误删/过期 | `multichat install-skills`（幂等） |
| 升级 multichat 代码后 | `npm run build`（dist 更新；skill 有变再跑 install-skills） |
| 消息发出去对方没反应 | 先 `multichat status` 确认对方还在线；UNCERTAIN 类错误勿重发先核实 |
