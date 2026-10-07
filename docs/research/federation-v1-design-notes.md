# 跨机联邦 v1 设计笔记（008 票）

日期：2026-10-06 · 环境：Windows 11 本机 · 零实现代码 · sshd 实验降级说明见 §1

## 0. 关键代码锚点

- `src/commands/send.ts:31-37` SendArgs（via 落点）；`:246-258` body 双通道（--body/stdin 已并存，BODY_CONFLICT 守卫现成）；`:29` 16K 入口检查
- `src/envelope.ts:46-48` reply-hint 模板（跨机回程 --via 的落点）；`:7-8` fromName 64 码点上限（`boss@win` 量级无忧）
- `src/ref.ts:12` RefEndpoint `{p:'claude'|'codex', id}`——无机器字段；`decodeRef` 对未知字段**宽容忽略**（旧 CLI 读新 ref 不炸，只是丢机器信息）——17-2 的兼容性天然成立
- `src/cli.ts:55` valueOpts 手写旗标表（--via 照此加）；`:170` 错误输出 `crosschat: CODE: message`；`:319` exitCode
- `src/identity.ts` resolveCallerIdentity(env, scan)——**隐藏关键点：远端 sshd 环境无 agent env，远端 send 的 caller 会解析成 human，对话将不可回复（CANNOT_REPLY_TO_HUMAN）**。必须由本地把源身份显式带给远端（见 D5 --origin）

## 1. sshd 远端解析实验（降级记录）

`ssh -o BatchMode=yes localhost echo ok` → **Connection refused（本机 sshd 未启用）**。按票面预案降级为分析性结论，以下三项列为**实施批 B1 首验项**（真机 sshd 起后 30 分钟内可全部跑完）：

1. DefaultShell=cmd（Windows 默认）与 =PowerShell 两形态的 PATH 可达性与引号行为矩阵
2. `--body "含 空格"` 经 cmd/PowerShell 的 argv 到达形态（预期：cmd 一层双引号可过；PowerShell 5.x 对 native 参数引号有吞噬史，7.3+ 才修）
3. stdin 管道经 ssh 到远端 node 进程的完整性（预期无损——设计不依赖 argv 传体，此项仅证伪风险）

**分析性结论（设计据此，标注"未经本机实测"）**：Windows OpenSSH 默认 DefaultShell=cmd.exe；cmd 会在 crosschat 进程看到 argv 前解释 `& | ^ %` 等元字符。**规避方式不是转义，是让这些字符根本不进远端 argv**：body 全走 stdin；旗标值域限定安全字符集（base64url/id8/名字）。PowerShell 形态同理。

## 2. 远端命令构造规范（D2 交付物）

```
本地:  <body> | ssh <host> crosschat send --conversation <mc1_ref> --json [--origin <desc>]
```

- **命令面固定**：`crosschat send` 字面 + 少量安全字符集旗标值；不提供远端命令可配（可配=注入面）
- **body 永远 stdin**：三方 shell（cmd/PowerShell/bash）引号地狱与 argv 长度上限同时免疫；远端 `resolveBody` 现成支持（send.ts:246）
- **旗标值安全字符集白名单**：ref=`mc1_[A-Za-z0-9_-]+`、id8/name（名字含空格跨机不推荐，文档引导用 id8/ref 寻址）；`--via` 值（host 别名）禁空格与 cmd 元字符，进命令前做一次白名单校验（防 --via 注入 ssh 命令行）
- **`--json` 收结构化回执**：远端 stdout 是机器可读 JSON（status/to/turn/replyRef/queue），本地解析后按本地格式重渲染——回执语义零翻译损耗

## 3. 十点推荐案

**D1 寻址语法 → `--via ssh:<host>`，host 原样透传 ssh，零自有配置层**
`--via` 只收一个 token（`ssh:` 前缀 + Host 别名），非默认用户/端口/密钥**全部由 ~/.ssh/config 解决**（ssh 原生能力：HostName/User/Port/IdentityFile），CLI 不加任何 ssh 参数旗标。理由：复用既有运维标准；"无必填配置文件"约束不破（ssh config 是可选增强）。传输通用命名空间从第一天建立（`ssh:`/`tcp:`/`broker:`，票 17）。

