# 参考部三表·拼装素材行（工作台）

> 状态：**待拼装**。三页 = addressing / env-vars / error-codes。ssh 行已到（本文件）；单机行待单机专家随协作批交付；tcp 行待 tcp 专家点名。行齐后由文档book2 统一定列结构拼装成页（供行模式，2026-10-17 用户拍板）。

## addressing.md 地址格式总表（建议列头：地址/格式 | 用于 | 解析规则 | 边界与备注）

### ssh 行（ssh 专家 c24 turn 2，2026-10-17，验收通过）

| `--via ssh:<别名>` | 跨机腿选择 | 别名 = 发起方 ~/.ssh/config 的 Host 行；字符集仅 [A-Za-z0-9._-]，越界 USAGE（防注入） | 唯一 ssh 地址参数；按机器投递，不选会话 |
| `--to <名/id8>`（配 --via ssh:） | 跨机收件人 | 名字在对端机上解析（本机同名不干扰）；id8 兜底未命名 codex 线程 | 值禁空格与 shell 元字符（跨机白名单，名字带空格是单机语义） |
| `--conversation <mc1_/mc2_ 引用>` | 跨机续话 | ref 自包含路由（双方端点+nonce+轮次），不查任何服务端 | 跨机腿上恒为完整引用；回信照抄信封 hint 免手写 |
| 短柄 `cN` | 本机续话缩写 | 本机会话分片映射回完整 ref；不过网（跨机腿到达时已解析为完整引用） | 两字符照抄即路由；旧柄照发也精确（路由靠 nonce） |
| 回执机器段 `<名>@<name>(<mid8>)` | 回执/记账显示 | name=对端名（无名退 mid8）；mid8=对端装机指纹前 8 位 | 仅显示型——用作寻址输入会断回信路（寻址仍用别名） |
| `[via <别名>]` | 跨机错误前缀 | 标记错误发生在哪一跳 | 前缀后为原错误码自纠指引，跨机原样有效 |
| 别名 = 对端 hostname | 回程自动选路（软依赖） | 对端按 ref 里发起方 hostname 找本机别名补 --via | 非硬校验：手写 --via 任意合法别名可用；仅"照抄回信"路径依赖此约定 |

## env-vars.md 环境变量总表（建议列头：变量 | 作用域 | 默认 | 说明）

### ssh 行（同上）

| `CROSSCHAT_SSH_TIMEOUT_MS` | ssh 跨机腿 | 120000 | 本机等待上限（毫秒）；非法值静默降级回默认；内层 TCP 连接超时固定 ConnectTimeout=10，不受它影响 |

### ssh 侧对共用旋钮的备注（并入单机行的备注列）

- `CROSSCHAT_MAX_BODY_KIB` 在 ssh 腿生效于本地预检、不透传远端——远端用自己的限额复检；`CROSSCHAT_MAX_TURN` 照常进信封。

## error-codes.md 错误码总表（建议列头：错误码 | 层 | 含义 | 自救）

### ssh 行（同上）

| `SSH_TRANSPORT_TIMEOUT` | 本地等待超时 / ssh 进程未退 | 远端状态不明（可能已投递） | 勿盲目重发（与首次投递叠加）；先在对端查 send-log 或 status --conversations 核实 |
| `SSH_TRANSPORT_FAILED` | ssh 自身失败（退出码 255） | 不通 / 密钥 / known_hosts | 报错自带自证命令：ssh <对端> crosschat --version（顺带验版本） |
| `REMOTE_FAILED [via <别名>]` | 对端异常退出 | 对端进程崩溃或找不到命令，附 stderr 尾部 400 字 | `(127): command not found` = 对端系统 PATH 缺 crosschat——Linux 软链 /usr/local/bin，win 加系统 PATH |
| （映射规则，非新码）同码透传 | 远端 crosschat 业务错 | 原错误码重抛，消息加 [via <别名>] 前缀 | 自纠指引跨机原样有效；注意匹配源是对端 stderr 的 crosschat: CODE: message 结构（非 stdout） |

