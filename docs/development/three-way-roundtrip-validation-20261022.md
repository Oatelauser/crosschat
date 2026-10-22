# 三方完整回信与查名诊断补验

日期：2026-10-22，Windows 本机。用户要求补齐真实 Codex CLI 与 Claude Code、Codex Desktop 的各方向完整回信，并查明「你好codex」首次查名失败。用户已确认仅修正错误分类和诊断，不自动恢复会话、不调整超时；TUI 产品实现仍未授权。

## 实际会话与链路

- Desktop 当前聊天：`01a15f09-73d9-7843-b748-9eeec7c6c207`，名称「排查 crosschat 消息不可见」。
- Claude Code 原交互「测试会话」：`7847dd79-3004-4989-a295-0476e3a37b48`，2.1.306。
- Codex CLI：`01a16164-7ff7-79a3-b4dc-df0460f6beb7`，0.163.0 真实 TUI/PTY，临时工作目录；使用本机默认 app-server daemon 0.160.0，本次测试前该 daemon 未运行。
- 四场均使用全局正式安装的 `e9874f8` 构建；无 transport/sessionFactory 注入，无 CODEX_HOME/CODEX_SQLITE_HOME 路由覆盖，无 sender 身份伪造。每条显式 steer，不把纯 ACK 再回一遍。仓库诊断修改及其本地 dist 构建与这套生产安装分开，完成矩阵后才升级本机包。
- CLI 原 metadata 因继承启动环境的 `CODEX_INTERNAL_ORIGINATOR_OVERRIDE=Codex Desktop` 带有 Desktop/vscode 标签，不能据此判断实际宿主。证据为真实 `codex.exe` TUI PID 40048、默认 daemon PID 29872、默认 proxy 列出相同完整 ID，以及生产 `openDesktopThread` 对该 ID 返回 null；实际消息由 CLI TUI 收到并执行 shell 回信。

## 完整往返结果

标记统一前缀 `TWR_20261022_`。每场均核对实际工具发送成功、收件侧真实 user 完整信封、按 hint 回信、发件侧真实 user ACK，排除提示正文和工具命令里的 marker。

| 场景 | 发起与回信 | 路由 | 结果 |
|---|---|---|---|
| A `CLI_CLAUDE_A` | CLI 主动→Claude 按 hint 回 CLI | c8 turn 1/2 | 通过；CLI 02:25:53.583Z 实际收到 ACK |
| B `CLAUDE_CLI_B` | Claude 主动→CLI 按 hint 回 Claude | c8 turn 3/4 | 通过；Claude 02:29:27.771Z 实际收到 ACK |
| C `CLI_DESKTOP_C` | CLI 主动→当前 Desktop 按 hint 回 CLI | c9 turn 1/2 | 通过；信封实际出现在当前界面，CLI 02:34:12.905Z 实际收到 ACK |
| D `DESKTOP_CLI_D` | 当前 Desktop 主动→CLI 按 hint 回当前 Desktop | c9 turn 3/4 | 通过；当前界面 02:34:55.182Z 实际收到 ACK |

原生调度的忙/闲 queue/steer、Desktop↔Claude 完整信封四场及 Desktop↔Desktop「你好codex」c7 实际 ACK 已在[上一验收记录](native-delivery-validation-20261022.md)及当前会话核对。本补验不把四场 roundtrip 扩称为所有组合的全部调度状态都重复跑过。

精简证据：临时目录 `crosschat-threeway-hZwJVb` 中的 baseline/matrix/case-a/b/c/d/four-way-audit JSON；CLI 独立证据在 `ccrt-f7150bd1` 的 route-proof/roundtrip-summary/roundtrip-evidence JSON。原生 rollout 和 Claude JSONL 保留原位，证据不含凭证或完整配置。

## 「你好codex」首次失败的证据边界

目标为 `01a15d45-f8ed-7202-8792-b889db47e611`。

