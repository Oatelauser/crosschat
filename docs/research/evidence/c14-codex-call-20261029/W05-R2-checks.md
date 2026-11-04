# C14-W05-R2 检查记录

2026-10-29。基线 `dba2c45d8b90efa3141129a2bfec62c6762f5411`，分支 `codex/core-refactor-pre-tui`。返修范围见 [W05-review.md](../../../development/evidence/c14-worker-20261029/W05-review.md) 的"R1 复审与 R2 单任务"一节；修法与判读见 [报告](../../c14-codex-call-correlation-20261029.md) §十一。

本轮**不跑原生复跑**，只修研究工装并验证异常路径。

## 逐项对照

| R2 要求 | 落点 | 实测 |
|---|---|---|
| 1 归属 P1：拒绝的旧根不得被删 | `prepareOwnedRoot`（`wx` 写 marker 即领取）、`removeOwnedRoot(root, claim)`（回读 marker 比对 `runId`）、`main` 去掉无条件 `finally` 删除 | 真实 `main --root <旧同 owner 非空根>` 返回 3，`keep.txt` 与 `ownership.json` 字节不变；并发领取只有赢家能删；marker 被改后拒绝删除 |
| 2 生命周期 | `runProcess` 的 `AbortSignal`、超时/取消树杀后等 `close`、`launcherGone`、`descendantsVerified`；`settleRoot` 只在本进程已知关闭时删根 | 取消用例 `cancelled + killedTree + closed`；超时用例孙进程确实消失、`launcherGone: true`、`descendantsVerified: false`；未关闭时 `cleanup: retained / processes-unverified`，根保留 |
| 3 JSON 边界与证据预检 | `parseModelRequest`；server 回调整体 try/catch；`parseHookLog` / `parseShellSamples` 的 `invalid-id`；三态 ID 相等；`normalizeAncestry` 的相邻 `ppid→pid` 与首行 pid 校验；`assertEvidenceAbsent` 在 `prepareOwnedRoot` 之前 | `{"input":{}}`、`{"tools":{}}`、非 JSON 各返回 400 且服务仍能关；数字 ID 被拒而非强转；缺 shell call id → `unverifiable`（不是 `mismatch`）；断链后最近 Codex 进程 `unverified`；已有证据时抛 `evidence-exists`，运行根根本没被创建 |
| 4 RED/GREEN 与汇报 | 本文件 + 报告 §十一 | 六轮 RED 各自命中，恢复后 48/48 |

## RED/GREEN

把六处守卫逐个改回缺陷形态，跑同一份 48 项测试，每轮结束从备份还原并核对字节一致：

| 轮次 | 改回的缺陷 | 结果 | 命中用例 |
|---|---|---|---|
| A 归属 | `main` 捕获后按路径 `rm -rf`（旧 `finally` 行为） | 1 failed / 47 passed | 真实 `main` 拒绝旧根且字节不变 |
| B ID | 去掉 `invalid-id`，`String()` 强转 | 1 failed / 47 passed | 数字 ID 不得被强转成相等 |
| C 请求 | 去掉 `parseModelRequest` 的 `input`/`tools` 校验 | 2 failed / 46 passed | 畸形请求不崩且返回 400；字段校验单测 |
| D 链 | `normalizeAncestry` 只做 `filter(isProcessRow)` | 2 failed / 46 passed | 断链截断；malformed 行不得当身份 |
| E 收束 | `settled = true`（旧：能跑到这一步就删） | 1 failed / 47 passed | 进程未关闭时保留根 |
| F 判读 | 缺失 ID 塌缩成 `mismatch` | 1 failed / 47 passed | 缺 shell call id 必须是 `unverifiable` |

## 检查

| 命令 | 结果 |
|---|---|
| `node --check`（探针 + Hook helper） | 通过 |
| `npx eslint`（探针 + 测试 + 两个 helper） | 通过 |
| `npx vitest run test/codex-call-correlation-probe.test.ts` | 48/48 通过 |
| `npm run check` | lint / check:imports / build 通过；测试 2494 通过 / **1 失败** / 11 跳过 |

`npm run check` 的唯一失败是 `test/tui-main-observations.test.ts > preserves native environment paths…`，与本单无关且**在基线就已失败**：把本单两个改动文件回退到 `dba2c45` 的字节后，同一用例仍在隔离运行时稳定失败（PowerShell 下同样失败）。该用例与 `src/tui/**` 都不在本单白名单内，未作任何改动，也未深挖原因。

## 证据

| 文件 | SHA256 | 状态 |
|---|---|---|
| `correlation-20261029.json` | `342f8c41cc95b0fc5d3fc994089e5f01e1153d55252527dac9abca61444be9be` | 首轮，**字节未改** |
| `cleanup-20261029.json` | `607e558c76dea0083a0544797d9759e841c92bd61196f22f54f7596290edc302` | 首轮，**字节未改** |
| `correlation-20261029-r1.json` | `868c8a507acceab694c5f116fbbe3254cf15e2677d98468b1e6f50c5b6967779` | R1 原生复跑，**字节未改** |

本轮没有新增原生证据：R2 只改工装与测试，未再启动真实 Codex。

## 清理

- 本轮只在系统临时目录下用 `mkdtemp` 造测试根，`afterEach` 按绝对路径删除；RED 轮的注入脚本与备份放在仓库外，用后已删。
- 未创建 `D:/cc-own-*` 目录；未启动真实 Codex；未触碰用户 `~/.crosschat`、daemon、auth/config；未安装/升级/卸载任何工具。
- 未改 `src/**`、CLI 用户命令、skill、总任务表/调度表、root 审计文件、原未跟踪 `docs/代码消息投递.md`。

## 未测

- 取消路径只在受控子进程上验证（`AbortSignal` → 树杀 → 等 `close`）；未在真实 Codex 进程树上触发过取消或超时。
- 并发领取用两个 `prepareOwnedRoot` 争同一空目录验证；跨进程（两个 node 进程）争抢未单独复现。
- 仍不覆盖 Desktop、共享 daemon、IPC owner、双开、`write_stdin`、第二 thread、子 agent、Linux/macOS。
