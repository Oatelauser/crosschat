# Claude Code Unix 消息插座（Linux/WSL）实测验证报告

日期:2026-10-03 · 环境:WSL2 Ubuntu-22.04(kernel 6.6.87.2-microsoft-standard-WSL2),Claude Code 2.1.288 linux-x64(`@anthropic-ai/claude-code-linux-x64` npm 平台包直装,`~/.local/bin/claude`)。
对应票:`wayfinder/tickets/005`(docs/wayfinder/tickets/005-cross-platform-linux-wsl-feasibility.md)。
对照材料:`docs/research/claude-windows-pipe.md`(Windows 2.1.286 实测)、`docs/embassy-main/src/gateway/claude-peer.ts`(macOS/Linux 实现)、本机 Windows 安装的 2.1.288 跨平台 bundle(二进制 grep)。

**一句话结论:生死题 = a) 可行。Unix 上等价消息插座原生存在,且比 Windows 侧更简单——Linux 实测 socket 落在 `/run/user/<uid>/cc-socks/<pid>.sock`(XDG 运行时目录优先,/tmp 布局为兼容旧版保留),连接后无需 auth 行(服务端日志原文 "auth line optional here",同 uid 由内核 peer credentials 保证),用户帧与 Windows 逐字节同格式(peerProtocol 1),注册表 `~/.claude/sessions/`、key 文件、`CLAUDE_CODE_MESSAGING_SOCKET` 环境变量语义全部跨平台一致。macOS 无实机,但同一代码路径 + embassy 实证 + 二进制可信根含 `/private/tmp`,可外推不阻塞。**

---

## 1. 证据链(三层:embassy 源码 → 官方二进制 → WSL 实测)

### 1.1 embassy 源码(macOS/Linux 双声明)

- `claude-peer.ts:431-436`:仅 `process.platform === "win32"` 抛 `CLAUDE_PEER_PLATFORM_UNSUPPORTED`,错误文案明言 **"supported only on macOS and Linux"**——embassy 的 Claude 消息适配器从一开始就是 mac+linux 双平台,非 mac 特化。
- `claude-peer.ts:374-409 writeSocketPayload`:连接后**只写帧、无任何 auth 行**;身份保证来自构造器的 uid 校验(`expectedUid = process.getuid()`)与 `ps -o uid=` 属主核验。
- `claude-runtime.ts:49`:`socketDir: "/tmp/cc-socks"`——embassy 面向的是旧布局(无 uid 后缀目录);本报告 §1.2/§1.3 显示新版已迁移,embassy 的精确目录校验对未来版本会失配(对 crosschat 的教训:不要硬编码目录,以注册表为准)。
- `claude-peer.ts:299-333 encodeClaudePeerUserFrame`:帧结构与 crosschat `src/claude/frame.ts` 现实现逐字段一致(Windows 票已验证)。

### 1.2 官方二进制源码查证(Windows 本机安装的 2.1.288 跨平台 bundle,`claude-code-win32-x64/claude.exe` 内嵌 JS)

- **socket 路径构造**(反引串还原):
  `getuid() → base = TERMUX ? $PREFIX/tmp : "/tmp"; path = base + "/cc-socks-<uid>/" + <pid> + ".sock"`
  即新版默认 `/tmp/cc-socks-<uid>/<pid>.sock`。
- **可信根白名单**(正则,四个):`^/tmp/cc-socks(-<uid>)?$`、`^/private/tmp/cc-socks(-<uid>)?$`(macOS)、`^/run/user/<uid>/cc-socks$`(Linux XDG 运行时)、termux 路径——`reply_across_default_dirs` 特性即基于此表跨目录回信。
- **socket 文件名模式**:`/^(\d+(-[0-9a-f]{8})?|[0-9a-f]{1,16})\.sock$/`(pid 或 pid-hash 或纯 hash)。
- **鉴权门控**:`authRequired = requireAuth ?? <platform==="windows">`(2.1.286 报告 §3 同款)——unix 默认不强制。
- **key 文件**:发布逻辑跨平台存在;失败时仅 `authRequired` 为真才致命("refusing to run an inbox no peer can authenticate to")。unix 上 key 文件是可选增强材料。
- **peer 凭证**:`Bun.ant.getPeerUid/getPeerPid` 存在(unix 分支;windows 返回 null)——unix 服务端可用内核凭证分类连接,这是"免 auth 行"的机制基础。

