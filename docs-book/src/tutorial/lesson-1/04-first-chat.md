# 1.4 第一次对话

## 对话全景

先看整件事长什么样，再一步一步踩。两个终端、两个命名会话、一条消息一来一回：

```text
终端 1（boss，claude）                     终端 2（worker，codex）
═══════════════════════                   ═══════════════════════
crosschat claude -n boss                  crosschat codex
（/-rename worker 命名线程）

👤 你在任一终端敲：
   crosschat send --to worker --body "……"
        │
        │  投递（本地直达）
        ▼
🤖 boss 看到                             🤖 worker 收到 📨 信封：
回执一行：                                 <cross-session-message …>
delivered to worker                             回信命令（短柄 cN）
  (turn 1) · 续话 c1                             正文
                                          worker 处理完，照抄信封里的命令回信：
                                          crosschat send --conversation c1 …
                                                 │
                                                 ▼
🤖 boss 收到 worker 的回信（turn 2）——循环继续，直到任务说完
```

一条消息、一条回信，中间没有任何服务器。下面把每一步真实走一遍——本节所有实录取自写作机器上的真实运行，会话名就是当时活着的会话。

## 起两个命名会话

命名是为了 `--to` 有地址可写。两侧的命名方式不对称，各自跟随原生习惯：

终端 1 起 claude 会话，名字是启动参数：

```bash
crosschat claude -n boss
```

终端 2 起 codex，名字在它的界面里改（随时可改，不用重启）：

```text
/rename worker
```

