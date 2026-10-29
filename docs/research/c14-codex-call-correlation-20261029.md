# C14-W05：Codex Hook 与普通 shell 的原生调用关联验证

2026-10-29。仓库 `D:/workspace/CC/multichat`，分支 `codex/core-refactor-pre-tui`，派单基线 `df76413568fe3a764b804533fcdf712abf638beb`。本单只回答一个问题：**已有正式 Codex CLI 中，一次原生命令工具触发的 Hook `tool_use_id`，能否与该命令普通 shell 中的 `CODEX_TOOL_CALL_ID` 精确对应；对应记录能否绑定本次实际执行进程。**

结论：**能，在 CLI 非交互 `exec` 这一条原生路径上。** 两次独立命令调用中，Hook `tool_use_id` 与普通 shell 的 `CODEX_TOOL_CALL_ID` **完整值逐字相等**；Hook 与 shell 的进程链在同一个 `codex.exe` 实例上相交（pid + 创建时间 + 可执行路径摘要三者一致）。同时观察到 thread/session 在同一次运行内稳定、call id 逐调用变化、turn id 在同 turn 内稳定。

这个结论**只覆盖 CLI 原生 exec 的一次调用关联**。它不覆盖 Desktop、共享 daemon、IPC owner、双开、`write_stdin`、子 agent，也不解决"执行实例属于 CLI 还是 Desktop 入口"。

## 一、工具与版本

| 对象 | 实际值 | 证据等级 |
|---|---|---|
| 已安装 CLI | `@openai/codex@0.163.0`，入口 `npm .../@openai/codex/bin/codex.js` | 本机 `codex --version` 与 `package.json` 实测 |
| 运行体 `CODEX_VERSION` | `0.163.0`（普通 shell 内读取） | 本单原生采样 |
| 固定源码 | `rust-v0.163.0`，commit `83086188ae0614bd882818ff1aa23f3194962012` | 与运行体同版本，前单已固定 |
| `hooks` / `unified_exec` 特性 | 均 `stable = true` | `codex features list` 实测 |

运行版本与固定源码**恰好同版本**，所以本单结论可以直接对回源码事实；这不代表以后版本仍成立。

## 二、环境与隔离

- 独占根 `D:/cc-own-c14w05-runN`（D 盘，本单自有），内含空 `profile/`、空 `CODEX_HOME`、合成 `workspace/`、独立 `tmp/`。
- 环境变量只保留 `PATH / PATHEXT / SystemRoot / WINDIR / COMSPEC / ProgramFiles* / SYSTEMDRIVE / OS`，其余全部指向独占根（`HOME`、`USERPROFILE`、`CODEX_HOME`、`APPDATA`、`LOCALAPPDATA`、`TEMP`、`TMP`）。不带用户模型 key、认证文件或真实会话变量。
- 模型只访问 `127.0.0.1` loopback fixture（Responses/SSE），`requires_openai_auth=false`、`request_max_retries=0`、`stream_max_retries=0`、`analytics.enabled=false`。未安装、升级或卸载任何工具。
- Hook 只写本独占 profile 的 `hooks.json`，最小 `PreToolUse` matcher `Bash`，命令是一个只追加一行 JSON 的 node 脚本；运行结束随 profile 一起清理。
- 信任审查用官方开关 `--dangerously-bypass-hook-trust` 绕过：它只跳过"持久化信任审查"，**Hook 仍由 Codex 自己触发**，不是手工调用 Hook 脚本冒充原生事件。运行时该开关会打印一条警告，属预期。
- `--no-daemon`：不连、不启用户的共享 daemon。

## 三、原生对账结果

模型被提供 9 个工具（`exec_command`、`write_stdin`、`request_user_input`、`view_image`、`multi_agent_v1`、`get_goal`、`create_goal`、`update_goal`、`web_search`）。命令走的是 `exec_command`（统一 exec），Hook 侧 `tool_name` 记为 `Bash`，与官方文档"统一 exec 以 Bash 匹配"一致。

一次运行内两次独立 `exec_command`，对账结果（第二次运行的脱敏证据：`evidence/c14-codex-call-20261029/correlation-20261029.json`）：

