# 2.3 命令总览

一张地图收拢本课的全部命令——每条一句话，点链接直达详解。还没部署的先去[2.4 SSH 部署与配置](04-deploy-config.md)，配完回来。

| 命令 | 一句话 | 详解 |
|---|---|---|
| `crosschat send --via ssh:<别名> --to <名>` | 发起跨机消息，名字在对端机上解析 | [发起跨机消息](05-first-message.md#发起跨机消息) |
| `crosschat send --conversation cN --body "…"` | 回信照抄信封命令，不写地址，回程自动选路 | [回信不写地址](05-first-message.md#回信不写地址) |
| `ssh <对端> crosschat status` | 看对端的会话名单——别赌名字发送 | [查对端名单](05-first-message.md#查对端名单) |
| `ssh <对端> crosschat doctor` | 远程望诊对端环境（能跑吗） | [体检与望诊](05-first-message.md#体检与望诊) |
| `crosschat status --conversations --via ssh` | 本机看 ssh 腿的跨机对话台账 | [体检与望诊](05-first-message.md#体检与望诊) |
| `scp <文件> <对端>:/tmp/` ＋ 发路径 | 正文超限时的旁路三步 | [正文超限时](05-first-message.md#正文超限时) |

另两条部署期命令住在 2.4：探活 `ssh peer` 与出腿自证 `ssh -o BatchMode=yes peer crosschat --version`。全课命令就这些——没有更多了，记住"跨机 = 单机 + 一个 `--via`"就够了。
