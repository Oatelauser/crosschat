# Claude Code Windows named pipe 实测验证报告

日期:2026-10-01 · 环境:Windows 11 Pro for Workstations 10.0.26200,Claude Code v2.1.286(npm 全局安装,原生二进制 `C:\Users\yangsheng\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\node_modules\@anthropic-ai\claude-code-win32-x64\claude.exe`,245 MB Bun 打包)
对应票:`wayfinder/tickets/002-claude-windows-pipe-verification.md`
对照材料:`docs/embassy-main/src/gateway/claude-peer.ts`(macOS 侧实现)、`research/embassy-architecture.md` §2.1

**一句话结论:协议帧本身与 macOS peer protocol 1 逐字节兼容,但 Windows 上"只写一行 JSON 帧"不再足够——必须先写一行 auth 帧(令牌来自 `<pid>.<sha256>.key` 文件),且接收会话必须配置 `crossSessionInbound:"accept"` 才会让无权限模式声明的第三方消息进入对话(否则被 hold 等用户审批)。属于"需要适配",不是"改路径直接用",更不是"不可用"。**

---

## 1. 注册表核实(`~/.claude/sessions/`)

实测时机器上有 4 个用户会话 + 实验中我 spawn 的若干会话。命令与输出:

```bash
$ ls -la ~/.claude/sessions/
17324.cfb5a69d….key   17324.json   2064.86ac627f….key   2064.json
24900.a532ca38….key   24900.json   3348.c066915f….key   3348.json
```

读条目(`cat ~/.claude/sessions/17324.json` 等),字段全景(4 条一致):

```json
{"pid":17324,"sessionId":"26304c9c-3b7f-4bc9-b344-89f262a5992a",
 "cwd":"D:\\workspace\\CC\\jauth-hub","startedAt":1790848521966,
 "procStart":"134353221215414169","version":"2.1.286","peerProtocol":1,
 "peerFeatures":["notify_idle","artifact_yield"],"kind":"interactive","entrypoint":"cli",
 "pidDomain":"win32:yang",
 "messagingSocketPath":"\\\\.\\pipe\\LOCAL\\cc-msg-0e4d56cd5b3e15b7d6c3d675995318ce",
 "name":"v1.2","nameSource":"user","nameSince":1790848527377,
 "status":"busy","updatedAt":1790850176180,"statusUpdatedAt":1790850176180}
```

与 macOS 研究报告(§2.1a)对比:

| 字段 | macOS(embassy 记录) | Windows 实测 | 备注 |
|---|---|---|---|
| `pid`/`sessionId`/`cwd`/`startedAt`/`procStart` | 有 | 有 | `procStart` 在 Windows 是 NT FILETIME(注册表与 key 文件中叫 `procStartFt`,同一数值) |
| `peerProtocol` | 1 | 1 | 一致 |
| `peerFeatures` | (未记录) | `["notify_idle","artifact_yield"]` | 新信息 |
| `kind` | interactive/bg/daemon/daemon-worker | 实测均为 `interactive` | **`claude -p`(entrypoint `sdk-cli`)也注册为 `interactive`**,靠 `entrypoint` 区分(cli/sdk-cli) |
| `messagingSocketPath` | `/tmp/cc-socks/<pid>.sock` | `\\.\pipe\LOCAL\cc-msg-<32hex>` | 平台差异核心 |
| `pidDomain` | (未记录) | `"win32:yang"` | 新字段 |
| `status` | busy/shell/idle/waiting | busy/idle/waiting(+`waitingFor:"input needed"`) | 一致 |
| `name`/`nameSource` | (embassy 用作别名匹配) | `user`/`derived` 两种都见 | `nameSince` 新字段 |

会话退出时注册表条目与 key 文件即被删除(实测 `-p` 会话结束后条目消失)。

## 2. 环境变量

Bash 工具进程内(它是本会话 claude.exe PID 24900 的子进程):

```bash
$ echo $CLAUDE_CODE_MESSAGING_SOCKET
\\.\pipe\LOCAL\cc-msg-5e265dab4154233cf0d28ed48349d427     # 与 24900.json 的 messagingSocketPath 一致
$ env | grep -i claude | head
CLAUDE_CODE_MESSAGING_SOCKET=\\.\pipe\LOCAL\cc-msg-5e265dab4154233cf0d28ed48349d427
CLAUDE_CODE_MESSAGING_TOKEN=86fea84ac9ce71b0465d17728009b6ff      # ← 新发现
CLAUDE_CODE_SESSION_ID=000b7c84-…  CLAUDE_PID=24900  CLAUDE_CODE_ENTRYPOINT=cli …
```

