# multichat

> Windows 一期：Claude Code ↔ Codex CLI 跨会话消息。无守护进程，原生投递，四个方向双向实测。
> 设计决策见 `docs/wayfinder/map.md`；联调实证见 `docs/drill-reports/`。

## 1. 心智模型（30 秒）

multichat 是本机 agent 之间的**邮差**：无守护进程、无驻留服务，每次发送就是一条命令。

- **Claude 侧**收消息 = 会话里出现一条"来自另一会话"的用户消息（需 `multichat claude` 启动开启接收许可）
- **Codex 侧**收消息 = 线程被投一个新 turn，由 app-server daemon **headless 执行**（不需要窗口在场）
- 教学内建：agent 侧装有 skill（`install-skills`），且每条消息信封自带回复命令——**题词只写角色，不写协议**

## 2. 环境与一次性安装

| 依赖 | 要求 |
|---|---|
| Node | ≥ 22 |
| Claude Code | 已安装 |
| Codex CLI | 已安装，app-server daemon 可用 |

```powershell
cd D:\workspace\CC\multichat
npm install && npm run build && npm link    # multichat 上 PATH
multichat install-skills                    # 协议教学装到两侧 agent
```

**daemon 必须从干净终端启动**（别在 Claude 会话内启动，否则派生 shell 身份污染，codex 回信撞 `CALLER_IDENTITY_CONFLICT`）：

```powershell
codex app-server daemon start
```

## 3. 对话生命周期（规则总纲）⭐

### 3.1 三种发起方式

| 发起者 | 怎么发 | 特性 |
|---|---|---|
| **claude** | 会话内 agent 跑 `multichat send --to <codex 线程名> --body "…"` | 最顺，推荐默认 |
| **codex** | 会话内 agent 跑 `multichat send --to <claude 会话名> --body "…"` | 发送随意；但**发出后要关掉 codex 窗口**（见 3.5） |
| **人** | 任意终端直接跑 `multichat send --to <名字> --body "…"` | 身份是 human：**能发、不能被回复**（单向指令/通知） |

第一条消息永远用 `--to`（此刻生成对话引用 reply-ref）；对方名字用 `multichat status` 查（名字含空格加引号）。

### 3.2 往复规则（谁说话、怎么接）

1. 收到方看到一条**信封消息**：`<cross-session-message from-name="发送方" turn="N">` + 正文 + **回复提示**（一条完整命令）
2. 回复 = **逐字照抄回复提示里的命令**，把 `<你的回复>` 换成正文：`multichat send --conversation mc1_… --body "…"`
3. 引用随每轮自动轮转，`turn` 递增——**无需记住任何历史**，每条消息自带下一步
4. 防失控：每对端点 30 条/60 秒限流（`RATE_LIMITED` → 等待或收尾）

### 3.3 轮次与终止

- 信封显示 `turn="N"`；题词里给预算（如"10 轮内完成"）；接近预算时 agent 按 skill 准则**总结收尾**
- 协议层不强制终止；人随时可停（会话里直接说、或 Ctrl+C）

### 3.4 流程 A：claude 发起（推荐）

```
步骤   动作主体   发生什么                                  窗口状态
1      你        终端 A：multichat claude + 角色题词         A 开
2      你        确认 codex 信箱线程已存在 → 关掉它的窗口     codex 关
3      claude    send --to <线程名> "任务…" → delivered(1)    —
4      codex     headless 收 turn、干活、照提示回信           codex 关
5      claude    收到信封（你在终端 A 当场看到）→ 验收/追问    —
6      ——        循环 4-5，直到预算 → 总结收尾                —
```

你的全程动作：步骤 1、2，然后在**终端 A 直播围观**（双方消息都出现在 claude 会话里）。

### 3.5 流程 B：codex 发起

```
步骤   动作主体   发生什么                                  窗口状态
1      你        终端 B：codex + 角色题词（教它主动联系）      B 开
2      codex     send --to mc-claude "…" → delivered(1)      B 开（发送不受窗口影响）
3      你        ★ 关掉 codex 窗口                           B 关
4      claude    收到信封（终端 A 看到）→ 照提示回复           —
5      codex     回信 headless 落进线程、处理、再回            B 关
6      ——        循环 4-5；想看 codex 侧就开窗 resume，看完关  —
```

