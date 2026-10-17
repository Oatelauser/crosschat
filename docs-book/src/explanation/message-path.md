# 一条消息的完整路径

## 七步的文件级展开

[第1课 1.5 的旅程图](../tutorial/lesson-1/05-mechanism.md#一条-send-的旅程)给了七步鸟瞰；这里把每一步落到模块与磁盘文件——crosschat 的全部状态就这几处，别无暗层：

| 步 | 做什么 | 读 | 写 |
|---|---|---|---|
| ① 入口补投 | 机会主义清一轮发件箱 | `~/.crosschat/outbox/*.json` | 同左 + mailbox |
| ② 身份反查 | 环境变量 → 注册表恰好一个匹配 | 环境变量；`~/.claude/sessions/*.json` | — |
| ③ 目标解析 | 全名 → 前缀 → id8 三层判定 | claude 注册表；codex thread/list（现场拉 proxy） | — |
| ④ 上限检查 | 三层来源 + 端点硬顶取 min | 环境变量 | — |
| ⑤ 轮次前进 | 分片线 or 传入引用，+1 轮 | `~/.crosschat/conversations/<sha256(对键)>.json` | — |
| ⑥ 投递 | 两条腿二选一（下两节） | claude：sessions 目录旁的密钥文件；codex：daemon | — |
| ⑦ 记账 | 账本一行 + 分片更新 | — | `send-log.jsonl`（先轮转后追加）；分片（tmp+rename） |

两处时序细节常被问：**⑦ 在投递结局之后**——failed 不落分片（`--to` 接续不被失败尝试污染），账本四种结局都记；**短柄分配写与⑦合一次**——分配柄不单独推进分片的对话线，骑在原有写上顺带完成。

## claude 腿的字节

往目标会话的管道写**换行分隔的单行 JSON**，写一次、关连接、永不重试：

```text
win32：两行                          unix：一行（无 auth）
{"type":"auth","token":"…"}          {"msgV":1,"msg_id":"<uuid>","type":"user",
{"msgV":1,"msg_id":"<uuid>",…}        "message":{"role":"user","content":"…"},
                                     "priority":"next"}
```

- **auth 行的 token** 来自 sessions 目录旁的密钥文件，文件名 = `<pid>.<sha256(归一化管道路径)>.key`——归一化保留 `\\.\pipe\` 前缀、其余小写，这是 Claude Code 自己的哈希规则，crosschat 照办。
- **unix 为什么省 auth**：同一用户的身份由内核凭据担保（管道两端同 uid），无需令牌。
- **写后 250ms 宽限**：对端正常会在收到 EOF 后立刻关连接；短宽限让断管以错误浮出——命名管道的写错误可能比写完成回调晚一拍，不等这一下会把断管误报成 delivered。

## codex 腿的调用序

一次投递一条全新链，从进程到协议逐层拉起再整体回收：

```text
解析 codex 可执行文件（win：npm 布局/where/daemon 目录三选一）
spawn codex app-server proxy（子进程环境剥掉两族身份变量）
stdio 双工上做 WebSocket 升级（ws://localhost/rpc，帧=ws 文本消息）
initialize（声明 experimentalApi）
thread/resume（目标线程）→ 状态判定：
   idle / busy → 继续（busy 在 ≥0.160 直接入队）
   waiting_approval → 停，CODEX_APPROVAL_REQUIRED（审批永不代答）
   not_loaded / 写者锁拒绝 → 轮询等 ~10s，仍不行 → parked
turn/start（turnTrigger: crosschat）→ 确认 inProgress
thread/unsubscribe → close（先 ws close 帧，再杀自己 spawn 的进程树）
```

线协议两个硬事实（实测钉死）：响应与通知帧**没有 jsonrpc 字段**，解析不得要求它；客户端方法白名单封闭，越界即编程错误。每请求 30 秒超时，超时后的迟到响应丢弃不视为故障。

## 落盘时序与原子性

- **分片写**：读旧 → 内存合并 → 写 `*.tmp` → rename 覆盖——原子性由文件系统 rename 担保，读者永远不会看到半份 JSON。
- **账本写**：追加前查大小，超 5MB 先把旧 `.old` 删掉、当前文件 rename 成 `.old`，再追加——历史整份保留，不做原地截断；轮转失败不拦追加（下次再试）。
- **mailbox**：尽力而为的镜像（追加失败不影响队列本体），权威永远是 outbox 的 JSON。
- **三者的顺序**：投递结局 → 账本 → 分片。崩溃卡在中间的后果有界：账本缺一行（那条消息状态以回执为准）或分片滞后一轮（下次 send 自愈）。

## 并发——谁和谁会撞

| 撞点 | 行为 | 为什么够用 |
|---|---|---|
| 同一对会话毫秒级并发 send | 分片 last-write-wins，接续线最坏滞后一轮 | 引用自包含，在途回信不受影响；滞后下次自愈 |
| 两人拿同一封旧信同时回 | 分片线赢——后到者按最新轮次 +1，不撞号 | 轮次以本机记录为准（B22） |
| 补投循环 vs 新 park | 逐线程锁文件互斥；争锁的 park 降级直写 | 毫秒级窗口，风险等同无锁时代，不阻塞发送 |
| 补投进行中有人入队 | 同轮就被捡到，FIFO 跨交错成立 | 每条投递前重读队列本体 |
| 限流窗口 vs 本条消息 | 检查只读、落账在结局后 | 串行语义：本条永远不数自己 |

设计姿态一句话：crosschat 不上跨进程锁阵，靠"原子写 + 自包含引用 + 自愈读"把竞态后果压到一轮以内——比锁便宜，比锁好懂。

## 跨机腿

ssh 腿在单机路径外再包一层壳，投递内核原样——对端跑的就是一条完整的本机 send：

| 步 | 发生什么 |
|---|---|
| 组装 | 固定 argv 面：`ssh <别名> -o BatchMode=yes -o ConnectTimeout=10 crosschat send --to/--conversation <目标> --json --origin <身份串>`——**没有 --body**，正文恒走 stdin（三方 shell 的引号矩阵整体免疫） |
| 传输 | 双超时链：外层本机等待（`CROSSCHAT_SSH_TIMEOUT_MS`，默认 120s）+ 内层 TCP 连接（`ConnectTimeout=10` 固定）；BatchMode 让任何交互提示变快速失败而非挂满外层 |
| 对端执行 | 登录 shell 起一条完整本机 send——名字解析、投递、排队、暂存全在对端（即本章单机路径的七步） |
| 回执 | 对端 stdout 的 JSON 回流，本机解析重渲染：三态 + 机器段 `name(mid8)` + 短柄 |
| 落账 | 发起侧写本机 send-log（只元数据）；对端签发的引用本地落账并配短柄——一段跨机对话，两边都有账 |

身份注入（--origin）与错误三层映射的完整语义见[2.6 通信机制](../tutorial/lesson-2/06-mechanism.md)与[ssh 命令详解](../reference/ssh-commands.md)。

<!-- tcp 腿占位：broker 帧 / 文件通道的路径展开，待 tcp 专家 -->