| 项 | 调用 1 | 调用 2 | 判读 |
|---|---|---|---|
| Hook `tool_use_id` 摘要 | `86694b834b22` | `efd6100a41ec` | **逐调用变化** |
| shell `CODEX_TOOL_CALL_ID` 摘要 | `86694b834b22` | `efd6100a41ec` | 与 Hook **完整值相等** |
| Hook `session_id` / shell `CODEX_THREAD_ID` | 相同（`8d464f7f8d01`） | 相同（`8d464f7f8d01`） | **同运行内稳定** |
| shell `CODEX_SESSION_ID` | 与 thread 相同 | 与 thread 相同 | root thread 下两者一致 |
| Hook `turn_id` 摘要 | `71f6c0145c4c` | `71f6c0145c4c` | 同 turn 内稳定 |
| 共享执行实例 | `codex.exe` pid 2380 | 同一 pid + 同一创建时间 | **同一实例** |

上表 thread/turn 摘要取自保存的第二次运行文件。首次运行是另一次原生启动，thread/turn 是另一组值（当时只在终端打印，未落盘），因此**不能**把首次运行的值填进这张表；见 §五 的元数据更正。

进程链（脱敏，两链在 `codex.exe` 相交）：

```
shell: node.exe ← powershell.exe ← codex.exe(2380) ← node.exe(启动器)
hook : node.exe ← powershell.exe ← codex.exe(2380) ← node.exe(启动器)
```

worker 当时做了两次原生运行，两次结论一致（两次调用都 `correlated`）。但**只有第二次运行的结构化证据被保存**；首次运行没有落盘记录，root 审计也无法从文件复核它，所以本报告只把第二次运行当作可复核证据，不把"两次运行"写成已保存的两份样本。

**对账方式**：模型给出两次带唯一标记的 `exec_command`；Hook 记录把标记原样带进 `tool_input.command`；shell 侧把同一标记作为参数写出。核对时**先按标记把 Hook 记录与 shell 记录一一绑定**（缺记录→`hook-missing`，重复记录→`ambiguous`，均不通过），再在内存里逐字比较完整 `tool_use_id` 与完整 `CODEX_TOOL_CALL_ID`。落盘证据只有散列、长度与相等布尔值。

**ID 稳定性小结**：thread/session 与 turn 在同一次运行内稳定；call id 每次工具调用变化；三者都不是入口标签。

## 四、证据等级与边界

这是**真实工具处理请求**：模型返回的是标准 `function_call`，Codex 自己起 shell、自己触发 Hook，没有手填 `CODEX_*` 身份环境，也没有直接调用 Hook 脚本。

但必须同时说明三条限制：

1. **call id 由 fixture 模型给出**。有意义的不是值，而是同一个值从模型 → 运行时 → Hook 输入 → shell 环境原样贯通。
2. **环境变量不是防伪造证据**。`CODEX_TOOL_CALL_ID` 由运行时在 spawn 时写入，任何进程都可以自行覆盖同名变量。所以本单证明的是"原生运行时在 Hook 与 shell 两侧给出同一个调用标识"，不是"这个 shell 可信"。要防伪造仍需进程/连接侧的独立锚点。
3. **本单只走 `exec_command` 一条路径**。模型本次被提供 9 个工具（见 §三 首段），但只**实际调用**了 `exec_command`；非统一 exec 的普通 `shell` 工具路径、`write_stdin` 复用、子 agent、fork/resume 均未测。

未测清单：Desktop Hook；共享 daemon；CLI/Desktop 同 thread 双开；IPC owner 对账；`write_stdin`；第二 thread；子 agent；Linux/macOS；长驻进程内的 call id 是否被复用。

## 五、工装与 RED/GREEN

- `scripts/codex-call-correlation-probe.mjs`：只读研究探针，不接产品路径。
  - 绑定：按本次**明确计划**逐项核对；tag 必须作为完整词元精确匹配（`call_w05_1` 不匹配 `call_w05_10`），每条 Hook/shell 记录**最多消费一次**；缺失、重复、重叠、计划外记录都记入 `problems`，运行判为不完整。
  - 实例对账：两侧各自取**最近**的 Codex 执行进程，要求 pid、创建时间、可执行路径摘要三者相符才报 `same`；只共享启动器时报 `different`（启动器单列为共同祖先）；证据不足报 `unverified`。malformed 行按类型丢弃，不做强转。
  - 采证完整性：每个计划内文件单独读取，区分"不可读 / 截断 / 完整"；Hook 拒绝行、shell 拒绝行、模型请求超限都进入整体状态。**完整采证下的不相等仍是有效结论**（`status: complete`、`outcome: mismatch`），只有证据不全或工装故障才退出 3。
  - 生命周期：自有子进程超时按 pid 树收束并等 `close`；spawn error、输出字节上限、`taskkill` 失败都记录；loopback 服务处理 listen 失败、请求体超限、请求次数超限，关闭有截止。
  - 目录：运行根先排他创建/认领并写 ownership，已有非空目录原样拒绝；证据文件用 `wx` 写，已存在即拒绝。
