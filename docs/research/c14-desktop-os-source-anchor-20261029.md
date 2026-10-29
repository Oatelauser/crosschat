# C14 Desktop 本机连接的 OS 进程锚点

2026-10-29（UTC+8）。C14-W08 研究单。branch `codex/core-refactor-pre-tui`，起始 `82f09a488c67b3d8ea46d7f179dbf82b9432af83`。本单不改产品、不配置 Hook、不安装软件、不起停 Desktop/daemon、不新增常驻组件、不试发。交付为最小只读探针 + 受控验证 + 一次 root 真实采样。

背景：短柄恢复暂不继续（用户已定"不新增运行状态文件"），本单回到 C14 来源识别主线，不重做 W01/W05 的全景研究。

## 一、结论先行

1. **拿得到 OS 级锚点。** Windows 内核直接返回管道服务进程 PID：`WaitNamedPipeW` → `CreateFileW` → `GetNamedPipeServerProcessId`。在本机自建管道上实测返回的正是创建者进程 PID（C1），不存在时是 `absent`/native 2（C2），唯一实例被占时是 `timeout`/native 121 且在 3s 截止内失败（C4），取到后句柄立即关闭、服务端连接数回落到 0（C3）。
2. **锚点回答的是"谁在服务这个管道"，不是"谁是逻辑 owner"。** `thread-owner-discovery` 返回的 ownerId 是 client-id 命名空间的字符串，与 PID 不同域。受控检查记录到探针只发了 `initialize` 与 `thread-owner-discovery` 两个只读方法，且报告里只留 ownerId 的长度与摘要（C9）。**任何"server PID = owner PID"的说法都是越界。**
3. **祖先关系要分三档，不能只判"是不是祖先"。** 同一进程快照里 server PID 出现在 shell 祖先链上 → `server-is-ancestor`（活进程不可能共用 PID，管道服务端随进程消亡，这条推断成立）；只在更上层汇合 → `shared-ancestor-only`（共同来源，不是同一实例）；否则 `unrelated`；元数据不全或 PID 不在表里 → `unverifiable`（C6）。**PID 复用由创建时间挡**：取到 server PID 后立刻用与祖先表同源的 `Win32_Process.CreationDate` 采该 PID 的创建时间，同 PID 不同创建时间判 `pid-reused`，缺创建时间一律 `unverifiable`——只匹配 PID 不算代次核验（C5/C6）。
4. **真实 Desktop 采样拿到了，但只到"PID 匹配观察"这一档。** `\\.\pipe\codex-ipc` 的 server PID `14368` 就是当前 shell 祖先链上的 `ChatGPT.exe`（`node 47768 → pwsh 31232 → codex.exe 24716 → ChatGPT 14368`，`depth:3`，`server-is-ancestor`）；逻辑 owner 是 36 位 client-id，摘要 `bf34358a80e4`，与 PID 不同域。**那次跑的是第一版探针，没采创建时间，按本单标准属 `instance-unverified`**，不能称同一实例已核验。

## 二、问题与测量方法

W01 观察过 Desktop shell 的祖先链，W05 验证过受控 CLI 的 Hook/call ID 对应，但两者都没有一个**独立于环境变量和继承标签**的 OS 实例锚点。本单要补的正是这一格：本机管道由哪个 OS 进程创建。

测量只用三条只读手段，全部有界：

- **管道服务 PID**：`WaitNamedPipeW`（连接等待 3s）→ `CreateFileW`（只连接，ID 为 `GENERIC_READ`）→ `GetNamedPipeServerProcessId` → 立即按该 PID 读 `Win32_Process.CreationDate` 取创建时间 → `CloseHandle`。不写帧、不读帧。创建时间刻意走**与祖先表相同的来源**：`GetProcessTimes` 与 WMI 的 `CreationDate` 实测相差 20 个 FILETIME 单位（约 2µs），跨源逐位比较不成立，同源才对得上。
- **祖先链**：复用 W01 已验收的 `readProcessTable`（`Win32_Process`，10s 上限）与 `traceAncestry`，拿到 PID/父 PID/创建时间/名称/路径形状/路径摘要。
- **逻辑 owner**（可选）：复用 `dist/codex/desktop-ipc.js` 的 `openDesktopThread`，只发 `initialize` 与 `thread-owner-discovery`，随后 `close()`。不 snapshot、不 subscribe、不 start/steer/rename/resume。

`Add-Type` 需要临时编译；探针在系统 TEMP 下自建独占 `w08-pipe-*` 根，并把子进程的 `TEMP`/`TMP` 指到该根，编译产物不外溢；`finally` 核对父目录与名称前缀后删除，不留常驻原生组件。

