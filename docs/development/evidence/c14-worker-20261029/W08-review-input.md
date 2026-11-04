# C14-W08 交付与受控验证输入

2026-10-29（UTC+8）。执行者 `cworker1`（本机 Claude），root 分发/原生采样/独立验收。仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，起始 HEAD `82f09a488c67b3d8ea46d7f179dbf82b9432af83`（与正式派单一致）。本单无 checkout/pull/reset/clean/stash/amend/push；原未跟踪 `docs/代码消息投递.md` 未改、未 stage；`src/**`、`test/**`、skills、package、W01/W03/W05/W07 与既有证据均未改。

**尚未实施产品，未接 `identified`/`association`，生产仍为 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED`。** 真实 Desktop 采样已由 root 执行（`W08-root-probe.json`，SHA256 `5557f812f83d8edbb3c5f61410b59f0e2274aac9c9605f76393985f7e1794238`，worker 未改其字节），但那次跑的是第一版探针，**PID 只有先后两次匹配观察，不等于实例核验**；见 §7。

本轮（轮次二）按 root 收口意见做了三处修订，改动都在白名单内：实例核验真正接入（§2.5）、子进程 TEMP 与错误路径脱敏（§2.6）、受控检查的收尾与删除前置校验（§2.7）。修订前的受控结果 `W08-result.json` 原样保留（SHA256 `a5b9bd084c71e8d500bf99cb3abfcb405d4e34f333bcf3414220ffd8df7fefee`），本轮输出写到新文件 `W08-result-b.json`。

## 1. 交付文件

| 文件 | 作用 |
| --- | --- |
| `docs/development/evidence/c14-worker-20261029/W08-probe.mjs` | 只读探针：取本机管道 server PID、比对 shell 祖先链、可选只读取 logical ownerId |
| `docs/development/evidence/c14-worker-20261029/W08-probe-check.mjs` | 受控检查：本机合成管道 + 合成进程表 + 假 Desktop hub；不读用户进程表 |
| `docs/development/evidence/c14-worker-20261029/W08-result.json` | 第一版受控检查结果（`wx` 新建，9/9 通过），保留不改 |
| `docs/development/evidence/c14-worker-20261029/W08-result-b.json` | 轮次二修订后的受控检查结果（`wx` 新建，9/9 通过） |
| `docs/development/evidence/c14-worker-20261029/W08-review-input.md` | 本文件 |
| `docs/research/c14-desktop-os-source-anchor-20261029.md` | 结论与研究边界 |

`W08-root-probe.json` 由 root 留存，worker 只读、不写、未 stage。

脚本 SHA256：`W08-probe.mjs` = `b924194a8a6ee3371f90ef6843f64911cae390e78e33984028217b5c73b16681`；root 那次真实采样用的是第一版（SHA `300ba1036e26ab3faffa19ae14cc3bc3f4651b71fe47d54dbcaa3b4c5ff91b70`）。

## 2. 探针做什么（只读、有界）

1. **server PID**：一个 `powershell.exe` 子进程跑内嵌 C#，用 `WaitNamedPipeW`（3s 上限）→ `CreateFileW`（只连接）→ `GetNamedPipeServerProcessId` → `CloseHandle`。不发任何业务帧。
2. **逻辑 owner**（仅 `--owner`）：复用 `dist/codex/desktop-ipc.js` 的 `openDesktopThread`，只发 `initialize` 与 `thread-owner-discovery`，取 `ownerId` 后 `close()`；不 snapshot、不 subscribe、不 start/steer/rename/resume。
3. **祖先链**：复用 W01 已验收的 `scripts/codex-caller-source-probe.mjs` 的 `readProcessTable`（`Win32_Process`，10s 上限）与 `traceAncestry`。
4. **收口**：`Add-Type` 编译用的临时根建在系统 TEMP 下 `w08-pipe-*`（`mkdtempSync` 独占），`finally` 中核对解析后父目录等于 `os.tmpdir()`、名称前缀匹配后递归删除。
5. **实例核验（轮次二接入）**：`GetNamedPipeServerProcessId` 之后立刻用 `Win32_Process.CreationDate.ToFileTimeUtc()` 采该 PID 的创建时间（**与祖先表同源**），写进 `query.serverCreatedAt`。`compareAnchors` 先要 `sameInstance(pid + 创建时间, 表行)` 成立才给关系；同 PID 不同创建时间判 `pid-reused-between-pipe-query-and-process-table`，缺创建时间判 `server-instance-metadata-incomplete`，一律 `unverifiable`。
6. **子进程 TEMP 与错误脱敏（轮次二）**：`execFile` 显式带 `TEMP`/`TMP` = 本次独占临时根，`Add-Type` 的编译产物落在自己的根里而不是宿主 TEMP。`queryPipeServer` 的 spawn 失败 `detail`、不可解析 stdout 都过 `redactMessage`（绝对路径替换为 `<path>`，截断 200 字符）。
7. **受控检查的收尾（轮次二）**：忙管道子进程的 `kill()` 后等它自己的 `close`；C7 删除临时根前先核对父目录与 `w08-check-` 前缀。

导出纯函数供受控检查：`pipeNameOf`、`sameInstance`、`compareAnchors`、`queryPipeServer`、`readOwner`、`redactMessage`。模块被 import 时不连任何管道（只在直接运行时探测）。

## 3. 受控检查实际结果（`node W08-probe-check.mjs`）

全部使用本机合成管道、合成进程表与假 Desktop hub；**未读用户进程表、未连真实 `codex-ipc`、未碰 `~/.crosschat`、未试发**。

| # | 问题 | 实际观察 | 判定 |
| --- | --- | --- | --- |
| C1 | 能否返回创建该管道服务实例的进程 PID 与创建时间，且与祖先表可比？ | `serverPid` = 检查进程自身 PID（15244 / 46840 两轮一致），`serverCreatedAt` 与另一次独立 CIM 读取逐位相等（`agreesWithAncestorTable:true`，如 `134377400116849630`），`cleanup {created:true,removed:true}` | 通过 |
| C2 | 管道不存在是否报 absent 而不是空成功？ | `{ok:false,stage:"wait",errorKind:"absent",nativeError:2}` | 通过 |
| C3 | 取到 PID 后是否关闭自己的连接？ | 服务端 `accepted:1`、`open:0`（400ms 后仍为 0） | 通过 |
| C4 | 唯一实例被占时是否按截止失败而不是挂住？ | 单实例原生服务端 + 先占一个连接后，探针 `{errorKind:"timeout",nativeError:121}`，耗时 3350ms（= 3s 连接上限 + 启动） | 通过 |
| C5 | 实例比较是否拒绝 PID 复用与残缺元数据？ | 同 pid 同创建时间→`same:true`；同 pid 不同创建时间→`pid-reused`；缺创建时间→`missing-creation-time`；不同 pid→`different-pid`；缺一侧→`missing-metadata` | 通过 |
| C6 | OS 锚点能否区分同实例、仅共同祖先、无关、不可核实？ | 带创建时间的合成表：`same-process` / `server-is-ancestor`(depth 1) / `shared-ancestor-only` / `unrelated`；同 PID 不同创建时间→`unverifiable(pid-reused-between-pipe-query-and-process-table)`；缺创建时间→`unverifiable(server-instance-metadata-incomplete)`；表里没有→`unverifiable(server-pid-not-in-process-table)`；无 PID→`unverifiable` | 通过 |
| C7 | 已存在的 `--out` 是否在开管道前拒绝？ | 退出 3，原文件字节仍为 `sentinel-bytes` | 通过 |
| C8 | 管道路径能否归一为管道名？ | `\\.\pipe\codex-ipc` → `codex-ipc`；裸名不变；空串→空 | 通过 |
| C9 | owner 发现是否只发两个只读方法、且不泄露 ownerId？ | 模拟 hub 记录到 `["initialize","thread-owner-discovery"]`；`owner {known:true,namespace:"client-id",length:10,digest:…,osPidEquivalent:false}`；报告中不出现 `fake-owner` 原文 | 通过 |

结果文件：第一版 `W08-result.json`、轮次二 `W08-result-b.json`，均 `wrote:true`、`passed:9`、`failed:0`。同一 `--out` 再跑一次 → 退出 3、内容未覆盖（C7 与手工各验一次）。

## 4. 检查与实测输出

| 检查 | 命令/方法 | 结果 |
| --- | --- | --- |
| 语法 | `node --check` 两个脚本 | 通过 |
| 受控检查 | `node docs/development/evidence/c14-worker-20261029/W08-probe-check.mjs` | 退出 0；9/9 通过 |
| 实例核验跨源一致 | C1 内把 `query.serverCreatedAt` 与另一次 `Win32_Process.CreationDate` 读取相比 | 逐位相等 |
| 错误路径脱敏 | 注入 `run` 造两条故障（spawn 抛含绝对路径的错、stdout 不可解析），看 `detail` | `spawn <path> ENOENT` / `oops at <path>`，两处都不含盘符路径 |
| 缺管道探针 | `node W08-probe.mjs --pipe <随机名> --no-table` | 退出 0；`errorKind:"absent"` |
| 缺 `CODEX_THREAD_ID` | `node W08-probe.mjs --pipe <随机名> --no-table --owner` | 退出 0；`owner {requested:true,known:false,reason:"CODEX_THREAD_ID absent"}` |
| 输出保护 | 对同一路径二次 `--out` | 退出 3，未覆盖 |
| 临时残留 | 检查 `%TEMP%/w08-pipe-*`、`%TEMP%/w08-check-*` | 均为 none；每次运行 `cleanup.removed:true` |
| 差异 | `git diff --check` | 见提交说明 |

按任务书未跑全量 `npm run check`（纯研究探针，不改 `src`/`test`）；最近产品基线仍为 2503 通过/11 原有跳过。未做文案字符串测试。

## 5. 范围、清理与归属

- 本机仅 Windows 验证；Linux/macOS 未测，也不改产品平台支持。
- 受控检查起的 `powershell.exe` 子进程（忙管道服务端、探针内）收尾时 `kill` 并**等它自己的 `close`**；探针子进程的 `TEMP`/`TMP` 指向本次独占临时根，`Add-Type` 编译不落到宿主 TEMP；每次运行的临时根均在核对父目录与名称前缀后删除，`%TEMP%/w08-pipe-*`、`%TEMP%/w08-check-*` 复查为 none。
- 未安装/升级/卸载任何工具，未改 Hook/config/注册表，未起停 Desktop/daemon，未改原生配置或 auth。
- 未向真实 `codex-ipc` 发送任何请求；工具管道未接（本单只在探针里留了 `pipeNameOf` 归一，未开 tools pipe 分支）。

## 6. 未决与缺口

1. **真实采样那次没做实例核验**：root 跑的是第一版探针，只有 `serverPid`，没有 `serverCreatedAt`，所以那次结论只能算"先后两次 PID 匹配观察"，不能称同一实例；轮次二的核验代码只在合成管道上实测过，真实 Desktop 上尚未复跑。
2. **`--owner` 的真实接线已在 root 那次跑通**（`known:true`、`namespace:"client-id"`、`osPidEquivalent:false`），但 ownerId 与 OS PID 仍是不同命名空间，本单不做等同。
3. **管道可能是共享 hub**：即使 server PID 命中 shell 祖先，也只证明"服务该管道的是本实例"，不证明"逻辑 owner 是这个 OS 进程"。
4. **工具管道未纳入**：`CODEX_APP_TOOLS_PIPE_PATH` 的 OS peer 可另测，但路径继承不证明本次调用用过它，本单不据此升级结论。
5. 多窗口、daemon、双开、三平台不在本单范围。

## 7. root 真实采样（`W08-root-probe.json`，第一版探针）

2026-10-29T09:28:10Z，真实 Desktop shell 一次采样，`processTable.ok:true`、`cleanup {created:true,removed:true}`：

| 项 | 值 |
| --- | --- |
| 管道路径 | `\\.\pipe\codex-ipc` |
| server PID | `14368` = `ChatGPT.exe`（`shape:"app"`，exe 摘要 `c183109d3295`） |
| 观察者祖先链 | `node 47768` → `pwsh 31232` → `codex.exe 24716`（`shape:"desktop-bundle"`）→ `ChatGPT.exe 14368`，`stopReason:"missing-parent"` |
| 关系 | `server-is-ancestor`，`depth:3`，`reasons:[]` |
| 逻辑 owner | `known:true`，`namespace:"client-id"`，长度 36，摘要 `bf34358a80e4`，`osPidEquivalent:false` |

**这份数据能说什么**：本机 `codex-ipc` 的服务进程就是当前 shell 祖先链上的 `ChatGPT.exe`（深度 3），不是旁支、也不是"仅共同祖先"；逻辑 owner 是 client-id 字符串，与这个 PID 无等同关系。

**这份数据不能说什么**：那次探针只比了 PID，没有采创建时间，所以**不能排除"查询与读表之间 PID 被复用"**——按本轮标准它属于 `instance-unverified`。真实 Desktop 上要拿到实例核验，需要 root 用修订后的探针复跑一次，输出到新路径（建议 `W08-root-probe-b.json`，`wx` 新建，不覆盖第一次）。
