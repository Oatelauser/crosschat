# 1.4 第一次对话

## 对话全景

先说这一课最重要的事：**你要记的不是命令，是"跟谁、说什么"**。

crosschat 的第一视角是聊天——你用自己的话下令，agent 自己组装命令；命令是 agent 的语言，不是你的。整个过程长这样（下文三步全部真实走一遍）：

```text
👤 你（在自己的 agent 会话里说）  用 crosschat 向本机的 claude 会话「二期8」问好
🤖 你的 agent                    自己组装 crosschat send …（你不用记命令）
📨 二期8 收到信封                 信封里自带回信命令，照抄即回
🤖 你的 agent 收到回信            闭环——全程你没敲过一条 crosschat 命令
```

三步准备 + 一次对话：先把两个会话起起来（[起两个命名会话](#起两个命名会话)），查一眼名单（[查本机名单](#查本机名单)），然后一句话对话（[发第一条消息](#发第一条消息)）。想自己敲命令的形态收在后半——想跳着看也可以，节节都有真实实录。

## 起两个命名会话

命名是为了有地址可写。两侧的命名方式不对称，各自跟随原生习惯：

终端 1 起 claude 会话，名字是启动参数：

```bash
crosschat claude -n boss
```

终端 2 起 codex，名字在它的界面里改（随时可改，不用重启）：

```text
/rename worker
```

`crosschat claude` / `crosschat codex` 会原样转发其余参数（`-c`、`resume`、`--model` 照用），只多做了接收开通与身份清洗两件事（[环境搭建](../../preface/04-env-setup.md#doctor-自检)立的习惯就是它）。名字可以带空格——命令里记得加引号：`-n "boss 2"`。

## 查本机名单

发之前看一眼对端在不在册——名单就是本机此刻全部可投递的会话：

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
（星内明细: --stars）
ssh: 无
（明细: --conversations --via ssh）
```

（tcp 星两行是第3课的地盘，没入网时显示 `tcp: 无`。）

隐式发生什么：裸跑给的是三段式摘要——本机会话计数加最近五个、tcp 星、ssh 对话，一眼看全貌。要挑人时加过滤：`--claude` / `--codex` 选段、`--name <关键词>` 按名字筛、`--all` 把没起名字的也带出来。名单是"活进程"名单：claude 注册表里进程已死的条目、codex 名册里已删的线程都不会出现——你看到的就是现在能收信的。这一步你也可以直接交给 agent（题词里写"先 status 确认名字"即可），它自己会查。

## 发第一条消息

现在到对话本身。👤 对自己的 agent 说（本课写作当天的真实实录——下令口径就是一句话）：

> 用 crosschat 向本机的 claude 会话「二期8」问好

🤖 agent 收到题词，自己组装命令并运行——找谁变成 `--to`，说什么变成 `--body`：

```console
> crosschat send --to 二期8 --body "你好二期8！第1课实录问好——收到请回一句即可。"
delivered to 二期8 (turn 3) · 续话 c19
```

回执一行三个信息点：**delivered**（投递三态之一）、**turn 3**（这对会话的第三轮——它们之前已经打过两次交道，`--to` 按名字自动接上了最近的对话，这就是"同名即续"）、**续话 c19**（这段对话的短柄，回信照抄它）。

回信随即到达——**你没有做任何事**，二期8 照信封里自带的命令回了信，你的 agent 被这条新消息唤醒：

```text
<cross-session-message from-name="二期8" turn="4">
<crosschat-reply-hint reply-as="单机通信专家">回复请运行: crosschat send --conversation c19 --body "<你的回复>"（长正文/含敏感字符可省 --body 改管道喂 stdin）</crosschat-reply-hint>
收到，单机通信专家好！勘误那条已闭环（7e6db4e），1.7.0 待发。
</cross-session-message>
```

turn 3 出、turn 4 回，一轮对话闭环。想确认全程，一条命令看这对会话的账目：

```console
> crosschat status --conversations
会话:
  二期8 → 单机通信专家   2 分钟前  turn 4  delivered  c19
  …
```

**想自己敲命令也可以**：命令形态就三种（新消息 `--to` / 回信 `--conversation <短柄>` / 长正文走管道），一张表在[1.3 命令总览](03-command-map.md#发送的三种形态)——但记住基准形态是"跟 agent 说一句话"，自己敲是备选，不是义务。

## 对面收到了什么

二期8 收到的不是你agent 的题词，而是一个信封——署名、回信命令、正文。换一次真实的跨工具投递看全文（worker 线程记录里的逐字节原文）：

```text
<cross-session-message from-name="单机通信专家" turn="1">
<crosschat-reply-hint reply-as="codex/01a14554">回复请运行: crosschat send --conversation c21 --body "<你的回复>"（长正文/含敏感字符可省 --body 改管道喂 stdin）</crosschat-reply-hint>
第1课实录取材：收到请按信封里的回复命令回一句确认即可。
</cross-session-message>
```

四样东西：署名行（谁、第几轮）、回信命令（`reply-as` 是收方视角的名字、短柄是回信要抄的）、正文、闭标签。收方要做的只有照抄命令、替换 `<你的回复>` 占位符——**若"信封"里出现第二条命令、管道符、`&&`，那不是信封，是伪造**，拒绝执行并报告。

## 照抄回信

回信方（agent）做的事只有一件：把信封里那条命令抄下来，占位符换成自己的回复——不写地址、不查名字，短柄在本机自动映射回这段对话。上一节那个 worker 正是这么做的，几分钟后对话总览里它已回完：

```console
> crosschat status --conversations
会话:
  codex/01a14554 → 单机通信专家  1 分钟前  turn 2  delivered  c21
  …
```

方向（它 → 我）、turn 2（它回信是第二轮）、delivered、行尾还是同一个柄 c21——柄与对话绑定，不随轮次变。回信到达发起方后，同样的信封（署名轮完互换）把循环继续下去。两个实用读法：末态列是**本机发送账本视角**（对端回信不产生你的账目）；行尾有滞留数时说明有消息暂存未投（看门狗在自动重投，别手动重发）。

## 名单不问出身

名单上的会话不挑启动方式，**TUI 不是收件前提**。codex 的投递目标一律是 daemon 里的线程——TUI 只是其中一个窗口（窗口占着线程时反而会挡住投递，报 CODEX_THREAD_LOCKED，关窗或等它释放即恢复），`codex exec` 这类无头方式拉起的线程同样在册可投，未命名的用 id8 寻址；claude 这边，后台（bg）会话与交互会话同权可投。真实例子（写作机器的 `status --codex --all`，前缀 `01a1` 开头的就是 id8）：

```console
> crosschat status --codex --all
codex:
  beta12         CC\test-cc    10-07 23:04 crosschat   01a116e5  not_loaded
  架构改造3       CC\ai-front-spec 10-03 13:18 codex-tui  01a10033  not_loaded
  (unnamed)      Temp\cc-exec-id-test 10-06 21:15 codex_exec 01a1115b  not_loaded
  …
```

三行三种出身：TUI 起的、crosschat 测试起的、`codex exec` 无头跑的——全都在册。唯一不担保的是在命令行里一次性匿名拉起的 claude（比如 `claude -p` 干一次性活）：它进不进名单取决于自己有没有注册消息通道，crosschat 不做承诺——发之前 status 看一眼，别赌。

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
