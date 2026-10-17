# A 名词表

全书术语一句话速查。词条按主题分组；教程里的首次讲解链接在后列。

## 单机词条

| 词条 | 一句话 | 深入 |
|---|---|---|
| 会话（session） | 一个运行中的 claude 实例，登记在本机会话注册表 | [1.2 术语](../tutorial/lesson-1/02-terms.md) |
| 线程（thread） | codex 侧的对话单位，住在 codex 自己的名册 | [1.2 术语](../tutorial/lesson-1/02-terms.md) |
| 名单 | `status` 看到的本机可投递会话集合（活的才在） | [如何查看在线会话](../howto/status.md) |
| id8 | 线程 id 的前 8 位——未命名 codex 线程的寻址形态 | [1.4 名单不问出身](../tutorial/lesson-1/04-first-chat.md#名单不问出身) |
| 信封 | 消息的到达形态：署名、回信命令、正文、闭标签 | [信封字段表](../reference/envelope.md) |
| 短柄 cN | 本机会话引用的两字符缩写，照抄即路由 | [如何让 AI 自动回信](../howto/reply-ref.md) |
| 引用（ref，mc2_） | 自包含对话引用：双方端点+对话号+轮次，解码即路由 | [1.5 回信怎么认路](../tutorial/lesson-1/05-mechanism.md#回信怎么认路) |
| nonce | 对话号——一段对话的身份证，跨轮不变，路由靠它 | 同上 |
| 轮次（turn） | 对话的第几来一回，引用自动计数 | [如何控制对话轮次](../howto/turn-budget.md) |
| 轮次预算 | turn="N/M" 的 M，接近时提醒收尾（软不硬拦） | 同上 |
| 投递三态 | delivered / queued / parked——三种都无需重发 | [投递语义与限制](../reference/delivery-semantics.md) |
| 发件箱 | parked 消息的本机暂存队列（每线程 200 条上限） | [发件箱与看门狗](../explanation/outbox-watchdog.md) |
| 看门狗 | 有滞留才存在的分离重投循环，清空即退 | 同上 |
| mailbox | 滞留消息的人类可读镜像（`~/.crosschat/mailbox/`） | [如何排查消息未送达](../howto/troubleshoot.md) |
| 发送账本 | `send-log.jsonl`：每条消息结局的元数据，永不记正文 | [如何查看在线会话](../howto/status.md) |
| 身份反查 | 从环境变量认出发送方（claude/codex/human） | [1.5 身份怎么来的](../tutorial/lesson-1/05-mechanism.md#身份怎么来的) |
| 启动器 | `crosschat claude`/`crosschat codex`：开接收、透传参数、清身份 | [环境搭建](../preface/04-env-setup.md) |
| skill | 装进 agent 技能目录的协议教材——低入侵的教学层 | [环境搭建·装 crosschat 与 skill](../preface/04-env-setup.md#装-crosschat-与-skill) |
| 写者占用 | codex TUI 附着线程时持有写者（旧 daemon 下挡投递） | [1.4 名单不问出身](../tutorial/lesson-1/04-first-chat.md#名单不问出身) |
| 注册表 | claude 自己写的会话登记册（`~/.claude/sessions/`），crosschat 只读 | [1.5 claude 腿](../tutorial/lesson-1/05-mechanism.md#claude-腿注册表与管道) |

## 跨机词条

<!-- 跨机词条（别名/hostname/mid/origin/via 前缀/星/册/adopt/extend 等）：待 ssh/tcp 专家与书方补 -->
