# codex 线程 TUI 占用可观测性研究（006 票）

日期：2026-10-06 · 环境：Windows 11 本机 · codex-cli 0.160.0 · managed daemon 0.160.0（PID 26024，`app-server --listen unix:// --managed-daemon`）· 一只 TUI 开着（无参 codex.exe PID 23208，启动于 11:18，持有两个线程）· 探测全部只读（thread/list + 文件系统 + 进程表；零 resume/turn 调用）

## 结论

**a) 有可靠信号源：`CODEX_HOME/thread-writer-locks/<threadId>.lock` 零字节锁文件。** 枚举该目录即得"哪些线程的写者正被持有"（TUI 开窗 = 持有写者）。纯文件系统读取，无 RPC、无副作用，win/unix 无差异（都是 readdir）。

### 修正一条既有结论

map.md B8 条目（2026-10-03）"0.160 TUI 附着 daemon 后写者锁消失"需要精化：消失的是**跨进程冲突**（TUI 与 app-server 同进程/同 daemon，thread-store 共享，`codex exec resume` 仍被拒——docs/research/codex-0160-inject-items.md:28 对照 B）；**锁文件本身照常落盘**。本机活体：TUI 启动 11:18，同刻出现两把锁：

```
$ ls -la ~/.codex/thread-writer-locks/
.coordination.lock                                (目录级协调锁，常驻，忽略)
01a10033-019d-7a02-861b-3b88ce4c308f.lock   mtime Oct 6 11:18
01a10f37-e25a-7550-8e64-41b60c20cbcd.lock   mtime Oct 6 11:18
```

文件内容为空（纯存在性标记，与 crosschat 自家 outbox 锁同款风格）。

## 证据

### 1. 锁文件（主信号）

- 两把锁的 mtime 与 TUI 进程启动时刻一致（11:18）——创建于附着时。
- **释放即清理**：`tui-thread-reference-capabilities/` 里残留 9 月 27 日的旧线程能力文件，但 thread-writer-locks 里没有对应旧锁——正常关窗会删锁，无历史堆积。
- **legacy 形态同样适用**（0.159.3 跨进程写者锁即此文件家族，docs/research/codex-open-window-injection.md:95 记录过删除线程后"writer-lock 文件消失"；≤0.157 / `--no-daemon` 形态下锁由 thread-store 持久层写，与 daemon 拓扑无关）。标注：legacy 未在本机重演，证据为 0.159 研究文档。
- **已知风险（未验证）**：TUI 崩溃若不清理会留死锁。展示层带 mtime 年龄可让人工识别陈旧锁；v1 先显示存在性，age 列为升级路径。

### 2. thread/list 状态 ≠ TUI 占用（佐证，不能当主信号）

经仓库自身 transport（dist/codex/{rpc,transport}.js）原样转储 `thread/list`（useStateDbOnly: true，limit 100，共 81 条）：

| 线程 | 锁文件 | thread/list | 说明 |
|---|---|---|---|
| 01a10033 | ✅ | `active{activeFlags:[]}`（busy） | TUI 持有**且**正在跑轮次——status 只反映轮次 |
| 01a10f37 | ✅ | **不在列表中**（81 条里没有） | TUI 今早新建的空标签页：无 rollout 文件、未入 state db 列表，唯一痕迹是锁 |

两行反向证明：status 说不了"谁被 TUI 持有"（busy 可能是 headless 轮次；held-idle 干脆不在列表）。原始响应逐字段检查过：`canAcceptDirectInput`/`threadSource`/`agentNickname` 全为 null，`originator`/`source`/`cliVersion` 不含附着信息——**没有藏在未映射字段里的信号**。

### 3. 进程 argv（弃用）

本机 TUI 以**无参数**启动（PID 23208 CommandLine 仅 exe 路径）——argv 不含线程 id；仅 `codex resume <id>` 启动才带。覆盖率差，弃用。process-inspector.ts 现只有 `isProcessAlive`（src/platform/process-inspector.ts:4），不扩。

### 4. 排除的其他目录

`app-server-control/`（daemon 启动锁）、`app-server-daemon/`（daemon.lock/pid，daemon 级）、`.sqlite-maintenance.lock`（瞬态）——均非逐线程信号。

## status 展示设计草案（实施批次用）

1. 新增纯函数 `listWriterLocks(codexHome)`（放 rollout-meta.ts 旁或新小模块）：`readdir(thread-writer-locks)`，过滤 `*.lock` 去扩展名，忽略 `.coordination.lock`。
2. `status.ts` codex 段（src/commands/status.ts:98-104 的渲染循环）：行尾追加 `TUI占用` 标记；JSON 输出（status.ts:76-83）加 `held: true` 字段。
3. 锁住但不在 thread/list 的线程（如空标签页）：补一行 id8 + `(未列入)`，name 记 `-`。
4. `cli.ts` 把 `codexHomeDir()`（rollout-meta 已有）接进 status deps。
5. 规模：~40 行 + 单测（临时目录造锁文件断言枚举与过滤）。**单批次足够，无需分批**；不动投递路径，纯增量，win/unix 同码。