- `test/helpers/codex-call-correlation-hook.mjs`：最小 `PreToolUse` Hook + shell 采样器。只投影允许字段（session/turn/tool_use_id/tool_name/command），不落 `transcript_path`、`cwd`、`model`、`permission_mode`；stdin 有截止和字节上限；Hook 失败时记 stderr 并退出 0，不阻断工具调用。
- `test/helpers/codex-call-correlation-fixture.mjs`：合成记录，测试不读宿主进程表。
- `test/codex-call-correlation-probe.test.ts`：38 项。纯函数用合成记录；生命周期用**自有受控子进程**（正常退出、非零、超时且带孙进程、输出上限、spawn error）；服务用本机 loopback（端口占用、请求超限、请求体超限、关闭）；入口链路用注入的假 CLI 走完整 `runCorrelation`，不启原生 Codex。

RED/GREEN（三处守卫逐个改回缺陷形态，跑同一份测试）：

| 轮次 | 临时改回的缺陷 | 结果 | 命中的用例 |
|---|---|---|---|
| A | tag 用子串匹配 | 1 failed / 37 passed | tag 精确匹配 |
| B | 共享祖先即判同一执行实例 | 4 failed / 34 passed | 共享启动器、最近执行体缺失、malformed 不强转、路径摘要缺失 |
| C | 读取失败当空文件 + 结论性不参与整体状态 | 4 failed / 34 passed | 缺第二份 shell、缺 Hook、读取三态、**假 CLI 只产出 1/2 的完整链路** |

恢复后 38/38 通过。C 轮正是 root 复现的反例：旧实现会以退出 0 报告"一个 correlated"，现在必须报不完整。

**元数据更正**（原文件字节保持不变）：

- 保存的 `correlation-20261029.json` 的 `collection.note` 写成"call ids and thread ids were chosen by the loopback fixture model"。事实是**只有 call id 由模型给出**；thread/turn/session 由 Codex 运行时分配，脚本从未让模型指定它们。该字段在旧版证据里，按 R1 约束不修改原文件，以本说明为准。
- 同一字段的 `runs: 2` 表示 worker 当时运行了两次，不表示保存了两份样本。
- §三 的 thread/turn 摘要已按保存文件核对为 `8d464f7f8d01` / `71f6c0145c4c`；此前版本误填了首次运行（未保存）的值。
- offered/used tools：9 个工具是**提供**，`exec_command` 是**实际调用**。

## 六、仍未闭合的环节

本单解决的是**本次调用 ↔ 执行实例**这一环：

- 调用 ID 对应：Hook 侧"这次调用要跑哪条命令"与 shell 侧"我是哪次调用"逐字一致；
- 执行实例：两条记录在同一个 `codex.exe` 实例上相交。

仍然缺的是**执行实例 ↔ 入口（CLI/Desktop）**：

- Hook 输入没有入口字段（前单已固定源码结论，本单实测再次确认 `tool_name` 只有 `Bash`，无 CLI/Desktop 标记）；
- 本单之所以能说"这是 CLI 的实例"，是因为**我们自己启动了这个进程树**，不是程序从任意 shell 推断出来的；
- Desktop 侧 owner 仍没有 pid 锚点（前单 `initialize` 响应只有随机 `clientId`）。

因此**不能**因为本单相等就返回来源类型：`identified` 仍不成立，生产 Provider 接线保持未批准。

## 七、下一单最窄条件

1. **Desktop 侧同一对**：在 Desktop 的一次真实工具调用里同时取 Hook `tool_use_id` 与 shell `CODEX_TOOL_CALL_ID`，看是否同样逐字相等；这是本单结论能否跨入口的最小验证。
2. **实例 ↔ 入口的独立锚点**：CLI 侧已有"自己启动的进程树"，Desktop 侧还缺 owner↔pid；任一方向拿到可重复的锚点，才能谈入口判定。
3. 可选：`write_stdin` 复用与长驻进程内的 call id 行为；子 agent 的 `session_id` 与 root 差异。

