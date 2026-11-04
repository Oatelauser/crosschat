# C14-W05-R3 检查记录

2026-10-29。基线 `decf49baca3bf08ed546a5aa45a65073aa2f3ac0`，分支 `codex/core-refactor-pre-tui`。收口范围见 [W05-review.md](../../../development/evidence/c14-worker-20261029/W05-review.md) 的"R2 复审与 R3 最小收口"；修法与判读见 [报告](../../c14-codex-call-correlation-20261029.md) §十二。

本轮**不跑原生复跑**，只按"未知就保留"收口工装。

## 逐项对照

| R3 要求 | 落点 | 实测 |
|---|---|---|
| 1 后代未核实也保留根 | `settled` 追加 `run.descendantsVerified === true`；`isolation.root` 文案改写 | 完整假 CLI 正常退出：`descendantsVerified: false`、`cleanup: retained / processes-unverified`、整体 `incomplete`、根目录仍在且 marker 未动；非零退出与取消同样保留 |
| 2 claim 绑定本次根与完整 marker | marker 增写解析后的根；claim 保存精确字节；删除前逐项比对 | 复制 marker 到另一自有根 → `root-not-owned:root-mismatch`；claim 改指向副本 → `marker-changed`；只改 PID、只改 runId → `marker-changed`；四例都保持字节不变 |
| 3 缺失 ID 优先不可比较 | `verdict` 改为 null 优先 | 缺 call ID + thread 有效但不同 → `unverifiable`（`toolCallIdEqual: null`、`threadIdEqual: false`），整体 `incomplete`；两组有效但不等仍是 `mismatch` |
| 4 祖先链代次与环 | `normalizeAncestry` 增父不晚于子、pid 不复用 | 父创建时间 200、子 100/120 的两链 → 第一条后即断，最近 Codex 进程 `unverified`；重复 pid → 在首断点截断 |
| 5 请求截止与 timer 释放 | `requestTimeoutMs` + `release()`；`close` 的截止 timer 在 `finally` 清除 | 半截请求（头完整、体不结束）在 200ms 截止内被记 `request-timeout` 且不计入请求数；子进程关服后 3s 内退出（关服截止设 5s，泄漏即超时） |

## RED/GREEN

把六处守卫逐个改回缺陷形态，跑同一份 56 项测试，每轮结束从备份还原并核对字节一致：

| 轮次 | 改回的缺陷 | 结果 | 命中用例 |
|---|---|---|---|
| A 收束 | 只用启动器 `close` 判定可删 | 3 failed / 53 passed | 正常退出保留根、非零退出保留根、只采到 1/2 也保留 |
| B claim | 只比 owner/runId | 2 failed / 54 passed | claim 指向别的根、marker 改任一字段 |
| C 判读 | 缺 ID 塌缩成 `mismatch` | 1 failed / 55 passed | 缺 call ID + thread 不同 |
| D 链 | 只查 pid 相邻 | 2 failed / 54 passed | 父晚于子出生、重复 pid |
| E 截止 | 半截请求超时后不记录 | 1 failed / 55 passed | 半截请求必须有界失败并留痕 |
| F timer | 关闭截止 timer 不提前释放 | 1 failed / 55 passed | 子进程关服后立即退出 |

## 检查

| 命令 | 结果 |
|---|---|
| `node --check scripts/codex-call-correlation-probe.mjs` | 通过 |
| `npx eslint`（探针 + 测试 + 两个 helper） | 通过 |
| `npx vitest run test/codex-call-correlation-probe.test.ts` | 56/56 通过 |
| `npm run check` | lint / check:imports / build 通过；测试 **2501 通过 / 2 失败 / 11 跳过**（233 文件：228 通过 / 2 失败 / 3 跳过） |

### 两处 `npm run check` 失败（原文照录，本单未改这两个文件）

1. `test/tui-main-observations.test.ts`：

```
 FAIL  test/tui-main-observations.test.ts > default local observation wiring > preserves native environment paths when the caller has not requested an isolated home
AssertionError: expected "spy" to be called once, but got 0 times
 ❯ test/tui-main-observations.test.ts:68:51
     66|    const active = runTui({ ...io, home: undefined });
     67|    try {
     68|      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce…
       |                                                   ^
     69|      expect(mocks.discovery).toHaveBeenCalledWith({});
     70|      expect(mocks.overview).toHaveBeenCalledWith(expect.objectContain…
```

按派单要求：没有改该文件、没有调大其超时或跳过断言，也**没有重跑它以抹掉这次失败**。

2. `test/core-diagnostics.test.ts`：

```
 FAIL  test/core-diagnostics.test.ts > isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation
AssertionError: expected 'still waiting for blocking probe' to be 'AbortError' // Object.is equality

Expected: "AbortError"
Received: "still waiting for blocking probe"

 ❯ test/core-diagnostics.test.ts:136:23
    134|         new Promise<string>((resolve) => setTimeout(() => resolve('sti…
    135|       ]);
    136|       expect(outcome).toBe('AbortError');
```

该用例把 abort 结果与固定 500ms 计时器赛跑；整包并行负载下超时。单独运行 `npx vitest run test/core-diagnostics.test.ts` 三次均 9/9 通过，属负载敏感，不是本单改动引入（本单只改 `scripts/` 与该探针的测试文件）。

### 环境

Windows 11 Pro for Workstations 26200；Node `v25.0.0`；vitest `3.2.7 win32-x64`；`npm run check` 第 1 次执行（16:18 起，22.05s）。完整日志当时保存在系统临时目录，失败原文与汇总已照录于此。

## 证据

| 文件 | SHA256 | 状态 |
|---|---|---|
| `correlation-20261029.json` | `342f8c41cc95b0fc5d3fc994089e5f01e1153d55252527dac9abca61444be9be` | 首轮，**字节未改** |
| `cleanup-20261029.json` | `607e558c76dea0083a0544797d9759e841c92bd61196f22f54f7596290edc302` | 首轮，**字节未改** |
| `correlation-20261029-r1.json` | `868c8a507acceab694c5f116fbbe3254cf15e2677d98468b1e6f50c5b6967779` | R1，**字节未改** |

本轮没有新增原生证据：未启动真实 Codex。

## 清理与归属

- 测试根的目录一律由 `mkdtemp` 建在系统临时目录，`afterEach` 按绝对路径删除；R3 起探针正常退出也保留运行根，这些根都在测试临时目录内，由同一个 `afterEach` 一并删除。
- RED 注入脚本与备份放在仓库外，用后已删；`npm run check` 的日志放在系统临时目录，摘录进本文件后删除。
- 未创建 `D:/cc-own-*`；未启动真实 Codex；未触碰用户 `~/.crosschat`、daemon、auth/config；未安装/升级/卸载任何工具。
- 未改 `src/**`、CLI 用户命令、skill、总任务表/调度表、root 审计文件、原任务书、W03 脚本与结果、原未跟踪 `docs/代码消息投递.md`。

## 未测

- 后代"已核实"没有实现路径：真实进程树上是否所有后代退出仍未验证，本轮按设计一律保留根。
- 取消、超时、半截请求都在受控子进程与 loopback 上验证；真实 Codex 进程树的取消/超时未实测。
- 跨进程（两个 node 进程）争抢同一运行根未单独复现；并发领取是同进程两次调用。
- 仍不覆盖 Desktop、共享 daemon、IPC owner、双开、`write_stdin`、第二 thread、子 agent、Linux/macOS。
