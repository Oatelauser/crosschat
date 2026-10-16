# 2.4 第一条跨机消息

## 对话全景

先看一次完整的跨机对话长什么样（真实实测实录；👤 是你，🤖 是 agent，📨 是 agent 收到的外来消息）：

```console
👤 用户[boss -> beta2]    用 crosschat 走 ssh 跨机给 yangwsl 机器的会话「beta2」问好，要求对方回复。
🤖 boss                   （组装并发出了那条跨机命令——下面第一条）
🤖 beta2 收到             📨 来自另一会话的消息:
                          <cross-session-message from-name="claude/boss" turn="1" from-machine="win">
                          <crosschat-reply-hint reply-as="beta2">回复请运行: crosschat send --conversation c3 --body "<你的回复>"（长正文/含敏感字符可省 --body 改管道喂 stdin）</crosschat-reply-hint>
                          你好 beta2，这是跨机问候
                          </cross-session-message>
🤖 beta2                  （照 hint 抄了一条回信命令——下面第二条）
🤖 boss 收到              📨 收到！跨机闭环成立（turn 2，自动经 ssh 回到 win）
```

```text
win · boss                              yangwsl · beta2
   │                                       │
   │ ① send --via ssh:yangwsl --to beta2   │
   │ ────────────── ssh 管道 ─────────────► │ ② 收到信封（from-machine="win"，
   │                                       │      回信命令不带 --via）
   │                                       │
   │                                       │ ③ 照抄 hint 回信 --conversation c3
   │ ◄────── 回程按 ref 自动选路走 ssh ───── │
   │ ④ 收到回复（turn 2）                    │
```

与单机的全部差别只有四个字：题词里多了「走 ssh 跨机」。命令由 boss 自己组装，beta2 照信封回信，双方谁都没敲过一次完整地址。下面把本课的四条命令逐一拆开——每条都是：用途 → 完整实录 → 隐式发生什么。

## 发起跨机消息

用途：给另一台机器上的会话发一条消息，名字在**对端**机上解析。

```console
> crosschat send --via ssh:yangwsl --to beta2 --body "你好 beta2，这是跨机问候，收到请回"
delivered to beta2@yangwsl(9f8e7d6c) (turn 1) · 续话 c1
```