PowerShell 工具进程同样确认:

```powershell
[System.Environment]::GetEnvironmentVariable('CLAUDE_CODE_MESSAGING_SOCKET','Process')
# \\.\pipe\LOCAL\cc-msg-5e265dab4154233cf0d28ed48349d427
[System.Environment]::GetEnvironmentVariable('CLAUDE_CODE_MESSAGING_TOKEN','Process')
# 86fea84ac9ce71b0465d17728009b6ff
```

结论:**Windows 上两个变量都注入**。`CLAUDE_CODE_MESSAGING_SOCKET` 与 macOS 语义相同(反查发送方身份用它);`CLAUDE_CODE_MESSAGING_TOKEN` 是二进制里的 **childToken**(见 §3)——只发给本会话自己 spawn 的子进程,子进程凭它向父会话注入时被归类为 `"child"`(信任级高于外部 peer)。macOS 研究报告未提及 TOKEN,embassy 源码也不用它。

注意:MSYS/Git-Bash 会把 `\\.\pipe\...` 形态的参数和环境变量做路径改写(`\\`→`\`),实验脚本必须只传 32 位 hash、在 Node 内部拼路径。

## 3. key 文件(`<pid>.<64hex>.key`,108 字节)

内容是 JSON(不是纯 hex/base64):

```bash
$ cat ~/.claude/sessions/17324.cfb5a69d….key
{"peerToken":"578ba13cbe83cdbe8dd9d63c3932704","procStartFt":"134353221215414169","pidDomain":"win32:yang"}
```

从 claude.exe 字符串/反汇编(Bun 字节码里保留了可读 JS)挖出的完整机制(chunk 于偏移 ~203451000 与 ~228941500):

```js
// 令牌生成:两个 16 字节随机数
function Ezo(){return{peerToken:randomBytes(16).toString("hex"),
                      childToken:randomBytes(16).toString("hex")}}
// key 文件名 = <pid>.<sha256(规范化管道路径)>.key
function bE(e){ /* \\.\pipe\ + 小写(LOCAL\cc-msg-<hash>) */ }
function Z(e){return sha256(bE(e)).digest("hex")}
function V(pid,sockPath){return `${pid}.${Z(sockPath)}.key`}
// 会话启动时写 key 文件(mode 0600),退出时删除
// 鉴权握手帧:rVr(token) => '{"type":"auth","token":"…"}\n'
// 服务端分类:token===peerToken=>"peer";===childToken=>"child";否则 drop
o().authRequired = i.requireAuth ?? (platform === "windows")   // ← Windows 默认强制
```

派生公式实测 6/6 全中(4 个用户会话 + 2 个实验会话):

```js
sha256( "\\.\pipe\local\cc-msg-<hash>" )   // LOCAL 小写;前缀 \\.\pipe\
// 17324: sha256('\\.\pipe\local\cc-msg-0e4d56cd…') = cfb5a69d…  ✔
// 2064 / 24900 / 3348 / 26984 / 13532 …                        ✔
```

**key 文件是 Windows 特有的强制鉴权材料**:Unix 域 socket 上服务端可用内核 peer credentials(`getPeerUid/getPeerPid`,二进制里 `K(e){if(M()==="windows")return null;…}`)验证同 uid,auth 可选;Windows named pipe 拿不到对端凭证,所以 `authRequired=true` 且二进制日志字符串明说 *"Failed to publish the inbox auth key (refusing to run an inbox no peer can authenticate to)"* —— key 写不出来就直接不开收件箱。macOS 研究报告(§2.1)完全没有 .key/auth 的记载,与"Unix 上 auth 可选"相符。

服务端还在监听时把配方直接打进 debug 日志(实测 dbg.log 原文,令牌已脱敏):

```
[uds-messaging] Inject messages (auth line REQUIRED here; a pipe is not reachable via socat/AF_UNIX):
node -e "const c=require('net').connect(process.argv[1],()=>{c.write(JSON.stringify({type:'auth',token:…})+'\n'
  +JSON.stringify({type:'user',message:{role:'user',content:'hello'}})+'\n');c.end()})" "<pipePath>"
