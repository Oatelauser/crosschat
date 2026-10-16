# 1.3 命令总览

单机通信的命令面一页看完：九个命令每条一句话，本课用到哪几个、深入在哪节，先有张地图。全量旗标与细节住第三部[命令总表](../../reference/commands.md)。

## 命令一览

| 命令 | 一句话 | 深入 |
|---|---|---|
| `crosschat send --to <名>` | 给本机某个会话发新消息（同名自动接续最近对话） | [1.4](04-first-chat.md) |
| `crosschat send --conversation <cN\|ref>` | 回信——照抄信封里的短柄即路由 | [1.4](04-first-chat.md) |
| `crosschat status` | 本机会话名单（裸跑三段式摘要；`--conversations` 看对话总览） | [1.4](04-first-chat.md) |
| `crosschat doctor` | 环境体检，❌ 才算失败 | [环境搭建](../../preface/04-env-setup.md#doctor-自检) |
| `crosschat install-skills` | 把协议教材装进两个 agent 的技能目录 | [环境搭建](../../preface/04-env-setup.md) |
| `crosschat claude` / `crosschat codex` | 启动器：会话能收消息，旋钮透传，参数原样转发 | [环境搭建](../../preface/04-env-setup.md)、[1.4](04-first-chat.md#起两个命名会话) |
| `crosschat serve` | tcp 星的起停与入网——跨机形态 | [第3课](../lesson-3.md) |
| `crosschat clean` | 清理收件残留与 30 天未动的对话分片 | [命令总表](../../reference/commands.md) |
| `crosschat uninstall` | 卸载（连状态与技能一起清） | [命令总表](../../reference/commands.md) |

前六个是单机通信的日常面：装好后你反复用的就是 send 与 status；后三个一个是跨机、两个是运维清理。另有一个隐藏维护入口（`__drain`）不属于使用面——看门狗自己用的，[1.5](05-mechanism.md#忙了怎么办三态与看门狗)顺带见到它。

## 发送的三种形态

send 是唯一入口，日常就三种形态，各有各的时机：

| 形态 | 什么时候用 | 长什么样 |
|---|---|---|
| `--to` 新消息 | 开口找人或换话题 | `crosschat send --to worker --body "……"` |
| `--conversation` 回信 | 收到信封后照抄回信 | `crosschat send --conversation c21 --body "……"` |
| 管道长正文 | 正文很长或含 `$`、引号等敏感字符 | `'……' \| crosschat send --to worker`（省 `--body`） |

三种形态在 [1.4 第一次对话](04-first-chat.md)里各有一次真实实录；正文大小的上限与提额在 [1.5 上限与限流](05-mechanism.md#上限与限流)。
