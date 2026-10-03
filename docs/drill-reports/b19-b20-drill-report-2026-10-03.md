# B19/B20 真机演练报告（全新会话验证：忙时入队回执 / parked 早退 / conversations 视图 / 按对分片）

日期：2026-10-03　执行会话：代码优化3（drill 派单）　环境：Windows 11 / codex-cli 0.160.0 / app-server daemon 0.160.0 / crosschat 1.1.0（源码构建，含 B15-B20）

## 0. 结论速览

- 第 0 步新鲜度：✅ 全局安装 dist 含 `STALL_PARK_TIMEOUT_MS`（codex/deliver.js ×2）与 `已入对方服务端队列`（commands/send.js ×1）；`status --conversations` 正常输出。
- G1 建会话：✅ drill-claude-b19（crosschat claude + stream-json 常驻 stdin）+ drill-b19b20（TUI 建线后改名转信箱模式）。
- G2 会话列表：✅ drill 对出现，JSON 恰七字段（pair/ref/updatedAt/turn/lastStatus/lastFrom/parked），方向/轮次/状态正确。
- G3 忙时入队：✅ 忙态发送 **6.5s** 返回 queued 主行 + 新措辞"已入对方服务端队列…终态可查 crosschat status --conversations"，无旧"暂未…确认"回执行；conversations 状态翻 queued；消息在本轮结束后真实落入线程并获回信。
- G4 parked 早退：⚠️ **未能真实诱导**。daemon 重启后 resume 立即报 busy → 走排队路径（6.5s queued），not_loaded 轮询与 CODEX_THREAD_LOCKED 均未触发；维持源码/dist/单测（假时钟）证据。
- G5 清理：✅ 进程、注册表条目、drill 线程（4 个）、临时文件、drill 会话分片全删；`git status` 干净（除本报告）。
- 总 crosschat 发送 3 条（限额 ≤10），全部指向自建 drill 线程，未触碰任何既有会话。

## 1. 第 0 步 · 新鲜度确认

| 检查 | 结果 |
|---|---|
| `grep STALL_PARK_TIMEOUT_MS`（npm root -g 下 @oatelauser/crosschat/dist） | 命中 `dist\codex\deliver.js` ×2 |
| `grep 已入对方服务端队列` | 命中 `dist\commands\send.js` ×1 |
| `crosschat status --conversations` | 正常（老版会报未知 flag）：仅既有对 `架构改造3 → cc-worker2  turn 20  delivered` |
| `crosschat --version` | 1.1.0（版本号未 bump，按任务说明属预期） |

## 2. G1 · 建会话

**claude 侧**：`crosschat claude` = 透传 `--settings {"crossSessionInbound":"accept"}`（src/commands/claude-wrapper.ts），注册表在 `~/.claude/sessions/*.json`，routable 条件 kind∈{interactive,bg} 且 pid 活着（src/claude/registry.ts）。
- 第一次尝试 `(sleep) | crosschat claude -n drill-claude-b19 -p "…"`：答完即退出（"no stdin data received in 3s"），进程死=不可路由。
- 改用 docs/research/claude-windows-pipe.md 的配方：`(echo '<stream-json user 行>'; sleep 2400) | crosschat claude -n drill-claude-b19 -p --input-format stream-json --output-format stream-json --verbose`（后台）→ 注册成功：`drill-claude-b19  interactive  idle  pid 27952`。

**codex 侧**：daemon 已活（`codex app-server daemon version` → status running, 0.160.0），无需重启。建线摸索出关键事实（详见 §5 发现）：**`codex exec` 建的线程 source=exec，crosschat 的 thread/list（默认 sourceKinds=interactive）永远看不见**；`thread/start` 线程随代理连接关闭而消失。最终路径：新窗口 TUI `codex "drill-B19B20 真机演练信箱线程。请只回复两个字：就绪"` → cli 源线程 01a10166 落盘，codex 自动命名「执行 drill-B19B20 演练」→ 关 TUI 窗（转信箱模式，写者栓随之消失，与 10-03 修正记忆一致）→ 经 app-server `thread/name/set` 改名为 `drill-b19b20` → `crosschat status` 可见且 idle。

## 3. G2/G3 · 会话视图 + 忙时入队（B13+B19 措辞 / B15 连续性 / B16 身份）

发送身份说明：在本 claude 会话的 shell 里跑 send，`CLAUDE_CODE_SESSION_ID` 使 caller 解析为 claude:ff98e3d2（= 代码优化3，B16 环境身份解析），对话对该身份 ↔ drill 线程。