1. 02:05:58.763Z 同次检查的 metadata 已存在完整 ID 和精确名称，但正式 send 返回 `NAME_NOT_FOUND`，可发送列表中没有该目标。因此不能称为“没有保存过这个名字”。
2. Desktop 原生日志 02:06:42.915Z 显示 `needs_resume`、`streamRole=null`；42.920Z 请求恢复，43.215Z 成功，43.284Z 成为 owner，43.288Z 恢复完成。
3. 首次直接只读 probe 是 02:07:00.902Z，晚于原生恢复约 18 秒；它不是启动恢复的动作。随后按名称发送成功并实际收到 c7 回信。
4. 事后默认 1 秒探测、并发 8 下三次只读复查均成功，owner/snapshot 仅几十毫秒。它们不能证明首次失败的具体子错误。首次请求未留下逐目标 owner/snapshot 原因；无关联 EPIPE 也不足以归因，因此未调整超时或自动 resume。

历史记录支持“保存记录与原生 owner 的加载状态不同”，不足以严格追认首次究竟是 owner 缺失、探测失败还是快照失败。修复使下次失败保留这一差别，而不伪造首次根因。

## 获批诊断修复

普通名称解析未命中后，才遍历保存记录并补查匹配目标。真实无记录保留 `NAME_NOT_FOUND`；保存记录已命中时分别报告 owner 不可用、协议不支持、owner/snapshot 探测失败、来源读取失败或采样间变化，保留 `stage`、安全 `code` 及必要 `ipcStage`，不透出原始错误正文。结果明确仅诊断 Desktop、CLI 未复核。

正常命中、既有歧义、会话 ID 直达和 conversation/ref 不走新分支；保存记录不进入可投递列表，不恢复会话、不自动重发、不换路由。skill 的错误章节同步教这些分类。

RED 命令为 `npm test -- codex-target-diagnostics.test.ts core-send-diagnostics.test.ts`：初次 9 失败/2 通过，其中新 adapter API 尚未实现；发送入口仍错误抛 `NAME_NOT_FOUND` 且未调用诊断。测试检查点 `5a55fdf`。另补 metadata 忽略取消后的及时结束/迟到结果丢弃，以及普通 coded Error 保持原汇总分类；先见 2 失败/21 通过，再转 GREEN。候选诊断仍保留合法原 code，且无原始错误正文。

产品提交 `e7cd972` 的最终 `npm run check` 退出 0：lint、98 模块/292 运行时边无环/越界、TypeScript 构建与全量 Vitest；**1114 通过、11 跳过（总 1125）；84 文件通过、3 跳过**。新增 20 个有意义的隔离回归，不启用普通测试的真实会话 live。skill validator 在 Windows 使用 `python -X utf8` 通过，内链全部可达。

## 本机安装与清理

安装前将原全局 e9874f8 包、CLI shim 与两侧 skill 另行备份至 `crosschat-diagnostics-upgrade-YCUIyh`；由本地精确 tgz 安装 `e7cd972`（不发布、不执行生命周期脚本），再同步 Codex/Claude skill。安装后全部 200 个 dist 文件、包内和两侧三份各 8 个 skill 文件均与项目 SHA-256 一致。

安装后真实只读/失败路径检查：当前 Desktop 正常发现，「你好codex」按保存名精确找到且 owner 可用；随机不存在名称仍退出 1、`NAME_NOT_FOUND`；已关闭的本测试 CLI 完整 ID 退出 1、`CODEX_DESKTOP_OWNER_UNAVAILABLE`，提示保存记录、`stage=owner`、具体 code 和“CLI 未复核”。两次失败均未投递，不自动恢复 daemon 或原生会话。详情在 `installed-smoke.json` / `failed-send-smoke.json`。

真实测试 TUI/PTY 正常退出；确认原生 loaded 列表为空且没有其他交互 CLI 后，原生 daemon stop 退出 0，仅停止本次自启 PID 29872。早期隔离 server 25372 也已停止；13 个临时脚本/元数据/log/bat/锁已精确删除，复制认证和 token 不存在。精简证据与测试目录内的原生官方缓存/SQLite 保留，没有递归清理用户目录。

daemon 启动本身未改配置；原生 TUI 自动插入 `tui.screen_reader_detection_done=true`，共 43 字节。TUI 退出后先验证配置仍为精确测试后哈希，再仅删该插入，结果 SHA-256 与测试前 `c90fbfcc51e8997aa175d0cbf66def4bf8a44a8983baca88ed9c399c122c3318` 一致；未覆盖并发用户修改，未输出或复制完整配置。证据为 `config-restoration.json`、CLI `cleanup-summary.json`。

矩阵与获批诊断修复均已验收，完成活动项已删除；没有开展 TUI 页面实现。还原备份继续保留。
