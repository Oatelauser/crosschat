# 启动器控制台输出纪律（横幅不串 TUI）

label: wayfinder:design
status: open
blocked-by: （无——先行于 020：其启动期同名预警依赖本票纪律）
claimed-by: （待领）

## Question

1.6.1 实测（用户 2026-10-15）：`crosschat claude -n cloudworker10 --connect cloud-broker` 的"已入星…"横幅有时落进 claude TUI 的输入区，用户误以为模型自己敲了初始化命令。

根因：横幅由**异步 attach 循环**打印（`src/commands/session-star.ts` run()——sessionId 靠 spawn 后快照差分获得，attach 确认天然晚于子进程启动）；聚合器需自动拉起时（ensureAggregator 重试循环最长 30s），确认到达时 claude TUI 已接管控制台，裸 stdout 写进 TUI。聚合器守护本身干净（spawn `stdio:'ignore'` + detached）——肇事者是启动器进程自己。

## 方案

- **横幅 spawn 前同步打**：三段地址三要素（星/机器/名）spawn 前全部可知（-n 场景）；文案不预支成功——报地址不报"已入星"（如 `入星 cloud-broker——会话地址 tcp:cloud-broker:yang:cloudworker10（attach 自动，异常见日志）`）
- **spawn 后成功路径全静默**：不打任何 stdout/stderr——重连提示（`星 X 聚合器连接断开，重连中……`）、attach 确认行全部落日志（`~/.crosschat/tcp/` 现有 node 日志旁挂 launcher 侧或复用）
- **失败保留一次 stderr**（attach 拒绝/聚合器超时/降级告警）：例外场景可见性优先于整洁；此后不再重复打
- **codex 无 -n**：名字靠扫描回填天然滞后——spawn 前不打地址行（名未知），只打星名行；确认落日志
- 多星循环逐星适用同款纪律
- 020 的启动期同名预警（spawn 前查探针打印）依赖本票先行

## 预算与停止条件

- 规模 S 票：横幅时序重排 + spawn 后静默 + 日志落点 + 测试（现有入星输出断言改为时序断言）
- 停止条件：npm run check 全绿；真机——`claude -n X --connect 星` 横幅在 claude TUI 出现前打印一次、TUI 内零残留输出；杀聚合器模拟断连，TUI 无输出且日志有记录、重连自动恢复成员籍
