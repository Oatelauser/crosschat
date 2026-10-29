# C14-W01：Codex CLI/Desktop 来源关联可行性与最小探针

2026-10-29。仓库 `D:/workspace/CC/multichat`，分支 `codex/core-refactor-pre-tui`，基线 `3aac1c7489efca699d8e6a6dbe83e7aad1673c4c`。本单只回答一个问题：**当前普通 shell 调用，能不能持续、准确地关联到实际执行它的 Codex CLI 或 Desktop 实例。** 结论是：能判定"入口类型"（CLI / Desktop）在**本机拓扑下可行但依赖环境**，能判定"本次调用"要靠原生字段，但**两者都不能把候选祖先、活着的 owner、自报标签当成来源证据**——因此 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED` 应当继续保留，直到下一单按本文的失败关闭条件接线并通过验收。

## 结论摘要

| 路线 | 结论 | 证据等级 | 适用范围 | 主要失效条件 |
|---|---|---|---|---|
| A 受控 CLI 连接＋本次 call | 受限可行 | 源码确定 + 仓库实现已读，未做真实受控连接实测 | 仅 crosschat 自己经 `--connect` 成功建桥、且 bridge 记录了 window→thread 的 CLI 窗口 | 桥回退原生启动；同 thread 被第二个 CLI/Desktop 打开；shell 读不到桥凭据 |
| B 执行实例指纹＋进程链 | 本机可行，需逐次核验 | 拓扑已原生验证；**shell 祖先链未原生验证**（需 root 在 Desktop shell 采样） | 最近的那个 codex 执行体可判形状时 | 共享 daemon 执行；执行体已退出；沙箱/EDR 拒绝读进程表；`ExecutablePath` 为空 |
| C 逐调用原生 Hook | 只能补"本次调用"，补不了"哪个入口" | 源码确定（字段与环境构造），未实测 | 需要 `tool_use_id ↔ turn ↔ thread` 的逐调用登记 | Hook 未配置、迟到、或 fail-open（执行继续但没登记）；Hook 环境是会话快照，拿不到入口标识 |
| D Desktop owner 对账 | 实测能力缺口 | **已原生验证**：IPC 只回随机 `clientId` | 无（当前无法把 owner 绑到 OS 进程） | 需要上游在 IPC 暴露 pid/实例标识 |

一句话给用户：**现在能说的只有"这个 shell 由哪个可执行文件派生、该文件长什么样"，不能说"这个 shell 一定来自 CLI 或 Desktop 入口"。** 前者是进程事实，后者是入口归属，二者之间缺一环——上游没有给。

## 一、复核：原生字段到底能证明什么

### 1.1 环境注入链（固定源码 `rust-v0.163.0`，commit `83086188ae0614bd882818ff1aa23f3194962012`）

shell 的环境由 `create_env(policy, thread_id)` 六步构造（`codex-rs__protocol__src__shell_environment.rs`）：按 `inherit` 取初始集合（默认 `All`）→ 应用默认排除 → 自定义排除 → 用户覆盖 → `include_only` → 写入 `CODEX_THREAD_ID` → 剔除不可继承变量。

关键在第二步：默认排除是 `*KEY*`、`*SECRET*`、`*TOKEN*` 三条**大小写不敏感**的模式。这意味着任何名字含 `TOKEN` 的变量（包括 crosschat 现在用的 `CROSSCHAT_CODEX_WINDOW_TOKEN`）**默认到不了 shell**，除非用户改 `shell_environment_policy.ignore_default_excludes` 或加 include 规则。这条直接判死了"把窗口凭据塞进环境、由 shell 自己读出来"这条最省事的路线：它要求用户改配置，本单不能也不该把它当默认前提。

`CODEX_TOOL_CALL_ID` 的注入点在整个固定源码里**只有一个**：`unified_exec/process_manager.rs:1478`，在进程创建路径上，顺序为 `create_env` → 覆盖 `CODEX_THREAD_ID` → `set_tool_call_id_env_var(Some(call_id))` → `inject_session_env` → `inject_apply_patch_env` → `inject_permission_profile_env` → `apply_unified_exec_env` → `strip_output_env`。

由此得到一个必须写进下一单的反例：**`write_stdin` 不刷新 `CODEX_TOOL_CALL_ID`。** 它复用已存在的 PTY 进程，环境在 spawn 时已固定，所以一个长驻进程里看到的 call id 永远是**最初那次 `exec_command`** 的 id，不是后续 `write_stdin` 的 id。`WriteStdinHandler`（`.../handlers/unified_exec/write_stdin.rs`）只是把 `chars` 写进同一个进程，全程没有再注入环境。所以"用 `CODEX_TOOL_CALL_ID` 判定本次调用"只在**新起进程**时成立。

### 1.2 Hook：有逐调用登记，没有入口字段

`PreToolUseRequest`（`codex-rs__hooks__src__events__pre_tool_use.rs`）字段是 `session_id / turn_id / subagent / cwd / transcript_path / model / permission_mode / tool_name / matcher_aliases / tool_use_id / tool_input`。**没有任何 CLI/Desktop 字段。**

Hook 进程的环境也不是继承来的：`command_runner.rs` 用 `env_clear()` 起进程，然后回放**会话快照**（`runtime.environment`）并过滤不可继承变量，再叠 handler 自己的 env。会话快照就是 `create_env` 的产物，所以 Hook 同样看不到被默认排除的 `*TOKEN*`，也拿不到任何"入口"标识。Hook 进程的父进程是会话进程，和 shell 同源——**Hook 的祖先链和 shell 的祖先链是同一条**，多拿不到一个字节。

Hook 的价值在别处：它是唯一能给出 `tool_use_id ↔ turn_id ↔ session_id` 逐调用绑定的原生面，而且这些 ID 不是模型能编的。代价是它是**可选配置**，且失败可能是 `FailedContinue`（登记没成功但命令照跑）。

### 1.3 app-server：`process_id` 不是 OS PID

`CommandExecution` item 的 `process_id`（`codex-rs__protocol__src__v2__item.rs`）是"底层 PTY 进程的标识（可用时）"，`WriteStdin` / `TerminalInteractionNotification` 同样带它。它是 PTY 句柄编号，**不能当 OS PID 用**，任务书对此的警告成立。

客户端身份是**自报**的：`client_name` 由客户端自己给（TUI 发 `codex-tui`），`AuthStorageOriginator::from_client_name(session.app_server_client_name().unwrap_or("none"))` 只是把它转成 originator 字符串。所以 `originator` 是标签，不是证据。

### 1.4 Desktop IPC：只回随机 clientId，没有进程锚点

本机实测（`.c14-w01-probe/probe.mjs`，只发一次 `initialize`，只读）：

```json
{ "resultKeys": ["clientId"],
  "result": { "clientId": "8feff53d-1e37-4b15-a4b7-882ed7833f9e" },
  "resultType": "success", "handledMatchesSelf": true }
