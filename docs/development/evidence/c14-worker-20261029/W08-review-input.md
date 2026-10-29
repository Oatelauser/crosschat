# C14-W08 交付与受控验证输入

2026-10-29（UTC+8）。执行者 `cworker1`（本机 Claude），root 分发/原生采样/独立验收。仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，起始 HEAD `82f09a488c67b3d8ea46d7f179dbf82b9432af83`（与正式派单一致）。本单无 checkout/pull/reset/clean/stash/amend/push；原未跟踪 `docs/代码消息投递.md` 未改、未 stage；`src/**`、`test/**`、skills、package、W01/W03/W05/W07 与既有证据均未改。

**尚未实施产品，未接 `identified`/`association`，生产仍为 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED`。真实 Desktop 采样待 root 执行（`NEED_ROOT_PROBE` 已发）。**

## 1. 交付文件

| 文件 | 作用 |
| --- | --- |
| `docs/development/evidence/c14-worker-20261029/W08-probe.mjs` | 只读探针：取本机管道 server PID、比对 shell 祖先链、可选只读取 logical ownerId |
| `docs/development/evidence/c14-worker-20261029/W08-probe-check.mjs` | 受控检查：本机合成管道 + 合成进程表 + 假 Desktop hub；不读用户进程表 |
| `docs/development/evidence/c14-worker-20261029/W08-result.json` | 受控检查结果（`wx` 新建，9/9 通过） |
| `docs/development/evidence/c14-worker-20261029/W08-review-input.md` | 本文件 |
| `docs/research/c14-desktop-os-source-anchor-20261029.md` | 结论与研究边界 |

`W08-root-probe.json` 由 root 留存，worker 不写。

## 2. 探针做什么（只读、有界）

1. **server PID**：一个 `powershell.exe` 子进程跑内嵌 C#，用 `WaitNamedPipeW`（3s 上限）→ `CreateFileW`（只连接）→ `GetNamedPipeServerProcessId` → `CloseHandle`。不发任何业务帧。
2. **逻辑 owner**（仅 `--owner`）：复用 `dist/codex/desktop-ipc.js` 的 `openDesktopThread`，只发 `initialize` 与 `thread-owner-discovery`，取 `ownerId` 后 `close()`；不 snapshot、不 subscribe、不 start/steer/rename/resume。
3. **祖先链**：复用 W01 已验收的 `scripts/codex-caller-source-probe.mjs` 的 `readProcessTable`（`Win32_Process`，10s 上限）与 `traceAncestry`。
4. **收口**：`Add-Type` 编译用的临时根建在系统 TEMP 下 `w08-pipe-*`（`mkdtempSync` 独占），`finally` 中核对解析后父目录等于 `os.tmpdir()`、名称前缀匹配后递归删除。

导出纯函数供受控检查：`pipeNameOf`、`sameInstance`、`compareAnchors`、`queryPipeServer`、`readOwner`、`redactMessage`。模块被 import 时不连任何管道（只在直接运行时探测）。

## 3. 受控检查实际结果（`node W08-probe-check.mjs`）

全部使用本机合成管道、合成进程表与假 Desktop hub；**未读用户进程表、未连真实 `codex-ipc`、未碰 `~/.crosschat`、未试发**。

| # | 问题 | 实际观察 | 判定 |
| --- | --- | --- | --- |
| C1 | 能否返回创建该管道服务实例的进程 PID？ | `serverPid` = 检查进程自身 PID（25052/26740/8136 三轮一致），`cleanup {created:true,removed:true}` | 通过 |
| C2 | 管道不存在是否报 absent 而不是空成功？ | `{ok:false,stage:"wait",errorKind:"absent",nativeError:2}` | 通过 |
| C3 | 取到 PID 后是否关闭自己的连接？ | 服务端 `accepted:1`、`open:0`（400ms 后仍为 0） | 通过 |
| C4 | 唯一实例被占时是否按截止失败而不是挂住？ | 单实例原生服务端 + 先占一个连接后，探针 `{errorKind:"timeout",nativeError:121}`，耗时 3350ms（= 3s 连接上限 + 启动） | 通过 |
| C5 | 实例比较是否拒绝 PID 复用与残缺元数据？ | 同 pid 同创建时间→`same:true`；同 pid 不同创建时间→`pid-reused`；缺创建时间→`missing-creation-time`；不同 pid→`different-pid`；缺一侧→`missing-metadata` | 通过 |
| C6 | OS 锚点能否区分同实例、仅共同祖先、无关、不可核实？ | `same-process` / `server-is-ancestor`(depth 1) / `shared-ancestor-only` / `unrelated` / `unverifiable(server-pid-not-in-process-table)` / 无 PID→`unverifiable` | 通过 |
| C7 | 已存在的 `--out` 是否在开管道前拒绝？ | 退出 3，原文件字节仍为 `sentinel-bytes` | 通过 |
| C8 | 管道路径能否归一为管道名？ | `\\.\pipe\codex-ipc` → `codex-ipc`；裸名不变；空串→空 | 通过 |
| C9 | owner 发现是否只发两个只读方法、且不泄露 ownerId？ | 模拟 hub 记录到 `["initialize","thread-owner-discovery"]`；`owner {known:true,namespace:"client-id",length:10,digest:…,osPidEquivalent:false}`；报告中不出现 `fake-owner` 原文 | 通过 |

结果文件：`W08-result.json`（`wrote:true`，`passed:9`，`failed:0`）。再次以同一 `--out` 运行 → 退出 3、内容未覆盖。

## 4. 检查与实测输出

| 检查 | 命令/方法 | 结果 |
| --- | --- | --- |
| 语法 | `node --check` 两个脚本 | 通过 |
| 受控检查 | `node docs/development/evidence/c14-worker-20261029/W08-probe-check.mjs` | 退出 0；9/9 通过 |
| 缺管道探针 | `node W08-probe.mjs --pipe <随机名> --no-table` | 退出 0；`errorKind:"absent"` |
| 缺 `CODEX_THREAD_ID` | `node W08-probe.mjs --pipe <随机名> --no-table --owner` | 退出 0；`owner {requested:true,known:false,reason:"CODEX_THREAD_ID absent"}` |
| 输出保护 | 对同一路径二次 `--out` | 退出 3，未覆盖 |
| 临时残留 | 检查 `%TEMP%/w08-pipe-*`、`%TEMP%/w08-check-*` | 均为 none；每次运行 `cleanup.removed:true` |
| 差异 | `git diff --check` | 见提交说明 |

按任务书未跑全量 `npm run check`（纯研究探针，不改 `src`/`test`）；最近产品基线仍为 2503 通过/11 原有跳过。未做文案字符串测试。

## 5. 范围、清理与归属

- 本机仅 Windows 验证；Linux/macOS 未测，也不改产品平台支持。
- 受控检查起的两个 `powershell.exe` 子进程（忙管道服务端、探针内）均在 `finally` 中 `kill`；每次探测的临时根均已删除。
- 未安装/升级/卸载任何工具，未改 Hook/config/注册表，未起停 Desktop/daemon，未改原生配置或 auth。
- 未向真实 `codex-ipc` 发送任何请求；工具管道未接（本单只在探针里留了 `pipeNameOf` 归一，未开 tools pipe 分支）。

## 6. 未决与缺口

1. **真实 Desktop 采样未做**：`NEED_ROOT_PROBE` 已发，等 root 在当前真实 Desktop shell 执行后据实收口。
2. **`--owner` 的真实接线只在假 hub 上验证过**：协议侧走的是已验收 `openDesktopThread`，但真实 hub 的应答仍待 root 那次运行确认。
3. **管道可能是共享 hub**：即使 server PID 命中 shell 祖先，也只证明"服务该管道的是本实例"，不证明"逻辑 owner 是这个 OS 进程"。ownerId 是 client-id 命名空间，与 PID 不同域，本单不做等同。
4. **工具管道未纳入**：`CODEX_APP_TOOLS_PIPE_PATH` 的 OS peer 可另测，但路径继承不证明本次调用用过它，本单不据此升级结论。
5. 多窗口、daemon、双开、三平台不在本单范围。
