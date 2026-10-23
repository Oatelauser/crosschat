# 工具兼容验证 CI 待办

2026-10-23。用户在 OpenCode 桌面版开发期间要求：“把 claudecode 和 codex、codex 桌面版的维护也参考 open code 做一个 ci 验证，把这个放到任务列表里面。你现在还是按照你的开发进度来。”

本批 [DeepSeek Harness npm/Web 开发验收](dsh-validation-20261023.md)已完成；正式 Desktop 与 GitHub 托管 runner 首轮见 C04/C05。[OpenCode 桌面版](opencode-integration-plan.md)的未完成 CI 实跑与被拒绝清理仍单独跟踪。下列事项保持后续任务，不因此展开其它工具或全平台矩阵。

测试目录约定（用户 2026-10-23 明确指示）：保留 `D:\workspace\CC\multichat\node_modules\.cache\crosschat-dsh-20261023-0975b6b93f724fec95264ad45903f291` 作为后续工具测试根，各工具在其下创建独占子目录及 ownership，配置、下载缓存和临时文件均归各自子目录。正常测试安装仍卸载、进程仍退出；该总根最终由用户统一删除，不再反复请求其删除。此决定不授权清理此前归属其它任务的残留，详见[用户决定与核对](dsh-cleanup-20261023.md)。

用户随后补充：Linux、Windows、macOS 的跨平台场景必须进入 CI；担心“工具类型 × 跨平台”造成验证组合爆炸，要求先记任务，后续讨论方案，当前继续既定开发进度。下表不代表已经决定缩减覆盖范围，也不代表这些平台已经跑过。

| 任务 | 范围 | 验收要求 | 状态 |
| --- | --- | --- | --- |
| C00 工具 × 平台的 CI 矩阵与成本方案 | 范围包含 OpenCode CLI/桌面、DeepSeek Harness、ZCode、Claude Code、Codex CLI/桌面，以及 Linux、Windows、macOS。逐项确认官方支持的组合与运行入口，再讨论怎样避免案例、机器与时长爆炸。 | 三个平台的必要验证进入 CI；真实支持矩阵、验证层次、频率、成本和覆盖缺口可审查。明确区分未支持、未验证和通过，不把没有运行的组合当作已通过。 | 待与用户讨论、再实施 |
| C01 Claude Code 兼容 CI | 核实正式 CLI 的隔离运行、原生收件、真实 shell 调用身份与回信、queue/steer 及异常回执；研究以本机脚本模拟其模型请求。 | 运行真实 Claude Code 与 crosschat；不需要个人模型 key。固定良好版本与候选对照，重复失败才按类别报告。 | 待实施 |
| C02 Codex CLI 兼容 CI | 核实正式 CLI/app-server 的隔离配置和脚本模型可行性；覆盖发现、精确 thread ID 投递、原生身份/回信、忙时处理及服务重启。 | 保留现有 Codex 语义，真实工具与 Adapter 一起测试，不用模拟 app-server 替代真实工具。 | 待实施 |
| C03 Codex 桌面版兼容 CI | 独立核实正式桌面发布包、内置 runtime/原生通信 owner、隔离启动与测试入口；覆盖已有窗口/线程收件及回信。 | 桌面与 CLI 的结果、版本和能力分别记录；不能用 app-server 单测冒充桌面 UI 验收。对 CI 暂时无法自动化的部分明确留界。 | 待实施 |
| C04 Harness 正式 Desktop 生命周期 | 在独立干净 runner 核实正式包、内置 desktop profile、Plugins 安装、实际 UI 收件/回信、退出与官方卸载器及 protocol 注册清理。 | npm/Web Host 的通过不代替 Desktop；独立记录 UI、发行包和清理证据。当前机器不新增此前已难以清理的系统注册。 | 待独立 runner 实施 |
| C05 Harness GitHub Actions 首轮 | 已实现 Windows npm/Web 工作流，14项受控 CI 测试和本地正式基线→候选序列通过；待工作流进入默认分支后核实托管 runner、定时、artifact 留存和报告权限。 | 保存实际 Actions run 证据；真实 issue 只在满足回归条件时触发，不为验收造错误 issue。不得把本地执行结果称作 GitHub 已启用。 | 待默认分支首轮 |

共同方案参考 [OpenCode CLI 已实现的兼容工作流](../../.github/workflows/opencode-compat.yml)：官方构建来源与摘要校验、隔离 HOME/数据/进程、本机 HTTP/SSE 脚本模型、基线与同一候选复现、下载/环境故障和兼容失败分开、去重 issue 与留存证据。模型凭据不放入 CI。

每项先核实对应工具的协议和自动化入口，再决定具体工装；不假定它们可以直接复用 OpenCode 的模型响应格式或桌面测试方式。探测任务和具有 issue 写权限的报告任务分离；不自动升级支持基线或改写用户软件。仅清理本次有明确归属的测试安装、进程与数据，保留规格、批准决定和验收证据。

C00 后续还需明确：“跨平台”只要求每种工具在各操作系统上的原生接入，还是同时要求源工具/系统 × 目标工具/系统的跨机端到端组合。该层范围、公共协议测试与平台专属行为如何分层、PR/定时/发布检查如何分配，以及是否采用有依据的组合筛选，均留待讨论后决定；本轮不自行缩减为某一种抽样方案。
