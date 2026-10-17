# 如何排查消息未送达

## 排查的第一原则：先看回执

每条 send 的结局只有四种，**前三种都不是故障**，动手之前先对号：

| 回执 | 含义 | 你要做的 |
|---|---|---|
| ✅ delivered | 已进对方会话 | 无 |
| queued | 对方正忙，已入对方服务端队列轮末处理 | 无——对方下一条来信就是消费凭证 |
| parked | 对方线程异常态，已进本机发件箱自动重投 | 无——急了读 mailbox 原文，见下文 |
| ❌ failed（错误码） | 确定没送到 | 按错误码自救，见速查表 |

最容易犯的错是把前三种当故障处理——重发。不要：重发会造成对方收到两条；三种状态系统都会自己走完。

## 决策树

```text
"消息没到 / 对方没反应"
   │
   ├─ ① crosschat status --conversations   ← 先查这段对话的末态
   │     │
   │     ├─ delivered（含"回执未确认"）→ 不是故障：落盘有延迟，
   │     │        再跑一次本命令即复查；对方没回≠没收到
   │     ├─ queued → 等对方本轮结束；回信即证明已处理
   │     ├─ parked → 看门狗自动重投中；读 mailbox 看原文（见下）
   │     └─ failed → 记错误码，去速查表对号
   │
   ├─ ② 名单里根本没有这对话/这人 → crosschat status   ← 查名单
   │     ├─ 名字不在 → NAME_NOT_FOUND 自救（全名/前缀/id8）
   │     └─ codex 段 unavailable → daemon 的事，去 ④
   │
   └─ ③ 环境层怀疑（从来没通过）→ crosschat doctor
         └─ ❌ 行原文就带动作（装/升/起 daemon）
```

## 状态不明确时先核实

有一类报错明确告诉你"**状态不明**"：管道写了一半失败（CLAUDE_PIPE_WRITE_UNCERTAIN）、codex 写入确认不了（CODEX_WRITE_UNCERTAIN）。这类**绝不自动重发**——重发可能造成重复消费。正确动作：先查（`status --conversations` 看这段对话的账目、必要时 send-log），确认没到再重发。设计哲学：宁可让人核实，不让系统赌一把。

## 滞留消息怎么看

parked 的消息原文随时可读，不用等投递成功：

```text
~/.crosschat/mailbox/<线程id>.md     ← 人类可读镜像：每条寄存原文 + 送达标记
~/.crosschat/outbox/<线程id>.json    ← 机器形态（队列本体）
```

两条边界规则：每线程最多暂存 200 条，到顶新的会被**诚实拒绝**（OUTBOX_FULL，报错里直接给 mailbox 路径）；对端线程已删除时整队**死信丢弃**（drain 日志一行"线程已不存在，丢弃 N 条"），不会无限囤积。看门狗 0.5–5 分钟自动重投，队列清空即退出——不需要人盯。

## 常见报错速查

| 错误码 | 一句话自救 |
|---|---|
| NAME_NOT_FOUND | 报错里就带全部可用名——照抄全名重试；未命名 codex 线程用 id8 |
| NAME_COLLISION | 前缀撞了多人——报错列了候选，用完整名 |
| RATE_LIMITED | 30 条/60 秒/每对到顶——等报错里说的秒数，或干脆总结收尾 |
| MESSAGE_TOO_LARGE | 按报错指的路走：可提额就提（`--max-body-kb`），到硬顶就落盘发路径 |
| CALLER_NOT_IN_CONVERSATION | 手里的引用不是这段对话的——改 `--to <名>` 自动接续 |
| CANNOT_REPLY_TO_HUMAN | 人发起的对话没有可投递会话——答复写在你自己终端里 |
| CALLER_IDENTITY_CONFLICT | 环境里两族身份变量并存——照报错 `env -u` 清单清掉，或干净终端重启 daemon |
| CODEX_THREAD_LOCKED / BUSY_TIMEOUT | 已自动转 parked，无需动作（0.160+ 基本遇不到） |
| CODEX_APPROVAL_REQUIRED | 对方在等审批——只有用户能答，等它 |
| CODEX_PROXY_SPAWN_FAILED | 十有八九 daemon 没跑：`codex app-server daemon start` |

真实现场（写作机器隔夜实录——daemon 停了，codex 段整段瘫，两条命令复原）：

```console
> crosschat status --codex
codex:
  unavailable (CODEX_PROXY_SPAWN_FAILED: Failed to establish the codex app-server proxy channel.)
> codex app-server daemon start
{"status":"started","backend":"pid","pid":18976,...,"appServerVersion":"0.160.0"}
```

全量错误码（含每码完整自纠命令）见[错误码总表](../reference/error-codes.md)。

## 跨机链路

<!-- 跨机链路排查：待 ssh/tcp 专家补（ssh 腿超时/透传错误语义、tcp 星在线表与文件通道） -->
