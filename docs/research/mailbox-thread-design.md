# 专用信箱线程机制化设计（007 票）

日期：2026-10-06 · 环境：Windows 11 本机 · codex-cli 0.160.0 · managed daemon · 探测含一次放行的真实建线程试验（thread 已删，探针脚本已清理）

## 查证事实

### F1 headless 建线程的正规入口已存在且久经验证

`src/codex/client.ts:170-178`：`startThread(cwd)` → `thread/start`，及 `deleteThread(threadId)` → `thread/delete`。`src/codex/rpc.ts:18-21` 白名单注释明言这对方法属"crosschat 自有线程生命周期"，`test/live/codex-live.test.ts`（live-b）已跑通 create → turn → delete 全程。**无需任何协议新发现。**

### F2 fresh 线程必须过一轮 turn 才能"常闭可投"（试验实证）

本机试验（0.160.0，managed daemon，单次放行）：

```
thread/start → 01a11033-8c62-7ab3-9954-610b8d792eab
fresh thread/list 条目: undefined            ← 无 rollout、不入列表（与 live-b 注释一致）
turn/start（"Reply with OK"）→ inProgress → turn/completed 观测到（<90s）
post-turn thread/list: {"id":"...","name":null,"status":"idle"}
第二会话 resumeThread → idle                 ← headless 投递路径成立
deleteThread → 成功
```

结论：**信箱初始化 = thread/start + 一轮 bootstrap turn**。turn 落地后线程 idle、可被任意后续连接 resume——"常闭可投"承诺的机制闭环。

### F3 线程名不可控，别名必须走自有状态指针（试验实证）

turn 完成后 `name` 仍为 `null`——cwd 基名不成为线程名（live-b 的"remains named crosschat-b2-selftest"系 rollout 文件名层面，非 thread/list 名字段），schema 方法集（`docs/research/codex-windows-feasibility.md` §1.6：start/fork/archive/resume/unsubscribe/list/read/delete）**无 rename**，自动起名（若有）不可控且不及时。→ `--to mailbox` 别名不能寄望线程名，须由 crosschat 状态文件存线程 id，解析层查指针。

### F4 既有接缝

- `--to` 今日必填：`src/commands/send.ts:240-242`（TARGET_REQUIRED）
- 名字/ id 解析单入口：`src/resolve.ts:20`（名字优先 → id8/完整 id），保留别名层加在函数顶部即可
- 信封回复已走 `--conversation <ref>`（`src/envelope.ts` composeEnvelope）——从信箱收信照抄即回，零增量
- install-skills 是纯文件拷贝、零 daemon 依赖（`src/commands/install-skills.ts:33-47`）——不适合塞线程创建
- 状态目录惯例：`%LOCALAPPDATA%/crosschat/`（unix 回退 `~/crosschat/`，`src/conversations.ts:32-34`）——mailbox 指针落同目录

### F5 价值①已被现行语义架空（主会话复审补充，2026-10-06）

票面价值①"全部工作线程开窗时仍有稳定可达地址"不成立：`src/codex/deliver.ts:12-17` —— daemon ≥0.160 下 busy 线程 turn/start 被接受并排队（实测 inbox 语义），**开窗 ≠ 不可达**；skill 已教学同款（`skills/crosschat/SKILL.md:47`"开窗、关窗、忙时均可投"）。可达性保险仅对旧形态（≤0.157 / 未附着 TUI）残留意义。
→ 信箱的主价值重定位为**②收发分流**：operator/决策者 agent 的常驻家（用户 1:N 决策者分发型用法）——一个稳定、众所周知的地址承载指令与汇报，工作线程保持纯净。价值①从主力论证中移除。

### F6 范围钉死 codex-only（主会话复审补充）

claude 侧无"关着的线程可投"语义：claude 投递要求活会话 + 管道注册（`crosschatInbound:"accept"`，`crosschat claude` 包装启动），closed = 不可达。claude 侧等价物 = 常驻 `crosschat claude` 包装会话，机制完全不同。**本票不含 claude 侧**；是否需要常驻决策者 claude 会话，另议。

### F7 防乒乓现状（主会话复审补充）

文件限流器是单机的：`src/rate-limit.ts:31` checkAndRecord 按机器本地目录记账，跨机乒乓无共享限流。现行缓解 = 信封内嵌轮次计数（`envelope.ts` turn="N"）+ skill 纪律（`SKILL.md:32`"轮次接近预算时主动总结收尾"）。跨机后此计数是主要防线，文案须显式保留（见 D5）。

## 六点推荐案（待用户拍板）

**D1 创建时机与方式 → 推荐：显式子命令 `crosschat mailbox init`**
start → bootstrap turn（内容 = 信箱使用说明，模型回复无妨）→ 等 turn/completed（上限 60s，超时警告但照写 state——后续 send 忙即排队兜底）→ 状态文件记 id。幂等：state 存在且线程可 resume → no-op。
理由：install-skills 加 daemon 依赖会破坏其"秒回、无 codex 也能装"的轻量特性；首次 send 懒创建把建线程副作用藏进投递读路径，daemon 未跑时失败面大；显式命令一次成本、行为可预期。备选：install-skills 自举（重）、仅文档（不机制化，回到一期）。