**D2 远端执行 → 见 §2 规范**（B1 首验项三项兜底）

**D3 回执与错误透传 → stdout JSON + stderr 码模式匹配 + 三层错误码**
- 正常：远端 `--json` stdout → 本地重渲染（delivered/queued/parked 文案与单机逐字一致，仅 to 名追加 `@<host>`）
- 远端业务错（exit=1）：stderr 首行匹配 `crosschat: (\w+):` → 本地抛**同码** MultichatError，消息前缀 `[via <host>]`（MESSAGE_TOO_LARGE 等自纠指引原样有效）
- 远端未知错（exit=1 无码模式）→ `REMOTE_FAILED`（附 stderr 尾部）
- ssh 自身失败（exit=255：不通/鉴权拒/超时断）→ `SSH_TRANSPORT_FAILED`，指引：`ssh <host> crosschat --version` 探活（顺带验版本，票 13）、查密钥与网络
- 本地 spawn 超时（默认 120s，ConnectTimeout=10s）→ `SSH_TRANSPORT_TIMEOUT`，文案对齐既有 UNCERTAIN 纪律：**状态不明勿盲目重发**，指引查远端 send-log 或重跑 status

**D4 同步语义 → 远端 parked 即返，与单机对齐**
远端忙时 parked 回执（含队列深度与 mailbox 路径——注意 mailbox 路径是**远端机器的路径**，本地渲染时标注 `（位于 <host>）`）经 ssh 即刻返回，不等看门狗投完。"发送即完成本轮"纪律跨机成立。超时默认 120s 可 `CROSSCHAT_SSH_TIMEOUT_MS` env 覆写（非必填）。

**D5 跨机回复路径 → ref 端点加 `m` 机器字段 + `--origin` 旗标（本票最重要发现）**
- ref 端点扩为 `{p, id, m?}`，**无 m = 本地**（17-2；decodeRef 对未知字段宽容，旧新互读不炸）；m 的值 = `os.hostname()`（零配置，hostname 是三平台公约数）
- **`--origin <p>:<id8>@<host>`**：本地发起跨机 send 时自动构造（本地 caller 身份 + 本机 hostname），作为远端命令的一个旗标注入——远端用它充当 caller 身份（fromName、ref.f、send-log.from），**解决 sshd 环境无 agent env 的身份塌缩**（§0 隐藏关键点）。agent 不可见此旗标（信封照抄路径不含它）
- 信封 reply-hint 跨机自动形态：`crosschat send --via ssh:<ref.f.m> --conversation <ref>`——回程 via 取自 ref 里的 m，接收方照抄即可回。**残险（v1 接受）**：对端 ssh config 若未覆盖发起方 hostname，回复报 SSH_TRANSPORT_FAILED 并指引（加 config 别名或换 id8+--via 手动）——部署清单写明"互知 hostname 或配别名"
- 显示名最小集：fromName 追加 `@<host>`（64 码点内）；跨机会话视图不做（票 14）

**D6 maxBodyBytes → v1 确认不需要**
本地入口 16K 检查对跨机发送同样经过（send.ts:65 在 via 分支之前），远端 CLI 再查一次同码报错——双层不冲突。"用满 codex 1M"与联邦解耦单列（增强，非本票）。

**D7 skill 增量 → 三行，信封结构零改动**
① 跨机发送示例一行（`crosschat send --via ssh:<host> --to <名字/id8> --body "..."`）；② "对端机器与名字用 status/题词获知，hostname 须可达"注记；③ 跨机轮次纪律标注（限流器单机记账，turn 计数是唯一防线——票 11）。安全纪律已在 SKILL.md（b3f58c6），照抄面自动覆盖跨机形态，不重复。

**D8 部署清单 → README 折叠节**
三平台矩阵表（任意→Linux 天然 / →Windows 装 OpenSSH Server+PATH / →Mac 开远程登录）+ 机器通道密钥两步（keygen + copy-id，密码共存）+ 自证 `ssh <host> crosschat --version` + **接收侧 claude 须 `crosschat claude` 启动**（17-3）+ 接收侧 codex daemon 要求 + hostname 互知注记。

