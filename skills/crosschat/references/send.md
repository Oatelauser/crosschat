# 发送与本机寻址

适用：主动联系其他会话。收到信封要回信时，改读 [reply.md](reply.md)。

## 选定目标

用 `crosschat status` 确认本机目标；可用 `--claude`、`--codex`、`--opencode`、`--dsh`、`--name <关键词>` 过滤。名字支持全名或唯一前缀，重名时按报错选择完整目标。未命名 Codex 会话用 id8 寻址，`--all` 可见。

OpenCode V2 CLI 与桌面会话使用同一 OpenCode Provider。用 `crosschat status --opencode --all --json` 获取所连服务中 `opencode` 列表的完整 `id`，投递地址为 `opencode/<完整 id>`，完整 ID 优先于同名会话。保留原生 ID，不套用 Codex UUID/id8 格式；名称或短前缀出现冲突时改用完整 ID。

桌面接入范围是默认本机服务（local sidecar）。桌面用户先在原生 OpenCode 桌面打开已有会话，再按同一服务中的完整 ID 寻址。

在 OpenCode 原生 shell 工具中直接运行 crosschat；原生 `OPENCODE_SESSION_ID` 标识当前发信会话。保留这个真实身份，不用 Codex 身份变量模拟 OpenCode。`crosschat opencode` 是 CLI 启动器，会清理继承的其他工具身份变量；桌面会话由原生桌面打开，当前会话内发送不需要重新启动。

DeepSeek Harness 需要在目标实际使用的 profile 安装并启用 crosschat Host 桥。用 `crosschat status --dsh --all --json` 获取 `dsh` 列表，地址为 `dsh/<完整 id>`。只路由当前运行的根 Agent；历史会话先由用户在原生 Harness 打开，子 Agent 不在发现范围内。完整 ID 视作不透明字符串，保留 `session-` 等原生前缀，不能套用 id8。

在 Harness 原生 `pwsh/bash` 工具中运行 crosschat，由真实 `DSH_SESSION_ID` 标识发信会话。保留该身份，不在外部终端伪造。crosschat 不提供 Harness 启动器，找不到目标时先核对实际 profile、桥与原生会话，不新建替代会话。

对方在另一台机器时，按 [remote.md](remote.md) 查询对端，不能从本机名单猜远端目标。

## 发送正文

按主文件的模式规则选择本条消息：

```bash
crosschat send --to "会话名" --body "普通协作消息"
crosschat send --to "会话名" --delivery steer --body "用户让我转达的内容"
```

正文直接写内容，无需自行套 `cross-session-message` 或 `crosschat-*` 标签。多行、特殊字符和文件内容按 [advanced.md](advanced.md) 走 stdin 或文件通道。

发送后按 [delivery.md](delivery.md) 判断结果并继续自己的任务。
