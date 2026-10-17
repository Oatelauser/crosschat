# 投递语义与限制

## 三态

每条 send 的投递结局必居其一，三种都**无需重发**：

| 状态 | 触发条件 | 后续由谁推进 |
|---|---|---|
| ✅ delivered | claude：管道一次写完成；codex：turn/start 返回 inProgress | 无需推进——对方处理是它自己的事 |
| queued | 对方 codex 线程正忙（daemon ≥0.160），消息已进**对方服务端**队列 | 对方本轮结束即串行处理；其下一条来信即消费凭证 |
| ⚠️ parked | 对方线程异常态（旧 daemon 忙等 ~10s 超时、或 TUI 持写者锁不释放） | 本机看门狗 0.5–5 分钟自动重投，投完为止 |

queued 与 parked 的区别值得记：**queued 排在对方的队伍里**（对方机器上的服务端队列，crosschat 不再管），**parked 排在你的机器上**（本机发件箱，crosschat 全责重投）。

## 回执与确认

codex 侧的 delivered 还有一层"确认"语义：投递后 crosschat 会去对方的会话记录文件里找这条消息的落盘痕迹（信封里的引用就是唯一标记），短窗口（约 1.5 秒）等到 → 静默；没等到 → 回执多一行"暂未在对方会话记录中确认（可能仍在落盘）"。**"未确认"不是丢失**——落盘可能晚于探测窗口，`status --conversations` 会自动复查一遍，翻成确认后不再显示。queued 恒不做此探测：消息坐在对方运行中的轮次后面，窗口内结构性不可能落盘。claude 侧无此机制（管道写完即终态）。

## 大小限制

单条正文的上限，从松到紧三层收口：

| 层 | 数值 | 说明 |
|---|---|---|
| 配置层 | 默认 16KiB；`--max-body-kb` > `CROSSCHAT_MAX_BODY_KIB` > 默认；来源值封顶 16MiB | 三层来源，非法值静默降级到下一层 |
| 端点硬顶 | claude 64KiB / codex 1MiB | 生效上限 = min(配置, 硬顶)——**到硬顶提额无效**，报错明说 |
| 语义 | 超限在出发前挡下 | 报错按当前传输只指一条走得通的路（单机=落盘发路径） |

这些是**传输与状态治理，不是上下文保护**——对话里程的治理是轮次预算（见[如何控制对话轮次](../howto/turn-budget.md)；数值的完整由来见[16KiB 上限的由来](../explanation/size-limit.md)）。

## 速率限制

防乒乓：每对会话 60 秒滑窗最多 30 条，超出报 RATE_LIMITED（报错带重试秒数）。计数不建新文件——直接读本机发送账本的尾窗（同一份条目既审计又限流）；检查只读、本次的账目在投递结局后才落，所以未来检查才数它。窗口不会静默丢弃或自动重试任何消息：到了就是到了，没发出去就等。

## daemon 版本与投递语义

codex 侧的忙时行为随 daemon 版本分界（crosschat 不起停 daemon，升级是运维动作）：

| 场景 | daemon < 0.160 | daemon ≥ 0.160 |
|---|---|---|
| 线程忙时投递 | turn/start 被拒 → 忙等 ~10s → **parked**（看门狗重投） | turn/start 被接受并**入队（queued）**，轮末串行处理 |
| TUI 窗口附着线程 | 持写者锁，投递被挡（LOCKED → parked） | 附着后锁语义变化，基本不再挡投递 |
| doctor 提示 | `⚠️ <0.160：开窗投递需升级` | ✅ |

`codex app-server daemon version` 看版本；旧 daemon 不是不能用——忙时语义退回 parked 路径，一切照旧自动重投。

## 平台限制

- **win · AF_UNIX 跨登录会话隔离**：codex daemon 的控制 socket 是 AF_UNIX，Windows 按登录会话隔离——从 sshd 会话、服务会话等**另一登录会话**投 codex 会报连接拒绝（os error 10061）。日常终端与 daemon 同会话无感；跨机侧同样成立（[第2课 2.4](../tutorial/lesson-2/04-deploy-config.md)注记）。
- **unix / macOS**：无此隔离；claude 腿 unix 上连 auth 行都省（同 uid 内核凭据担保，见[安全模型](../explanation/security.md)）。
- **信任边界**：全部单机投递的隐含前提是**同一台机器的同一个用户**；跨用户不隔离也不承诺。

## 跨机投递

<!-- 跨机投递语义：待 ssh/tcp 专家补（ssh 三层错误同码透传、tcp 星三态/PEER_OFFLINE/文件通道 64MiB） -->
