# B5 联调报告（claude ↔ codex 通道）

日期：2026-10-02　执行会话：mc-claude　环境：Windows 11 / codex-cli 0.159.3 / daemon app-server 0.157.1

## 0. 结论速览

- claude → codex（**未被 TUI 打开**的线程）：✅ 全通，3 轮 + 总结，内容保真。
- claude → codex（**被 live TUI 打开**的线程）：❌ `already has an active writer`，协议层无绕法。
- codex → claude：✅ 通（回复经 multichat 信封回到 claude 会话）。
- 途中排障一个环境问题：daemon 未启动导致 `CODEX_PROXY_SPAWN_FAILED`。

---

## 1. 执行过的 multichat 命令与报错原文（按时间顺序）

### 第一次联调

| # | 命令 | 结果 / 报错原文 |
|---|------|----------------|
| 1 | `multichat status` | claude 列出 4 会话正常；codex 段：`unavailable (CODEX_PROXY_SPAWN_FAILED: Failed to establish the codex app-server proxy channel.)` |
| 2 | `multichat status`（重试） | 同上，一字不差 |
| 3 | `multichat send --to 回应问候 --body "你好，我是 claude 侧，请回复一句话确认收到"` | ✅ `delivered to 回应问候 (turn 1)` + reply-ref `mc1_eyJ2IjoxLCJm...joxfQ`（自包含引用） |
| 4 | `multichat send --conversation mc1_...YyI6Mn0 --body "第2轮联调：传输内容校验。请原样回显这个标记 MC-RT-8842，并附上你所在线程名，一句话即可。"` | ✅ `delivered to 回应问候 (turn 3)`；codex 回信（turn 4 信封）原样回显 `MC-RT-8842`，线程名「回应问候」无误 |
| 5 | `multichat send --conversation mc1_...YyI6NH0 --body "第3轮·联调总结收尾：..."` | ✅ `delivered to 回应问候 (turn 5)` |

### 第二次联调（目标改为用户最新开的 codex 窗口）

| # | 命令 | 结果 / 报错原文 |
|---|------|----------------|
| 6 | `multichat status` | codex 段可见新线程：「等待 agent 消息并完成三轮回复」(01a0fa14)、「架构升级整改」(01a0f50a) 等，**全部 `not_loaded`** |
| 7 | `multichat send --to 等待 agent 消息并完成三轮回复 --body "..."`（未加引号） | ❌ exit 1：`multichat: USAGE: send: unexpected argument: agent`（线程名含空格被拆参；CLI 体验问题，非协议问题） |
| 8 | 同上（引号包裹线程名） | ❌ exit 1：`multichat: CODEX_PROTOCOL_ERROR: codex setup (initialize/resume) failed for 01a0fa14-6f13-7a60-9a2f-b8567dbf9221. (thread 01a0fa14-6f13-7a60-9a2f-b8567dbf9221 already has an active writer)` |
| 9 | 再次重试（间隔约数分钟，排除"窗口正跑 turn"的瞬态占用） | ❌ 报错与 #8 逐字相同 |

### 排障辅助命令（非 multichat，供复盘）

- `codex --version` → `codex-cli 0.159.3`；`where.exe codex` → 只返回两个 npm shim（`codex` / `codex.cmd`），**无 .exe**
- `codex app-server proxy`（手动复现）→ `Error: failed to connect to socket at C:\Users\<user>\.codex\app-server-control\app-server-control.sock` / `Caused by: 由于目标计算机积极拒绝，无法连接。 (os error 10061)`
- `codex app-server daemon start` → `{"status":"started","backend":"pid","pid":11128,"managedCodexVersion":"0.157.1","cliVersion":"0.159.3","appServerVersion":"0.157.1",...}`
- `codex app-server generate-ts --out ...` → 提取 `ClientRequest.ts` 全量方法表（见 §4）

---

## 2. CODEX_PROXY_SPAWN_FAILED 出现时的 daemon 状态判断

