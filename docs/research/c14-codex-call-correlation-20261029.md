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
| Hook `session_id` / shell `CODEX_THREAD_ID` | 相同（`2586146cfbb5`） | 相同（`2586146cfbb5`） | **同运行内稳定** |
| shell `CODEX_SESSION_ID` | 与 thread 相同 | 与 thread 相同 | root thread 下两者一致 |
| Hook `turn_id` 摘要 | `1c8981e41a12` | `1c8981e41a12` | 同 turn 内稳定 |
| 共享执行实例 | `codex.exe` pid 2380 | 同一 pid + 同一创建时间 | **同一实例** |

进程链（脱敏，两链在 `codex.exe` 相交）：

```
shell: node.exe ← powershell.exe ← codex.exe(2380) ← node.exe(启动器)
hook : node.exe ← powershell.exe ← codex.exe(2380) ← node.exe(启动器)
```

两次运行（`run1`、`run2`）结论一致：两次调用都 `correlated`，即 `toolCallIdEqual` 与 `threadIdEqual` 同时为真。

**对账方式**：模型给出两次带唯一标记的 `exec_command`；Hook 记录把标记原样带进 `tool_input.command`；shell 侧把同一标记作为参数写出。核对时**先按标记把 Hook 记录与 shell 记录一一绑定**（缺记录→`hook-missing`，重复记录→`ambiguous`，均不通过），再在内存里逐字比较完整 `tool_use_id` 与完整 `CODEX_TOOL_CALL_ID`。落盘证据只有散列、长度与相等布尔值。

**ID 稳定性小结**：thread/session 与 turn 在同一次运行内稳定；call id 每次工具调用变化；三者都不是入口标签。

## 四、证据等级与边界

这是**真实工具处理请求**：模型返回的是标准 `function_call`，Codex 自己起 shell、自己触发 Hook，没有手填 `CODEX_*` 身份环境，也没有直接调用 Hook 脚本。

但必须同时说明三条限制：

1. **call id 由 fixture 模型给出**。有意义的不是值，而是同一个值从模型 → 运行时 → Hook 输入 → shell 环境原样贯通。
2. **环境变量不是防伪造证据**。`CODEX_TOOL_CALL_ID` 由运行时在 spawn 时写入，任何进程都可以自行覆盖同名变量。所以本单证明的是"原生运行时在 Hook 与 shell 两侧给出同一个调用标识"，不是"这个 shell 可信"。要防伪造仍需进程/连接侧的独立锚点。
3. **本单只走 `exec_command` 一条路径**。模型本次只被提供 `exec_command`，非统一 exec 的普通 `shell` 工具路径、`write_stdin` 复用、子 agent、fork/resume 均未测。

未测清单：Desktop Hook；共享 daemon；CLI/Desktop 同 thread 双开；IPC owner 对账；`write_stdin`；第二 thread；子 agent；Linux/macOS；长驻进程内的 call id 是否被复用。

## 五、工装与 RED/GREEN

- `scripts/codex-call-correlation-probe.mjs`：只读研究探针，不接产品路径。纯函数负责解析 Hook JSONL、解析 shell 样本、按标记绑定并逐字比对、取两条进程链的最近共同祖先（必须 pid **且** 创建时间相同）；运行器负责独占 profile、loopback 模型、启动 CLI、超时收束、关闭服务。
- `test/helpers/codex-call-correlation-hook.mjs`：最小 `PreToolUse` Hook + shell 采样器；Hook 失败时记 stderr 并退出 0，不阻断工具调用。
- `test/helpers/codex-call-correlation-fixture.mjs`：合成记录，测试不启子进程、不读宿主进程表。
- `test/codex-call-correlation-probe.test.ts`：13 项，全部使用受控输入。

RED/GREEN：先跑绿（13/13），再把两处守卫临时去掉——`toolCallIdEqual && threadIdEqual` 的判定，以及"无 Hook 记录即 `hook-missing`"的分支——重跑得到 **2 failed / 11 passed**，恰好是"错误 ID 不被接受""缺 Hook 不被接受"两项失败；恢复后重新 13/13 通过。错误 ID、缺失记录、重复记录、无对应 shell 均不会被当成关联成功。

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

退出码：`0` 表示跑出对账结论（相等或不相等都算），`3` 表示工装故障（未产生结论）。**工装故障不得写成"原生不支持"。**

## 九、清理与归属

- 本单新增：本报告、`evidence/c14-codex-call-20261029/correlation-20261029.json`、探针脚本、Hook helper、fixture、测试各一份。
- 未改 `src/**`、已验收的 W01 研究与 root 记录、skill/总表、用户配置；未安装/卸载/启停用户软件；未连生产远端；未读取用户 auth/config/会话。
- 临时根 `D:/cc-own-c14w05-a1`、`D:/cc-own-c14w05-run1`、`D:/cc-own-c14w05-run2` 均为本单自有，结束前已停止自有进程并核对绝对路径与归属后删除；其他既有目录（如 `D:/cc-own-cztKHB`）未触碰。
- 原未跟踪 `docs/代码消息投递.md` 保持原样，未 stage。