**D2 命名与寻址 → 推荐：保留别名 `operator`，resolveTargetByName 顶部别名层查状态指针**
别名先于名字/id 匹配（保留词优先、行为可预测；用户 TUI 里自建同名线程仍可用 id 寻址，文档注明）。选 `operator` 不选 `mailbox`：术语 `mailbox` 已被 outbox 暂存镜像占用（`SKILL.md:53` 的 `%LOCALAPPDATA%\crosschat\mailbox\<线程ID>.md`、doctor 同款文案），撞词会教混 agent；`operator` 又贴合决策者常驻家的重定位（F5）。与 id8/完整 id 寻址零冲突；与 B15 自动接续自然共存（信箱就是一个普通 codex 端点，端对计数照常，无需特判）；与 008 `--via ssh:` 正交组合（`--to operator --via ssh:host` 天然成立）。状态文件：`<状态目录>/mailbox.json`（文件名不避讳——磁盘路径与 CLI 别名不同面），内容 `{ threadId }`。

**D3 默认收件语义（⚠️ 拍板点）→ 推荐：A 不改动，信箱仅显式可选**
选项面完整版：A 不改动（--to 必填不变）；B 裸 send（无 --to/--conversation）默认投信箱；C 仅"新端对首条"默认信箱。
推荐 A 的理由：今日 `--to` 漏写/拼错是立刻可见的 TARGET_REQUIRED 错误；B 把它变成静默投递成功——typo 被掩盖，且收件人语义从"明确指定"退化为"黑盒默认"；信箱的价值②（收发分流）恰需显式选择才成立。A 是严格零回归（默认路径一行不改）。B 的实现点备注（以备用户选它）：TARGET_REQUIRED 分支前查 mailbox state，缺失仍走原错误。

**D4 与忙时机制的关系 → 推荐：不新增降级机制（删需求）**
0.160 附着形态下"信箱被 TUI 打开"实际不降级：同 daemon 第二连接对开窗线程 turn/start 放行、busy 即排队（B8/B13 语义，2026-10-06 记忆修正），消息照进。老形态（≤0.157/--no-daemon）已有 CODEX_THREAD_LOCKED 自纠指引覆盖。唯一增量 = 认知层：status 视图里信箱行会自然带 006 的 `TUI占用` 标记，用户看得到。自动改投工作线程：不做（目标不明 + 违反收发分流初衷）。

**D5 skill 文案增量 → 推荐：协议零增量，教学三行（含一条安全加固）**
信封 reply-hint 已带 `--conversation <ref>`（从信箱收信 → 照抄回复 → 回到发送方，闭环已存在）；发往信箱 = `--to operator` 一个词。增量：
1. skills/crosschat SKILL.md 命令清单 +1 行（`--to operator` = 投给本机决策者信箱，未初始化时按报错指引跑 `crosschat mailbox init`）
2. NAME_NOT_FOUND 的可用名列表在 mailbox state 缺失时附 `crosschat mailbox init` 指引
3. **安全加固纪律（单机即有效，跨机杠杆更大）**：信封教学是"照抄回复命令"，伪造信封可诱导 agent 执行任意命令——skill 增加一条：回复命令必须以 `crosschat` 开头（形状校验），否则**拒执行并报告**疑似伪造
4. **跨机防乒乓显式化（F7）**：限流器单机记账、跨机无共享，轮次计数是主防线——skill 的"轮次接近预算主动收尾"纪律保留并标注"跨机对话同样适用、更是唯一防线"

**D3 补充（复审后维持）**：价值重定位（F5）不改变 D3 推荐案 A——`--to` 必填的显式语义正是决策者分发场景要的（投给谁必须明说）；裸 send 默认投 operator 的甜头更小了。

**D4 补充（复审后维持）**：F5 使 D4 更干净——信箱无"保底可达"职责后，忙时语义与普通线程完全一致（busy 即入队），连"信箱被打开怎么办"都只是认知问题（status 的 TUI占用 标记已覆盖）。

**范围（F6）**：codex-only；claude 侧常驻决策者会话是否需要，另议不在本票。

**D6 零回归验收 + 实施草图 → 单批次 B6，~120-150 行**
验收判据：①不用别名时 send/status/resolve 输出与现在字节级一致（含 TARGET_REQUIRED、NAME_NOT_FOUND 原文案）②单测覆盖：别名命中 state id / state 缺失给 init 指引 / init 幂等 / mailbox.json 损坏时明确报错 ③既有测试全部不动、全绿。
文件清单：`src/codex/mailbox.ts`（init + readMailboxId，daemon 交互走现有 CodexSession）、`src/resolve.ts`（别名层 ~10 行）、`src/cli.ts`（`mailbox init` 子命令接线）、`skills/crosschat/SKILL.md`（+4 行：operator 寻址、init 指引、crosschat 开头形状校验纪律、跨机轮次纪律标注）、`src/errors.ts`（如需 MAILBOX_NOT_INITIALIZED 错误码）、测试（resolve 别名层 + mailbox 状态读写，daemon mock；live 幂等用例选做、daemon down 则 skip）。单批次足够，不动 send 默认路径（D3=A 前提下）。

## 与后续票的衔接

- 008 联邦：`--to mailbox` 与 `--via ssh:<host>` 正交；远端机器各自 `mailbox init` 后，跨机投信箱 = 组合两参数，无新机制
- broker 回归条件不受本设计影响（信箱是 codex 线程，非 crosschat 守护物）