**D9 零回归判据**
`--via` 缺席 → runSend 现路径字节级一致（全部新逻辑在 via 早分支后，send.ts 入口守卫顺序不动）；既有测试零改动全绿；新增单测：via 值白名单校验、ssh 命令行构造断言（mock spawn）、回执 JSON 解析重渲染、三层错误码映射。

**D10 分批 → B1/B2/B3，其中 B1 吸收原 B2 的错误映射（边界耦合紧）**
- **B1 寻址+远端执行+回执透传+错误码映射**（~150 行）：--via 解析/白名单、ssh spawn（stdin 管道、--json、--origin 构造）、stdout/stderr 三层映射。首验项：§1 三实验
- **B2 回复路径**（~100 行）：ref `m` 字段、--origin 远端侧消费、信封 reply-hint via 形态、parked 的远端路径标注
- **B3 文档+联调**：README 部署节、skill 三行、抽样联调 2-3 向（建议 win→wsl、wsl→win、claude→codex 跨机各一），其余六向按"远端行为=单机行为"组合子论证（票 15）放行
- 全程衔接 subagent 编排（主会话派单/验收/提交）与零回归铁律

## 4. 备选与否决记录（防复审重走）

- **自有别名层/ssh 参数旗标面**（D1）：否决——重建 ssh 已有的运维标准，违反无配置约束
- **argv 传 body + 引号转义**（D2）：否决——三方 shell 转义矩阵不可收敛，stdin 一招全免
- **远端命令可配**（D2）：否决——可配即注入面，固定字面最安全
- **跨机共享限流**（票 11）：v1 不做——无共享存储（无 broker），轮次计数 + skill 纪律够防失控，真失控等 broker 形态
- **m 字段用 ssh 别名而非 hostname**（D5）：否决——别名是对端视角的名字，发起方无法零配置得知自己在对端的别名；hostname 是自描述的，配一次 ssh config 即闭环

## 5. 主会话第五轮俯瞰补录（2026-10-06，拍板前）

- **A · 部署前提明示（并入 D8）**：ssh v1 隐含**双向可达**前提（同 LAN/VPN）。单向可达环境（如对端在 IDC NAT 后、发起方在办公室 NAT 后）反向 ssh 不通——这正是 broker 堡垒机形态的存在动机。部署清单首行写明；hostname 互知注记随之升级为"互达互知"。
- **B · 发起侧审计补全（并入 B1/B2，~10 行）**：跨机发送目前只落远端 send-log，本机无记录——B14 审计原则被绕过。修法：本地收到远端回执后补一条本地 send-log（fromName 带 via host 标注），保持"每次投递本机可审计"。
- **C · via 自动补全（可选鲁棒性）**：CLI 在 `--conversation` 的 ref 带 `m` 字段且 `--via` 缺席时自动补 `--via ssh:<m>`。教抄路径已显式带 via，此为手敲漏保险，非必须。

## 6. mc2_ 紧凑 ref 格式（第六轮俯瞰定稿，并入 B2）

用户拍板动机：mc1_ base64url(JSON) ≈296 字符，每轮双方上下文都付一遍。**mc2_ 二进制打包 ≈79 字符（3.7×）**，单机 ≈58。布局：`[flags 1B：两端类型码+id编码方式位+m存在位][f.id][t.id][m_f 长度+串][m_t 长度+串][nonce 6B][轮次 varint]`，纯 Buffer 标准库零依赖，改 ref.ts encode/decode ~60-80 行 + 测试。