## 三、受控结果（本机合成，非真实 Desktop）

九项检查全部通过，明细见 [W08-review-input.md](../development/evidence/c14-worker-20261029/W08-review-input.md) 与 `W08-result-b.json`（第一版结果 `W08-result.json` 原样保留）。要点：

- 服务 PID 与创建者一致，创建时间与另一次独立读取**逐位相等**；服务端只看到一个连接、随后回落为 0——探针没有把连接挂住。
- `absent` / `timeout` 两种失败各有确切 errorKind 与 native 码，不是"空结果"也不是"同实例"。
- 实例比较的八种输入（同实例、祖先、仅共同祖先、无关、PID 复用、缺创建时间、表里没有、无 PID）各自落到不同结论。
- 假 Desktop hub 上 owner 发现只发两个方法，ownerId 只以摘要出现。

这些只证明**工具行为**，不证明真实 Desktop 的关系。

## 四、边界与不能证明的事

1. **管道可能是共享 hub。** 若 `codex-ipc` 由多个窗口共用的进程服务，server PID 只能说明"这个进程在服务该管道"，不能说明"我们的 shell 由它执行"。`server-is-ancestor` 只把锚定到"同一 OS 进程树"，不越过逻辑 owner。
2. **共同祖先不是同一实例。** 两者都挂在 `chatgpt.exe` 下，只能说明来源相近；这条是本单特意单独判一档的原因。
3. **工具管道路径不证明用过它。** `CODEX_APP_TOOLS_PIPE_PATH` 是继承来的环境，本次调用是否真的经过它，需要另外的逐调用证据（W05 那条路线），本单不做。
4. **PID 会复用。** 所有实例相等判断都要求 PID + 创建时间同时成立；只有 PID 相同一律不认。
5. **创建时间不是与取 PID 同一原子的。** 它在 `CloseHandle` 之后按 PID 读，中间有几毫秒窗口；若进程恰在此窗口内退出且 PID 立刻被复用，会把新实例读成旧实例。PID 复用要求计数回绕，实际很难命中，但这是已知窗口，代码里有 `shortcut:` 标注，不当作零风险。
6. **只有 Windows。** `GetNamedPipeServerProcessId` 是 Win32 专有；Linux/macOS 的等价物（`SO_PEERCRED` 等）本单未测，也不改产品平台支持。
7. **不升级生产。** 生产对 codex 的来源识别仍是 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED`；本单不接 `identified`、不写 `association`、不启用人工确认。

## 五、复现

受控检查（本机合成管道，不读用户进程表、不连真实管道；`--out` 只能写新路径）：

```
node docs/development/evidence/c14-worker-20261029/W08-probe-check.mjs
node docs/development/evidence/c14-worker-20261029/W08-probe-check.mjs --out docs/development/evidence/c14-worker-20261029/W08-result-b.json
```

单次探测（`--out` 已存在会先拒绝，退出码 3）：

```
node docs/development/evidence/c14-worker-20261029/W08-probe.mjs --pipe <管道名> [--owner] [--no-table] [--out <新路径>]
```

真实 Desktop shell 采样（root 执行；再采一次请换新路径，勿覆盖 `W08-root-probe.json`）：

```
node docs/development/evidence/c14-worker-20261029/W08-probe.mjs --owner --out docs/development/evidence/c14-worker-20261029/W08-root-probe-b.json
```

## 六、真实采样与下一步

`W08-root-probe.json`（2026-10-29T09:28:10Z，第一版探针）已回：`codex-ipc` 的 server PID `14368` 是 `ChatGPT.exe`，落在当前 shell 祖先链第 3 层（`node 47768 → pwsh 31232 → codex.exe 24716 → ChatGPT 14368`），判 `server-is-ancestor`、`reasons:[]`；逻辑 owner 可核实但属 client-id 命名空间（长度 36，摘要 `bf34358a80e4`），与 PID 不等同；`cleanup {created:true,removed:true}`。

**这一档的诚实标注**：那次只比 PID，没有创建时间，按本单标准是"先后两次 PID 匹配观察、instance-unverified"。要把它推进到实例核验，需要 root 用修订后的探针复跑一次（新路径 `W08-root-probe-b.json`）；本单到此为止，不自行认定同一实例。

剩余缺口（本单不扩大）：

- 若 server 只是 hub：缺口是"hub 与逻辑 owner 的对应"，需要 hub 侧自报或逐调用证据，不是再连一次管道能解决的。
- 工具管道 peer 未测；多窗口、daemon、双开、三平台不在本单范围。
