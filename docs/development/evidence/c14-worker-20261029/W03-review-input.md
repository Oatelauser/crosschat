# C14-W03 复核输入：短柄并发分配诊断

2026-10-29。worker `cworker1` 提交 root 审计。本单只交付可重放证据与修复方案，未改产品实现。

## 基线

- 仓库：`D:/workspace/CC/multichat`
- branch：`codex/core-refactor-pre-tui`
- 开始 HEAD：`e009b637396180e3ba7b49cb99310a5341c67a98`
- 完成 commit：本文件所在 commit（见回报消息）
- 运行基线：Node `v25.0.0`，`win32 x64`；dist 构建 `dist/conversations.js`（2026-10-29 11:26，src 自 `0f146c0` 未变）
- 平台未测：Linux/macOS 未运行本探针

## 当前分配的实际读写顺序

`handleForRef` → `scanHandles`（读全部分片，取机器级最大号）→ `claimHandle(max+1)`：

1. `attachHandle` → `savePair`：写临时文件、`rename` 到分片（分片写入）。
2. `scanHandles`：重新读全部分片（写后扫描）。
3. 若发现同号不同 nonce/pair：`handle = max+2`，再次 `attachHandle`（唯一一次改写，**改写后不再扫描**）。
4. 返回 handle；调用方把它写进 reply hint。

可能碰撞的位置：
- 两个调用者都完成第 1 步后都做第 2 步：各自看到对方的候选号，各自算出同一个 `max+2`；第 3 步的写入不再校验，于是同号落进两个分片。**本单已确定性重放。**
- 同 pair 的 `savePair` 是整分片 last-write-wins：分配写与 `recordConversation` 并发时可能互相覆盖（丢新柄或回退会话行）。**仅源码推论，未重放。**
- `attachHandle` 忽略 `savePair` 返回值：写入失败仍返回一个任何分片都不存在的 handle。**仅源码推论，未重放。**

## 精确复现步骤（确定性）

```bash
cd D:/workspace/CC/multichat
node --check docs/development/evidence/c14-worker-20261029/W03-probe.mjs   # 退出 0
node --check docs/development/evidence/c14-worker-20261029/W03-worker.mjs  # 退出 0
node docs/development/evidence/c14-worker-20261029/W03-probe.mjs           # 退出 0
```

探针做的事：

1. `mkdtemp` 任务独占根；合成端点与 ref；不读写真实 `~/.crosschat`，不发送任何消息。
2. 两个独立 Node 子进程各自调用本仓库构建导出的真实 `claimHandle(file, ref, 1)`，初始候选相同（模拟两者都在对方写入前完成初次扫描）。
3. 运行时生成一个 CJS preload，只拦截 `fs.renameSync` 调度：`r1` 让两次首次分片写入都落盘后双方才继续扫描；`r2` 让两次重试写入都等双方算完 `max+2` 后才落盘。算法、返回值、分片内容都由真实代码产生，探针不写重复分片。
4. 结束后用真实 `resolveHandle` 解析返回柄，并读取分片计数。
5. 子进程和临时根在 `finally` 清理；屏障有 15s 超时，子进程有 30s 超时。

## 重放结果（5 次并发 + 1 次串行对照）

| 运行 | 两个执行者返回 | 同号分片条目 | `resolveHandle` | 屏障超时 |
|---|---|---|---|---|
| 并发 ×5 | 都是 `c3` | 2 | 全部 `INVALID_CONVERSATION_REF`（撞号） | 0 |
| 串行对照 | `c1` | 1 | 正常解析 | 0 |

- 5/5 并发运行复现同号不同 nonce；两个分片分别记录 `c3`。
- 串行对照正常，说明探针本身没有破坏正常路径。
- 证据：`W03-result.json`（含每次运行的柄、nonce、分片前缀、resolve 结果、清理状态）。

## 已证实与未确定

已证实（确定性重放）：
- 当前构建在“两个独立执行者都完成首次写入后才扫描、且都在对方重试写入前算出重试号”的时序下，会返回同一个短柄，落进两个分片，`resolveHandle` 报撞号。
- 单次改写后不复核，是重复号能持久化的直接原因。
- 串行路径（含现有 `claimHandle(file,ref,1)` 测试场景）不受影响。

未确定：
- 真实 `c14` 的历史重复是否由这条路径造成。真实状态里同时存在无类型/部分类型/全类型三种 pair key（三条对话线），这本身会让同一对会话产生多条对话线；它与本单的并发重复是两件可独立发生的事，不能互相归因。
- 同 pair 的 `savePair` 覆盖与写入失败返回幽灵柄：只有源码推论，未做重放。
- Linux/macOS 上的文件系统时序未测；`rename` 原子性跨平台差异未评估。

## 下一单最小修复方案（未实施）

文件：`src/conversations.ts`。

1. **重试后复核（最小修复）**：`claimHandle` 的第二次 `attachHandle` 之后再做一次 `scanHandles`；若仍同号（其他 nonce/pair），继续取 `max+1` 重试，最多 3 次；返回前保证本次 handle 在全部分片中只对应自己的 nonce。并发不变量：*返回的短柄在返回时刻机器级唯一*。跨进程在返回后仍可能插入同号，但确定性双重复位被关闭。
2. **写入失败显式化**：`attachHandle` 返回 `savePair` 的布尔结果；`claimHandle` 在失败时抛 `CONVERSATION_STATE_WRITE_FAILED`（或等价），不返回不存在的柄。
3. **同 pair 覆盖**：若 root 要求一并处理，需在 `savePair` 层面引入按 pair 的写互斥或合并写；这会改动持久化并发模型，影响大于第 1 项，建议单列并评估跨平台原子性。本单不引入锁、全局计数文件或存储格式变更。

RED/GREEN 场景（给实现单）：
- RED：本探针（两个子进程 + 屏障）→ 两个执行者返回同号、`resolveHandle` 撞号。
- GREEN：同探针 → 返回两个不同号，各自 `resolveHandle` 回到自己的 ref；串行 CAS 既有测试保持通过。
- 幽灵柄：注入 `savePair` 失败（只读目录或测试注入）→ `claimHandle` 必须抛错，不能返回不可解析的柄。

## 检查与清理

- `node --check` 两个脚本：退出 0；探针隔离重跑：退出 0，5/5 复现，1 次串行对照通过。
- 未跑产品全量 check（按任务书由 root 统一审计）；未改 src、测试、package、skill、全量任务表。
- 临时根均为 `mkdtemp` 下 `crosschat-w03-*`，每次运行后已删除；屏障/子进程均正常退出，无超时、无残留进程。
- 未读写真实 `~/.crosschat`，未向任何会话发送测试消息；未安装/升级任何工具。
- 剩余 dirty：仅原未跟踪 `docs/代码消息投递.md`，未触碰。

## 本单文件

- `W03-probe.mjs`（编排与屏障，可直接重跑）
- `W03-worker.mjs`（单个分配执行者）
- `W03-result.json`（有界脱敏证据）
- 本文件