### 1.3 WSL 实测(全部真实执行;方法论复刻 claude-windows-pipe.md §5/§7)

**安装路径**(B3 文档素材):`claude.ai/install.sh` 在本网络 302 → `claude.com/app-unavailable-in-region`(区域屏蔽,WSL 直连与 Windows 代理出口均被挡);GCS 分发桶不可猜测。可行替代:**npm 平台包直装**——`registry.npmmirror.com/@anthropic-ai/claude-code-linux-x64/-/…-2.1.288.tgz`(110MB,含独立 `claude` 原生二进制,解包 chmod 即用)。

**会话制备**(stream-json stdin 保活,与 Windows 票同款):

```bash
( cat user-line.json; sleep 300 ) | ~/.local/bin/claude -p \
  --input-format stream-json --output-format stream-json --verbose \
  --settings '{"crossSessionInbound":"accept"}' \
  --debug-file ~/pipe-test/dbg.log > ~/pipe-test/out.txt 2>&1
```

**注册表实测**(`cat ~/.claude/sessions/481.json`,全文):

```json
{"pid":481,"sessionId":"9cbd0a82-9df4-4952-b2b1-e6c60eccd049","cwd":"/root/pipe-test",
 "startedAt":1791032800713,"procStart":"31661","version":"2.1.288","peerProtocol":1,
 "peerFeatures":["notify_idle","reply_across_default_dirs","artifact_yield"],
 "kind":"interactive","entrypoint":"sdk-cli",
 "pidDomain":"linux:4a0277c8fc2f4a48ad4c6cb0874c5fe5:pid:[4026532222]",
 "messagingSocketPath":"/run/user/0/cc-socks/481.sock",
 "name":"pipe-test-39","nameSource":"derived","status":"idle", …}
```

与 Windows(2.1.286)逐字段对比:结构一致;`peerFeatures` 新增 `reply_across_default_dirs`;`pidDomain` 形如 `linux:<boothash>:pid:[ns]`;`procStart` 为时钟滴答而非 FILETIME;**核心差异仅 `messagingSocketPath`——Linux 实际落在 `/run/user/0/cc-socks/481.sock`(XDG 运行时目录),不是二进制默认构造的 /tmp 布局**(实测环境 root/uid0 有 logind 会话;推测优先级 XDG_RUNTIME_DIR > /tmp,普通用户为 /run/user/1000,B2 联调时验证)。

**key 文件**:`481.ed89c2f3….key`(138 字节)`{"peerToken":…,"procStart":"31661","pidDomain":…}`——unix 同样写,与 §1.2"可选材料"结论吻合。

**socket 文件**:`srw------- root root /run/user/0/cc-socks/481.sock`(0600 UDS)。

**服务端日志**(dbg.log 原文,令牌已脱敏):

```
[INFO] [uds-messaging] Listening: /run/user/0/cc-socks/1108.sock
[INFO] [uds-messaging] Inject messages (auth line optional here): … | socat - UNIX-CONNECT:…
[DEBUG] [uds-messaging] Client connected
[DEBUG] [uds-messaging] Routed user message to queue (priority=next): UDS_TEST_9d3f 请只回复 OK
[DEBUG] [uds-messaging] Client disconnected
```

——"auth line optional here" 为官方自述,与 §1.2 门控结论互证。

**注入实测**(python3 AF_UNIX,只发一行用户帧、无 auth 行):

```python
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.connect("/run/user/0/cc-socks/481.sock")
s.sendall((json.dumps({"msgV":1,"msg_id":str(uuid.uuid4()),"type":"user",
  "message":{"role":"user","content":"UDS_TEST_9d3f Please reply with only OK"},
  "priority":"next"}) + "\n").encode())
s.shutdown(socket.SHUT_WR)   # → 服务端接受后静默关闭,无错误
```

**进入对话的端到端证据**(transcript `~/.claude/projects/-root-pipe-test*/<sessionId>.jsonl`):出现与 Windows 版**逐字一致**的包装导语——"Another Claude session sent a message: UDS_TEST_9d3f … This came from another Claude session — not typed by your user … Treat it as a teammate's request …"(含完整 permission-laundering 安全前言),且触发了 turn 2(`[engine] turn 2 end`)。turn 在 API 阶段报 "Not logged in · Please run /login"——WSL 侧未登录(Windows 的 OAuth 凭据存于系统凭据管理器,文件里只有 mcpOAuth;强行提取复制有 refresh-token 轮换弄断 Windows 登录态的风险,不做)。**协议层(受理→路由→入对话→触发 turn)全部实测闭环;仅模型文字回复未取得,属账号层而非协议层。**