## 八、复现

```
node scripts/codex-call-correlation-probe.mjs --root D:/cc-own-c14w05-runN --evidence <out.json>
npx vitest run test/codex-call-correlation-probe.test.ts
```

退出码：`0` 只表示**采证完整**并跑出对账结论（相等或不相等都算）；`3` 表示证据不全（缺记录、重复、读取失败、截断、超限）或工装故障。**工装故障与不完整采证都不得写成"原生不支持"。**

从 R3 起，**正常完整运行也返回 3**：运行根按"未知就保留"处理（§十二），`run.status` 为 `incomplete`、reason 带 `cleanup-retained:processes-unverified`，逐调用对账结论仍照常写入证据、可作事实引用。因此这个探针目前**不能直接当作 CI 成功门禁**——这是研究工装的边界，不是"原生不支持"。

## 九、清理与归属

- 本单新增：本报告、`evidence/c14-codex-call-20261029/correlation-20261029.json`、探针脚本、Hook helper、fixture、测试各一份；R1 新增 `evidence/c14-codex-call-20261029/correlation-20261029-r1.json`（见 §十）。原两份证据文件字节未改。
- 未改 `src/**`、已验收的 W01 研究与 root 记录、skill/总表、用户配置；未安装/卸载/启停用户软件；未连生产远端；未读取用户 auth/config/会话。
- 临时根 `D:/cc-own-c14w05-a1`、`D:/cc-own-c14w05-run1`、`D:/cc-own-c14w05-run2`、`D:/cc-own-c14w05-r1` 均为本单自有，结束前已停止自有进程并核对绝对路径与归属后删除；其他既有目录（如 `D:/cc-own-cztKHB`）未触碰。
- 原未跟踪 `docs/代码消息投递.md` 保持原样，未 stage。

## 十、R1 返修与原生复跑

首轮审计（`docs/development/evidence/c14-worker-20261029/W05-review.md`）指出五项 Spec 与三项 Standards 缺口，均属研究工装，不否定 §三 的局部原生观察。R1 的修法与验证见 §五。

修完后用同一台机器、同一已安装 CLI（`0.163.0`）、同一隔离方式复跑一次原生实验，新证据单独落盘为 `evidence/c14-codex-call-20261029/correlation-20261029-r1.json`（SHA256 `868c8a507acceab694c5f116fbbe3254cf15e2677d98468b1e6f50c5b6967779`），**不覆盖**首轮两份文件：

| 项 | 复跑结果 |
|---|---|
| 整体状态 | `complete`，`outcome: correlated`，无 reasons，退出 0 |
| 计划 / 实采 | 计划 2 次，shell 2 份、Hook 2 条，拒绝行 0，读取全部 `ok` 且未截断 |
| 调用 ID | 两次都完整值相等（`toolCallIdEqual`、`threadIdEqual`、`sessionIdEqual` 均真） |
| 执行实例 | 两侧最近 Codex 进程一致：`codex.exe` pid 17712 + 创建时间 + 路径摘要，`executorVerdict: same` |
| 共同祖先 | 同为该 `codex.exe`；更外层的 `node.exe` 启动器单列为祖先，未当作执行实例 |
| 模型请求 | 3 次；提供 9 个工具，实际调用只有 `exec_command` |
| 收束 | 进程正常退出，未触发超时/树杀；服务关闭有界；运行根按 ownership 删除 |

这仍只是**本机 CLI 0.163.0 非交互 exec 的局部观察**，不扩到 Desktop、共享 daemon、IPC owner、双开或 `write_stdin`。

## 十一、R2 返修

R1 复审（同 [W05-review.md](../development/evidence/c14-worker-20261029/W05-review.md) 的"R1 复审与 R2 单任务"）在工装里复现出一个**真缺陷**和三条边界缺口。R2 只修工装与测试，**不跑原生复跑**，§三、§十 的原生观察与三份证据文件字节均未改。

### 缺陷与修法

