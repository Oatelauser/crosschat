# Unix（WSL）端到端联调报告

日期:2026-10-04 · 环境:WSL2 Ubuntu-22.04，crosschat 1.3.0（仓库 dist，与发布版同源），Claude Code 2.1.288 linux-x64（GLM provider：`open.bigmodel.cn`，settings.json env 注入），Codex CLI 0.160.0（provider：`www.sui-xiang.net`，**需代理**）。root 账户实测。

## 结论

**claude 侧在 unix 上全链路打通，含真实模型回复与 agent↔agent 双向对话闭环。codex 侧模型轮次被网络阻塞（provider 需代理，WSL NAT 不继承 Windows 系统代理），传输层此前已验证（daemon/proxy/thread-list）。**

## 实测矩阵

| # | 场景 | 证据 | 结果 |
|---|---|---|---|
| 1 | human→claude 投递 | `send --to xc-drill-64` → `delivered (turn 1)` + reply-ref | ✅ |
| 2 | 真实模型回复（B2 遗留项） | 注入 `UNIX_E2E_4b7e` → GLM 25s 真实 turn，正文含 `OK_UNIX`；此前 2.1.288 会话未登录时同路径 turn 在 API 层失败，本次登录后闭环 | ✅ |
| 3 | 回投护栏 | 目标会话按 skill 教学 `crosschat send --conversation <reply-ref>` → `CANNOT_REPLY_TO_HUMAN`（human 发起的对话无可回投端点） | ✅ 语义正确 |
| 4 | claude→claude（agent 发送方） | 向 A 注入指令 → A 以自身身份（`CLAUDE_CODE_MESSAGING_SOCKET` env → 注册表反查）执行 `send --to B` → `delivered to xc-drill2-16 (turn 1)` | ✅ |
| 5 | 反向回投（reply-ref 接续） | B 收到后用 reply-ref 回信 → A transcript 落盘 `OK_B</cross-session-message>` 信封（入站 4 次），turn 计数 A→B turn1 / B→A turn2 | ✅ |
| 6 | codex 模型轮次 | `codex exec` → provider 连接挂起（WSL 直连 000；Windows 直连亦 000，走 127.0.0.1:7897 为 200） | ⛔ 网络阻塞，非代码 |

## 已知坑（unix 用户注意）

1. **PATH 互通阴影**：WSL 内 `crosschat` 可能解析到 Windows 侧 npm shim（1.2.1，unix 分支未实现）——WSL 内应正式安装 `npm i -g @oatelauser/crosschat`（≥1.3.0），或显式用 linux 侧安装路径。本次联调全程显式 `node …/dist/cli.js` 规避。
2. **codex provider 需代理**：sui-xiang.net 类中继端点在 WSL NAT 下不可达。出路：代理软件开"允许局域网"后 `https_proxy=http://<宿主网关>:7897`，或 WSL 切 mirrored networking。claude 侧 GLM 官方端点直连无碍。

## 与 Windows 行为对照

- hold 差异维持 B2 结论：unix 裸帧即路由，Windows 需 accept（包装会话统一带 `--settings '{"crossSessionInbound":"accept"}'`，两端一致）。
- 回执/轮次/reply-ref 语义与 Windows 实测一致（同代码路径，本次 unix 实证 turn1/turn2 计数与 `CANNOT_REPLY_TO_HUMAN` 护栏）。

## 现场清理

双靶会话自然退出（保活 sleep 到期）；已删 `/root/xc-drill*`、`/root/crosschat`（演练状态）、演练专用 transcript（`-root-xc-drill*` 项目目录）；用户真实 `~/.claude`、`~/.codex` 数据未触碰。
