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
