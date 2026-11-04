# C14-W01：Codex CLI/Desktop 来源关联可行性与最小探针

2026-10-29（R2 文档修订）。仓库 `D:/workspace/CC/multichat`，分支 `codex/core-refactor-pre-tui`。首轮基线 `3aac1c7489efca699d8e6a6dbe83e7aad1673c4c`、提交 `68782c5`；R1 基线 `aa31ce08b42ac84b811003efa0975a2de556924d`、提交 `c38a809`；R2 基线 `a8148ab51d5361ae822710672a42969d5f7e05d5`。本单只回答一个问题：**当前普通 shell 调用，能不能持续、准确地关联到实际执行它的 Codex CLI 或 Desktop 实例。**

结论：**能判定"这个 shell 由哪个可执行文件派生、该文件长什么样"（候选入口），不能判定"这个 shell 一定来自 CLI 或 Desktop 入口"（已核实关联）。** 两者之间缺的是"本次调用 ↔ 执行实例"的独立证据，不是再采一次同样的环境变量；客户端 token 到执行端环境的跨进程传递同样未证实。因此 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED` 继续保留。

本版修正首轮两处事实错误（默认环境过滤方向、候选形状当来源证明）和三处过强声称（实例指纹已核验、IPC 全面不可能、Linux 分支有界），R2 再修正一处（把 TUI 客户端 env 当成共享 owner 的执行 env）。**首轮报告与提交保留原样，不因返修改写。**

## 结论摘要

| 路线 | 结论 | 证据等级 | 适用范围 | 主要失效条件 |
|---|---|---|---|---|
| A 受控 CLI 连接＋本次 call | 只证实到"窗口 token → 桥连接 → 选定 thread" | 源码确定 + 仓库实现已读，未做真实受控连接实测 | 桥能证明某个 thread 由哪个窗口选定；**不能**证明这个 shell 的执行环境带该 token | 桥回退原生启动；同 thread 被第二个 CLI/Desktop 打开；token 未跨连接到执行端 |
| B 执行实例指纹＋进程链 | 本机 Desktop 正向可判，CLI 未采样；只能给候选 | 源码确定 + 拓扑原生验证 + root 两次 Desktop shell 原生采样 | 最近的 codex 进程形状可识别、且 pid 与创建时间齐全时 | 更近的未知 codex 执行体；共享 daemon 执行；执行体已退出；沙箱/EDR 拒绝读进程表；关键元数据缺失 |
| C 逐调用原生 Hook | 只能补"本次调用"，补不了"哪个入口" | 源码确定（字段与环境构造），未实测 | 需要 `tool_use_id ↔ turn ↔ thread` 的逐调用登记 | Hook 未配置、迟到、或 fail-open；Hook 环境是会话快照，拿不到入口标识 |
| D Desktop owner 对账 | 本次响应未暴露进程锚点 | 已原生验证一次 `initialize` 响应 | 无（当前观察内无法把 owner 绑到 OS 进程） | 需要更多 IPC/OS 侧观测；本单未研究私有接口 |

一句话给用户：**现在能说的是"这个 shell 派生自一个形状可识别的 codex 可执行文件，且它更像 Desktop 或 CLI 的安装布局"，不能说"这个 shell 一定来自 CLI 或 Desktop 入口，或来自哪一个实例"。**

## 一、复核：原生字段到底能证明什么

### 1.1 环境注入链（固定源码 `rust-v0.163.0`，commit `83086188ae0614bd882818ff1aa23f3194962012`）

shell 的环境由 `populate_env(policy, thread_id)` 按序构造（[`codex-rs/protocol/src/shell_environment.rs:105-175`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/protocol/src/shell_environment.rs#L105-L175)）：

1. 按 `inherit` 取初始集合（默认 `All`，第 113-132 行）；
2. **默认排除**：仅当 `!policy.ignore_default_excludes` 时剔除 `*KEY*` / `*SECRET*` / `*TOKEN*`（第 138-146 行）；
3. 自定义排除（第 148-151 行）；
4. `set` 用户覆盖（第 153-158 行，在过滤之后插入，因此不受第 2/3 步影响）；
5. `include_only` 只保留匹配项（第 160-163 行）；
6. 写入 `CODEX_THREAD_ID`（第 165-168 行）；
7. 剔除不可继承变量（第 170-172 行）。

**首轮在此处判反了方向。** `ignore_default_excludes` 在配置转换处默认 **true**（[`codex-rs/config/src/shell_environment_policy.rs:136`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/config/src/shell_environment_policy.rs#L136)：`toml.ignore_default_excludes.unwrap_or(true)`），即**默认不套用** KEY/SECRET/TOKEN 过滤；只有显式设为 `false` 才套用。root 审计同时确认 `protocol/src/config_types.rs` 的 `Default` 也是 true（该文件不在本机固定缓存中，我未直接核对）。由此：

- 执行端**已经存在**于 owner 进程环境里的变量，默认不会被这条规则删掉。这只说明"已有变量不被删"，**不能**推出"客户端进程里的 token 会出现在执行端"——两者是不同进程的环境。首轮"默认到不了、必须改用户配置"的否决撤回，但不能读成"桥凭据可达"。
- 反过来也不能断言"一定可达"：用户若配置了 `exclude` / `include_only` / `ignore_default_excludes = false`，仍会被过滤；`include_only` 是第 5 步，**不能恢复**第 2/3 步已删的值；`set` 虽在第 4 步插入，仍可能被第 5 步 `include_only` 或第 7 步剔除。
- 非 unified-exec 路径同样走这套策略：`codex-rs/core/src/exec_env.rs:32-37` 直接转调 `shell_environment::create_env`。

`CODEX_TOOL_CALL_ID` 的注入点在整个固定源码里**只有一个**：`unified_exec/process_manager.rs:1478`，在进程创建路径上。`write_stdin` 复用已存在的 PTY，不再注入环境（`handlers/unified_exec/write_stdin.rs`），所以长驻进程里看到的 call id 永远是**最初那次 `exec_command`** 的。root 的两次独立 `exec_command` 实测正好对应这一点：同一 thread，`CODEX_TOOL_CALL_ID` 摘要改变（`d186a709` → `88204fb1`），`CODEX_THREAD_ID` / `CODEX_SESSION_ID` 摘要不变（均 `165ee6b0`）。注意这只证明"每次新起进程带一个新的 call id"，不证明"这个 call id 能对回执行实例"。

### 1.2 Hook：有逐调用登记，没有入口字段

`PreToolUseRequest`（`codex-rs/hooks/src/events/pre_tool_use.rs`）字段是 `session_id / turn_id / subagent / cwd / transcript_path / model / permission_mode / tool_name / matcher_aliases / tool_use_id / tool_input`。**没有任何 CLI/Desktop 字段。**

Hook 进程的环境不是继承来的：`command_runner.rs` 用 `env_clear()` 起进程，回放**会话快照**（`runtime.environment`）并过滤不可继承变量。会话快照是 `create_env` 的产物，所以 owner 执行端环境里已有的变量默认会保留——首轮"Hook 同样看不到被默认排除的 `*TOKEN*`"一句撤回。但快照里有什么取决于 **owner 进程的环境**，与 TUI 客户端进程的 env 无关，**不能由此推出桥凭据在 Hook 环境里**。Hook 仍然拿不到"入口"标识，Hook 进程的祖先链与 shell 同源，多不出一个字节。

Hook 的价值在别处：它是唯一能给出 `tool_use_id ↔ turn_id ↔ session_id` 逐调用绑定的原生面，且这些 ID 不是模型能编的。代价是可选配置，且失败可能是 `FailedContinue`（登记没成功但命令照跑）。

### 1.3 app-server：`process_id` 不是 OS PID

`CommandExecution` item 的 `process_id`（`app-server-protocol/src/protocol/v2/item.rs`）是"底层 PTY 进程的标识（可用时）"，`WriteStdin` / `TerminalInteractionNotification` 同样带它。它是 PTY 句柄编号，**不能当 OS PID 用**。

客户端身份是**自报**的：`client_name` 由客户端自己给（TUI 发 `codex-tui`），`AuthStorageOriginator::from_client_name(...)` 只是转成 originator 字符串。所以 `originator` 是标签，不是证据。

### 1.4 Desktop IPC：本次响应只有随机 clientId

本机只读实测（原始字节见 `desktop-ipc-initialize-capture.txt`，结构化重述见 `desktop-ipc-initialize.json`）：

```json
{ "resultKeys": ["clientId"],
  "result": { "clientId": "8feff53d-1e37-4b15-a4b7-882ed7833f9e" },
  "resultType": "success", "handledMatchesSelf": true }
