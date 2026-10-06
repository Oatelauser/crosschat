# crosschat codex new——headless 建线程 CLI 出口

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

新增 `crosschat codex new [--cwd <dir>]`：headless 建线程（`thread/start`，库已有 `startThread`，src/codex/client.ts:170）+ 一轮极小 bootstrap turn 硬化（007 实验 F2：fresh 线程零轮次不入 thread/list、resume 被拒，过一轮才可投递）+ 打印 id8 与完整 id。脚本/联邦预置场景拿 id 直接寻址（B4 id8 已支持），**无命名、无注册表、无状态文件**——007 wontfix 的推论直接成立。

设计已无悬空决策（唯一注意点即 bootstrap turn 必带，成本 = 每线程一次模型调用），本票实为实施前挂号。零回归：纯新增子命令，既有命令行为不动。

## Resolution

**关闭（defer，2026-10-06 用户质询后主会话认账）**：当前无任何调用方——既定用法是人开 TUI 建会话（Q6），独立命令属"为没有调用方的场景造命令"。**技术答案（用户提案 refine 后定稿）**：线程 id 即 `thread/start` 返回值（瞬间可得，非"发请求才分配"）；fresh 线程零轮次不可投递，须过一轮 turn 硬化——而**第一条真实消息体本身即可充任该轮**（零额外"你好"开销）。落法 = `send --to codex`（未指明具体线程时）懒初始化：建线程 → 消息体即首轮 → 回执带 id + conversation ref，无独立命令、无状态文件。第一个真实调用方预期是 008 联邦的接收端预置——届时并入联邦批次作子项。
