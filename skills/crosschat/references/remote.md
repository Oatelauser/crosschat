# 跨机寻址

适用：主动向另一台机器发消息。**回复已有信封时按 [reply.md](reply.md) 保留路由**，无需重新拼地址。

## TCP

```bash
crosschat status --via tcp:<机器>
crosschat send --via tcp:<星>:<机器>:<名称或完整ID> --tool <收件类型> --body "正文"
```

目标名单从对端查询，每次都把收件类型放在独立 `--tool`：`claude`、`codex-cli`、`codex-desktop`、`opencode`、`dsh` 或 `dsh-desktop`，以对端实际声明为准。同类型重名时用完整原生 ID。OpenCode CLI/Desktop 共用服务；Harness 正式 Windows Desktop 已有本机真实 UI 收发证据，跨机及其它平台按实际验收范围判断。类型必须被发送端、broker、目标 node 保留，缺少能力报错后先升级相应 crosschat，保留原目标类型。

## SSH

```bash
ssh <主机别名> crosschat status
crosschat send --via ssh:<主机别名> --to <名称或完整ID> --tool <收件类型> --body "正文"
```

主机别名来自 SSH config，不从机器显示名猜别名。

SSH 必填已核实的收件 `--tool`，由远端按该类型解析目标。名称有空格时正确引用或改用完整 ID。TUI 的原生 SSH Host 别名会话可用 `y` 复制完整命令；TUI 受管连接不能冒充原生 SSH config 别名。

两种通道都按主文件规则选择模式，需要时显式增加 `--delivery steer`。多行/特殊字符或大内容读 [advanced.md](advanced.md)；星注册、下线和接任读 [stars.md](stars.md)。发送后按 [delivery.md](delivery.md) 处理结果。
