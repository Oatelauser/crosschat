# ssh 命令详解

跨机 ssh 形态的全部命令、参数、显示与隐式规则。教学见[第2课 跨机通信（ssh）](../tutorial/lesson-2.md)，本页是速查与契约。

## send --via ssh

给另一台机器上的会话发消息；名字在目标机上解析。

参数：

| 参数 | 取值 | 规则 |
|---|---|---|
| `--via` | `ssh:<别名>` | 别名 = 发起方 `~/.ssh/config` 的 Host 行；字符集仅 `[A-Za-z0-9._-]`，越界报 USAGE（防命令行注入） |
| `--to` | 名字或 id8 | 在**对端**机上解析；值禁空格与 `& | < > ^ % " '` 及首杠——名字带空格是单机语义，跨机改用 id8 或 `--conversation` |
| `--conversation` | `mc1_`/`mc2_` 完整引用或 cN 短柄 | 必须匹配 `mc[12]_` 前缀；回信通常照抄信封命令，免手写 |
| `--body` 或 stdin | 二选一 | 同给报 BODY_CONFLICT；`--body` 缺席才读 stdin；**跨机正文恒走 stdin 管道**——远端命令行里没有正文 |
| `--max-body-kb` | 正整数 KiB | 调高**本机**预检限额；不透传远端（远端用自己的限额复检） |
| `--json` | 旗标 | 远端回执 JSON 原样透传，另附 `via` 字段 |

显示（成功，一行）：

```console
delivered to beta2@yangwsl(9f8e7d6c) (turn 1) · 续话 c1
```

三态与单机语义一致：`delivered` 送达；`queued` 对方正忙已入队、轮末处理；`parked` 旧版守护异常态、已暂存并自动重投——三者都无需重发。机器段 `@name(mid8)` = 对端名 + 指纹短码（无名退 mid8）；行尾 `· 续话 cN` 是发起方本机会话短柄（柄缺席的异常路径退 `reply-ref: mc2_…` 整行）。

隐式规则（不写进命令、但每次都在发生）：

1. 远端命令面**固定不可配**：`ssh <别名> -o BatchMode=yes -o ConnectTimeout=10 crosschat send --to/--conversation <目标> --json --origin <身份串>`——可配置即注入面
2. 三道白名单守同一条防线：`--via` 别名、`--to` 值、`--conversation` 值（让危险字符根本不进远端命令行，而非转义）
3. `--origin` 隐藏旗标：机器注入的发送方身份（工具/完整 id/显示名/hostname/指纹，整串 base64url），agent 不可见；**在场即权威**，压过对端进程的任何环境残留
4. 出发前按最宽端点（codex 1MiB）预检，超线本地直接挡下、ssh 零调用；claude 端点 64KiB 在对端复检时暴露
5. 每次发送落本机 send-log（只元数据永不写正文），跨机对话因此出现在本机 `status --conversations`
6. 回执里对端签发的引用在本地落账并配短柄——`--to` 续话、`--conversation cN` 都接得上

错误（四层）：

| 层 | 错误码 | 自救 |
|---|---|---|
| 本地等待超时 / ssh 进程未退 | `SSH_TRANSPORT_TIMEOUT` | 远端状态不明——勿盲目重发；先在对端查 send-log 或 status |
| ssh 自身失败（退出码 255） | `SSH_TRANSPORT_FAILED` | 报错自带自证命令：`ssh <对端> crosschat --version` |
| 远端 crosschat 业务错 | **原错误码** + `[via 对端]` 前缀 | 自纠指引原样有效（MESSAGE_TOO_LARGE 等） |
| 对端异常退出（无错误码结构） | `REMOTE_FAILED [via 对端] 远端异常退出(code): stderr 尾部 400 字` | 看 stderr 尾部定位（PATH 缺失最常见，见下） |

## ssh 对端 crosschat --version

```console
> ssh -o BatchMode=yes peer crosschat --version
1.6.4
```

一条命令四验：网络通、密钥对、对端系统 PATH 找得到 crosschat、版本不过旧。部署完成的判据 = **双向都出版本号**。对端报 `REMOTE_FAILED (127): command not found` = 对端 npm 全局 bin 不在系统 PATH（Linux 软链 `/usr/local/bin/crosschat`，win 加系统 PATH）。详解见[2.4 出腿自证](../tutorial/lesson-2/04-deploy-config.md#双向可达部署)。

## ssh 对端 crosschat status

看对端的会话名单——跨机的对端不在本机 status 里，**别赌名字发送**。这就是一次普通 ssh 远程命令，跑的是对端自己的 status，输出与对端本机一致；过滤参数照常（`--claude` / `--codex` / `--name`）。收件形态（codex daemon 线程、claude bg 会话、无头 exec）见[2.5 查对端名单](../tutorial/lesson-2/05-first-message.md#查对端名单)。

## ssh 对端 crosschat doctor

远程望诊对端环境。doctor 体检所在机器自己：环境段（Node ≥22、claude 可路由会话、codex CLI 与 daemon ≥0.160、双侧 skill、双身份残留）、入 tcp 星的机器另查星段、发件箱滞留殿后。**不含 ssh 联邦项**——别名/密钥/连通性走自证命令。只有 ❌ 使退出码非 0；⚠️ 是合法状态的教学提示。实录与读法见[2.5 体检与望诊](../tutorial/lesson-2/05-first-message.md#体检与望诊)。

## scp 旁路三步

正文超限（默认 16KiB，可提额至端点硬顶）时的大内容通道——**不是内建功能**：代码只做预检并在报错里教这三步，执行者是人或 agent。

```console
> scp big-analysis.txt yangwsl:/tmp/big-analysis.txt
> crosschat send --via ssh:yangwsl --to beta2 --body "分析 /tmp/big-analysis.txt，结论报过来"
delivered to beta2@yangwsl(9f8e7d6c) (turn 3) · 续话 c1
```

scp 与 `--via` 共用同一份 ssh config、别名与密钥，部署配一次全通。大结果回传反向同构（对端 scp 回来或落盘发路径）；win↔WSL 可免网络直写盘。完整实录见[2.5 正文超限时](../tutorial/lesson-2/05-first-message.md#正文超限时)。

## status --conversations --via ssh

```console
> crosschat status --conversations --via ssh
会话:
  文档book → ssh专家    9 分钟前   turn 6   delivered  c17
```

只保留 ssh 腿的跨机对话段（tcp 腿用 `--via tcp`）；一行含双方、最近轮次、投递末态、行尾续话柄——跨机对话多了以后这就是 ssh 联邦台账。传输族判定依据 ref 端点机器字段（带机器名且无星标识 = ssh）。

## CROSSCHAT_SSH_TIMEOUT_MS

ssh 专属的唯一环境变量：覆写本机等待上限，默认 120000（毫秒）；非法值静默降级回默认——配置是给操作者的旋钮，不是给攻击者的面。内层 TCP 连接超时固定 `ConnectTimeout=10` 秒，不受此变量影响。其余环境变量（`CROSSCHAT_MAX_BODY_KIB` / `CROSSCHAT_MAX_TURN`）与单机共用，见[环境变量总表](env-vars.md)。
