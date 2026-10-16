# 前言

- [这本书讲什么](preface/what.md)
- [怎么读](preface/how-to-read.md)
- [符号约定](preface/symbols.md)

# 第一部 教程

- [第1课 单机通信](tutorial/lesson-1.md)
  - [1.1 背景与场景](tutorial/lesson-1/01-background.md)
  - [1.2 术语](tutorial/lesson-1/02-terms.md)
  - [1.3 安装](tutorial/lesson-1/03-install.md)
  - [1.4 第一次对话](tutorial/lesson-1/04-first-chat.md)
  - [1.5 通信机制](tutorial/lesson-1/05-mechanism.md)
- [第2课 跨机通信（ssh）](tutorial/lesson-2.md)
  - [2.1 背景与场景](tutorial/lesson-2/01-background.md)
  - [2.2 术语](tutorial/lesson-2/02-terms.md)
  - [2.3 命令总览](tutorial/lesson-2/03-command-map.md)
  - [2.4 SSH 部署与配置](tutorial/lesson-2/04-deploy-config.md)
  - [2.5 第一条跨机消息](tutorial/lesson-2/05-first-message.md)
  - [2.6 通信机制](tutorial/lesson-2/06-mechanism.md)
- [第3课 跨机通信（tcp）](tutorial/lesson-3.md)
  - [3.1 背景与场景](tutorial/lesson-3/01-background.md)
  - [3.2 术语](tutorial/lesson-3/02-terms.md)
  - [3.3 命令一览](tutorial/lesson-3/03-command-map.md)
  - [3.4 起星与入网](tutorial/lesson-3/04-star-setup.md)
  - [3.5 会话入星与寻址](tutorial/lesson-3/05-join-address.md)
  - [3.6 跨机消息与文件](tutorial/lesson-3/06-message-file.md)
  - [3.7 升级](tutorial/lesson-3/07-upgrade.md)

# 第二部 指南

- [如何查看在线会话](howto/status.md)
- [如何发送大内容](howto/large-content.md)
- [如何让 AI 自动回信](howto/reply-ref.md)
- [如何收编会话](howto/adopt.md)
- [如何修改机器显示名](howto/showname.md)
- [如何排查消息未送达](howto/troubleshoot.md)
- [如何使用反向隧道](howto/nat-tunnel.md)
- [如何控制对话轮次](howto/turn-budget.md)

# 第三部 参考

- [命令总表](reference/commands.md)
- [ssh 命令详解](reference/ssh-commands.md)
- [地址格式总表](reference/addressing.md)
- [投递语义与限制](reference/delivery-semantics.md)
- [环境变量总表](reference/env-vars.md)
- [错误码总表](reference/error-codes.md)
- [信封字段表](reference/envelope.md)
- [兼容性矩阵](reference/compatibility.md)

# 第四部 原理

- [设计边界：只做投递](explanation/design-boundary.md)
- [一条消息的完整路径](explanation/message-path.md)
- [发件箱与看门狗](explanation/outbox-watchdog.md)
- [ssh 与 tcp 星怎么选](explanation/ssh-vs-tcp.md)
- [16KiB 上限的由来](explanation/size-limit.md)
- [安全模型与信任边界](explanation/security.md)
- [tcp 星的内部机制](explanation/star-internals.md)

# 附录

- [A 名词表](appendix/glossary.md)
- [B 常见问题](appendix/faq.md)
- [C 验证阶梯](appendix/ladder.md)