**判断：app-server daemon 完全未运行（不是坏、不是慢）。**

依据链：
1. 报错复现稳定（两次 status 一字不差），排除瞬态。
2. 手动执行 `codex app-server proxy` 得到底层真实报错：控制 socket `app-server-control.sock` 连接被**积极拒绝**（os error 10061）= 该 socket 上没有监听进程。multichat 的 status 输出只显示笼统的 `Failed to establish the codex app-server proxy channel.`，真实 stderr（即上面那条 10061）被吞在 cause 里没有透出——这本身是个可改进点。
3. `codex app-server daemon start` 一次成功，随后 multichat status 立即恢复列出 codex 线程 → 因果闭环。
4. 版本细节：daemon 托管的 app-server 是 0.157.1，与 CLI 0.159.3 存在版本差（daemon 独立常驻进程）。

---

## 3. 向 codex 线程投递失败的具体表现

- **目标线程**：「等待 agent 消息并完成三轮回复」，id `01a0fa14-6f13-7a60-9a2f-b8567dbf9221`（用户两个新开 codex 窗口中较新的那个；按线程 id 时序 01a0fa14 > 01a0f50a「架构升级整改」判定）。
- **报错原文**（两次逐字相同）：
  ```
  multichat: CODEX_PROTOCOL_ERROR: codex setup (initialize/resume) failed for
  01a0fa14-6f13-7a60-9a2f-b8567dbf9221.
  (thread 01a0fa14-6f13-7a60-9a2f-b8567dbf9221 already has an active writer)
  ```
  失败点：`thread/resume` RPC 本身被服务端拒绝（deliver.ts 的 setup 阶段，尚未走到 `turn/start`，**零写入**）。
- **试过的绕法**：
  1. 等待后重试（假设窗口正跑 turn、写者锁是瞬态）→ 无效，报错逐字相同，锁随 TUI 持有而非随 turn。
  2. 协议层找注入 API：`generate-ts` 拉全量 `ClientRequest` 方法表逐个排查 → **不存在**能写他人占用线程的方法（详见 §4）。
  3. 未尝试：向另一窗口「架构升级整改」投递（预期同样失败，且污染用户工作线程，无信息增益）；要求用户关窗（属方案而非绕法，见 §5）。
- **对照实验**（同一时段、同机制）：向**未被任何窗口打开**的旧线程「回应问候」投递，三轮全部成功且 codex 侧正常回复 → 失败变量唯一且充分：目标线程是否被 live TUI 持有。

---

## 4. 「codex TUI 线程不在 daemon」的验证依据

结论表述精确化：**TUI 会话不是 daemon 的客户端；daemon 与 TUI 只通过共享的磁盘状态库关联。daemon 的线程列表看不到 TUI 的实时占用，占用只在 resume 被拒时以副作用形式暴露。**

依据（按证明力排序）：

1. **协议面没有多客户端写入路径**：`ClientRequest.ts` 全量方法中，写路径仅 `turn/start`、`turn/steer`、`turn/interrupt`，全部要求写者身份；`thread/read` 只读；`thread/fork` 产生新线程（收件人不变）；`thread/resume` 是获取写者身份的唯一入口，且被单写者锁拒绝。若 TUI 线程可经 daemon 触达，协议里应存在某种 inject/send 方法——没有。
2. **thread/list 不反映 live 占用**：两个 TUI 窗口开着的状态下，daemon 侧 `thread/list`（multichat 传 `useStateDbOnly: true`，读状态库）把**所有**线程报成 `not_loaded`——包括被 TUI 实际持有的 01a0fa14。若 TUI 是 daemon 客户端，其线程状态应可见为 loaded/busy。
3. **共享状态库确实互通**：TUI 新建的线程（01a0fa14 等）随后出现在 daemon 的列表里——TUI 与 daemon 各自运行，但读写同一份持久化状态。
4. **daemon 可独立跑无主线程**：「回应问候」被 daemon headless resume 并完整跑了 turn（含执行 shell 回信），期间两个 TUI 窗口在场但与该线程无关。
5. 版本差佐证 daemon 是独立托管进程（0.157.1 vs CLI 0.159.3），`daemon bootstrap` 自述面向 "SSH-driven" 外部控制场景，非 TUI 主通道。

