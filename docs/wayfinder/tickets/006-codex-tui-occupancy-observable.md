# crosschat codex 线程 TUI 占用可观测性研究

label: wayfinder:research
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

status 能否用**非侵入、只读**的方式显示"哪个 codex 线程正被 live TUI 持有"？结论三选一：a) 有可靠信号源（指出具体来源与读取方式，status 展示方案落地）；b) 无非侵入信号源（评估降级：不显示/显示"未知"是否可接受）；c) 部分环境可观测（按 daemon 形态分叉）。

背景与已知约束：

- **0.160+ TUI 附着 daemon 后磁盘写者锁消失**（2026-10-03 修正结论，见 map.md B8 条目）——读锁文件这条路在当前推荐形态下大概率不通；旧形态（daemon ≤0.157 / `--no-daemon`）下锁文件是否存在、路径在哪，票内一并查证作兜底信号。
- **禁止用 resume/turn 探测**——会抢写者，违反只读前提。
- 候选信号源（票内逐一验证，可补充）：
  1. daemon `thread/list` JSON-RPC 响应里的状态字段（是否区分 busy/attached）
  2. 进程 inspector（`src/platform/process-inspector.ts`）：TUI 以 `codex resume <id>` 启动时 argv 含线程 id；非 resume 启动的 TUI 是否暴露当前线程需查
  3. 其他：daemon 活动连接/会话注册表等本票调研发现的来源
- 注意区分：`src/outbox.ts` 的 `releaseThreadLock` 是 crosschat 自己的发件箱协调锁，与 codex 写者锁无关，别混。
- 零回归铁律：本票只研究不实现；后续实施也仅允许 status 增量展示，不得改动投递路径。

优先级上下文（2026-10-06 用户拍板）：本票与 007 专用信箱线程（未开票）提前于联邦 v1 / broker 执行，顺序 006 → 007。
