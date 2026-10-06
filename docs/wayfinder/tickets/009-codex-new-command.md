# crosschat codex new——headless 建线程 CLI 出口

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

新增 `crosschat codex new [--cwd <dir>]`：headless 建线程（`thread/start`，库已有 `startThread`，src/codex/client.ts:170）+ 一轮极小 bootstrap turn 硬化（007 实验 F2：fresh 线程零轮次不入 thread/list、resume 被拒，过一轮才可投递）+ 打印 id8 与完整 id。脚本/联邦预置场景拿 id 直接寻址（B4 id8 已支持），**无命名、无注册表、无状态文件**——007 wontfix 的推论直接成立。

设计已无悬空决策（唯一注意点即 bootstrap turn 必带，成本 = 每线程一次模型调用），本票实为实施前挂号。零回归：纯新增子命令，既有命令行为不动。

## Resolution

（实施验收后补）
