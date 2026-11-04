# C14-W05-R1 检查记录

2026-10-29。基线 `24734e3205c9a3c7d9e1f490a3d63cee96fe4792`，分支 `codex/core-refactor-pre-tui`。返修范围见 [W05-review.md](../../../development/evidence/c14-worker-20261029/W05-review.md) 与 [原任务书](../../../development/evidence/c14-worker-20261029/W05-task.md)；结论与修法见 [报告](../../c14-codex-call-correlation-20261029.md) §五、§十。

## 逐项对照

| R1 要求 | 落点 | 实测 |
|---|---|---|
| 1 按计划核对、精确唯一匹配、一次消费、读取错误/截断、缺失/重复 | `correlateCalls`（plan/problems/conclusive）、`readBounded` 三态 | 假 CLI 只产 1/2 → `status: incomplete`；精确匹配、重复 shell、重复 hook、重叠 tag、计划外记录各有用例 |
| 2 共同祖先 ≠ 最近执行实例 | `nearestCodexExecutor` / `sameExecutor` / `sharedAncestor` | 不同 `codex.exe` 只共享 `node.exe` → `different`；缺元数据 → `unverified`；malformed 行不强转 |
| 3 生命周期收束 | `runProcess` / `killOwnedTree` / `startMockModel.close` / Hook stdin 截止 | 超时连带孙进程被杀且等 `close`；spawn error、输出上限、listen 失败、请求/请求体超限、关闭截止各有用例 |
| 4 独占根与证据保护 | `prepareOwnedRoot` / `removeOwnedRoot` / 证据 `wx` 写 | 非空目录原样拒绝；非本单 ownership 拒绝删除；已存在证据不被覆盖 |
| 5 文案与补证 | 报告 §三、§五、§十 | thread/turn 摘要按保存文件校正；offered/used 分开；`collection.note` 的 thread 说法以文字更正，原文件未改 |
| 6 检查与提交 | 本节 | 见下 |

## 检查

| 命令 | 结果 |
|---|---|
| `node --check`（探针 + 两个 helper） | 通过 |
| `npx vitest run test/codex-call-correlation-probe.test.ts` | 38/38 通过 |
| `npx eslint`（探针 + 测试 + 两个 helper） | 通过 |
| `npm run check` | 退出 0：230 文件通过 / 3 跳过；2485 测试通过 / 11 跳过 |

RED/GREEN 三轮（子串匹配、共享祖先即同实例、读取失败当空文件 + 结论性不参与状态）分别得到 1 / 4 / 4 项失败，恢复后 38/38，详见报告 §五。

## 证据

| 文件 | SHA256 | 状态 |
|---|---|---|
| `correlation-20261029.json` | `342f8c41cc95b0fc5d3fc994089e5f01e1153d55252527dac9abca61444be9be` | 首轮，**未改** |
| `cleanup-20261029.json` | `607e558c76dea0083a0544797d9759e841c92bd61196f22f54f7596290edc302` | 首轮，**未改** |
| `correlation-20261029-r1.json` | `868c8a507acceab694c5f116fbbe3254cf15e2677d98468b1e6f50c5b6967779` | R1 原生复跑，新增 |

R1 原生复跑：`status: complete`、`outcome: correlated`、退出 0；计划 2 次，实采 shell 2 / Hook 2，拒绝行 0；两次调用完整值相等；两侧最近 Codex 进程为同一 `codex.exe`（pid 17712 + 创建时间 + 路径摘要）。仍只是本机 CLI 0.163.0 非交互 `exec` 的局部观察。

## 清理

- 运行根 `D:/cc-own-c14w05-r1` 由探针按 ownership 删除，已核实不存在；无遗留自有进程。
- 未触碰 `D:/cc-own-cztKHB`、用户会话、用户 daemon、用户 auth/config；未安装/升级/卸载任何工具。
- 未改 `src/**`、CLI 用户命令、skill、总任务表/调度表、root 审计文件、原未跟踪 `docs/代码消息投递.md`。

## 未测

Desktop Hook；共享 daemon；CLI/Desktop 双开；IPC owner；`write_stdin`；第二 thread；子 agent；Linux/macOS；长驻进程内 call id 复用。原生复跑未覆盖异常路径——异常路径由受控子进程与 loopback 失效用例保证，不是靠一次正常运行的手工观察。
