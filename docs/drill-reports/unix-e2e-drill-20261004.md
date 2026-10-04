# Unix（WSL）端到端联调报告

日期:2026-10-04 · 环境:WSL2 Ubuntu-22.04，crosschat 1.3.0（仓库 dist，与发布版同源），Claude Code 2.1.288 linux-x64（GLM provider：`open.bigmodel.cn`，settings.json env 注入），Codex CLI 0.160.0（provider：`www.sui-xiang.net`，需代理，后经代理 TUN 接管恢复直连）。root 账户实测。

## 结论

**unix 上全部方向打通**：human→claude / human→codex 投递、真实模型回复、claude↔claude 双向对话闭环、codex→claude、claude→codex、codex→codex。此前网络阻塞的 codex 模型轮次在代理恢复后三条腿补测全部通过。

## 实测矩阵

| # | 场景 | 证据 | 结果 |
|---|---|---|---|
| 1 | human→claude 投递 | `send --to xc-drill-64` → `delivered (turn 1)` + reply-ref | ✅ |
| 2 | 真实模型回复（B2 遗留项） | 注入 `UNIX_E2E_4b7e` → GLM 25s 真实 turn，正文含 `OK_UNIX`；此前 2.1.288 会话未登录时同路径 turn 在 API 层失败，登录后闭环 | ✅ |
| 3 | 回投护栏 | 目标会话按 skill 教学 `crosschat send --conversation <reply-ref>` → `CANNOT_REPLY_TO_HUMAN`（human 发起的对话无可回投端点） | ✅ 语义正确 |
| 4 | claude→claude（agent 发送方） | 向 A 注入指令 → A 以自身身份（`CLAUDE_CODE_MESSAGING_SOCKET` env → 注册表反查）执行 `send --to B` → `delivered (turn 1)` | ✅ |
| 5 | claude↔claude 反向回投 | B 用 reply-ref 回信 → A transcript 落盘 `OK_B</cross-session-message>` 信封，turn 计数 1/2 正确 | ✅ |
| 6 | human→codex 投递 | `send --conversation <human→X1 ref>` → `delivered to codex/01a10735 (turn 2)`，X1 模型按指令执行 | ✅ |
| 7 | **codex→claude** | X1 模型执行 `send --to xc-drill5-35 --body "X2C_8b4d …"` → A3 收到入站信封，思考原文确认 "the codex session (01a10735) directly sent me a message" | ✅ |
| 8 | **claude→codex** | A3 照信封 reply-hint 原样回信 `crosschat send --conversation <f=codex ref>` → `queued`（X1 忙，turn 边界消费，忙时排队语义正确）；A3 结束语主动引用新 skill 纪律"本轮完成，不轮询等待" | ✅ |
| 9 | **codex→codex** | X1 模型逐字执行预构造 ref `send --conversation <f=codex:X1 t=codex:X2>` → X2 rollout 落盘入站信封 `X2X_c51e …</cross-session-message>` 并回复 `OK_X2` | ✅ |

## 新发现（产品与教学）

1. **未命名 codex exec 线程无法被 `--to` 寻址**（resolveTargetByName 仅精确名匹配）→ claude 无法主动发起与无名 codex 线程的对话，只能由 codex 侧先发起（claude 再用 reply-hint 接续，腿 8 即此路径）。候选改进：`--to` 支持 id8/完整 id，或给 exec 线程命名能力。已记待办。
2. **指令内嵌 ref 对 GLM 不可靠**：三次尝试中 GLM 两次自行解码重造 ref（改 f / 换成信封 hint 的 ref），均被端点校验正确拒绝（`CALLER_NOT_IN_CONVERSATION` 护栏有效）；codex 侧模型逐字执行零改写。结论：跨 agent 传投递命令时，让接收方使用其信封自带 reply-hint（产品设计主路径），而非正文内嵌构造 ref。
3. **skill"发送即完成本轮"纪律实测生效**（当日新增的教学）：A3 主动引用并遵守——不轮询、等异步唤醒。
4. headless 演练环境注意（真实用户走 `crosschat claude` 包装不受影响）：root + `bypassPermissions` 被 claude 拒启；default 模式下 headless 无审批面会拦 Bash——组合 `--settings '{"permissions":{"defaultMode":"default"}}' --allowedTools Bash` 解决。

## 已知坑（unix 用户注意）

1. **PATH 互通阴影**：WSL 内 `crosschat` 可能解析到 Windows 侧 npm shim（旧版无 unix 支持）——WSL 内应正式安装 `npm i -g @oatelauser/crosschat`（≥1.3.0）。本演练全程显式 `node …/dist/cli.js` 规避。
2. **codex provider 需代理**：中继端点在 WSL NAT 下默认不可达（Windows 直连亦不通，系统代理模式只覆盖 Windows 进程）；本次经代理 TUN 接管后 WSL 直连恢复。claude 侧 GLM 官方端点直连无碍。

## 与 Windows 行为对照

- hold 差异维持 B2 结论：unix 裸帧即路由，Windows 需 accept（包装会话统一带 accept，两端一致）。
- 回执/轮次/reply-ref/忙时排队语义与 Windows 实测一致（同代码路径）。

## 现场清理

全部演练会话已终止；已删 `/root/xc-drill3-5`、`/root/xc-cx1-2`、`/root/crosschat`（演练状态）、演练专用 transcript（`-root-xc-drill*` 项目目录）。保留：两个演练 codex rollout（`~/.codex/sessions/2026/10/04/rollout-*7623*` / `*bc85*`，惰性 jsonl 可随手删）；用户自己的会话与数据全程未触碰（`crosschat claude` 包装的 cc-worker10 在运行中，未受影响）。