★ 是关键步：claude 的回信要进 codex 的线程，而**线程被开着的窗口独占**（codex 单写者锁，上游设计）。忘了关也不会丢——multichat 会等待（默认 120s），你关窗瞬间送达；超时报 `CODEX_THREAD_LOCKED` 指引重发。

**不对称速记**：claude 收发都随意；codex 发随意、收需要线程空闲（窗口关）。

### 3.6 完整示例：codex 当领导派活给 claude（剧本式，照抄可跑）

> **先启动 ≠ 先说话**：claude 是被叫方，电话得先开机；但任务由 codex 发起。
> 多任务循环 = 把示例里的单个任务换成一串任务清单，领导验收通过 N 后自动下发 N+1。

**任务目标**：codex（领导）命令 claude（工人）在 `D:\workspace\CC\demo` 创建 `notes.txt` 写三行待办，并验收。

**第 1 步 · 左窗启动 claude（接收方先开机）**
```
D:\workspace\CC\demo> multichat claude
```
进入后输入 `/rename worker`（给领导一个明确的名字），然后什么都不贴，待命。

**第 2 步 · 右窗启动 codex（领导）并贴题词**
```
D:\workspace\CC\demo> codex
```
```
你是领导。用 multichat（先 status 确认名字）给 claude 会话「worker」下发任务：
在当前目录创建 notes.txt，内容三行：买牛奶、交电费、给妈妈打电话。
收到完成报告后，亲自打开文件验证内容；通过则回复"验收通过，任务结束"并停止；
不通过则下发返工任务。
```

**第 3 步 · 右窗屏幕——任务由 codex 发出**
```
● exec: multichat status
● exec: multichat send --to worker --body "任务1：在当前目录创建 notes.txt…"
● delivered to worker (turn 1)          ← 任务飞进左窗，发起方是 codex
```

**第 4 步 · 关掉右窗**（领导要在线程里收报告了；收报告需要它的窗口关着）

**第 5 步 · 左窗屏幕——claude 收令干活**
```
📨 来自另一会话的消息:
<cross-session-message from-name="codex/01a0f…" turn="1">
任务1：在当前目录创建 notes.txt，内容三行…
回复请运行: multichat send --conversation mc1_xxx --body "<你的回复>"
</cross-session-message>

⏺ Write: notes.txt（三行待办）
⏺ Bash: multichat send --conversation mc1_xxx --body "已完成：notes.txt 已创建，内容为要求的三行。"
⏺ delivered (turn 2)                     ← 报告发回给 codex
```

**第 6 步 · 自动发生（无任何窗口，看不见但它在跑）**
报告落进 codex 线程 → codex 被唤醒 → 亲自打开 notes.txt 核对三行 → 通过 → 它跑 `send --conversation mc1_yyy --body "验收通过，任务结束"`。

**第 7 步 · 左窗几秒后——收工**
```
📨 <cross-session-message from-name="codex/01a0f…" turn="3">
验收通过，任务结束
</cross-session-message>
```
claude 停止。**全程在左窗直播**；想看领导的验收细节：开右窗 `codex resume` 翻历史，看完关。

## 4. 每日标准流程（速览）

1. `multichat status` —— 环境体检（codex 段 unavailable → 先修 daemon，见 §11）
2. `multichat claude` + 角色题词（终端 A）
3. `codex` + 角色题词（终端 B）→ **关掉 B**
4. 在终端 A 围观，必要时人插话（见 §5）
5. 预算耗尽 → agent 总结收尾 → 关会话

## 5. 场景速查

| 场景 | 操作 |
|---|---|
| 人插话 | 任意终端 `multichat send --to <名字> --body "…"`（单向，对方无法回你） |
| claude ↔ claude | 双方都 `multichat claude` 启动，其余同流程 A |
| 向开着的 codex 窗口投递 | 直接发：multichat 等待，关窗瞬间送达；120s 超时报错指引 |
| 看 codex 侧历史 | 开窗 resume 该线程，看完关掉恢复收信 |
| 新话题 | agent 用 `--to` 新发，不续旧引用 |
| 超长内容（>16KiB） | 写文件、消息只发路径（对方按需读，也省上下文） |

## 6. 命令速查

```
multichat send --to <名字> --body "<正文>"          # 新消息
multichat send --conversation <ref> --body "<正文>" # 回复（ref 照抄信封）
echo … | multichat send --to <名字>                 # 正文走 stdin
multichat status [--json]                           # 双侧总览（名字/目录/时间/状态）
multichat install-skills [--dir <根>]               # 安装/更新 skill（幂等）
multichat claude [任意 claude 参数…]                 # 带接收许可启动 claude（透传）
```