### 单机行（单机通信专家，2026-10-17，随批4 交付）

| `--to <名>`（单机） | 本机收件人 | 全名精确（字节不变）→ 大小写不敏感唯一前缀（跨 claude/codex 两侧合并计数）→ id 层 | 名字可含空格（命令加引号）；多命中 NAME_COLLISION 列候选教完整名 |
| `--to <id8\|完整id>` | 未命名 codex 线程 | 可选 `codex/` 前缀；id8 前缀唯一命中即投 | id8 多命中列全部完整 id；id 寻址只在前缀层 0 命中后进场（名字永远赢 id） |
| `--conversation <cN>` | 本机续话（信封 hint 默认形态） | 扫全部分片找该柄唯一 nonce | 两字符照抄即路由；过期/撞号报错教 `--to` 接续；柄不过网 |
| `--conversation <mc1_/mc2_>` | 完整引用续话（柄缺席的保底） | 解码即路由（端点+nonce+轮次自包含） | mc1_ 永久兼容解码；旧 CLI 读新 ref = "trailing bytes"+升级教学（设计好的偏差路径） |
| human 发送方 | 人在终端发消息 | 环境无身份变量即 human | 可发不可收：对 human 端点的回信报 CANNOT_REPLY_TO_HUMAN |

## env-vars.md（续）·单机行

| `CROSSCHAT_MAX_BODY_KIB` | 全部 send（单机生效全量；跨机腿仅本地预检、**不透传远端**，远端用自身限额复检——ssh 侧备注并入此列） | 未设（兜底 16384） | 三层来源：`--max-body-kb` > 本变量 > 默认；非法值静默降级；端点硬顶 claude 64KiB / codex 1MiB 之下提额无效 |
| `CROSSCHAT_MAX_TURN` | 全部 send | 未设（信封 turn 不带分母） | 进信封 `turn="N/M"`；启动器会话级同源（写进子进程环境） |
| `CROSSCHAT_CLAUDE_BIN` | claude 可执行文件解析 | PATH 上的 `claude`（win 走 npm 布局→where） | 覆写用；doctor 用同一解析 |
| `CROSSCHAT_CODEX_BIN` | codex 可执行文件解析 | win：npm 布局→where→daemon 目录三选一；unix：PATH 的 `codex` | 覆写用；proxy spawn 同源 |
| `CODEX_HOME` | codex 生态根（rollout 会话/写者锁/回执查找） | `~/.codex` | codex 原生变量，crosschat 尊重不接管 |
| `CLAUDE_CODE_MESSAGING_SOCKET` | 发送方身份反查（claude 侧） | — | 按管道路径匹配注册表，须**恰好一个**命中（零/多 = IDENTITY_UNRESOLVED） |
| `CLAUDE_CODE_MESSAGING_TOKEN` / `CLAUDE_CODE_SESSION_ID` | 与 SOCKET 同族（清洗清单成员） | — | 反查只读 SOCKET；三枚统一随启动器与 proxy spawn 剥离 |
| `CODEX_THREAD_ID` / `CODEX_SESSION_ID` | 发送方身份反查（codex 侧） | — | THREAD 优先于 SESSION；与 claude 族并存 = CALLER_IDENTITY_CONFLICT（报错带 env -u 自纠清单） |

## error-codes.md（续）·单机族行

