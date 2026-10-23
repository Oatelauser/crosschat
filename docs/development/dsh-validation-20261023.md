# DeepSeek Harness 开发与验收记录

2026-10-23，Asia/Shanghai。接续用户“那你接着往下做，我自己会验证”的授权，按原接入顺序实现 Harness。用户自行从零安装、使用真实模型验证；本次开发使用隔离的官方 npm runtime 与本机脚本模型，不读取或上传真实模型 key。

## 最终功能与边界

Provider 为 `dsh`。官方 Host bundle 位于 `integrations/dsh`，`crosschat dsh-bridge-path` 只输出随包路径。桥只借用当前 live root Agent，通过原生 `followup/steer` 投递；不恢复冷历史、不路由子 Agent、不创建替代目标。原生发信身份为 `DSH_SESSION_ID`。

已接入身份、mc2 现有 extended-provider 编码、名称/完整 ID 解析、发送、status/discovery/TUI、精确收编和成员验活。Harness ID 保留完整原值，包括发信信封的 from-addr；其共同的 `session-` 前缀不能作为 id8。旧工具的地址/编码/预算和存储键保持原契约。未配置桥不阻塞旧工具；已配置但损坏/不可达的来源错误不伪装成空列表。

自有桥协议为 1；实验宿主窗口 `>=0.2.1-rc.2 <0.3.0-0`。正文默认 16KiB，Harness Adapter 的策略上限 1MiB，不称其为上游硬限制。不明写入不重试，不使用 Codex outbox。

桥绑定 `127.0.0.1` 随机端口、随机 Bearer token 和 owner 登记，核对 PID/instance/runtimeVersion，拒绝 Origin。只读发现不修复或删除登记。Windows 不把 chmod 声称为 ACL 隔离。使用步骤见[用户文档](../deepseek-harness.md)。

## 真实发行物与运行证据

Windows x64，Node v25.0.0。官方 npm `@deepseek-ai/dsh@0.2.1-rc.2` 和局部 `pnpm@11.28.5` 装在本次独占根；未全局安装 CLI、未改 PATH、未安装 Harness Desktop。来源核查固定官方提交 `687f282e8625c6b8d11ff58211a90524be2e4317`；实际 npm version、tarball SRI 与生成 lock 的哈希分别留档，不把源码提交核查冒充发行包可重现构建证明。

- [安装前 baseline](evidence/dsh-20261023/baseline.json)、[所有权](evidence/dsh-20261023/ownership.json)
- [npm 安装](evidence/dsh-20261023/install-result.json)、[pnpm 安装](evidence/dsh-20261023/install-pnpm-result.json)、[实际版本](evidence/dsh-20261023/version-result.json)、[解析后的发行物完整性](evidence/dsh-20261023/installation-integrity.json)
- [首轮真实失败](evidence/dsh-20261023/driver-module-red.json)：生产桥已安装，测试 driver 位于 runtime 依赖图外，公共模块 bare import 解析失败。修正仅限测试 driver 的公共 entry 解析；记录为工装基础设施故障。
- [第二轮真实通过](evidence/dsh-20261023/second-live.json)：8/8，正式插件管理器添加/选择生产 bundle，真实 Web Host + sessionController 创建四个普通交互会话。

第二轮覆盖实际 Messages HTTP/SSE 与原生 pwsh tool_result 中的当前 session/profile/home、生产认证和完整分页发现、idle 唤醒、受控忙碌 gate 下 queue/steer 的 step/turn 边界、原生 shell 完整身份发信与同一 conversation 回信，以及目标不存在时不创建替代会话。测试控制面只创建/观测会话；生产发现和投递经过 crosschat 正式 Adapter 与桥。

官方 Host 经 SIGTERM handler 自然零退出，登记消失，本次 run 目录删除；报告四个 cleanup 布尔为 runtimeStopped/registrationRemoved/removed=true、forced=false。此处证明宿主与桥生命周期，不扩大为独立审核所有后代进程的证据。

模型由当前进程的 loopback fixture 固定响应；Harness 的正式模型协议适配器、Agent loop、原生 shell 与 crosschat 实际执行。没有验证模型智能、浏览器 UI 或 Desktop UI。标题模型插件在 fixture 中关闭，telemetry 关闭，所有 HOME/DSH/agents/npm/pnpm/temp/工作区路径隔离，真实 key/preload 环境不继承。

## RED/GREEN 与回归

功能检查先保存业务失败，再实施：身份/解析/发送 `449ece1`，模型 HTTP/SSE `bd90283`，桥与 Adapter `e56df5d`，reader/发现/TUI `a8a145a`，标题/CLI/status/成员 `4d2db44`，严格状态 `ae2982e`，旧工具 adopt 在可选来源故障下 `c3cfe7f`，profile 隔离 `d61df65`，完整发信地址冲突 `b89241f`，启动故障分类 `5574cdb`，CI 生命周期 `c4d0345`。生产 GREEN `24d72eb`、公共 CLI `2ee83cc`、旧 adopt 修正 `4b2967e`、完整发信地址 `1ae8919`、真实 runtime `ac9e074`。

受控真实 HTTP 桥/Adapter 50/50；reader/发现/TUI 对应 18 项，旧 TUI 和 OpenCode 来源一并回归；CLI/status/成员、跨工具同 ID、旧编码/短地址、取消与不明写入均有行为用例。最终全仓检查与 CI 编排结果在收尾后追加。

## 尚待收尾

- 计划内的单独禁用/重新启用桥生命周期实测。
- Windows npm/Web 兼容 CI 编排与独立 issue reporter 的开发验收、实际运行边界。
- 本次局部测试软件卸载、独占根清理和最终全仓检查。

正式 Harness Desktop 安装、UI、退出/卸载生命周期，以及 Linux/macOS 留待独立干净 runner；本批不在已发生清理审批拒绝的机器新增全局 `dsh` protocol 注册。OpenCode 未完成 CI 实跑与被拒绝清理保持其原记录；本批不把它们判为通过。Claude/Codex/Desktop 维护及工具×跨平台策略仍在[后续任务列表](tool-compatibility-ci-tasks.md)，未顺带扩大实施。