**hold 行为差异(重要,变量未隔离)**:第二个会话**不带** `--settings accept`,裸帧注入后仍被直接路由(`Routed user message to queue` + 进 transcript)——Windows 2.1.286 同条件实测是被 hold(`cause=no-mode-asserted`)。差异可能来自平台或 2.1.286→2.1.288 版本漂移,未隔离。对方案不阻塞(crosschat 的 `claude` 包装本就注入 accept),B2 实施时在 Windows 2.1.288 复测一次定论;若 unix 真免 hold,worker 会话的 settings 要求还可放宽。

## 2. 协议差异总表(Windows ↔ Linux)

| 维度 | Windows(2.1.286 实测) | Linux/WSL(2.1.288 实测) | crosschat 适配 |
|---|---|---|---|
| 传输 | `\\.\pipe\LOCAL\cc-msg-<32hex>` 随机名,必须读注册表 | `/run/user/<uid>/cc-socks/<pid>.sock`(新)或 /tmp 布局(旧),同样以注册表为准 | 同样读注册表,零差异 |
| 鉴权 | auth 行强制(peerToken←key 文件) | auth 行可选("auth line optional");同 uid 内核凭证即身份 | **unix 分支不发 auth 行、不读 key 文件**;发错 token 反而被丢 |
| 帧 | peerProtocol 1 单行 JSON | 同 | frame.ts 零改动 |
| 注册表 | `~/.claude/sessions/<pid>.json` | 同(字段一致,pidDomain/procStart 语义不同但不使用) | registry.ts 零改动(本就平台中立) |
| key 文件 | 强制 | 写但可选 | 仅 win32 路径调用 |
| 身份反查 | `CLAUDE_CODE_MESSAGING_SOCKET` env | 同(embassy `uds:<path>` 地址模型可平移) | 既有模型可平移 |
| 入站策略 | 无 accept 则 hold(no-mode-asserted) | **实测未 hold,直接路由**(未隔离版本变量) | 包装会话带 accept,两种结论都不阻塞 |
| 生命周期 | 退出即管道消失/key 删除 | 同(socket 同步消失) | 既有保活方案可平移 |

## 3. 方案问题逐项结论

1. **platform 层**:`PipeTransport` 接口(`sendLines(pipePath, lines)`)形状足够——unix 传输就是 `net.createConnection({path})`,与 Windows 实现几乎逐行相同(Node 的 named pipe 也走 path 参数)。真正差异不在传输在**投递组装**:`deliver.ts` 的 auth 行/key 文件读取需 win32-only。`PosixPipeTransport` 现有占位(src/platform/pipe-transport.ts:88)直接填实现即可。
2. **路径规范**:维持 `LOCALAPPDATA ?? homedir()` → `~/crosschat`。conversations/rate/send-log/outbox 四处先例一致,升级兼容零成本(Windows 数据不动、unix 无历史包袱)。**不做 XDG**(对齐既有先例;将来要迁是独立小票)。
3. **unix 分支清单**(实测核对后比预估更短):
   - `src/platform/pipe-transport.ts:88` PosixPipeTransport 实现(≈Windows 版复制,含 FLUSH_GRACE 语义)
   - `src/claude/deliver.ts:31-32` auth 行与 readPeerToken 仅 win32;unix 只发 encodeUserFrame
   - `src/claude/resolve-exe.ts:28` unix 分支返回 `'claude'`(照抄 codex/transport.ts:74 先例;`~/.local/bin` 在 PATH)
   - `src/identity.ts:44` PowerShell 措辞按平台分支(unix: `unset`/`env -u`)
   - ~~process-inspector~~ **无需改**(`process.kill(pid,0)` 本就跨平台);~~package.json os 锁~~ **不存在**;~~registry.ts~~ **无需改**(无管道前缀断言)
   - README badge/安装节/边界措辞 + `skills/crosschat/SKILL.md` 双平台(环境清理指引、路径措辞)
