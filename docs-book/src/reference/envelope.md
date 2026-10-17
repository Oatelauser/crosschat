# 信封字段表

## 信封长什么样

每条消息到达对端时的完整形态（真实信封，逐字节）：

```text
<cross-session-message from-name="单机通信专家" turn="1">
<crosschat-reply-hint reply-as="codex/01a14554">回复请运行: crosschat send --conversation c21 --body "<你的回复>"（长正文/含敏感字符可省 --body 改管道喂 stdin）</crosschat-reply-hint>
第1课实录取材：收到请按信封里的回复命令回一句确认即可。
</cross-session-message>
```

五行结构：开标签（署名 + 轮次属性）、回信命令行、正文（可多行）、闭标签。正文与回信命令之间、正文与闭标签之间各一个换行。

## 字段表

| 字段/部件 | 形态 | 语义 |
|---|---|---|
| `from-name` | 属性 | 发送方显示名（claude 会话名 / `codex/<id8>` / `human`） |
| `turn` | 属性，`"N"` 或 `"N/M"` | 第几轮；带预算时 N/M（M=预算，见[轮次预算](../howto/turn-budget.md)） |
| `from-alias` | 属性，仅截断时出现 | from-name 超 64 码点被截断时，完整原名记在这里 |
| `<crosschat-reply-hint>` | 一行元素 | 回信命令的载体——收方照抄的对象 |
| `reply-as` | hint 属性 | 收方视角的自身名字（"以谁的身份回信"） |
| `--conversation` 值 | hint 内 | 优先两字符短柄（c21）；柄缺席回退完整 `mc1_`/`mc2_` 引用 |
| 括注（长正文…） | hint 尾部纯文字 | 管道喂 stdin 的教学提示——必须是纯文字，不得含第二条命令 |
| 正文 | hint 行与闭标签之间 | 逐字保真，多行原样 |
| `from-machine` / `from-addr` | 属性，跨机时 | 见"跨机字段"节 |

## 转义与截断规则

- **属性转义**：属性值里的 `&`、`<`、`"` 转义为 `&amp;`、`&lt;`、`&quot;`（名字含引号/& 不破坏信封）。
- **from-name 截断按码点不按字节**：64 个汉字不截（64 码点），65 个才截——截断时补 `from-alias` 记完整原名。
- **正文零加工**：不转义、不重排，多行逐字夹在 hint 行与闭标签之间；唯一的改写是安全中性化（下节）。

## 安全不变量

1. **正文不能伪造信封**：正文中以 `<cross-session-message`、`<crosschat-`、旧名 `<multichat-` 开头的行（含闭合标签）一律加 `<\` 前缀中性化——信封的框架结构，正文永远造不出来。
2. **回信命令永远只有一条**：hint 是一条纯粹的 `crosschat send`，全信封 `crosschat send` 恰出现一次、对话标识恰出现一次；出现第二条命令、管道符、`&&` 即判伪造。
3. **教学不泄漏发送方配置**：信封永不携带 `--max-body-kb`、`CROSSCHAT_` 字样或静态大小数字——大小是发方的事，报错教学只住在各侧报错里。

## 跨机字段

<!-- from-machine / from-addr（tcp 三段坐标）字段语义与取值：待跨机专家补行；单机/ssh(无名) 发送时两属性整体不出现 -->