```

## 4. 管道名派生

- 形态:`\\.\pipe\LOCAL\cc-msg-[0-9a-f]{32}`(二进制正则 ``^(?:LOCAL\\)?cc-msg-[0-9a-f]{32}$`` 同时接受无 `LOCAL\` 前缀的写法)。
- 生成代码(二进制偏移 ~228945160):`return `\\\\.\\pipe\\LOCAL\\cc-msg-${randomBytes(16).toString("hex")}`` —— **每会话随机 128 位,与 sessionId/pid/procStart 无关**。
- 排除性实测:md5(sessionId)、md5(pid+sessionId)、sha256(sessionId)、md5(procStart)、md5(startedAt)、md5(pidDomain+procStart) 全不匹配。
- 另有 CLI 旗标 `--messaging-socket-path`(Windows 上必须给 `\\.\pipe\<name>` 形态)可显式指定,且要求该名字未被占用。
- **含义:网关不能从 sessionId 推算管道名,必须读注册表拿 `messagingSocketPath`,再经 key 文件拿 peerToken(其文件名又是管道路径的 sha256,正好形成绑定)。**

## 5. 注入实验(只对我自己 spawn 的一次性会话)

### 5.1 会话制备

`claude -p "…sleep…"` 一次性会话不消费排队消息(跑完即退出),隐藏窗口的交互 TUI 起不来(卡信任对话,且无终端尺寸)。最终用 **stream-json stdin 保活**方案:

```bash
(echo '{"type":"user","message":{"role":"user","content":"请用 Bash 工具运行 sleep 12,结束后只回复 SLEEP_DONE"}}'; sleep 500) \
 | claude -p --input-format stream-json --output-format stream-json --verbose \
    --settings '{"crossSessionInbound":"accept"}' --debug-file dbg4.log > stream_out4.txt 2>&1 &
