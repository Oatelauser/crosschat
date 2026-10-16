# 原生 claude 会话接收 crosschat 消息弹"是否接受"确认——调研归档

日期：2026-10-16 · 结论级：已归档（用户拍板不教学、不立票）

## 现象

crosschat 向原生运行的 Claude Code 会话投递消息时，接收端弹"是否接受这条消息"确认；`crosschat claude` 启动器起的会话无此弹窗；两个原生 claude 会话用 SendMessage 互发也无此弹窗。

## 根因（官方文档实证）

接收端对入站消息走 inbound 判定（Delivered / Held=弹窗 / Refused）：

- 外部进程经 socket 投递"不声明权限类"；接收端若为 bypass 类模式（bypassPermissions/可用时的 plan），默认判定=全部 hold → 弹窗；prompt 类接收端默认放行（仅 bypass 自报发送方 hold）。
- 显式配置 `crossSessionInbound: hold` 或**无效值**同样导致 hold（无效值即使更高优先级源设了 accept 也 hold）。
- 弹窗超时 `dialogExpiry` 默认 5 分钟。

## 官方配置面（唯一正解）

```json
// ~/.claude/settings.json（用户级；project/local 值只在更严格时生效）
{ "crossSessionInbound": "accept" }
```

- 取值 accept | hold | refuse；v2.1.224+（Windows 需 v2.1.234+）；也可经 `/config` 的 "Messages from your other sessions" 行设置。
- permissions allow/deny **管不了入站**（那是出站工具调用面）；无"信任本机会话"开关、无 CLI flag、无环境变量。

## 与 `crosschat claude` 启动器的区别（归档决策依据）

| | 启动器会话 | 原生 + accept |
|---|---|---|
| 粒度 | 按会话（投递管道私属+持令牌直投） | 按用户全局 |
| 信任范围 | 仅 crosschat 管道免确认 | 任意同机同用户进程免确认 |
| 星籍/跨机 | 入星成员，三段地址跨机可达 | 无星籍，仅同机 |
| 安全代价 | 零 | 弃人闸 |

## 决策

2026-10-16 用户拍板：**归档，不教学、不立票**。理由：免弹窗正路（启动器）已存在且零安全代价；accept 场景窄（偶发投递存量原生会话）、代价是用户级放弃入站人闸。重开条件：原生会话免弹窗成为高频真实需求，或 Claude Code 提供按会话粒度的入站信任配置。

来源：code.claude.com/docs/en/cross-session-messaging.md（Control inbound messages / The session's inbox socket）、settings-reference.md（crossSessionInbound / dialogExpiry / isolatePeerMachines 条目）