`crosschat claude` / `crosschat codex` 会原样转发其余参数（`-c`、`resume`、`--model` 照用），只多做了接收开通与身份清洗两件事（[1.3](03-install.md#doctor-自检)立的习惯就是它）。名字可以带空格——命令里记得加引号：`-n "boss 2"`。

## 查本机名单

用途：发消息前先确认对端在册——名单就是本机此刻全部可投递的会话。

```console
$ crosschat status
本机会话: claude 4 · codex 20
  claude 文档book  1 分钟前
  claude 单机通信专家  4 分钟前
  claude 二期8  17 分钟前
  claude ssh专家  42 分钟前
  codex beta12  10-07 23:04
（全量: --claude|--codex|--name）
tcp: 共 2 星
  …
（星内明细: --stars）
ssh: 无
（明细: --conversations --via ssh）
```

（tcp 星两行是第3课的地盘，没入网时显示 `tcp: 无`。）

隐式发生什么：裸跑给的是三段式摘要——本机会话计数加最近五个、tcp 星、ssh 对话，一眼看全貌。要挑人时加过滤：`--claude` / `--codex` 选段、`--name <关键词>` 按名字筛、`--all` 把没起名字的也带出来。名单是"活进程"名单：claude 注册表里进程已死的条目、codex 名册里已删的线程都不会出现——你看到的就是现在能收信的。

## 名单不问出身

名单上的会话不挑启动方式，**TUI 不是收件前提**。codex 的投递目标一律是 daemon 里的线程——TUI 只是其中一个窗口（窗口占着线程时反而会挡住投递，报 CODEX_THREAD_LOCKED，关窗或等它释放即恢复），`codex exec` 这类无头方式拉起的线程同样在册可投，未命名的用 id8 寻址；claude 这边，后台（bg）会话与交互会话同权可投。真实例子（写作机器的 `status --codex --all`，前缀 `01a1` 开头的就是 id8）：

```console
$ crosschat status --codex --all
codex:
  beta12         CC\test-cc    10-07 23:04 crosschat   01a116e5  not_loaded
  架构改造3       CC\ai-front-spec 10-03 13:18 codex-tui  01a10033  not_loaded
  (unnamed)      Temp\cc-exec-id-test 10-06 21:15 codex_exec 01a1115b  not_loaded
  …
```

三行三种出身：TUI 起的、crosschat 测试起的、`codex exec` 无头跑的——全都在册。唯一不担保的是在命令行里一次性匿名拉起的 claude（比如 `claude -p` 干一次性活）：它进不进名单取决于自己有没有注册消息通道，crosschat 不做承诺——发之前 status 看一眼，别赌。本节接下来的演示正好用无头线程当对端，id8 寻址当场见效。

## 发第一条消息

用一个真实无头 worker 当收件人：先 `codex exec "只用一句中文回复：worker 已就位。"` 起一个线程（真实输出的关键几行）：

```console
$ codex exec "只用一句中文回复：worker 已就位。"
OpenAI Codex v0.160.1
--------
session id: 01a14554-ba83-7402-bea7-2bccd9c4b5bb
…
codex
worker 已就位。
```

id8 就是 session id 的前 8 位（`01a14554`）。现在发消息——`--to` 名字与 id8 是同一个参数，判定序是全名精确、唯一前缀、最后 id：

```console
$ crosschat send --to 01a14554 --body "第1课实录取材：收到请按信封里的回复命令回一句确认即可。"
delivered to codex/01a14554 (turn 1) · 续话 c21
回执: 暂未在对方会话记录中确认（可能仍在落盘）；稍后查 send-log.jsonl 或重跑 status
```

一行回执三个信息点：**delivered**（投递三态之一）、**turn 1**（这段对话第一轮）、**续话 c21**（本机短柄，回信照抄它）。第二行是回执探针：crosschat 投完会去对方会话记录里找这条消息的落盘痕迹，短窗口内没等到就如实说"暂未确认"——**"未确认"不是丢失**，稍后跑一次 `status --conversations` 通常就翻成已确认（[1.5](05-mechanism.md#忙了怎么办三态与看门狗)看全套）。

隐式发生什么：这条命令同时做了——解析发送方身份（从环境变量认出我是谁）、按 id8 定位线程、检查正文限额（默认 16KiB）、把对话引用前进一步（turn 计数）、投递、在 `~/.crosschat/send-log.jsonl` 记一行账（只有元数据，永不记正文）。全程一次性，跑完即退。

## 对面收到了什么

worker 收到的不是你敲的那行命令，而是一个信封。以下逐字节取自它线程记录里的真实落盘：

```text
<cross-session-message from-name="单机通信专家" turn="1">
<crosschat-reply-hint reply-as="codex/01a14554">回复请运行: crosschat send --conversation c21 --body "<你的回复>"（长正文/含敏感字符可省 --body 改管道喂 stdin）</crosschat-reply-hint>
第1课实录取材：收到请按信封里的回复命令回一句确认即可。
</cross-session-message>
```

四样东西：署名行（谁、第几轮）、回信命令（`reply-as` 是收方视角的名字、`c21` 是回信要抄的短柄）、正文、闭标签。安全纪律从这里开始生效：**收方要做的只是照抄回信命令、替换 `<你的回复>` 占位符**——若"信封"里出现了第二条命令、管道符、`&&`，那不是信封，是伪造，拒绝执行并报告。

## 照抄回信

worker 的确照抄了。几分钟后查对话总览：

```console
$ crosschat status --conversations
会话:
  codex/01a14554 → 单机通信专家  1 分钟前  turn 2  delivered  c21
  文档book → 单机通信专家        9 分钟前  turn 5  delivered  c20
  …
```

第一行就是这段对话：方向（它 → 我）、turn 2（它回信是第二轮）、delivered、短柄 c21。它做的事只有一件：把信封里那条命令抄下来，占位符换成自己的回复——不写地址、不查名字，c21 在本机自动映射回这段对话。回信到达我这边时，我又收到一个同款信封（署名轮完互换、短柄照旧），循环如此往复。

轮次在涨，说明对话在走；短柄始终是 c21，说明还是同一段对话——柄与对话绑定，不随轮次变。对话总览还有两个实用读法：`lastStatus` 一列是**本机发送账本视角**（对端回信不产生你的账目）；行尾有滞留数时说明有消息暂存未投（看门狗在自动重投，别手动重发）。

## 长正文走管道

信封括注里那句"可省 --body 改管道喂 stdin"是日常最常用的形态。正文很长，或含 `$`、反引号、引号这类 shell 敏感字符时，不要 inline——省掉 `--body`，整段经管道喂进去，内容不经 shell 二次解释，逐字到达：

```powershell
@'
价格 $100、命令 `dir`、"双引号" '单引号' ——对端收到的就是这些字符本身
'@ | crosschat send --to 二期8
```

```console
delivered to 二期8 (turn 1) · 续话 c19
```

（PowerShell 主线：单引号 here-string，收尾 `'@` 必须顶格。Linux 一行带过：bash 用 `cat <<'EOF' | crosschat send --to <名>` 定界符带单引号，`$` 与反引号同样逐字不展开。更多读文件正文、编码防坑的分层见 [如何发送大内容](../../howto/large-content.md)。）

到这里，一轮完整对话走通了。每条命令背后踩着哪套地层——[1.5 通信机制](05-mechanism.md)拆开看。