```

`initialize` 的 result 只有 `clientId`——**没有 PID、没有版本、没有实例指纹、没有可执行路径**。`thread-owner-discovery` 回的 `ownerId` 就是某个连接的 `clientId`。于是 route D 的缺口是结构性的：**owner 是"某条连接"，不是"某个进程"**，从 IPC 面上无法把 owner 绑到 `ChatGPT.exe` 的 pid。要补这一环只能等上游在 IPC 里加 pid/实例字段（私有接口，本单不假设它存在）。

## 二、四条路线

### A. 受控 CLI 连接＋本次 call —— 受限可行

crosschat 的 `--connect` 路径（`src/commands/codex-wrapper.ts` → `src/codex/session-events.ts`）会起一个本地 WS 桥（`127.0.0.1:0`、Bearer 校验用 `timingSafeEqual`），给 TUI 传 `--remote <url> --remote-auth-token-env CROSSCHAT_CODEX_WINDOW_TOKEN`，并在桥上拦截 `thread/start|resume|fork|turn/start` 的响应 → 于是**桥知道"这个窗口选中了哪个 thread"**。

这是本单找到的最强关联，但它的锚点是**桥的连接**，不是 shell 的环境：1.1 已证明凭据默认到不了 shell。可行的接法是：

1. shell 报告 `CODEX_THREAD_ID`（原生注入，可信为"我在这个 thread 里"）；
2. 桥的 window→thread 记录证明"这个 thread 曾被 crosschat 启动的 CLI 窗口选中"；
3. 两者相交，且**该 thread 在当前时刻没有被第二个客户端占用**，才能判 CLI。

失效条件很硬：`reportLauncherFailure` 之后回退原生启动（没有桥）；同一个 thread 被第二个 CLI 或 Desktop 打开（桥的记录变成"曾"而不是"是"）；`turn/steer` 不产生新窗口记录。所以它只能覆盖"crosschat 自己起的 CLI 窗口"，不能覆盖用户自己在终端敲 `codex` 的 shell。

维护成本低（复用现有桥，不加新协议），但它回答的是"这个 thread 是不是我起的那个窗口"，不是"这个 shell 是谁的执行体"。

### B. 执行实例指纹＋进程链 —— 本机可行，需逐次核验

本机拓扑（`docs/research/evidence/c14-codex-source-20261029/topology-20261029.json`，已脱敏）：

- Desktop：`ChatGPT.exe` 14368 → `codex.exe` 24716（形状 `desktop-bundle`，路径形如 `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`）→ `codex-code-mode-host.exe` 3240。
- CLI：npm `codex-cli 0.163.0` → `node.exe` 跑 `@openai/codex/bin/codex.js` → 原生体 `@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`（形状 `npm-native`）。
- 本机**没有** app-server daemon 在跑：`~/.codex/app-server-daemon/daemon.pid` 是 121 小时前的陈旧记录，其中 pid 已死（`pidAlive:false`），但文件里带着 `{pid, processStartTime, executableIdentity:{digest, path_digest}}`——这是上游自己发布的**唯一**实例指纹格式，只覆盖 daemon 执行体。

两个执行体的形状在本机可分：Desktop bundle 在 `OpenAI\Codex\bin\<hash>\` 下，npm 体在 `@openai/codex-win32-x64\vendor\` 下。用最近的那个 codex 执行体的**父进程形状**做判据（父是 `ChatGPT.exe` → Desktop；父是 `node.exe` → CLI），比"链上有没有 Desktop 祖先"稳，因为后者会把 **Desktop 里起的嵌套 CLI** 误判成 Desktop。

必须逐次核验的三件事：pid + 创建时间（防 PID 重用）、可执行路径散列（防同名替身）、执行体是否仍存活（防实例重启后读到陈旧记录）。`scripts/codex-caller-source-probe.mjs` 就按这三条写，并用 `creation-order` 停止条件显式拒绝"父进程比子进程晚创建"的 PID 重用假链。

失效条件：shell 由 daemon 派生时，最近执行体是 daemon，链上不再有窗口信息（同 daemon 多窗口完全不可分）；执行体已退出后补采就只剩孤儿链；Windows 上非提权读 `ExecutablePath` 可能为空，形状退化成 `unknown`；沙箱/EDR 可能直接拒绝进程表读取。以上任一情况都**只能报 `unknown`，不能退化成猜**。

**证据等级：拓扑已原生验证；"shell 的祖先链"未原生验证**——我进不了 Codex 的 shell，已向 root 发 `NEED_ROOT_PROBE` 请其代跑探针。

### C. 逐调用原生 Hook —— 只能补"本次调用"

见 1.2。它能给的：`tool_use_id`、`turn_id`、`session_id`、`cwd`、`transcript_path`。它给不了的：入口类型（没有字段，环境是会话快照，祖先链与 shell 同源）。

因此 Hook 不是"来源"路线的替代，而是**"本次调用"的补强**：B 判入口类型，C 判"这条消息确实来自当前这次 tool call"，两者合起来才接近"已核实来源"。但它要求用户配 hooks，属于需要用户决定的事项；且 fail-open 语义意味着"没收到 Hook"不能当"没执行"。

### D. Desktop owner 对账 —— 实测能力缺口

见 1.4。owner 只是 `clientId`，没有进程锚点。这条路线在公开接口上到此为止；私有接口（Desktop 内部把 `clientId` 与 pid 关联的地方）本单不研究、不假设。

## 三、必要反例逐条

| 反例 | 结论 | 依据 |
|---|---|---|
| 同一 ID 在 CLI/Desktop 同时存在 | **不能靠 ID 判来源**：`CODEX_THREAD_ID` 两边都可能是同一个值 | 原生字段本身不含入口；`state_5.sqlite.source` 没有 `desktop` 值，`originator` 是自报标签 |
| Desktop 启动嵌套 CLI | 最近执行体仍是 npm 体 → 可判 CLI；但"链上有 Desktop 祖先"的写法会误判 Desktop | 本机拓扑 + `classifyEntry` 只看最近执行体；已写成 fixture 测试 |
| 同 daemon 多窗口 | **不可分**：两个窗口的 shell 祖先链完全相同 | daemon 是执行体，窗口只是连接；本机当前无 daemon 在跑，未实测 |
| 旧 originator 标签 | 不可当证据 | `originator` 自报且可覆盖；分布 `Codex Desktop` 113 / `codex-tui` 52 / `(null)` 26 / `codex_exec` 16 / `crosschat` 2 / `codex_work_desktop` 2 |
| PID 重用 | 可用创建时间拒绝 | `traceAncestry` 的 `creation-order` 停止条件；RED/GREEN 已记录 |
| 实例重启 | 旧 pid+创建时间记录必须失效 | 指纹三元组，不是单 pid |
| 持续 exec / `write_stdin` | `CODEX_TOOL_CALL_ID` 不随 `write_stdin` 更新 | 唯一注入点 `process_manager.rs:1478`，spawn 期 |
| Hook 缺失或迟到 | 可能 fail-open，执行继续但无登记 | `FailedContinue` 语义；未实测 |

## 四、本机实测与未实测

已原生验证：Desktop/CLI 两个执行体的形状与祖先链（`topology-20261029.json`）；Desktop IPC `initialize` 只回 `clientId`（`desktop-ipc-initialize.json`）；探针在**非 Codex** shell 里的负样本——`verdict: unknown / no-codex-ancestor`，`env: []`（`probe-negative-control.json`）。

未实测：任何 Codex shell 内的环境与祖先链（需 root 采样）；共享 daemon 拓扑；Hook 实际触发；真实受控 `--connect` 连接的窗口记录。这些在报告里一律按"未测"计，不从正向观察推全覆盖。

## 五、下一单建议

**目标**：把 route B 接到共享 Provider，只在证据齐全时给 `association: 'verified'`，否则保持 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED`。

