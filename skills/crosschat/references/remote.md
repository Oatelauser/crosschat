# 跨机寻址

适用：主动向另一台机器发消息。**回复已有信封时按 [reply.md](reply.md) 保留路由**，无需重新拼地址。

## TCP

```bash
crosschat status --via tcp:<机器>
crosschat send --via tcp:<星>:<机器>:<工具>/<会话> --body "正文"
```

目标名单从对端查询。工具段用 `claude` / `codex`；同机无重名时可省略工具段。多候选时照报错中的限定地址选择。

## SSH

```bash
ssh <主机别名> crosschat status
crosschat send --via ssh:<主机别名> --to <名字或id8> --body "正文"
```

主机别名来自 SSH config，不从机器显示名猜别名。

两种通道都按主文件规则选择模式，需要时显式增加 `--delivery steer`。多行/特殊字符或大内容读 [advanced.md](advanced.md)；星注册、下线和接任读 [stars.md](stars.md)。发送后按 [delivery.md](delivery.md) 处理结果。
