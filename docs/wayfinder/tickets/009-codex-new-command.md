# crosschat codex new——headless 建线程 CLI 出口

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

新增 `crosschat codex new [--cwd <dir>]`：headless 建线程（`thread/start`，库已有 `startThread`，src/codex/client.ts:170）+ 一轮极小 bootstrap turn 硬化（007 实验 F2：fresh 线程零轮次不入 thread/list、resume 被拒，过一轮才可投递）+ 打印 id8 与完整 id。脚本/联邦预置场景拿 id 直接寻址（B4 id8 已支持），**无命名、无注册表、无状态文件**——007 wontfix 的推论直接成立。

设计已无悬空决策（唯一注意点即 bootstrap turn 必带，成本 = 每线程一次模型调用），本票实为实施前挂号。零回归：纯新增子命令，既有命令行为不动。

## Resolution

**关闭（终案零机制，2026-10-06 用户连续质询后定稿）**：headless 建线程 = **`codex exec "<内容>"` 原生承接**——codex 原生命令建线程 + 跑一轮（自动硬化）+ 退出，角色题词原生随行；之后 `crosschat status` 见 id8、`--to` 寻址，跨机预置 = `ssh <host> codex exec "<题词>"`。crosschat 零新命令、零新旗标、零状态文件。技术事实一并归档：线程 id 即 `thread/start` 返回值（瞬间可得）；fresh 线程零轮次不可投递，须过一轮 turn 硬化（exec 天然满足）；claude 侧无对应物是平台事实（无 daemon、`-p` 一次性不注册消息管道）。mailbox init / name set / codex new / --spawn 四案同因否决——crosschat 不拥有会话生命周期，已提炼为地图站定性架构约束（2026-10-06）。