隐式发生什么，一段讲完：这条命令没有在本机投递——crosschat 组装了一条**固定的远端命令**，经 ssh 送到 yangwsl 执行，等价于有人在那台机器上敲了 `send --to beta2`。名字 beta2 在对端名单里解析，本机同名会话与此无关。回执从对端传回后按本机格式重渲染，所以输出跟单机几乎一样，只有收件人多了机器段 `@yangwsl(9f8e7d6c)`——名字加对端指纹（[2.2 机器指纹 mid](02-terms.md#机器指纹-mid)）。忙时三态照单机语义：

```console
queued to beta2@yangwsl(9f8e7d6c) (turn 2; 对方正忙，已入队，本轮结束即处理) · 续话 c1

已寄存给 beta2@yangwsl(9f8e7d6c)（对方忙，未送达）。队列共 1 条，看门狗每 0.5–5 分钟自动重试，无需手动 status。
人工随时可读滞留内容: ~/.crosschat/mailbox/<线程ID>.md（位于 yangwsl）
续话: c1
```

delivered / queued 都无需重发；parked 是旧版守护的异常态，已暂存、看门狗自动重投，同样无需手动干预。行尾「续话 c1」是本机配的会话短柄，续话照抄。

❌ 再把别名敲错一次，看看跨机报错长什么样（传输层不通时）：

```console
> crosschat send --via ssh:yangsl --to beta2 --body "…"        # 别名手滑少了个 w
crosschat: SSH_TRANSPORT_FAILED: ssh 无法到达 yangsl（不通/密钥/known_hosts）。自证: ssh yangsl crosschat --version（顺带核对版本）；检查 ~/.ssh/config 与网络。
```

错误自带头诊断命令——照抄跑一遍就知道断在哪一层。

还有一条纪律在此立住：**跨机轮次纪律**。防乒乓限流器是各机各自记账的，跨机没有全局限流——turn 轮次是唯一防线。接近预算就总结收尾，别无限往返。

## 回信不写地址

用途：对端收到跨机消息后回复——照抄信封里的命令，一个地址都不用写。

```console
> crosschat send --conversation c3 --body "收到！跨机闭环成立"
delivered to claude/boss@win(3f2a81b0) (turn 2) · 续话 c3
```

隐式发生什么：回信命令里没有 `--via`，也不需要——发起方机器名已经坐在 c3 背后的对话引用（ref）里，执行侧按它自动补路由：本机 ssh config 里有 win 这个别名，就走 ssh；没有别名但本机入了 tcp 星（第3课），就换 tcp 腿；都没有就照旧试 ssh 并在失败时报错指路。这就是 [2.2 别名与 hostname](02-terms.md#别名与-hostname) 那句"别名 = hostname 是软依赖"的落点：win 在 yangwsl 侧的别名恰好叫 win，回程自动成立。

信封括注里那句"长正文/含敏感字符可省 --body 改管道喂 stdin"对跨机同样成立——正文走 stdin 管道，不进任何一层的命令行，`$`、反引号、引号逐字到达（[第1课 单机通信](../lesson-1.md)的管道手法原样可用，这也是 [2.5 通信机制](05-mechanism.md)会展开的一条设计）。

## 查对端名单

用途：发之前先确认对端有什么会话——跨机的对端**不在本机 status 里**，别赌名字发送。

```console
> ssh yangwsl crosschat status
本机会话: claude 1 · codex 1
  claude beta2  3 分钟前
  codex workteam  12 分钟前
（全量: --claude|--codex|--name）
tcp: 无
ssh: 无
（明细: --conversations --via ssh）
```

隐式发生什么：这就是一次普通的 ssh 远程命令，跑的是对端自己的 status——你看到的是对端那张名单，过滤参数照常可用（`ssh yangwsl crosschat status --claude`）。

反方向看自己：跨机对话发起后，**本机**的 `crosschat status --conversations` 会出现这一对（发起侧也记账）：

```console
会话:
  文档book → ssh专家    9 分钟前   turn 6   delivered  c17
```

一行里双方、最近轮次、投递状态、行尾续话柄都在。注意 `status --via tcp:<机器>` 那种远程枚举形态是[第3课 跨机通信（tcp）](../lesson-3.md)的 tcp 通道能力；ssh 对端就用上面这条 ssh 命令。

## 正文超限时

用途：正文超过大小上限时，按报错指的路走 scp 旁路——大内容不过消息通道。

❌ 先看本地直接挡下的样子（默认上限下硬塞 20KB）：

```console
> crosschat send --via ssh:yangwsl --to beta2 --body "<20KB 长文>"
crosschat: MESSAGE_TOO_LARGE: Body is 20000 bytes; the limit is 16384. 可提额：--max-body-kb <KiB> 或 CROSSCHAT_MAX_BODY_KIB=<KiB>（claude 端点硬顶 64KiB、codex 端点 1MiB，到顶只能落盘）。跨机大内容（ssh 形态）：先 scp <文件> yangwsl:/tmp/<文件名>，再 crosschat send --via ssh:yangwsl … --body "见 /tmp/<文件名>"（scp 与 --via 共用同一份 ssh 配置）
```

❌ 还有一种更隐蔽的：本机提了额、出发了、**在对端被拦下**——错误带 `[via]` 前缀回来，教学也换成接收方视角：

```console
> crosschat send --via ssh:yangwsl --to beta2 --body "<20KB 长文>" --max-body-kb 64
crosschat: MESSAGE_TOO_LARGE: [via yangwsl] Body is 20000 bytes; the limit is 16384 on this machine (a --via remote send). 发送方本机提额无效——上限属接收方（本机）配置。大内容走 scp 旁路：发送方先落盘，scp <文件> <接收方>:/tmp/<文件名>，再 crosschat send --via ssh:<接收方> … --body "见 /tmp/<文件名>"（scp 与 --via 共用同一份 ssh 配置）。确需直发大内容：由接收方（本机）操作者调 CROSSCHAT_MAX_BODY_KIB。
```

✅ 照报错教的做（scp 与 `--via` 共用同一份别名和密钥，[2.3 SSH 部署与配置](03-deploy-config.md)配一次全通）：

```console
> scp big-analysis.txt yangwsl:/tmp/big-analysis.txt
> crosschat send --via ssh:yangwsl --to beta2 --body "分析 /tmp/big-analysis.txt，结论报过来"
delivered to beta2@yangwsl(9f8e7d6c) (turn 3) · 续话 c1
```

```text
① 本机落盘 big-analysis.txt ──► ② scp 到对端 /tmp/ ──► ③ send 只发一句话（带对端本地路径）
   （超限的大正文留在这里）        与 --via 同一份别名/密钥      消息通道只走路径引用
```

大结果回传同理反向走一遍（对端 scp 回来，或题词让对端把结果落盘发路径）。

隐式发生什么，把这套数字一段讲完：默认上限 16KiB；`--max-body-kb` 或环境变量可调高，但 claude 投递管道硬顶 64KiB、codex 硬顶 1MiB，到顶提额无效；ssh 跨机腿在**出发前**按最宽的 1MiB 预检——超线本地直接挡下，ssh 根本不会发起；过了预检的，到对端还要用对端自己的限额复检一次（上面第二条实录就是）。所以超限的正解从来不是硬塞，而是 scp。要说清楚的是：scp 不是 crosschat 的内建通道——代码负责预检、并在报错里教这三步，真正执行 scp 的是你（或 agent）。win↔WSL 这对还有更省的捷径：文件根本不用过网络，WSL 直写 win 盘（`cp result.txt /mnt/c/Users/<你>/AppData/Local/Temp/`），用完即删。
