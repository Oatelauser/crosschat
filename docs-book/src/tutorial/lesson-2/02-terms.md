# 2.2 术语

## 术语表

| 词 | 一句话 | 出现的地方 |
|---|---|---|
| Host 别名 | `~/.ssh/config` 里给一台机器起的短名，crosschat 只认它当地址 | `--via ssh:<别名>` |
| hostname | 机器的系统名（`hostname` 命令输出），机器自述的身份 | 别名的推荐取值、origin、ref |
| mid / mid8 | 装机指纹的前 8 位（win 注册表 MachineGuid / Linux /etc/machine-id / mac IOPlatformUUID），同名机器靠它分辨 | 回执机器段、ref 端点 |
| origin | 随消息走到对端的发送方身份串（谁、哪台机器、指纹），由机器注入，agent 看不见 | 跨机信封的署名来源 |
| ref（mc2_） | 自包含的对话引用：双方端点 + 对话号 + 轮次，回信需要的全部路条 | 信封 reply-hint、`--conversation` |
| 短柄 cN | ref 的两字符本机缩写（c3 这样），照抄即路由 | 信封回信命令、回执行尾 |
| 回执三态 | delivered（送达）/ queued（对方忙已入队，轮末处理）/ parked（旧版异常态，已暂存自动重投） | 每条 send 的输出 |
| [via 主机] | 跨机报错前缀，标记错误发生在哪一跳；前缀后面是原样透传的自纠指引 | 跨机失败输出 |

## 别名与 hostname

部署前最值得先讲清的一对关系：**推荐把 `~/.ssh/config` 里的别名直接写成对端的系统 hostname**——对端敲 `hostname` 输出什么，你这边 `Host` 就写什么。

这是回信自动选路的软依赖，不是硬校验。手写 `--via ssh:<任意合法别名>` 永远可用；但跨机信封里的回信命令不带 `--via`（2.4 会亲眼看到），对端执行时按 ref 里的机器名自动补路由——补出来的正是发起方的 hostname。别名 ≠ hostname 时，"对端 ssh config 里有这个 hostname 当别名"就不成立，自动回程断掉（报 SSH_TRANSPORT_FAILED，指引补别名）。别名 = hostname，一次配对，终身免念。

## 机器指纹 mid

hostname 会撞名——真实世界就有两台机器都叫 yang 的联邦在跑。mid（machine-id）是每台装机唯一的指纹。crosschat 取它的前 8 位（mid8）放进回执机器段：

```console
delivered to beta2@yangwsl(9f8e7d6c) (turn 1)
                        └── 这 8 个十六进制字符就是 yangwsl 的 mid8
```

两端 mid 都在时，"是不是同一台机器"由 mid 说了算——hostname 相同也骗不过去；任一端 mid 读不到，才退回比 hostname（2.5 的同名机器一节看它怎么工作）。