1. **拒绝的旧根仍被删除（P1）。** 旧 `main` 在 `finally` 里按路径 `rm -rf`，于是"拒绝非空根"之后照样把别人的目录删了。现在：`prepareOwnedRoot` 用 `ownership.json` 的 `wx` 写作为**领取**，marker 带本进程 `runId`；`removeOwnedRoot(root, claim)` 删除前回读 marker 并要求 `owner` 与 `runId` 都相符；`main` 不再有任何按路径删除。并发领取时失败者拿不到 `claim`，因此没有删除权。领取失败、marker 中途被改、他人正在用的根，都保持字节不变。
2. **生命周期。** `runProcess` 增加 `AbortSignal` 取消，超时与取消都走"树杀 → 等 `close` → 复查 pid"；`launcherGone` 记录启动进程是否真的消失，`descendantsVerified` 恒为 `false`——杀树成功不等于每个后代都退出。根目录只在**本进程已知关闭**时删除（§十二 起收紧为始终保留）；超时、取消、泄漏、spawn 失败一律保留，并在 `reasons` 里写明 `cleanup-retained:processes-unverified`。定时器与监听器在每条出口上清掉。
3. **JSON 边界与证据预检。** loopback 服务的请求体先过 `parseModelRequest`：顶层必须是对象，`input` 必须是对象数组，`tools` 必须是对象数组；畸形返回 400 并记 `model-invalid-input` / `model-invalid-tools`，回调整体包 try/catch，绝不让事件回调抛出进程。ID 只接受**非空字符串**：数字 ID 被拒（`invalid-id`），不再 `String()` 强转成"相等"。缺失 ID 与两个有效但不等是两件事：前者 `unverifiable`（`call-id-missing` / `thread-id-missing`），后者 `mismatch`。进程链要求首行就是记录自己的 pid、相邻行 `ppid` 与下一行 `pid` 相连；断链之后的行一律丢弃，不会把无关的 Codex 行当成共同实例。已有证据文件在**任何 CLI 启动之前**就被拒（`evidence-exists`），最终写入仍是排他创建。
4. **RED/GREEN 覆盖到入口。** 新增用例覆盖真实 `main` 拒绝旧根后字节不变、并发领取失败者不能删、marker 被改不能删、畸形请求不崩且服务能关、数字/缺失 ID、断链、取消、未关闭时保留根、已有证据时根都没被创建。RED 六轮分别改回上述缺陷形态，命中 1 / 1 / 2 / 2 / 1 / 1 项失败，恢复后 48/48 通过。

### 对 §五 的更正

§五 成文于 R1，下面几句按 R2 现状更正（R1 的原文不再代表当前工装）：

- "已有非空目录原样拒绝" → 拒绝之后**也不删除**；删除权只属于领取成功的那个运行，且删前回读 marker。
- "malformed 行按类型丢弃，不做强转" → 还要求链是**连通的**，断链之后的行不再参与实例判定。
- "证据文件用 `wx` 写，已存在即拒绝" → 现在在启动任何 CLI **之前**就先查，拒绝时不产生运行根。
- "超时按 pid 树收束并等 `close`" → 等 `close` 只证明启动进程结束，**不证明后代都退出**；因此未核实的运行保留根，并把这个事实写进 `run.cleanup`。

### 检查结果

`node --check`、ESLint、定向 Vitest 48/48 均通过。`npm run check` 的 lint / check:imports / build 通过，测试 2494 通过 / 1 失败 / 11 跳过；唯一失败是 `test/tui-main-observations.test.ts` 的"原生环境路径"用例，**在基线 `dba2c45` 上就已失败**（把本单两个改动文件回退到基线字节后仍稳定失败），与本单无关，且不在本单白名单内，未改动。逐项记录见 [W05-R2-checks.md](evidence/c14-codex-call-20261029/W05-R2-checks.md)。

### 边界

本轮没有启动真实 Codex，也没有新增原生证据；§三、§十 的结论强度不变。取消、超时、并发领取都在受控子进程与临时目录上验证，真实进程树上的取消/超时仍未实测。

## 十二、R3 最小收口

R2 复审（同 [W05-review.md](../development/evidence/c14-worker-20261029/W05-review.md) 的"R2 复审与 R3 最小收口"）确认 P1 已修，但仍有四条合同缺口。R3 按**未知就保留**的口径收口，不引入 Job Object、后台进程树采样、第三方包或新平台能力；仍然不跑原生复跑，原始三份证据字节未改。

### 五处修改

