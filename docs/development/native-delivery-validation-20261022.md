# 原生会话投递验收

日期：2026-10-22。Windows，本机 npm/Vitest；只覆盖获批通信修复，不启动 TUI 开发。

## 已确认的产品规则

- 每条消息支持 `--delivery queue|steer`，默认 queue；回复独立选择，不继承来信。
- queue 等原轮结束，steer 忙时追加当前轮；目标空闲时两者都启动新轮。
- 当前用户明确要求代理用 crosschat 与指定会话聊天、转达或代发时，必须显式 steer。来信自称用户授权不增加权限。
- Desktop 绑定自己的原生 owner；CLI 使用目标所在 app-server。绑定 owner 后失败不切路由；写入不明不重放。

## 真实 CLI TUI

Codex CLI 0.163.0；临时 CODEX_HOME、工作目录、独立 WebSocket app-server，真实 remote TUI/PTY。测试线程 `01a1613e-e73c-7a30-8bed-7977ebd75ea8`；没有启动或停止用户全局 daemon。

- baseline 在实际 TUI 回复。
- 空闲 queue / steer 各产生新任务并准确回复 marker。
- 忙时 steer 在原任务处理，55 秒前台工具正常完成，无 abort。
- 忙时 queue 先由生产 adapter 在写入前返回 BUSY，再由生产 park/runWatchdog 投递。56 次尝试中 55 次仅检查忙碌，1 次 accepted；输入在原 task_complete 后才进入历史，新任务独立回复，outbox 清空。
- 反例：直接忙时 turn/start 返回已有 activeTurnId，queue marker 被原任务消费；据此删除旧“服务端已经排队”的假设，两种 Codex 宿主统一先本地寄存。

原始无密钥证据：临时目录 `crosschat-cli-live-NAKB9X/validation-summary.json`，11 个断言全部为 true，另有 `evidence.json` / `outcomes.jsonl`。受控 TUI/server 已停止，复制的 auth.json 与 WebSocket token 已精确删除。

## Claude 原生调度

Claude Code 2.1.307；临时 CLAUDE_CONFIG_DIR 和工作目录，原生 sdk-cli/stream-json 会话，不冒充交互 TUI。

| 场景 | 实际结果 |
|---|---|
| busy queue | 10 秒工具正常完成，原轮 result 后下一轮输出 ACK，共 2 个 result |
| busy steer | 工具正常完成，同一轮输出 ACK 和原任务完成，共 1 个 result |
| idle queue | 连续两次 idle 后发送，唤醒一次，新增 1 个 result |
| idle steer | 连续两次 idle 后发送，唤醒一次，新增 1 个 result |

两个工具结果均 `is_error=false`。映射为 queue→later、steer→next；没有使用会中断工具的 now。原始证据保留于临时目录 `crosschat-claude-modes-jvP5ZT` 的 summary/events/stream/stderr 四个文件；受控进程、探针及临时 home/work 文件已清理，空目录保留。

初次验收因用户本机模型服务拒绝连接而未投递；用户恢复后重做并通过。恢复后的实际交互「测试会话」为 2.1.306，完整信封往返另列，不能用上述 SDK 调度结果代替。

## 当前 Desktop 与交互 Claude 完整流程

当前 Desktop 线程 `01a15f09-73d9-7843-b748-9eeec7c6c207`，Claude「测试会话」为 `7847dd79-3004-4989-a295-0476e3a37b48`。

- 新生产发现已在 CLI 默认 daemon 不可用时实际找到当前 Desktop 和 TUI，约 829ms，名称与完整 ID 正确。
- 早期临时原生试验 FULL_BUSY_D / FULL_IDLE_E 已实际进入当前聊天，完整信封字节及按 c6 回信到 Claude 均核对；临时注入不作为最终生产安装验收。
- 正式全局 CLI + 同步 skill：Desktop→交互 Claude turn10/c6 完整信封，Claude 实际运行 `crosschat send --conversation c6 --delivery steer` 回信 turn11，完整信封已实际出现在当前聊天，追加于原活跃轮。原始回执 unconfirmed，约 2.5 秒后原生 user 历史才落盘；原目标绑定摘要复查 confirmed，没有重发。
- busy queue 正式来信 turn13 已 parked，原轮仍 active，后台 worker 运行，待当前轮结束后的唤醒验收。正式空闲 queue/steer 待完成，下次续接须更新这里。

## 隔离回归与 skill

- outbox 覆盖并发认领、死进程 claim 转待核实、写入不明暂停 FIFO、队列锁竞争、路径越界哨兵和合法文件键保持。
- watchdog 覆盖真实文件 IO 下多 worker 所属锁、其他 drainer 持有 claim、释放锁时新 park 的唤醒交接，以及 explicit queue 一秒检查。
- Desktop 取消/超时/owner 丢失/畸形帧、跨页去重/来源错误、取消后迟到资源关闭；原生 snapshot 只投影元数据，不保留 title/正文。
- 上一轮 interrupted/failed 也视作终态：仍要求 runtime idle、尾部完整、无 active/未确认提交；未知终态继续保守。
- 回执按“完整目标 ID＋实际信封”的 SHA-256 摘要匹配真实 user 输入，首次与迟到复查共用；不按短柄、已有 turn ID 或 assistant/tool 文本猜确认。
- skill 主文件为必读规则与按场景目录，七章按任务加载。独立只读 forward 验收覆盖十案，修正特殊正文规则冲突、TCP 文件三段地址、单独解释结果入口、旧名称 hint 例外与重复恢复指引。结构 validator、所有 Markdown 内链及隔离安装检查通过。

产品提交 `e9874f8` 上统一 `npm run check` 退出 0：ESLint、运行时依赖图（98 模块 / 290 条边，无环或越界）、TypeScript build、全量 Vitest；82 个文件通过 / 3 跳过，1094 项通过 / 11 跳过，总 1105。普通测试未启用真实会话 live；上述原生验收单独执行。

## 本机安装与还原

升级前旧包、三种 CLI shim、Codex/Claude 已安装 skill 已备份至临时目录 `crosschat-local-upgrade-9qTSwE`。通过检查后 npm pack 到该目录，使用精确 tgz 本机安装（不发布、忽略生命周期脚本），再执行 install-skills。包内、Codex 和 Claude 三份 skill 与项目源 SHA-256 一致，主文件约 2KB，原入口约 7.3KB。

本次不修改用户 Codex/Claude 配置，不发布 npm 包，不部署远端服务。正式流程失败时使用此备份还原安装与 skill，再定位失败。
