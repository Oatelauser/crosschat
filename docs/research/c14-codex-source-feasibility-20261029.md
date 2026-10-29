# C14-W01：Codex CLI/Desktop 来源关联可行性与最小探针

2026-10-29（R1 返修版）。仓库 `D:/workspace/CC/multichat`，分支 `codex/core-refactor-pre-tui`。首轮基线 `3aac1c7489efca699d8e6a6dbe83e7aad1673c4c`，首轮提交 `68782c5`；R1 基线 `aa31ce08b42ac84b811003efa0975a2de556924d`（root 审计与原生采样）。本单只回答一个问题：**当前普通 shell 调用，能不能持续、准确地关联到实际执行它的 Codex CLI 或 Desktop 实例。**

结论：**能判定"这个 shell 由哪个可执行文件派生、该文件长什么样"（候选入口），不能判定"这个 shell 一定来自 CLI 或 Desktop 入口"（已核实关联）。** 两者之间缺的是"本次调用 ↔ 执行实例"的独立证据，不是再采一次同样的环境变量。因此 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED` 继续保留。

本版修正首轮两处事实错误（默认环境过滤方向、候选形状当来源证明）和三处过强声称（实例指纹已核验、IPC 全面不可能、Linux 分支有界），并引用 root 的原生采样。**首轮报告与提交保留原样，不因返修改写。**

## 结论摘要

| 路线 | 结论 | 证据等级 | 适用范围 | 主要失效条件 |
|---|---|---|---|---|
| A 受控 CLI 连接＋本次 call | 受限可行 | 源码确定 + 仓库实现已读，未做真实受控连接实测 | 仅 crosschat 自己经 `--connect` 成功建桥、且桥记录了 window→thread 的 CLI 窗口 | 桥回退原生启动；同 thread 被第二个 CLI/Desktop 打开；用户 `shell_environment_policy` 过滤掉桥凭据 |
| B 执行实例指纹＋进程链 | 本机 Desktop 正向可判，CLI 未采样；只能给候选 | 源码确定 + 拓扑原生验证 + root 两次 Desktop shell 原生采样 | 最近的 codex 进程形状可识别、且 pid 与创建时间齐全时 | 更近的未知 codex 执行体；共享 daemon 执行；执行体已退出；沙箱/EDR 拒绝读进程表；关键元数据缺失 |
| C 逐调用原生 Hook | 只能补"本次调用"，补不了"哪个入口" | 源码确定（字段与环境构造），未实测 | 需要 `tool_use_id ↔ turn ↔ thread` 的逐调用登记 | Hook 未配置、迟到、或 fail-open；Hook 环境是会话快照，拿不到入口标识 |
| D Desktop owner 对账 | 本次响应未暴露进程锚点 | 已原生验证一次 `initialize` 响应 | 无（当前观察内无法把 owner 绑到 OS 进程） | 需要更多 IPC/OS 侧观测；本单未研究私有接口 |

一句话给用户：**现在能说的是"这个 shell 派生自一个形状可识别的 codex 可执行文件，且它更像 Desktop 或 CLI 的安装布局"，不能说"这个 shell 一定来自 CLI 或 Desktop 入口，或来自哪一个实例"。**

## 一、复核：原生字段到底能证明什么

### 1.1 环境注入链（固定源码 `rust-v0.163.0`，commit `83086188ae0614bd882818ff1aa23f3194962012`）

shell 的环境由 `populate_env(policy, thread_id)` 按序构造（`codex-rs/protocol/src/shell_environment.rs:105-175`）：

1. 按 `inherit` 取初始集合（默认 `All`，第 113-132 行）；
2. **默认排除**：仅当 `!policy.ignore_default_excludes` 时剔除 `*KEY*` / `*SECRET*` / `*TOKEN*`（第 138-146 行）；
3. 自定义排除（第 148-151 行）；
4. `set` 用户覆盖（第 153-158 行，在过滤之后插入，因此不受第 2/3 步影响）；
5. `include_only` 只保留匹配项（第 160-163 行）；
6. 写入 `CODEX_THREAD_ID`（第 165-168 行）；
7. 剔除不可继承变量（第 170-172 行）。

**首轮在此处判反了方向。** `ignore_default_excludes` 在配置转换处默认 **true**（`codex-rs/config/src/shell_environment_policy.rs:136`：`toml.ignore_default_excludes.unwrap_or(true)`），即**默认不套用** KEY/SECRET/TOKEN 过滤；只有显式设为 `false` 才套用。root 审计同时确认 `protocol/src/config_types.rs` 的 `Default` 也是 true（该文件不在本机固定缓存中，我未直接核对）。由此：

- 名字含 `TOKEN` 的变量（包括 crosschat 的 `CROSSCHAT_CODEX_WINDOW_TOKEN`）**默认可以到达 shell**。首轮"默认到不了、必须改用户配置"的否决撤回。
- 反过来也不能断言"一定可达"：用户若配置了 `exclude` / `include_only` / `ignore_default_excludes = false`，仍会被过滤；`include_only` 是第 5 步，**不能恢复**第 2/3 步已删的值；`set` 虽在第 4 步插入，仍可能被第 5 步 `include_only` 或第 7 步剔除。
- 非 unified-exec 路径同样走这套策略：`codex-rs/core/src/exec_env.rs:32-37` 直接转调 `shell_environment::create_env`。

`CODEX_TOOL_CALL_ID` 的注入点在整个固定源码里**只有一个**：`unified_exec/process_manager.rs:1478`，在进程创建路径上。`write_stdin` 复用已存在的 PTY，不再注入环境（`handlers/unified_exec/write_stdin.rs`），所以长驻进程里看到的 call id 永远是**最初那次 `exec_command`** 的。root 的两次独立 `exec_command` 实测正好对应这一点：同一 thread，`CODEX_TOOL_CALL_ID` 摘要改变（`d186a709` → `88204fb1`），`CODEX_THREAD_ID` / `CODEX_SESSION_ID` 摘要不变（均 `165ee6b0`）。注意这只证明"每次新起进程带一个新的 call id"，不证明"这个 call id 能对回执行实例"。

### 1.2 Hook：有逐调用登记，没有入口字段

`PreToolUseRequest`（`codex-rs/hooks/src/events/pre_tool_use.rs`）字段是 `session_id / turn_id / subagent / cwd / transcript_path / model / permission_mode / tool_name / matcher_aliases / tool_use_id / tool_input`。**没有任何 CLI/Desktop 字段。**

Hook 进程的环境不是继承来的：`command_runner.rs` 用 `env_clear()` 起进程，回放**会话快照**（`runtime.environment`）并过滤不可继承变量。会话快照是 `create_env` 的产物，因此按 1.1 的修正，**会话里有的变量（含桥凭据）默认也在快照里**——首轮"Hook 同样看不到被默认排除的 `*TOKEN*`"一句撤回。但这不改变结论：Hook 仍然拿不到"入口"标识，Hook 进程的祖先链与 shell 同源，多不出一个字节。

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

### A. 受控 CLI 连接＋本次 call —— 受限可行（按 1.1 修正后重新评估）

crosschat 的 `--connect` 路径会起一个本地 WS 桥（`127.0.0.1:0`、Bearer 校验用 `timingSafeEqual`），在 `src/codex/session-events.ts:106-107` 给 TUI 传 `--remote <url> --remote-auth-token-env CROSSCHAT_CODEX_WINDOW_TOKEN`，并把 `CROSSCHAT_CODEX_WINDOW_TOKEN: token` **只写进被 spawn 的 TUI 子进程 env**（不写全局 `process.env`），同时拦截 `thread/start|resume|fork|turn/start` 的响应 → 桥知道"这个窗口选中了哪个 thread"。

按修正后的默认策略，这个 token 会随 TUI 的 `create_env` 进入它 spawn 的 shell。于是出现一条首轮被错误否决的接法：

1. shell 读到 `CROSSCHAT_CODEX_WINDOW_TOKEN`（每窗口一枚，只存在于该 TUI 进程树）；
2. 桥的记录证明该 token 对应哪个窗口、该窗口选中了哪个 thread；
3. shell 的 `CODEX_THREAD_ID` 与该窗口的 thread 一致。

这比"凭据必须改配置才能到 shell"的原判断强得多：token 是**每窗口唯一的秘密**，普通终端里的 `codex` 不会有它。但它仍然只是**下降关系**证据，不是"本次调用"证据：

- token 可继承，TUI 派生的**所有**后代都能读到，无法区分是哪一次 tool call；
- 用户若配置了 `exclude` / `include_only` / `ignore_default_excludes = false`，token 可能被过滤——可达是默认行为，不是保证；
- 同一 thread 被第二个 CLI/Desktop 打开后，桥的 window→thread 记录变成"曾"而不是"是"；
- `reportLauncherFailure` 之后回退原生启动（没有桥、没有 token）；
- 完全不覆盖用户自己在终端敲 `codex` 的 shell；
- 代价：一个 bearer secret 出现在整棵 shell 子树的 env 里（相对现状的增量暴露是"shell 及其后代"）。

**证据等级：源码确定 + 仓库实现已读；未做真实受控连接实测。** 需要一次受控 `--connect` 的 CLI shell 采样才能把"token 确实到达 shell"从源码推断升为实测。

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

因此 Hook 不是"来源"路线的替代，而是**"本次调用"的补强**。按 1.1 修正，Hook 的会话快照**可以**携带桥凭据——所以 A + C 组合存在一条比首轮判断更现实的路径：Hook 侧拿到 `tool_use_id`，shell 侧拿到 token 与 `CODEX_TOOL_CALL_ID`，两边是否同一个 call 仍需实测（见第五节）。它要求用户配 hooks，属于需要用户决定的事项；且 fail-open 意味着"没收到 Hook"不能当"没执行"。

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

本机负样本（`probe-negative-control.json`）：非 Codex shell 里 `verdict: unknown / no-codex-ancestor`，`env: []`。

未实测：CLI shell 正向采样；共享 daemon；Hook 实际触发；真实受控 `--connect` 的窗口记录；IPC owner 对账；第二 thread；同 thread 双开；Linux/macOS（本探针明确不支持）。

## 五、下一单建议

**前提**：本单不批准把候选形状直接移植进生产 Provider。下一单也必须先回答"本次 call ↔ 执行实例"的独立证据问题，而不是把形状与同一环境的 thread 相交就升 `verified`。

**仍然缺什么（按可验证性排序）**：

1. **执行体侧与 shell 侧是否记录同一个 call 标识。** shell 侧的 `CODEX_TOOL_CALL_ID` 与 Hook 侧的 `tool_use_id` 是否相等，未实测。若相等，就是"执行体自己的登记"对"shell 环境"的交叉验证，这才算独立；若不等，需要别的手段。
2. **owner ↔ OS 进程绑定。** 当前 `initialize` 响应没有锚点；需要更多 IPC/OS 观测，未核实。
3. **daemon 场景。** 同 daemon 多窗口的 shell 链不可分，需要 daemon 运行态实测。
4. **候选形状的边界规则**（本单已给出实现与反例）：逐层扫描、遇到未知 codex 进程即停、元数据不全即 `unknown`。

**候选实现**（下一单，需 root 批准后才动 `src/**`）：

- 新增 `src/codex/process-ancestry.ts`：移植 `parseProcessTable` / `traceAncestry` / `classifyEntry`，保持"只报事实、失败即 `unknown`"，Windows 走 `Get-CimInstance`，其他平台 `unavailable`（不猜）。
- 改 `src/application/caller-source/providers.ts` 的 codex 分支：只有 ①最近 codex 进程是已知执行体形状且父形状匹配；②实例元数据齐全（pid+创建时间+路径摘要）；③`CODEX_THREAD_ID` 与本次调用使用的 thread 一致；④（A 路线）桥凭据/窗口记录一致，才返回 `identified` + `scope: 'instance'`；否则原样 `unverified`，理由区分 `no-codex-ancestor` / `unrecognized-codex-executor` / `desktop-bundle-without-app-parent` / `npm-executor-without-node-parent` / `incomplete-instance-metadata` / `executor-gone` / `table-unavailable` / `platform-unsupported`。
- 不改 `service.ts` 门禁、不改确认状态机；`scope: 'instance'` 的既有语义直接复用。
- 验收反例：更近未知执行体 → `unknown`；`createdAt=0` → `unknown`；Desktop 里起嵌套 CLI → CLI；同 daemon 两窗口 → `unknown`；执行体退出后补采 → `unknown`；进程表读不到 → `unknown` 且不抛异常；非 Windows → `unavailable`。
- **需要用户决定**：是否接受"来源判定依赖本机进程表"；是否推进 route C（需要配 hooks）；是否把 route A 的桥凭据接进判定（凭据会出现在 shell 子树的 env 里）。

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

| 事实 | 位置 |
|---|---|
| 默认排除仅在 `ignore_default_excludes=false` 时套用 | `codex-rs/protocol/src/shell_environment.rs:138-146` |
| `ignore_default_excludes` 配置转换默认 true | `codex-rs/config/src/shell_environment_policy.rs:136` |
| `set` 在过滤之后、`include_only` 之前 | `codex-rs/protocol/src/shell_environment.rs:153-163` |
| `CODEX_TOOL_CALL_ID` 唯一注入点 | `codex-rs/core/src/unified_exec/process_manager.rs:1478` |
| 非 unified-exec 路径复用同一策略 | `codex-rs/core/src/exec_env.rs:32-37` |
| Hook 无入口字段 | `codex-rs/hooks/src/events/pre_tool_use.rs` |
| Hook 环境为会话快照 | `codex-rs/hooks/src/engine/command_runner.rs` |
