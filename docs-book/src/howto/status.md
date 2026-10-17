# 如何查看在线会话

## 一条命令三张视图

用途：`crosschat status` 一条命令，按你要回答的问题切三张视图——**谁在线**（裸跑摘要）、**挑人**（过滤旗标）、**这段对话走到哪了**（`--conversations`）。

```console
> crosschat status
本机会话: claude 4 · codex 20
  claude 文档book  1 分钟前
  claude 单机通信专家  4 分钟前
  claude 二期8  17 分钟前
  claude ssh专家  42 分钟前
  codex beta12  10-07 23:04
（全量: --claude|--codex|--name）
tcp: 共 2 星
  …
ssh: 无
（明细: --conversations --via ssh）
```

隐式发生什么：入口处先顺手补投一遍发件箱滞留消息（有缓解会打一行 stderr，没有则无声），然后读两张登记册——claude 注册表与 codex 线程名册，各过滤掉死进程与已删线程。所以名单永远是**此刻能收信的**，不是"曾经开过的"。

## 裸跑摘要怎么读

三段各答一问：

- **本机会话**——计数一行（claude N · codex N，滞留消息多时附 `滞留 N（看门狗运行中/未运行）`），下面是最近五个命名会话（跨两侧按最近活跃混排）。未命名的默认不占这五行。
- **tcp**——入网的星与机器（没入网显示 `tcp: 无`；这是[第3课](../tutorial/lesson-3.md)的地盘，单机阶段看一眼即可）。
- **ssh**——跨机对话段数（`ssh: 无` 就是还没有）。

一行结论：**看"现在有谁、都在不在"，裸跑就够了**。尾巴上两行括注就是切换提示——全量用过滤旗标，对话明细用 `--conversations`。

## 挑人与选段

给 `--to` 找收件人时的两张滤网：

| 旗标 | 作用 | 例 |
|---|---|---|
| `--claude` / `--codex` | 只看一侧 | `crosschat status --codex` |
| `--name <关键词>` | 按名字大小写不敏感筛 | `crosschat status --name 二期` |
| `--all` | 把未命名会话也带出来（默认隐藏） | `crosschat status --codex --all` |

未命名的 codex 线程长这样（`--all` 才可见，行首 id8 就是投递地址）：

```console
> crosschat status --codex --all
codex:
  beta12         CC\test-cc    10-07 23:04 crosschat   01a116e5  not_loaded
  (unnamed)      Temp\cc-exec-id-test 10-06 21:15 codex_exec 01a1115b  not_loaded
  …
```

codex 侧整段不可用时（daemon 没跑），这一段会显示 `unavailable (CODEX_PROXY_SPAWN_FAILED: …)` 而不是让整条命令失败——一侧宕是合法状态答案，claude 段照给。

## 对话总览逐列读法

用途：`crosschat status --conversations`——每一对会话一行，看方向、轮次、末态、滞留：

```console
> crosschat status --conversations
会话:
  二期8 → 单机通信专家   19 分钟前  turn 2  delivered  c19
  codex/01a14796 → 单机通信专家  1 分钟前  turn 1  delivered  c25
  …
```

| 列 | 读法 |
|---|---|
| 方向 `A → B` | 最近一条是谁发给谁的（`↔` = 未知） |
| 相对时间 | 这对最近一轮是什么时候 |
| `turn N` | 这段对话走到的轮次（两侧取最大） |
| 末态 | 本机**发送账本**视角：delivered / queued / parked / failed——对端回信不产生你的账目 |
| `queued` 注记 | 已交对端队列待消费，**对方回信即证明已处理**，勿追问 |
| 滞留 N | 本机发件箱里还没投出去的条数（看门狗在自动重投） |
| 行尾 cN | 这段对话的续话短柄，回信照抄它 |

末态还是 `delivered` 但前面加过"回执暂未确认"的行，跑一次本视图会自动复查一遍回执——所以"发完过几分钟再看一眼"是有意义的动作。

## 账本与镜像（send-log 与 mailbox）

总览之外还有两份一手记录，都在 `~/.crosschat/` 下：

- **`send-log.jsonl`**——发送账本：每条消息的结局一行元数据（谁、给谁、何时、什么状态、轮次、引用），**永不记正文**；超 5MB 整份轮转成 `.old`。命令超时转后台后结果也在这，事后可查。
- **`mailbox\<线程id>.md`**——滞留镜像：发件箱里每条 parked 消息的人类可读副本，滞留原文随时能看，不用等投递成功。

## 跨机对端不在名单里

名单是本机的——这是设计不是缺陷：对端会话登记在对端机器的注册表里。跨机要查名单：ssh 形态用 `ssh <对端> crosschat status`（[第2课](../tutorial/lesson-2.md)），tcp 星用 `crosschat status --via tcp:<机器>` 远程枚举（[第3课](../tutorial/lesson-3.md)）。查到名字再发，别赌名字发送。
