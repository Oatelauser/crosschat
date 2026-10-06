# crosschat codex new——headless 建线程 CLI 出口

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

新增 `crosschat codex new [--cwd <dir>]`：headless 建线程（`thread/start`，库已有 `startThread`，src/codex/client.ts:170）+ 一轮极小 bootstrap turn 硬化（007 实验 F2：fresh 线程零轮次不入 thread/list、resume 被拒，过一轮才可投递）+ 打印 id8 与完整 id。脚本/联邦预置场景拿 id 直接寻址（B4 id8 已支持），**无命名、无注册表、无状态文件**——007 wontfix 的推论直接成立。

设计已无悬空决策（唯一注意点即 bootstrap turn 必带，成本 = 每线程一次模型调用），本票实为实施前挂号。零回归：纯新增子命令，既有命令行为不动。

## Resolution

**关闭（defer，2026-10-06 用户质询后主会话认账）**：当前无任何调用方——既定用法是人开 TUI 建会话（Q6），独立命令属"为没有调用方的场景造命令"。**技术答案（三轮 refine 后定稿）**：线程 id 即 `thread/start` 返回值（瞬间可得，非"发请求才分配"）；fresh 线程零轮次不可投递，须过一轮 turn 硬化——而**第一条真实消息体本身即可充任该轮**（零额外"你好"开销）。**落法 = `send --spawn codex`**（显式旗标，非 `--to codex` 魔法词——避免撞名与 to 语义过载/typo 安全性损失）：旁路 resolveTarget → `startThread(cwd)` → 消息体即首轮 turn（startThread 后本连接即写者，免 resume）→ 回执多行 `new thread <id8>` + conversation ref；send-log 照常、B15 端对自动成立；`--spawn` 每次 = 新线程，续聊走 ref/id8；**不设 `--spawn claude`**（无 headless claude 会话形态，平台事实：claude 无 daemon、`-p` 为一次性进程不注册消息管道、交互式预置无意义——不对称映射平台差异）。**`--spawn` × `--via` 组合天然成立**：`--via ssh:host --spawn codex` = 远端预置接收线程，008 设计时直接引用无需重想。无独立命令、无状态文件。第一个真实调用方预期是 008 联邦的接收端预置——届时并入联邦批次作子项。
