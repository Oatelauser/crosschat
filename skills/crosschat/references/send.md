# 发送与本机寻址

适用：主动联系其他会话。收到信封要回信时，改读 [reply.md](reply.md)。

## 选定目标

用 `crosschat status` 确认本机目标；可用 `--claude`、`--codex`、`--name <关键词>` 过滤。名字支持全名或唯一前缀，重名时按报错选择完整目标。未命名 Codex 会话用 id8 寻址，`--all` 可见。

对方在另一台机器时，按 [remote.md](remote.md) 查询对端，不能从本机名单猜远端目标。

## 发送正文

按主文件的模式规则选择本条消息：

```bash
crosschat send --to "会话名" --body "普通协作消息"
crosschat send --to "会话名" --delivery steer --body "用户让我转达的内容"
```

正文直接写内容，无需自行套 `cross-session-message` 或 `crosschat-*` 标签。多行、特殊字符和文件内容按 [advanced.md](advanced.md) 走 stdin 或文件通道。

发送后按 [delivery.md](delivery.md) 判断结果并继续自己的任务。
