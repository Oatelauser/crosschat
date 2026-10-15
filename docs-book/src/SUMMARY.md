<!-- 定稿 v1.0（2026-10-15 002 关票）——四拍板：六课全写 / Windows 演示主线（Linux 每步一行带过）/ 第4课命名换轨留主线 / 附录三件全收 -->

# 前言

- [前言](preface.md)

# 第一部 教程 · 从零到会

- [第0课 准备你的电脑](tutorial/00-setup-node.md)
- [第1课 认识两位 AI 伙伴](tutorial/01-install-agents.md)
- [第2课 请出传令官](tutorial/02-install-crosschat.md)
- [第3课 第一次跨工具对话](tutorial/03-first-chat.md)
- [第4课 起名字与换班](tutorial/04-naming.md)
- [第5课 两台机器传话](tutorial/05-ssh.md)
- [第6课 星型消息网](tutorial/06-tcp-star.md)

# 第二部 指南 · 遇到问题查这里

- [如何查现在谁在线](howto/status.md)
- [如何发大内容不炸](howto/large-content.md)
- [如何让 AI 自己回信](howto/reply-ref.md)
- [如何收编忘入星的会话](howto/adopt.md)
- [如何给机器起显示名](howto/showname.md)
- [如何排查「消息没到」](howto/troubleshoot.md)
- [如何在 NAT 后面打反向隧道](howto/nat-tunnel.md)
- [如何防俩 AI 聊到停不下来](howto/turn-budget.md)

# 第三部 参考 · 查表

- [命令总表](reference/commands.md)
- [地址与寻址格式总表](reference/addressing.md)
- [投递语义与边界限制表](reference/delivery-semantics.md)
- [环境变量与旋钮总表](reference/env-vars.md)
- [错误码总表与自纠动作](reference/error-codes.md)
- [skill 信封字段表](reference/envelope.md)
- [Agent 兼容性矩阵](reference/compatibility.md)

# 第四部 原理 · 想明白的人看

- [crosschat 的哲学：只做投递，不管生死](explanation/philosophy.md)
- [一条消息的旅行](explanation/message-journey.md)
- [发出去的消息会丢吗——发件箱与看门狗](explanation/outbox-watchdog.md)
- [ssh 直连 vs tcp 星：不是两种传输，是两种部署拓扑](explanation/ssh-vs-tcp.md)
- [为什么默认 16KiB](explanation/size-limits.md)
- [信任边界在哪：安全模型](explanation/security.md)
- [星是怎么自己活的](explanation/star-self-healing.md)

# 附录

- [A 名词表](appendix/glossary.md)
- [B FAQ](appendix/faq.md)
- [C 完整验证阶梯](appendix/verification-ladder.md)