1. **后代未核实即保留根。** `settled` 现在要求 `run.descendantsVerified === true`。这个值在本运行器里恒为 `false`（杀树成功不等于每个后代退出），所以**正常退出、非零退出、超时、取消都不再删除运行根**：`cleanup` 是 `retained / processes-unverified`，路径写进证据，`reasons` 带 `cleanup-retained:processes-unverified`，整体不是 `complete`。这是本轮明示的选择：宁可留目录，也不用启动器 `close` 冒充后代证据。
2. **claim 绑定本次根与完整 marker。** `prepareOwnedRoot` 把解析后的绝对根写进 marker（`owner / runId / root / createdAt / pid`），并把精确字节保存在 claim 里；`removeOwnedRoot` 先比对 `claim.root` 与本次解析路径，再逐字节比对磁盘 marker，再核对全部身份字段。根不同、marker 被复制到别的目录、只改 PID 或创建时间，都拒绝删除且不动字节。
3. **缺失 ID 优先不可比较。** 判定改为"任一必需比较字段为 `null` → `unverifiable`"，只有两组有效 ID 才可能落到 `mismatch`。所以"缺 call ID + thread 不同"不再被误判成负结论。
4. **祖先链代次与环。** `normalizeAncestry` 除相邻 `ppid→pid` 外，还要求父进程创建时间不晚于子进程、pid 不得重复；在第一个断点截断。独立审计用"创建时间 100/120 的子进程指向时间 200 的共同 Codex 父"复现的 `same`，现在得到 `unverified`。
5. **请求截止与定时器释放。** loopback 请求有 `requestTimeoutMs`（默认 10s）截止，半截请求返回 408 并记 `request-timeout`；`end / error / close` 与服务关闭各自清理自己的 timer 与 listener；关闭成功时立即清除关闭截止 timer。此前"所有工作结束后仍等 5 秒"的路径不再出现。

### RED/GREEN

把六处守卫逐个改回缺陷形态，跑同一份 56 项测试，每轮结束从备份还原并核对字节一致：

| 轮次 | 改回的缺陷 | 结果 | 命中用例 |
|---|---|---|---|
| A 收束 | 只用启动器 `close` 判定可删 | 3 failed | 正常退出保留根、非零退出保留根、只采到 1/2 时也保留 |
| B claim | 只比 owner/runId，不比根与字节 | 2 failed | claim 指向别的根、marker 改任一字段 |
| C 判读 | 缺 ID 塌缩成 `mismatch` | 1 failed | 缺 call ID + thread 不同 |
| D 链 | 只查 pid 相邻 | 2 failed | 父晚于子出生、重复 pid |
| E 截止 | 半截请求超时后不记录 | 1 failed | 半截请求必须有界失败并留痕 |
| F timer | 关闭截止 timer 不提前释放 | 1 failed | 子进程关服后立即退出 |

### 检查结果

`node --check`、ESLint、定向 Vitest **56/56** 通过。`npm run check` 的 lint / check:imports / build 通过，测试 **2501 通过 / 2 失败 / 11 跳过**，两处失败都在本单未改动的文件里：

- `test/tui-main-observations.test.ts` 的"原生环境路径"用例（`vi.waitFor` 默认 1000ms 内未调用 `render`）——与 R2 记录同一条，按派单要求**没有重跑**该文件、没有改其断言或超时。
- `test/core-diagnostics.test.ts` 的"通过默认内置隔离路径终止真实探针子进程"（`expected 'still waiting for blocking probe' to be 'AbortError'`）——该用例把 abort 结果与固定 500ms 计时器赛跑，只在整包并行负载下超时；单独运行该文件三次均 9/9 通过。

两条都属**负载敏感的测试时序问题**，不是本单引入的产品回归；完整日志当时已保存，失败原文与环境摘要见 [W05-R3-checks.md](evidence/c14-codex-call-20261029/W05-R3-checks.md)。按要求没有改这两个文件，也没有用重复运行抹掉首次失败。

### 边界

- 正常原生运行现在**总是**以 `retained` 结束并返回 3：逐调用对账结论仍写入证据（`calls[].verdict`），但整体 `status` 不会是 `complete`。把该运行器当 CI 门禁需要另单，本单不阻塞、也不取消原 CI 待办。
- 后代"已核实"没有任何实现路径：不引入平台级进程树证据，也不允许手填 `descendantsVerified: true`。
- 取消、超时、半截请求都在受控子进程与 loopback 上验证；真实 Codex 进程树上的取消/超时仍未实测。