## 7. 投递语义矩阵

| 接收方 | 状态 | 行为 |
|---|---|---|
| claude（`multichat claude` 启动） | 窗口开 | ✅ 秒达，会话内出现信封消息 |
| claude（裸 `claude` 启动） | 任何 | ❌ 无接收许可（换 `multichat claude` 重启） |
| codex | 窗口关 | ✅ 立即 headless 执行并回信 |
| codex | 窗口开 | ⏳ multichat 等待，关窗瞬间送达；120s 超时报错 |
| codex | turn 进行中 | ⏳ 排队等空闲（同一机制） |

## 8. 错误码排障

**使用类**：`NAME_NOT_FOUND`（错误信息列出全部可用名，照抄）· `NAME_COLLISION`（重名，`status --json` 看 id）· `MESSAGE_TOO_LARGE`（>16KiB → 落盘发路径）· `RATE_LIMITED`（30 条/60s → 等待或收尾）· `TARGET_*`/`BODY_*`/`USAGE`（参数错误照提示改）

**身份类**：`CALLER_IDENTITY_CONFLICT`（环境双身份残留。临时：命令前缀 `env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID`；根治：干净终端重启 daemon）· `CALLER_NOT_IN_CONVERSATION`（非参与者不能借引用回复）· `CANNOT_REPLY_TO_HUMAN`（对话由人发起，无处回信）

**通道类**：`CODEX_PROXY_SPAWN_FAILED`（看 stderr 摘录；通常 daemon 未跑 → `codex app-server daemon start`）· `CODEX_THREAD_LOCKED`（等待超时：关对方 codex 窗口后重发，立即送达）· `CODEX_THREAD_BUSY_TIMEOUT`（忙满 120s，稍后重发）· `CODEX_APPROVAL_REQUIRED`（codex 等人工审批，**工具永不代答**）· `CLAUDE_PIPE_*`/`CODEX_*UNCERTAIN`（写入中途失败状态不明——**勿盲目重发**，先 `status` 核实对方是否已收到）

## 9. 边界与限制

单条 ≤16KiB；每对端点 30 条/60s；等待上限默认 120s；信任边界=同一 Windows 用户；接收许可只授予 `multichat claude` 启动的会话；长对话靠轮次计数+落盘引用控制上下文。

## 10. FAQ

**Q：codex 窗口为什么开着收不到？** codex 单写者锁（上游设计）：窗口独占线程。multichat 的处理是等你关窗再投。二期研究 remote 形态 TUI 取消此限制。

**Q：为什么必须 `multichat claude`？** 它注入跨会话接收许可；裸 `claude` 的会话收不到。

**Q：`codex queue` 不是能开窗收吗？** 实测对本地 TUI 是黑洞（exit 0 但永不送达），已弃用。

**Q：消息历史在哪看？** claude 侧=会话 transcript；codex 侧=开窗 resume 线程。

## 11. 故障恢复

| 症状 | 动作 |
|---|---|
| status 的 codex 段 unavailable | 干净终端 `codex app-server daemon start` |
| codex 回信撞身份冲突 | 同上（重启 daemon 即根治） |
| skill 误删/过期 | `multichat install-skills` |
| 升级 multichat 代码后 | `npm run build`（skill 有变再 install-skills） |
| 消息发出对方没反应 | 先 `status` 确认对方在线；UNCERTAIN 类错误勿重发先核实 |

## 12. 开发说明

```powershell
npm run check          # lint + build + test（125 项）
MULTICHAT_LIVE=1 npx vitest run --dir test   # 真机 live 测试（会 spawn 一次性会话）
```

- 目录：`src/claude`（注册表/管道/鉴权）· `src/codex`（proxy/RPC/投递）· `src/commands`（CLI）· `src/platform`（平台接缝，二期 mac/linux 扩展点）· `skills/`（agent 教学）
- 平台接缝：PipeTransport / ProcessInspector / PathLayout；二期适配只动这三个实现
- 过程档案：`docs/wayfinder/`（决策地图）· `docs/research/`（研究报告）· `docs/drill-reports/`（联调实证）· `docs/embassy-main/`（embassy 源码参考副本，未入库）
- 二期入口：`docs/wayfinder/map.md` 雾区（联邦/受管形态/mac/linux/完整集）