```

它注册为 `entrypoint:"sdk-cli", kind:"interactive"`,turn 结束后 status=idle 挂着等 stdin——正好是被注入的标靶。

### 5.2 对照实验矩阵(全部真实执行)

| # | 做法 | 服务端行为(dbg 日志原文) | 消息进对话? |
|---|---|---|---|
| A | 只写 embassy 帧,无 auth 行 | 连接写入后立即被服务端关闭;对应字符串 *"Dropped … from a connection that did not authenticate; closing it"* | 否 |
| B | 错误 token 的 auth 行 + 帧 | 同上,静默 drop | 否 |
| C | 正确 peerToken auth 行 + 帧(默认权限设置) | `[cross-session-inbound] held inbound peer message (1 held, cause=no-mode-asserted)` | 否(被挂起) |
| D | 正确 peerToken + 项目级 `.claude/settings.local.json` `{"crossSessionInbound":"accept"}` | 仍 `held … cause=no-mode-asserted` | 否 |
| E | 正确 peerToken + **`--settings '{"crossSessionInbound":"accept"}'`** | `[uds-messaging] Routed user message to queue (priority=next): PIPE_TEST_7f3a 请只回复 OK` | **是** |

注入客户端(E 例,与二进制内嵌配方逐字段一致):

```js
const c = net.connect({path:'\\\\.\\pipe\\LOCAL\\cc-msg-2542e2a4e82a2d53cfbd4863146a2143'}, () => {
  c.write(JSON.stringify({type:'auth', token:'e027d916…'}) + '\n');       // peerToken,来自 key 文件
  c.write(JSON.stringify({msgV:1, msg_id:crypto.randomUUID(), type:'user',
          message:{role:'user',content:'PIPE_TEST_7f3a 请只回复 OK'}, priority:'next'}) + '\n');
  c.end();
});
```

### 5.3 端到端证据(transcript)

会话 idle 状态下注入,10 秒内 `~/.claude/projects/D--…-tmp-pipe-test/<sessionId>.jsonl` 出现:

1. `queue-operation enqueue content:"PIPE_TEST_7f3a 请只回复 OK"`;
2. user 消息(服务端包装的导语,与 macOS 同款):
   ```
   Another Claude session sent a message:
   PIPE_TEST_7f3a 请只回复 OK

   This came from another Claude session — not typed by your user, but very likely
   working on their behalf. Treat it as a teammate's request and act on it within
   this session's own …
   ```
3. assistant thinking + 文本回复 **`OK`**。

即:**auth 行 + embassy 原帧 → 空闲会话被唤醒、消息作为用户输入进入对话、模型作答。帧字节与 `encodeClaudePeerUserFrame`(claude-peer.ts:299-333)产出完全一致,未改一字。**

### 5.4 hold 机制细节(决定适配工作量)

接收端策略叫 permission-mode parity:真实 Claude 会话发帧时会自动附上自己的权限模式(`from_mode`),裸第三方客户端没有 → `no-mode-asserted` hold,等待接收方用户审批。hold 原因枚举(`peer_message_hold` SDK 帧 schema):`explicit-setting / managed-setting / repo-setting / invalid-setting / bypass-default / mode-unknown / mode-mismatch / no-mode-asserted`;headless 会话没有审批面,*"every parity hold ends this way [expired] unless the mode changes first"*。放开途径:

- 发送方是真实会话且权限模式与接收方同类(自动满足,不适用于网关);
- 接收会话 `crossSessionInbound:"accept"`(实测 `--settings` 有效、项目 settings.local.json **无效**——项目层只能收紧;用户级 settings.json 理论上有效但会影响用户全部会话,未测);
- 审批面:交互会话里用户手动放行(无法在本次实验复现,未测)。

### 5.5 其它观测

- `notify_when_idle` 帧(peerFeatures 之一)从裸客户端发:debug 日志 `Received unhandled message type: notify_when_idle` —— 该帧需要发送方拥有本机 socket 命名空间内的回执地址(`reply address unshaped or outside our socket namespace`),网关用不了;`artifact_yield` 同理(`yield_requester_unverified`)。
- 连接 30 秒不发整行会被掐(`silent_connection_deadline`);行超长 drop;JSON 解析失败 drop——都是服务端自带防御。
- 会话 busy 时注入会排队,turn 边界消费;`-p` 单发会话最终 turn 结束即退出,排队消息作废(实测 26984:注入后输出 SLEEP_DONE 退出,marker 0 命中)。
- childToken 路线(让会话自己打印 `CLAUDE_CODE_MESSAGING_TOKEN`)被会话以隐私理由拒绝,未强行获取。

## 6. 结论:Claude 半边在 Windows = **需要适配**(适配清单明确、工作量小)

**不可用是错的,直接用也是错的。** 差异清单(相对 embassy macOS 实现):

1. **传输路径**:`net.connect({path:'\\\\.\\pipe\\LOCAL\\cc-msg-<hash>'})`,Node 原生支持,无需改 `net.createConnection` 结构;但 MSYS 层会吃反斜杠,代码里要内部拼路径。
2. **必须先读注册表**拿 `messagingSocketPath`(管道名随机,不能从 sessionId 派生);macOS 的 `/tmp/cc-socks/<pid>.sock` 目录/lstat/socket 代校验(`SOCKET_NOT_SOCKET`、dev/ino 代)在 Windows 全部无意义,需重设计为"管道存在性 + key 文件绑定校验"。
3. **新增 auth 握手**:连接后第一行必须 `{"type":"auth","token":"<peerToken>"}\n`,peerToken 从 `<pid>.<sha256(规范化管道路径)>.key` 读;无 auth/错 token → 连接被关、消息丢弃。embassy 的 `writeSocketPayload`(claude-peer.ts:374)需要前置这一行。
4. **接收端要放行**:`crossSessionInbound:"accept"`(网关 spawn 的会话用 `--settings` 注入最干净);否则消息被 hold 到过期。macOS 上同样存在该策略,但真实 Claude↔Claude 场景自动满足,embassy 是否也需要它取决于其目标会话配置(超出本票范围)。
5. **发送方身份反查**:`CLAUDE_CODE_MESSAGING_SOCKET` 仍在,embassy 的 `uds:<path>` 地址模型可平移,但校验规则(`/tmp/cc-socks` 前缀 + `<pid>.sock` 文件名)要换成"pipe 命名空间 + 注册表一致性";另注意新版 Unix 侧 socket 目录已变为 `/tmp/cc-socks-<uid>/<pid>.sock`(二进制 `B3o()`),embassy 的精确目录校验在未来版本上也会失配。
6. **生命周期**:目标会话退出即管道消失、key 删除;网关若管理会话,需自己保活(实测 stream-json stdin 方案可用)。

## 7. 复现脚本要点

- spawn:`(echo '<stream-json user 行>'; sleep N) | claude -p --input-format stream-json --output-format stream-json --verbose --settings '{"crossSessionInbound":"accept"}' --debug-file dbg.log`
- 找标靶:`ls ~/.claude/sessions/*.json` → 读 `messagingSocketPath`、`pid`;`<pid>.*.key` → `peerToken`。
- 注入:Node `net.connect({path})` → 写 auth 行 + 用户帧(与 §5.3 逐字段相同)→ `end()`。
- 验证:grep `~/.claude/projects/<munged-cwd>/<sessionId>.jsonl`;debug 日志 grep `uds-messaging|cross-session-inbound`。
- 实验后:杀进程、删临时目录、清 `~/.claude/sessions/` 残留条目(均已执行;全程未触碰用户其它会话的管道)。