| `NAME_NOT_FOUND` | 目标解析 | 名字/前缀/id 全不中 | 报错附全部可用名——照抄全名重试；未命名 codex 线程用 id8（status --all 可见） |
| `NAME_COLLISION` | 目标解析 | 同名/同前缀/同 id8 多命中 | 报错列候选；用完整名（或完整 id） |
| `TARGET_CONFLICT` / `TARGET_REQUIRED` | 参数 | `--to` 与 `--conversation` 同给 / 都没给 | 二选一（tcp 三段 via 自带收件人是唯一例外） |
| `BODY_REQUIRED` / `BODY_CONFLICT` | 参数 | 正文缺失 / --body 与 stdin 同给 | 补正文或去掉其一；管道喂 stdin 时省 --body |
| `MESSAGE_TOO_LARGE` | 大小 | 正文超生效上限（配置或端点硬顶） | 按报错当前传输走：可提额则 `--max-body-kb`；到硬顶落盘发路径（单机发文件唯一形态） |
| `RATE_LIMITED` | 速率 | 每对会话 60 秒 30 条到顶 | 等报错给出的秒数或总结收尾；不静默丢弃 |
| `CALLER_IDENTITY_CONFLICT` | 身份 | 两族身份环境变量并存 | 照报错 `env -u` 清单临时清；根治 = 干净终端重启 codex daemon |
| `IDENTITY_UNRESOLVED` | 身份 | SOCKET 匹配注册表零或多命中 | 确认目标会话还活着（status），从正确的会话环境发起 |
| `CALLER_NOT_IN_CONVERSATION` | 路由 | 调用者不是引用任一端点 | 引用抄漏/过期——改 `--to <名>` 自动接续 |
| `CANNOT_REPLY_TO_HUMAN` | 路由 | 对 human 端点的回信 | 无会话可投递；答复写在发起方自己的终端里 |
| `INVALID_CONVERSATION_REF` | 路由 | 引用畸形/柄过期/柄撞号 | 与信封逐字比对重抄；柄过期改 `--to <名>` 接续 |
| `TARGET_NOT_FOUND` | 路由 | 目标会话已退场（claude 退出/线程删除） | `--to <名>` 接续该端对最新对话 |
| `CLAUDE_PIPE_CONNECT_FAILED` | claude 腿 | 管道连不上（会话已死） | 确定未达；status 核对后重发 |
| `CLAUDE_PIPE_WRITE_UNCERTAIN` | claude 腿 | 写中途失败，状态不明 | **勿自动重发**——核实（status/账本）后再决定 |
| `CLAUDE_KEY_FILE_MISSING` / `CLAUDE_KEY_FILE_INVALID` | claude 腿 | 密钥文件缺/坏 | 目标会话重启后重发（key 随会话重新生成） |
| `CLAUDE_EXE_NOT_FOUND` | 环境 | claude CLI 解析不到 | 装/修 PATH；unix 可用 `CROSSCHAT_CLAUDE_BIN` 指路 |
| `CODEX_PROXY_SPAWN_FAILED` | codex 腿 | proxy 起不来（十有八九 daemon 没跑） | 报错自带 `codex app-server daemon start`；附 stderr 尾与 os error 证据 |
| `CODEX_PROTOCOL_ERROR` | codex 腿 | initialize/resume 等写前步骤失败 | 确定未写；按报错细节查 daemon 版本/状态 |
| `CODEX_THREAD_BUSY_TIMEOUT` | codex 腿 | 线程 ~10s 内不可达（旧 daemon） | 已自动转 parked，无需动作 |
| `CODEX_THREAD_LOCKED` | codex 腿 | TUI 窗口持写者不放 | 已自动转 parked；关窗后自动送达 |
| `CODEX_THREAD_NOT_FOUND` | codex 腿 | 线程已删除/归档 | 无法投递；发件箱整队死信丢弃并留痕 |
| `CODEX_APPROVAL_REQUIRED` | codex 腿 | 对方在等审批 | 只有用户能答；等它 |
| `CODEX_TURN_REJECTED` / `CODEX_WRITE_UNCERTAIN` | codex 腿 | turn 被拒 / 接受状态未知 | 拒绝=确定未写可改投；UNCERTAIN 勿自动重发，先核实 |
| `OUTBOX_FULL` | 发件箱 | 该线程滞留满 200 条 | 报错给 mailbox 路径取回内容；确认线程存续后重发 |
| `USAGE` / `INTERNAL` | 通用 | 参数不合法 / 程序缺陷 | 照报错修正命令；INTERNAL 带 `crosschat: ` 前缀可反馈 |