| # | 命令 | 墙钟 | 输出摘录 |
|---|---|---|---|
| 1 | `crosschat send --to drill-b19b20 --body "长任务：从 1 数到 500…"` | 6.5s | `delivered to drill-b19b20 (turn 1)` + reply-ref；send-log `receipt:"confirmed"` |
| — | G2 采集 | — | `claude:ff98e3d2-… → drill-b19b20  1 分钟前  turn 1  delivered`；JSON 七字段齐全（见下） |
| 2 | （线程 busy 跑数数任务时）`crosschat send --to drill-b19b20 --body "排队演练…"` | **6.5s** | `queued to drill-b19b20 (turn 2; 对方正忙，已入队，本轮结束即处理)` + `已入对方服务端队列，本轮结束即处理；终态可查 crosschat status --conversations`；**无**旧回执行「回执: 暂未…确认」 |
| — | `status --conversations` | — | drill 对翻 `turn 2  queued` |
| — | （数数轮结束后）rollout 监视 | — | turn 2 消息「排队演练」真实落入 rollout；drill 线程经 crosschat 回信 → 视图翻 `drill-b19b20 → 代码优化3  turn 2  delivered`（方向随 lastFrom 翻转，对端显示名被正确解析） |

G2 JSON（新对，恰 7 字段）：
```json
[{"pair":["claude:ff98e3d2-…","drill-b19b20"],"ref":"mc1_…","updatedAt":1791024989690,
  "turn":1,"lastStatus":"delivered","lastFrom":"claude:ff98e3d2-…","parked":0}, …]
```
（终态时 pair 显示名两侧齐备：`["代码优化3","drill-b19b20"]`，turn 3，lastFrom=codex:01a10166。）

## 4. G4 · parked 早退（B19）——未能真实诱导，如实报告

- 前置安全检查：`架构改造3`（用户在用线程）转 idle 且 10s 稳定后才动手；drill 侧重启只影响自建线程。
- 诱导尝试：`codex app-server daemon restart` → 立即 `time crosschat send --to drill-b19b20 --body "重启后探针…"`。
- 真实结果：**6.5s 返回 queued（turn 3）**——重启后 `thread/resume` 直接报 busy（被中断 turn 的 rollout 状态被 daemon 重构为 active），排队语义照常成立，没有走 not_loaded 轮询，也就没有 parked。
- CODEX_THREAD_LOCKED：0.160 TUI 附着 daemon 后写者栓消失（今日再证：TUI 开窗期间建线、关窗后投递全程无锁），旧式锁拒无法再真实触发。
- 结论：**维持假时钟证据**（单测注入小 busyTimeoutMs）+ 源码 `STALL_PARK_TIMEOUT_MS=10_000`（deliver.ts:45，dist 已含）。未验证事项：真实机器上 ~10s parked→看门狗补投→delivered 的全链路时序。
- 附带验证：重启后排队消息照旧落盘（turn 3 监视确认），用户侧 `架构改造3 ↔ cc-worker2` 循环在重启后正常推进到 turn 25，无打断事故。

## 5. 演练中的额外发现（供后续票参考）

1. **exec 线程对 crosschat 不可见**：`codex exec` 建线程 source=exec；thread/list 默认 sourceKinds=interactive（cli/vscode），limit 提到 100（共 69 条）也不出现。`--thread-source cli` 只改 analytics 字段不改 source。若要支持"脚本建信箱线程"，需 crosschat 侧显式传 sourceKinds 或文档明确只收 TUI 建的线程。
2. **thread/start 生命周期**：经代理连接创建的线程在连接关闭即消失（无 rollout 落盘前不持久）。
3. **thread/name/set 可用**：crosschat 自身 RPC 白名单（rpc.ts）不含它，但服务端允许；本次用它把自动标题改成精确 drill 名。
4. **发送端显示名渲染瑕疵**：对端未回信前，conversations 视图把发送端渲染成裸 identity key（`claude:ff98e3d2-…`）；收到对端携带 `to` 显示名的记录后才解析为「代码优化3」。
5. 自动标题不含前缀保证：codex 自动命名为「执行 drill-B19B20 演练」（动词开头），演练要求精确前缀时需依赖改名路径。

## 6. G5 · 清理清单（全部完成）

- 杀 drill claude 进程树（pid 27952 + 其 MCP 子进程）+ 停后台 stdin 管道；删 `~/.claude/sessions/27952.json` 与配对 .key 残留。
- `codex delete --force`：drill-b19b20（01a10166）及摸索期 exec 线程 01a1015d、01a10162（01a10160 为 thread/start 短命线程，自灭）；`~/.codex/sessions/2026/10/03/` 只剩用户自己的两个 rollout。
- 删临时目录 `%TEMP%\crosschat-drill`（探针脚本 name-thread.js / raw-name.js / raw-turn.js / launch-tui.cmd / generate-ts 产物）。
- 删 drill 自己的会话分片 `%LOCALAPPDATA%\crosschat\conversations\a9a1bd61….json`（用户对分片 e56b5b3f… 未动；send-log 属正常追加，保留）。
- 终验：`crosschat status` / `status --conversations` 无任何 drill 行；`git status --porcelain` 仅本报告一个新文件；未 git commit。
