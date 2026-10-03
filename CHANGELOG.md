# Changelog

本项目的全部显著变更记录于此。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 变更（B16：审计补缺）

- send-log 条目新增 `from`（发送方身份键）——多 agent 并发时审计需要「谁发的」，此前只有「发给谁」
- README 源码安装节注明：开发期重装本地目录需 `npm i -g . --force`（版本未变时 npm 报 up to date 跳过文件更新，装到的还是旧代码）

### 变更（B15：对话连续性——`--to` 消息的 turn 计数修复）

- `--to` 发送现在**自动接续该端对最近的对话**（本地 `conversations.json` 按无序端对记 latest ref），turn 随每条消息递增；任一端用 `--to` 回复都续同一线程。修复 2026-10-02 实测的「30 条不同消息全部标 turn=1」失真
- 送达/入队/寄存都记账；寄存的消息也占轮次（它终将送达）
- 状态文件损坏自愈为新对话；端对不匹配的记录被忽略
- `TARGET_NOT_FOUND`（claude 会话已退出）错误附指引：`status` 查在线会话后 `--to <新名字>` 重新寻址

## [1.1.0] - 2026-10-03

### 变更（B14：发送存根与 rollout 回执，整改第三步）

- 发送存根：每次 send 的最终结果（delivered/queued/parked/failed + 时间/对端/轮次/错误码）追加写入 `%LOCALAPPDATA%\crosschat\send-log.jsonl`（仅元数据，不含消息体）——工具层超时转后台的发送事后可查
- rollout 回执：codex 投递被接受后，轮询对方会话记录文件确认消息（按唯一 reply-ref）真实落入对话历史，回执写入 send-log；短暂未确认时输出提示行
- `findRolloutFile` 从 rollout-meta 导出（threadId → rollout 路径）

### 变更（B13：忙时入队——codex 收件箱语义，整改第二步）

- **忙线程直接入队**：daemon ≥0.160 上对运行中的 turn 调 `turn/start` 会被接受并按线程串行排队，当前轮结束瞬间落历史并被处理（实测证据：一次性探针线程 01a10009-b314，两条探针消息在计数轮结束后同刻落历史并被依次回答）。`deliverToCodexThread` 不再对 busy 轮询 120s 后超时，busy 即投递，返回 `queued: true`；`send` 输出新状态 `queued to <名字>（对方正忙，已入队，本轮结束即处理）`
- 旧 daemon 拒绝排队型 turn/start 时映射为 `CODEX_THREAD_BUSY_TIMEOUT`，落发件箱由看门狗重投（行为兜底）
- 投递子进程环境剥离双身份残留（`CLAUDE_CODE_*` / `CODEX_*` 会话变量），根治 CALLER_IDENTITY_CONFLICT 的环境侧诱因
- README 新增 daemon 依赖说明（版本要求、未运行时的退化行为、重启后需重新 start）

### 变更（B12：发件箱活性与诚实语义，2026-10-02 双智能体事故整改第一步）

- 排涝看门狗：`parked` 后自动派生独立的短期重投进程（`__drain --watch`），30s→60s→120s→300s 退避，箱空即退——不再依赖「碰巧有人调 crosschat 且碰巧空闲」
- 队列纪律：发件箱非空时新消息直接入队，不再借 120s 轮询插队越过更早的滞留（FIFO 保序）
- 排涝公平化：busy/locked 属线程级状态，首次失败即中止该线程本轮，不再把整轮预算烧在必然失败的后续条目上（修复队尾 12 小时 attempts=0 的饿死）
- 诚实文案：`parked` 输出队列深度与 mailbox 镜像路径；`OUTBOX_FULL` 指向镜像文件而非「线程疑似已死」
- mailbox 镜像：每条寄存/送达/丢弃追加到 `%LOCALAPPDATA%\crosschat\mailbox\<线程ID>.md`，滞留内容随时人读
- 并发安全：park/drain 按线程加锁（lockfile，60s 过期抢占），看门狗单实例（pid+心跳锁）
- 上限放宽：每线程 20 → 200 条；doctor 显示每线程深度/最旧年龄/看门狗状态/镜像路径
- 兼容：pre-B12 无 id 的旧寄存条目读取时稳定合成 id，可继续排涝

## [1.0.1] - 2026-10-02

- README 移除曾用名注记；首验 Trusted Publisher (OIDC) 自动发布管线

## [1.0.0] - 2026-10-02

首个公开版本。Windows 一期：本机 Claude Code ↔ Codex CLI 跨会话消息，无守护进程，原生投递。

### 新增
- 四命令 CLI：`send`（同步投递/自包含引用/轮次计数）、`status`（双侧总览含目录时间）、`install-skills`、`claude`（接收许可包装启动）
- Claude 侧通道：sessions 注册表发现、named pipe + peerToken 鉴权、peer 协议 v1 帧注入
- Codex 侧通道：app-server proxy 桥接（ws-over-stdio）、resume→turn/start 投递、busy/locked 等待循环
- 溯源信封（回复命令自带教学 + 保留字中性化）与 agent 侧 skill（低入侵：题词只写角色）
- 防乒乓限流（30 条/60s/对端点）、16KiB 单条上限、身份冲突自纠指引
- 机会式发件箱：忙/锁超时 parked 落盘，任意 send/status 调用入口自动排涝补投
- daemon 0.160 开窗投递支持（同 daemon 多连接绕过进程级写者锁，实证）
- 双 bin 过渡别名（crosschat 主 / multichat 曾用名）

### 过程档案
- 设计决策地图（wayfinder）、实测研究报告 ×4、联调实证 ×2 随仓库公开（已脱敏）

[1.1.0]: https://github.com/Oatelauser/crosschat/releases/tag/v1.1.0
[1.0.0]: https://github.com/Oatelauser/crosschat/releases/tag/v1.0.0