未定案项（诚实标注）：写者锁的存储位置（状态库里的 lease 记录 vs daemon 内存连接表）未直接验证；但不影响结论——无论哪种，`thread/list` 都不暴露它，且协议无第三条写入路径。

---

## 5. codex 侧接收方案建议

**推荐：承认并固化 headless 信箱模型，不与写者锁对抗。**

1. **语义定型**：claude → codex 的投递目标永远是"当前未被 TUI 打开的线程"。投递后 codex 由 daemon headless 跑 turn 回信（本次已验证全链路）。用户要看对话，事后在 TUI 里 resume 该线程即可——但窗口开着期间它是只读的（再投递会撞锁），界面/文档要把这个"开着=只读，关着=可投"讲清楚。
2. **错误码细分**（小改动，先做）：把 `already has an active writer` 从笼统的 `CODEX_PROTOCOL_ERROR` 里拆出来，给专属错误码（如 `CODEX_THREAD_LOCKED`），错误信息直接指引："目标线程正被 codex 窗口占用；关闭该窗口后重发，或改投信箱线程"。
3. **status 标注占用**：resume 探测或状态库里的 lease 字段（若 §4 未定案项核实为状态库字段则零成本），让 `multichat status` 显示哪个线程被 live 占用，避免本次"全是 not_loaded 却投不进去"的迷惑。
4. **若二期必须"投进 live 窗口"**：daemon 协议已证死路，唯一出路在 codex TUI 侧——TUI 插件/hook 主动拉取信箱（协议有 `hooks/list`，能力未探明，需单开调研票）。按低入侵约束，不得依赖给 codex 塞题词让它轮询。
5. **专用信箱线程**（可选增强）：为每台机器注册一个 multichat 自有的常闭 operator 线程作为默认收件地址，避免用户工作线程与信箱混用（本次第一轮测试就复用了旧测试线程「回应问候」才没污染工作线程，属侥幸操作而非机制保证）。

---

---

## 6. 补记（报告写完后追加的第二次联调，2026-10-02 晚）

**信箱模型前后对照实证（线程 01a0fa49，codex 自命名「联调2」）**：

| 状态 | 操作 | 结果 |
|---|---|---|
| TUI 窗口开着 | 向该线程投递 | ❌ `CODEX_THREAD_LOCKED`（新错误码已实战触发，文案与指引正确） |
| 用户关闭窗口后 | 同一线程、同一引用投递 | ✅ `delivered (turn 2)`，daemon headless 跑 turn，codex 回信 turn 3（标记 `MC-DM-5501` 原样回显）；turn 4 收尾送达，turn 5 codex 确认"联调测试通过" |

至此写者锁模型有了最硬的证据：**同一线程、开窗即拒、关窗即通**。加上首轮 01a0fa14/01a0fa3f 两次，`CODEX_THREAD_LOCKED` 共触发 3 次，全部与窗口开闭状态吻合，无误报。

**新已知问题（codex 侧报告，转记）**：daemon 模式 codex 会话首次回复时遇到 `CALLER_IDENTITY_CONFLICT`——环境同时残留 `CLAUDE_CODE_*`（MESSAGING_SOCKET/TOKEN/SESSION_ID）与 `CODEX_THREAD_ID` 两套身份变量，移除 CLAUDE_CODE_* 三个后恢复。建议：multichat 在 codex 侧调用方做身份变量隔离（spawn codex turn 前清掉 CLAUDE_CODE_*），或把该冲突码加入自纠指引。

*附：联调期间未向「代码实现」以外的 claude 会话主动发起 multichat 消息（「代码实现」为先发方，仅按 reply-hint 回执）。*