```

这一次 `initialize` 响应里没有 PID、版本、实例指纹或可执行路径；`thread-owner-discovery` 回的 `ownerId` 是某个连接的 `clientId`。因此**在这个响应范围内**，owner 是"某条连接"而不是"某个进程"。

首轮把这一点写成"路线 D 结构性关闭、只能等上游加字段"是过强的：一次 `initialize` 响应不能证明所有 IPC 方法、所有连接形态（含 OS 层句柄/管道对账）都拿不到进程信息。正确的表述是：**已观察到一个能力缺口，route D 未核实，私有接口与维护成本未评估**。本单不研究全部内部接口。

## 二、四条路线

### A. 受控 CLI 连接＋本次 call —— 只证实到桥侧

crosschat 的 `--connect` 路径会起一个本地 WS 桥（`127.0.0.1:0`、Bearer 校验用 `timingSafeEqual`）。代码顺序很关键（`src/codex/session-events.ts:23-34`）：

1. 先 `open()` 打开**共享 owner**（失败则 `startInstalledCodexOwner` 再开一次）；
2. **之后**才生成每窗口 token（`randomBytes(32)`）；
3. `session-events.ts:106-107` 把 `--remote <url> --remote-auth-token-env CROSSCHAT_CODEX_WINDOW_TOKEN` 与 `CROSSCHAT_CODEX_WINDOW_TOKEN: token` **只交给被 spawn 的 TUI 客户端子进程**；
4. 桥拦截 `thread/start|resume|fork|turn/start` 的响应，得到 window→thread。

因此已证实的链条只有：**窗口 token → 桥连接（认证）→ 选定 thread**。桥对 owner 是认证与透明转发，**不是向 owner 注入 shell/Hook 环境**；token 在 owner 打开之后才生成，owner 的进程环境里没有它。

**窗口 token → 共享 owner 的 shell/Hook 环境：尚未证实，且不能由客户端 env 推出。** owner 自己派生 shell（app-server 执行路径）时，那个 shell 继承的是 owner 的环境，不是 TUI 客户端的环境。显式传递（例如让 owner 接收一个 per-window 标识并注入 shell 环境）是否可行，仍须研究其 API 与生命周期；本单不宣称不可能，也不宣称可行。

失效与未测：`reportLauncherFailure` 后回退原生启动（无桥）；同 thread 被第二个 CLI/Desktop 打开后窗口记录变成"曾"；`turn/steer` 不产生新窗口记录；用户自己的 `codex` shell 完全不覆盖。**证据等级：源码确定 + 仓库实现已读；未做真实受控连接实测。** 即使将来在 TUI 客户端 env 里观察到 token，也不等于执行端 shell 有 token——要证明后者，必须在 owner 派生的 shell 里直接观察。

### B. 执行实例指纹＋进程链 —— 本机 Desktop 正向可判，CLI 未采样；只能给候选

本机安装布局与进程拓扑（`topology-20261029.json`，已脱敏；该文件是一次进程表快照，**不含 shell 采样**）：

- Desktop：`ChatGPT.exe` 14368 → `codex.exe` 24716（形状 `desktop-bundle`，路径形如 `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`）→ `codex-code-mode-host.exe` 3240。
- CLI：npm `codex-cli 0.163.0` → `node.exe` 跑 `@openai/codex/bin/codex.js` → 原生体 `@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe`（形状 `npm-native`）。
- 本机**没有** app-server daemon 在跑：`~/.codex/app-server-daemon/daemon.pid` 是 121 小时前的陈旧记录，其中 pid 已死（`pidAlive:false`），但文件带着 `{pid, processStartTime, executableIdentity:{digest, path_digest}}`——这是上游自己发布的**唯一**实例指纹格式，只覆盖 daemon 执行体，本单未实测其运行态。

判据必须从 shell 向外逐层走，**最近的 codex 进程说了算**：

- 遇到已知包装器（`codex-command-runner.exe`、`codex-windows-sandbox-setup.exe`）跳过；
- 遇到已知执行体形状（`desktop-bundle` / `npm-native`）→ 看它的父进程形状（父是 `ChatGPT.exe` → Desktop；父是 `node.exe` → CLI）；
- 遇到**名字像 codex 但形状未知**的进程（如 root 重放的 `D:/portable/codex.exe`，形状 `other`）→ **立即判 `unknown`**，不得越过它去选更远的已知祖先。首轮 `classifyEntry` 用 `findIndex` 找第一个"已识别形状"，正好会越过这类更近的未知执行体，已改为逐层扫描并在第一个 codex 进程处决策。

实例元数据必须齐全才算候选：执行体与其父都要有 `pid + 创建时间 + 路径摘要`。创建时间缺失/非有限（root 重放：Codex 与父应用 `createdAt=0` 仍被判 desktop）→ 判 `unknown / incomplete-instance-metadata`，保留原始事实供诊断。`parseProcessTable` 现在丢弃 `NaN`/`Infinity`/非正数，统一记 0。

**路径摘要是路径字符串的摘要，不是文件身份校验。** 它只能记录"看到过这个路径"，不能防同名替身——要防替身需要文件内容摘要或 Authenticode 签名者，并与可信参考核对；本单没做，也没有采样后的存活/代次重核。首轮"路径散列（防同名替身）""逐次三元组验证已经实现"两句撤回，改为：**三元组是拒绝陈旧记录的必要条件，不是充分条件。**

**证据等级：安装布局与进程拓扑已原生验证；Desktop shell 正向链由 root 两次原生采样验证（见第四节）；CLI shell 没有正样本。**

失效条件：shell 由 daemon 派生时最近执行体是 daemon，链上不再有窗口信息（同 daemon 多窗口不可分）；执行体退出后补采只剩孤儿链；Windows 上非提权读 `ExecutablePath` 可能为空，形状退化成 `unknown`；沙箱/EDR 可能拒绝进程表读取。以上任一情况都**只能报 `unknown`**。

### C. 逐调用原生 Hook —— 只能补"本次调用"

见 1.2。它能给的：`tool_use_id`、`turn_id`、`session_id`、`cwd`、`transcript_path`。它给不了的：入口类型（没有字段，环境是会话快照，祖先链与 shell 同源）。

因此 Hook 不是"来源"路线的替代，而是**"本次调用"的补强**。Hook 的会话快照来自 owner 执行端，与 TUI 客户端 env 无关，**不能假设快照里有桥凭据**。它要求用户配 hooks，属于需要用户决定的事项；且 fail-open 意味着"没收到 Hook"不能当"没执行"。Hook 侧 `tool_use_id` 与 shell 侧 `CODEX_TOOL_CALL_ID` 是否同一个 call，未实测——这是当前最接近"独立关联"的候选（见第五节）。

### D. Desktop owner 对账 —— 本次响应未暴露进程锚点

见 1.4。一次 `initialize` 响应没有进程锚点；route D 未核实，私有接口与维护成本未评估。本单不研究全部内部接口，也不向上游发需求。

## 三、必要反例逐条

| 反例 | 结论 | 依据 |
|---|---|---|
| 同一 ID 在 CLI/Desktop 同时存在 | **不能靠 ID 判来源**：`CODEX_THREAD_ID` 两边都可能是同一个值 | 原生字段不含入口；`state_5.sqlite.source` 没有 `desktop` 值，`originator` 是自报标签 |
| Desktop 启动嵌套 CLI | 最近执行体是 npm 体 → 可判 CLI；"链上有 Desktop 祖先"的写法会误判 Desktop | 本机拓扑 + `classifyEntry` 逐层扫描 |
| 更近的未知 codex 执行体 | **必须判 `unknown`**：root 重放 `probe → pwsh → D:/portable/codex.exe → pwsh → desktop bundle → ChatGPT`，首轮实现返回 desktop | R1 fixture `portableChain`，RED→GREEN 已记录 |
| 同 daemon 多窗口 | **不可分**：两个窗口的 shell 祖先链完全相同 | daemon 是执行体，窗口只是连接；本机当前无 daemon 在跑，未实测 |
| 旧 originator 标签 | 不可当证据 | `originator` 自报且可覆盖；分布 `Codex Desktop` 113 / `codex-tui` 52 / `(null)` 26 / `codex_exec` 16 / `crosschat` 2 / `codex_work_desktop` 2 |
| PID 重用 | 两侧创建时间都在时可用 `creation-order` 拒绝；缺时间则无法判断 | `traceAncestry` 的 `creation-order` 停止条件；`incomplete-instance-metadata` |
| 实例重启 | 旧 pid+创建时间记录必须失效 | 指纹三元组是必要条件，非充分条件 |
| 持续 exec / `write_stdin` | `CODEX_TOOL_CALL_ID` 不随 `write_stdin` 更新 | 唯一注入点 `process_manager.rs:1478`，spawn 期 |
| Hook 缺失或迟到 | 可能 fail-open，执行继续但无登记 | `FailedContinue` 语义；未实测 |
| 关键元数据缺失 | 形状可读也不得升级 | root 重放 `createdAt=0`；R1 fixture `missingMetadataChain` |

## 四、证据分类与本机实测

本单的证据分四类，报告不再混用：

1. **安装布局（路径形状）**：两个执行体的路径形状规则，来自本机路径 + `pathShape` 单测。
2. **版本观察**：本机 CLI 运行体 `codex-cli 0.163.0`；root 采样的 Desktop 运行体 `CODEX_VERSION = 0.165.0-alpha.1.2`。**源码固定 commit 是 0.163.0，与 0.165.0-alpha.1.2 的运行体分开计**，不把 0.163 的源码结论直接当 0.165 的运行事实。
3. **进程拓扑**：`topology-20261029.json`，一次进程表快照 + 磁盘上的 thread/daemon 记录，**没有 shell 采样**。
4. **真实 shell 采样**：只有 root 的两条 Desktop 记录，见下。

root 原生采样（原始脱敏记录：`docs/development/evidence/c14-worker-20261029/W01-root-probe.json`，本单不改写其字段）：

- 同一 Desktop thread 内两次普通 `exec_command`，`login:false`，无自定义环境，探针均退出 0。
- 两次祖先链一致：`node.exe(探针) ← pwsh.exe ← codex.exe 24716 [desktop-bundle] ← ChatGPT.exe 14368 [app]`，`stopReason: missing-parent`（`ChatGPT.exe` 的父进程不在表内）。
- `CODEX_THREAD_ID` / `CODEX_SESSION_ID` 摘要相同（`165ee6b0`），`CODEX_TOOL_CALL_ID` 摘要不同（`d186a709` / `88204fb1`）。
- 环境里另有 16 个 `CODEX_*` 变量（`CODEX_APP_RUNTIME_CLI_PATH`、`CODEX_INTERNAL_ORIGINATOR_OVERRIDE`、`CODEX_APP_TOOLS_PIPE_PATH`、`CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY` 等），均不匹配 KEY/SECRET/TOKEN 模式；没有 `CROSSCHAT_*` 变量。

**这批变量是闭源 Desktop 侧的实现细节，不是契约**：它们可继承、可伪造，只能当旁证，不能当来源证据；本单不据此接产品 Provider。

R1 探针返修（提交 `c38a809`）由 root 独立复跑：定向 `npx vitest run test/codex-caller-source-probe.test.ts` 为 14/14；完整 `npm run check` 在基线 `c38a809` 上为 2447 passed / 11 原有 skipped，229 files passed / 3 skipped。R2 只改本报告，未重跑这些检查。

本机负样本（`probe-negative-control.json`）：非 Codex shell 里 `verdict: unknown / no-codex-ancestor`，`env: []`。

未实测：CLI shell 正向采样；共享 daemon；Hook 实际触发；真实受控 `--connect` 的窗口记录；IPC owner 对账；第二 thread；同 thread 双开；Linux/macOS（本探针明确不支持）。

## 五、下一单建议

**前提**：本单不批准把候选形状直接移植进生产 Provider。下一单也必须先回答"本次 call ↔ 执行实例"的独立证据问题，而不是把形状与同一环境的 thread 相交就升为已识别来源。

**本单与下一单的边界**：当前可实施的只有**隔离诊断/证据采集**——只输出事实（祖先链、形状、元数据是否齐全、环境摘要），最多标注 `candidate`，不返回 `identified`，不接 `providers.ts`，不触发 `service.ts` 对 `identified + sourceTool` 的自动补分类。生产接线保持**未批准**。

**仍然缺什么（按可验证性排序）**：

1. **本次 call ↔ 实际执行实例。** 当前所有"thread 一致"都来自同一个环境，不是独立证据。最接近的候选是 Hook 侧 `tool_use_id` 与 shell 侧 `CODEX_TOOL_CALL_ID` 是否相等——未实测。只有拿到"执行体自己登记的 call 标识"与"shell 环境里的标识"相交，才算独立。
2. **执行实例 ↔ 入口（CLI/Desktop）。** 进程形状只说明安装布局；Desktop 侧还缺 owner↔OS 进程绑定（`initialize` 响应无锚点），CLI 侧还缺正向采样。
3. **共享 daemon 场景。** 同 daemon 多窗口的 shell 链不可分，需要 daemon 运行态实测。
4. **A 路线的跨进程传递。** 窗口 token 在 TUI 客户端 env 里，owner 派生 shell 时继承的是 owner 环境；显式传递是否可行需研究 owner 的 API 与生命周期。

**因此下一单（需 root 批准）**：

- 允许：新增只读证据采集器（可把本单的 `parseProcessTable` / `traceAncestry` / `classifyEntry` 移植到 `src/codex/process-ancestry.ts`，或先留在 `scripts/`），输出 `candidate` 与理由码，不参与任何判定。
- 需要先完成的验证：①Hook `tool_use_id` ↔ `CODEX_TOOL_CALL_ID` 实测；②owner↔pid 绑定或等价的独立锚点；③daemon 运行态。
- **不批准**：在①②③完成前，任何"形状 + 元数据 + thread + 窗口凭据即返回 `identified`"的 Provider 配方。`service.ts` 会对 `identified + sourceTool` 自动补分类，所以只删掉 "verified" 一词并不能防止误用。
- 保留的边界规则（仅用于诊断输出）：逐层扫描、遇到未知 codex 进程即停、元数据不全即 `unknown`。
- **需要用户决定**：是否接受"来源判定依赖本机进程表"；是否推进 route C（需要配 hooks）；是否值得研究 A 路线的显式跨进程传递（需要 owner 侧 API，成本未评估）。

## 六、探针（研究工具，不接产品路径）

`scripts/codex-caller-source-probe.mjs` 本版变更：

- **仅 Windows**：Linux/macOS 返回 `platform-unsupported`；移除了首轮无界的 `/proc` 全量扫描（它不遵守超时/字节上限）。产品平台支持与三平台 CI 未变。
- **退出码合同**：读到进程表 → 退出 0；`unavailable` 是诊断结果 → 退出 2。不把退出 0 写成"探测成功"。
- **分类边界**：逐层扫描，遇到未知 codex 执行体立即 `unknown`；关键元数据缺失 → `unknown / incomplete-instance-metadata`。
- **字段更名**：`defaultExcluded` → `matchesDefaultExcludePattern`，语义是"名字匹配可选过滤模式"，不是"已被排除"。root 的 `W01-root-probe.json` 保留旧字段名，属于历史捕获，不改写。

`test/codex-caller-source-probe.test.ts`：14 项，全部使用合成表或注入读取器；不再读真实宿主进程表、不再依赖 1ms 时序。失败映射用注入的拒绝验证（`table-timeout` / `table-too-large` / `table-unreadable` / `platform-unsupported`）。

## 七、清理与遗留

- 首轮临时目录 `.c14-w01-probe/` 已删除（删前核对绝对路径与归属）。
- 未安装/卸载任何软件，未启停用户 Desktop，未改全局配置，未接生产远端，未做真实模型调用。
- 未跟踪的 `docs/代码消息投递.md` 保持原样，未 stage。
- 遗留：本报告、探针与 `docs/research/evidence/c14-codex-source-20261029/` 四份文件保留，作为下一单的验收基座。

## 八、复现

```
node scripts/codex-caller-source-probe.mjs            # 任意 Windows shell，输出脱敏 JSON
node D:/workspace/CC/multichat/scripts/codex-caller-source-probe.mjs   # 在 Codex Desktop/CLI 的 shell 里跑
npx vitest run test/codex-caller-source-probe.test.ts
```

## 九、精确源码定位

固定源码一律指 commit [`83086188ae0614bd882818ff1aa23f3194962012`](https://github.com/openai/codex/tree/83086188ae0614bd882818ff1aa23f3194962012)（`rust-v0.163.0`）。

| 事实 | 位置 |
|---|---|
| 默认排除仅在 `ignore_default_excludes=false` 时套用 | [`codex-rs/protocol/src/shell_environment.rs#L138-L146`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/protocol/src/shell_environment.rs#L138-L146) |
| `ignore_default_excludes` 配置转换默认 true | [`codex-rs/config/src/shell_environment_policy.rs#L136`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/config/src/shell_environment_policy.rs#L136) |
| `set` 在过滤之后、`include_only` 之前 | [`codex-rs/protocol/src/shell_environment.rs#L153-L163`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/protocol/src/shell_environment.rs#L153-L163) |
| `CODEX_TOOL_CALL_ID` 唯一注入点 | [`codex-rs/core/src/unified_exec/process_manager.rs#L1478`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/unified_exec/process_manager.rs#L1478) |
| 非 unified-exec 路径复用同一策略 | [`codex-rs/core/src/exec_env.rs#L32-L37`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/core/src/exec_env.rs#L32-L37) |
| Hook 无入口字段 | [`codex-rs/hooks/src/events/pre_tool_use.rs`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/hooks/src/events/pre_tool_use.rs) |
| Hook 环境为会话快照 | [`codex-rs/hooks/src/engine/command_runner.rs`](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/hooks/src/engine/command_runner.rs) |

本仓库实现（当前分支 `codex/core-refactor-pre-tui`）：

| 事实 | 位置 |
|---|---|
| 先开共享 owner、后生成窗口 token | `src/codex/session-events.ts:23-34` |
| token 只写入 TUI 客户端子进程 env | `src/codex/session-events.ts:106-107` |