规格四要点（第六轮审查产出）：
1. **轮次用 LEB128 varint**（非 1 字节定长——协议不强制终止，长对话可超 127 轮）
2. **id 编码逃生门**：UUID（32-hex）走定长 16B；非 UUID id 走"长度前缀+原始串"，flags 位区分——claude 会话 id 格式漂移不翻车；human 端点零 id 字节
3. **mc1_ 永久兼容解码**，新旧共存零迁移；旧 CLI 读 mc2_ → INVALID_CONVERSATION_REF 错误文案加"对端版本较新，升级本机 crosschat 后回复"（版本偏斜落地细节）
4. **信封回复命令跨机形态不带 `--to`**（第六轮纠错：ref 已含双方端点，--to 冗余且与单机形态不一致）：`crosschat send --via ssh:<m> --conversation mc2_xxx --body "<你的回复>"`——比最初演示更短

## 7. 第七轮俯瞰补录（2026-10-06，B1 派单前）

- **F1 · --origin 编码（规格漏洞修复）**：origin 值含会话显示名（可含空格/unicode），与 D2 旗标值白名单矛盾——定案 origin 整串 base64url 编码传输，远端解码记账（~4 行，免疫引号）。
- **F2 · ssh 固定参数**：补 `-o BatchMode=yes`（交互提示变快速失败，防 agent 首连卡满 120s 超时）；known_hosts 由部署探活步骤预先播种；ConnectTimeout=10s 已有。
- **F3 · 测试捷径**：`--via ssh:localhost` 可零第二台机测联邦全语义，B1 首验与单测复用。
- **F4 · 丢线头**：票 008 决策点 16（CI mac 观察位）至今未落——并入 B3 或独立微批，勿烂尾。
- **F5 · 脚本可用性**：本地 `--json` × `--via` = 远端 JSON 透传 + `via` 字段增补。
- 附注：启用本机 sshd 即开监听端口，防火墙规则按需收窄（用户权衡）。

## 8. 第八轮俯瞰补录（2026-10-06，收尾轮）

- **R1 · 残险归档**：伪造信封可诱导回信至攻击者指定 `--via` 目标（形状合法单命令，纪律拦不住）；前提=已入信任边界（同用户/已认证联邦节点），接受为文档化残险，缓解=skill 纪律+题词角色约束；消息签名留 broker 形态评估。
- **R2 · 零代码性能**：部署文档提示 `~/.ssh/config` 可加 `ControlMaster auto` 复用连接（ssh 原生，摊薄每次握手 100-300ms）。
- **R3 · 微 UX**：未知传输前缀（tcp:/broker:）报错文案带"二期支持"注记。
- 结构性结论：七轮+本轮后设计可施工，余项均为注记级。B1 派单即开工。

## 9. B3 收尾批输入清单（2026-10-07 固化，含用户实测沉淀）

- **README ssh 示例题词用用户原句**："使用 crosschat 发送消息给 beta2 问好，消息要求经过 ssh 管道送到（send 时加 --via ssh:<对端系统hostname>）。需要对方回复并停止。"（占位符承载"别名=对端 hostname"最佳实践）
- **部署节**：双向可达前提（单向/NAT 等 broker）；win 收件腿 codex 不可用（AF_UNIX 跨登录会话隔离，claude 腿实测可用）；WSL 镜像网络 22 冲突→别名带非标端口；别名推荐=对端真实 hostname（别名≠hostname 会断回程路条）；WSL 反向须显式用户名（默认 root）；ControlMaster 提速可选；`ssh-keyscan -p <port>` 播种非标端口 host key；`wsl -u root` 直写 authorized_keys 解鸡生蛋
- **skill 三行**：--via 教学（用户实测证明：不给提示 agent 不会跨机）+ 对端名单获取方式 + 跨机轮次纪律
- **错误文案**：TARGET_NOT_FOUND 补"对端可能已重启，改用 --to 自动接续"自愈指引
- **FAQ**：status 只显示本机会话——跨机看对端用 `ssh <对端> crosschat status`；常重启会话用 /rename 固定稳定名字
- **CI mac 观察位**（008 决策点 16，continue-on-error 起步）
- **反馈归档**：aio-cube 两份 + 用户亲手实测报告（B2.2 复现实验终裁：跨机回投失败样本均另有根因——B8 前 id 缺陷/human 单向/claude 会话退出之陈旧端点；**跨机主路径（双方存活+全新对话+照抄回信）尚待干净复测点亮**，归档按此表述修订）
