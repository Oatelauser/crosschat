# crosschat 跨平台（Linux/WSL）可行性研究

label: wayfinder:research
status: closed
blocked-by: （无）
claimed-by: 主会话（2026-10-03，wayfinder 一票一会话）

## Question

Claude Code 在 unix（WSL 内实装实测 + 官方文档/源码查证）有没有等价的本机消息入口（消息插座/socket/等价机制）？结论三选一：a) 可行（协议细节+差异）；b) 不可行（替代机制评估）；c) 部分可行。可行则答 platform 层切分、路径规范、unix 分支清单、CI 矩阵、文档措辞、发版策略、分批方案。零实现代码、零版本号变更。macOS 参考 docs/embassy-main（前身项目，号称支持 mac）。

## Resolution

**结论 a) 可行，且 unix 侧比 Windows 更简单。** 三层证据：① embassy `claude-peer.ts:431` 明言 macOS+Linux 双支持、连接只写帧无 auth 行；② 2.1.288 官方 bundle（本机 Windows 安装内）含完整 unix 分支——路径构造 `/tmp/cc-socks-<uid>/<pid>.sock`、四可信根（含 `/run/user/<uid>/cc-socks`）、`authRequired` 仅 win32 默认强制、`getPeerUid` 内核凭证；③ WSL Ubuntu-22.04 实装实测（npm 平台包直装，install.sh 区域被墙）：注册表 `~/.claude/sessions/481.json` 出现且 `messagingSocketPath="/run/user/0/cc-socks/481.sock"`，python3 无 auth 行注入 → 服务端日志 "Routed user message to queue"、transcript 出现与 Windows 逐字一致的 peer 包装导语并触发 turn（模型回复因 WSL 未登录未取得，账号层非协议层）。关键差异仅两处：unix 不发 auth 行/不读 key 文件（D1）、socket 目录不硬编码以注册表为准（D2，embassy 教训）。意外发现：无 `crossSessionInbound` 的会话在 2.1.288 WSL 仍被直接路由（Windows 2.1.286 是 hold，版本/平台变量未隔离，B2 复测）。方案七问逐项结论 + B0✅→B1 平台层→B2 claude unix 投递联调→B3 codex/CI/文档/发版 1.3.0-experimental 分批已定，衔接 subagent 编排模式与零回归铁律。详见 `docs/research/claude-unix-socket.md`。