- 新增 `src/codex/process-ancestry.ts`：把本单探针的 `parseProcessTable` / `traceAncestry` / `classifyEntry` 移植为 TypeScript，保持"只报事实、失败即 `unknown`"。进程表读取有界（超时 + 上限），跨平台：win32 走 `Get-CimInstance`，Linux 走 `/proc`，macOS 报 `unavailable`（不猜）。
- 改 `src/application/caller-source/providers.ts` 的 codex 分支：只有同时满足 ①最近执行体形状为 `desktop-bundle` 且父为 `app`，或 `npm-native` 且父为 `node`；②`CODEX_THREAD_ID` 存在且与本次调用使用的 thread 一致；③执行体 pid+创建时间仍存活，才返回 `identified` + `scope: 'instance'`；否则原样返回 `unverified`，理由字段区分 `no-codex-ancestor` / `desktop-bundle-without-app-parent` / `executor-gone` / `table-unavailable`。
- 不改 `service.ts` 的门禁，不改确认状态机；`scope: 'instance'` 的既有语义（一次性、随实例失效）直接复用。
- 验收反例：Desktop 里起嵌套 CLI 必须判 CLI；同 daemon 两窗口必须判 `unknown`；PID 重用链必须 `unknown`；执行体退出后补采必须 `unknown`；进程表读不到必须 `unknown` 且不抛异常。
- **需要用户决定**：是否接受"来源判定依赖本机进程表"这一前提（沙箱/EDR 环境下会退化为 `unknown`）；是否要推进 route C（需要用户配 hooks）；是否向 OpenAI 提"IPC 暴露 pid 或注入 `CODEX_ENTRY` 环境变量"的需求——这是唯一能让 route D 闭环的办法。

## 六、清理与遗留

- `.c14-w01-probe/`（`ownership.json`、`probe.mjs`、`collect-evidence.mjs`）为任务独占临时目录，采集完成后递归删除，删前核对绝对路径在 `D:/workspace/CC/multichat/.c14-w01-probe` 下。
- 未安装/卸载任何软件，未启停用户 Desktop，未改全局配置，未接生产远端，未做真实模型调用。
- 未跟踪的 `docs/代码消息投递.md` 保持原样，未 stage。
- 遗留：`docs/research/evidence/c14-codex-source-20261029/` 三份脱敏证据与报告本身保留，作为下一单的验收基座。

## 七、复现

```
node scripts/codex-caller-source-probe.mjs            # 任意 shell，输出脱敏 JSON
node D:/workspace/CC/multichat/scripts/codex-caller-source-probe.mjs   # 在 Codex Desktop/CLI 的 shell 里跑
npx vitest run test/codex-caller-source-probe.test.ts
```
