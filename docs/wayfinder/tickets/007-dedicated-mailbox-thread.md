# crosschat 启动即命名（-n）设计

label: wayfinder:research
status: open
blocked-by: （无）
claimed-by: 研究子代理（2026-10-06，主会话派单）

## 设计转向记录（2026-10-06）

本票原案"专用信箱线程机制化（operator 别名 + name set 注册表）"经用户质询后**作废**：双侧 `/rename` 原生命名已覆盖"给会话起名"，`--to <名字>` 今天即可投递。用户提案取代：**启动即命名**——`crosschat claude -n <name>` / `crosschat codex -n <name>`，且 `-n` 必须是 claude/codex **自己的原生会话名**，不是 crosschat 侧别名；一步到位，不引入注册表文件。原案的研究产物（F1-F7）中关于线程生命周期的事实仍然有效，见 docs/research/mailbox-thread-design.md。

## Question

`-n` 启动命名两侧能否落地为**原生子名**？两个实验定音：

1. **claude 腿**：`crosschat claude -n worker2` 启动后由 wrapper 把名字写入会话注册表条目（`~/.claude/sessions/<pid>.json`，crosschat 本就读取的数据源）。验证点：claude 是否回写覆盖；名字对 `/rename`、status 发现、`--to` 解析是否等效。
2. **codex 腿**（2026-10-06 用户约束：**不走逆向**——不以 sqlite 直写或未公开 daemon 方法为实现基础，版本耦合 codex 升级即断）：只查文档化面（generate-ts schema + 官方 changelog / 更新版本）有无线程命名 API 或 CLI 参数。无 → 结论 c) 维持"TUI 里 /rename 一步"，升级路径 = 向上游提 rename API/flag 需求，官方出了就接入。

附带记档（不展开设计）：
- 轮换：claude 侧重开同 `-n` 即可（旧会话死名字释放）；codex 侧旧线程占名，未来可用 `thread/archive` 做平滑轮换
- 2026-10-06 全局复审的安全/防乒乓要点（skill 文案层面）不随本转向丢失，归 008 票决策点 5/11/12 承接

## Resolution

（待研究代理回报后由主会话补）