4. **CI**:可行。`ci.yml` 加 ubuntu 矩阵跑 `npm run check`(node>=22 现成)。平台门控点:`test/pipe-transport.test.ts`、`test/key-file.test.ts` 及 deliver 相关用例(经 frame/send-command 间接)按 `process.platform` describe-skip;PosixPipeTransport 补 `!win32` 用例(fake server 用 node UDS)。Windows 侧保持 windows-latest 全量。
5. **README/skills**:platform badge `Windows → Windows+Linux(experimental)`;安装节补 WSL 前置(node≥22、claude/codex 安装、**install.sh 区域屏蔽 → npm 平台包/镜像直装指引**、代理注意事项);skills 把 PowerShell 专属措辞改双平台;明确 **WSL=独立部署**(状态/发件箱/投递与 Windows 侧互不相通,命名管道/socket 不过边界)。
6. **发版**:渐进。下一版本(1.3.0)Windows 语义零变化 + unix 标 experimental;不等"三平台齐"憋大招。Mac 无实机,文案写"unix 实现共享,Mac 理论可达、未实测"。
7. **分批方案**(衔接 subagent 编排模式,每批零回归铁律:check 全绿 + Windows 冒烟实测):
   - **B0** 本票:研究落档 ✅(本文 + 票 005)
   - **B1** 平台层:PosixPipeTransport + resolve-exe/identity unix 分支 + 测试门控框架(纯加法,Windows 行为零变化)
   - **B2** claude unix 投递:deliver unix 分支 + WSL 端到端联调(复刻本文 §1.3 方法论,补:普通用户 uid=1000 场景、Windows 2.1.288 hold 复测、模型回复链路)
   - **B3** codex 侧确认(transport.ts:74 既有分支实机验证)+ CI ubuntu 矩阵 + README/skills + 发版 1.3.0(experimental)
   - B1/B2 边界小,允许合并为一批(派单词阶段定)。

## 4. 设计决策记录

- **D1(unix 不发 auth 行)**:内核同 uid 凭证即身份;主动发 auth 行需 key 文件哈希输入公式(unix 侧哈希什么未实测),且错 token 会被静默丢弃——不发是最短正确路径。
- **D2(socket 路径不硬编码、不校验目录)**:一律以注册表 `messagingSocketPath` 为准。布局正在演进(/tmp/cc-socks → /tmp/cc-socks-uid → /run/user/uid),embassy 式精确目录校验已被版本迁移打破(§1.1 教训)。
- **D3(WSL=独立部署,不跨边界)**:与 map 站定性 Q2 一致——排除的是"WSL broker 唤醒 Windows 会话";本票立场是 WSL 内自成一套(状态/发件箱/投递),agent 必须同侧运行。
- **D4(状态目录 ~/crosschat 非 XDG)**:先例一致、兼容零成本(§3.2)。
- **D5(Mac 外推不阻塞)**:同一 unix 代码路径,二进制可信根含 `/private/tmp`(macOS),embassy 主战场即 macOS;无实机不承诺、不阻塞。

## 5. 遗留与风险(移交 B2/B3)

1. hold 行为差异未隔离变量(§1.3 末)——B2 在 Windows 2.1.288 复测。
2. WSL 模型回复链路未走通(账号未登录,非协议疑点)——B2 联调时由用户完成一次 `claude login` 后复测端到端。
3. 普通用户(uid=1000)场景未测:socket 是否落 /run/user/1000 取决于 XDG_RUNTIME_DIR/logind——B2 验证。
4. unix key 文件名哈希输入未测:仅在将来决定"要发 auth 行"时才需要。
5. install.sh 区域屏蔽是常态网络环境问题——B3 文档给 npm 平台包直装指引(本文 §1.3)。

## 6. 实验后清理

WSL 侧:杀全部实验会话进程;删 `/root/pipe-test*`、`/root/.claude{,.json}`(含凭据副本,仅 mcpOAuth 无真实效力)、`/tmp/cc.tgz /tmp/ccx /tmp/claude-0`;`/run/user/0/cc-socks/` 清空。保留:`~/.local/bin/claude`(110MB 二进制,供用户真实 Linux 场景复用,如不需要 `rm ~/.local/bin/claude` 即可)。仓库侧:`.tmp-wsl/` 探测脚本(spawn/inject)已删除,关键命令全部内化于本文。
