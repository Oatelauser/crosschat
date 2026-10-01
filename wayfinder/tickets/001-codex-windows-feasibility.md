# Codex 在 Windows 的原生通道可行性

label: wayfinder:research
status: closed
blocked-by: （无）
claimed-by: 研究子代理（2026-10-01 制图会话派发）

## Question

Codex 半边在 Windows 上能否走原生通道（App Server JSON-RPC：`thread/resume` + `turn/start` / `turn/steer`）？

- 本机 codex 安装形态：`codex --version`、安装路径、`~/.codex`（CODEX_HOME）目录布局
- `codex app-server` / `codex app-server proxy` 子命令在 Windows 是否存在、行为是否一致
- 管安装（`~/.codex/packages/standalone`）与 App Server 守护进程在 Windows 的等价物（ChatGPT 桌面版？）
- 会话内 shell 进程是否继承 `CODEX_THREAD_ID`
- 官方 Windows 支持状态（官方文档 / GitHub issue）

结论三选一：原生可行 / 部分可行（说明缺口）/ 不可行（给出论证 → 触发降级轮询设计）。
产出：`research/codex-windows-feasibility.md`（中文，引用来源）。

## Resolution

**结论：原生可行，不需要降级轮询。** 本机（Windows 11, codex-cli 0.159.3 / daemon 0.157.1）活体验证了完整链路：`codex app-server proxy` 子进程存在且 stdin/stdout 为透明字节管道，其上 WebSocket 握手（HTTP 101）与 `initialize`、`thread/list` JSON-RPC 往返均成功返回真实数据；管安装等价物为 `~/.codex/packages/app-server-daemon`（`x86_64-pc-windows-msvc`），守护进程与 `app-server-control.sock`（Windows AF_UNIX）常驻可用。官方 schema 证实 `thread/resume`、`turn/start`、`turn/steer` 及参数形状（`expectedTurnId`/`turnTrigger`）与 embassy 所用一致；环境变量方面，历史 Windows 会话实证 shell 子进程同时继承 `CODEX_THREAD_ID` 与 `CODEX_SESSION_ID`（实现建议双读）。遗留缺口均为移植工作量而非通道问题：macOS 三元组/目录名假设、lstat+uid socket 见证模型需换 Windows 等价物、进程收割用 Job Object/taskkill、seclogon 被禁的机器上沙箱 exec 会失败（`CreateProcessWithLogonW` 1058，影响会话内干活能力不影响通道）。`turn/start`/`turn/steer` 未活体发送（只读边界），实施首日用 `thread/start` 新线程隔离补验。详见 `research/codex-windows-feasibility.md`。
