# DeepSeek Harness 开发与验收记录

2026-10-23，Asia/Shanghai。接续用户“那你接着往下做，我自己会验证”的授权，按原接入顺序实现 Harness，[实施合同](dsh-integration-contract.md)保留范围与批准决定。用户自行从零安装、使用真实模型验证；本次开发使用隔离的官方 npm runtime 与本机脚本模型，不读取或上传真实模型 key。

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
- [第三轮真实通过](evidence/dsh-20261023/third-live.json)：保持 8 项，并在 idle 场景内增加官方 pluginManager bundle disable/enable。旧登记撤销、旧端口关闭、同一 PID 和四个 Agent 对象保留；重新启用生成新 instance/凭据，旧凭据被拒绝，原会话收到新 nonce 并返回 ACK。

第二轮覆盖实际 Messages HTTP/SSE 与原生 pwsh tool_result 中的当前 session/profile/home、生产认证和完整分页发现、idle 唤醒、受控忙碌 gate 下 queue/steer 的 step/turn 边界、原生 shell 完整身份发信与同一 conversation 回信，以及目标不存在时不创建替代会话。测试控制面只创建/观测会话；生产发现和投递经过 crosschat 正式 Adapter 与桥。

官方 Host 经 SIGTERM handler 自然零退出，登记消失，本次 run 目录删除；报告四个 cleanup 布尔为 runtimeStopped/registrationRemoved/removed=true、forced=false。此处证明宿主与桥生命周期，不扩大为独立审核所有后代进程的证据。

模型由当前进程的 loopback fixture 固定响应；Harness 的正式模型协议适配器、Agent loop、原生 shell 与 crosschat 实际执行。没有验证模型智能、浏览器 UI 或 Desktop UI。标题模型插件在 fixture 中关闭，telemetry 关闭，所有 HOME/DSH/agents/npm/pnpm/temp/工作区路径隔离，真实 key/preload 环境不继承。

## RED/GREEN 与回归

功能检查先保存业务失败，再实施：身份/解析/发送 `449ece1`，模型 HTTP/SSE `bd90283`，桥与 Adapter `e56df5d`，reader/发现/TUI `a8a145a`，标题/CLI/status/成员 `4d2db44`，严格状态 `ae2982e`，旧工具 adopt 在可选来源故障下 `c3cfe7f`，profile 隔离 `d61df65`，完整发信地址冲突 `b89241f`，启动故障分类 `5574cdb`，CI 生命周期 `c4d0345`。生产 GREEN `24d72eb`、公共 CLI `2ee83cc`、旧 adopt 修正 `4b2967e`、完整发信地址 `1ae8919`、真实 runtime `ac9e074`。

受控真实 HTTP 桥/Adapter 50/50；reader/发现/TUI 对应 18 项，旧 TUI 和 OpenCode 来源一并回归；CLI/status/成员、跨工具同 ID、旧编码/短地址、取消与不明写入均有行为用例。生命周期和身份分类追加 RED `0d1be8e`，GREEN 与第三轮实测 `e48c7c4`；driver/fixture/model 17/17。

最终 `npm run check` 通过：ESLint、174 模块/560 条运行时依赖边无环和边界违规、TypeScript、178 测试文件通过，1941 项通过/11 项按既有条件跳过。见[检查记录](evidence/dsh-20261023/repository-check.json)与[原始输出](evidence/dsh-20261023/repository-check.log)。[npm pack dry-run](evidence/dsh-20261023/package-dry-run.json) 确认桥代码/patch/图标/locale、正式 dsh Adapter 和完整 skill 随包，未发布或全局 link。

## 兼容 CI

[工作流](../../.github/workflows/dsh-compat.yml) 与[编排](../../scripts/dsh-compat-ci.mjs) 固定 Windows x64，定时与手动入口；不展开尚待讨论的工具×平台矩阵。官方 npm 根包和 pnpm 固定基线见[清单](../../scripts/dsh-compat-baseline.json)，下载实际字节做 SHA-512 SRI 校验。候选元数据只解析一次；同一 artifact 的后续安装复制锁并执行 npm ci，确保候选复现时依赖不漂移。

每轮运行都有独占 root、报告路径和 UUID，严格核对进程退出、8 项完整证据、覆盖范围和四个 cleanup 字段。未知释放、timeout/signal、报告不匹配、强杀或清理失败时保留 root 并停止后续安装；不以旧报告填 PASS。正式模型请求由当前 runner 上的脚本 HTTP/SSE 服务响应，不调用开发者电脑，也不需要真实 key。

只有基线完整通过，同一候选两次在同一兼容检查失败且清理完整，才创建去重 issue。模型/网络/安装/测试控制面/清理失败不会误报兼容回归。真实 shell 返回可解析 JSON 后原生身份字段错/缺失，归为 `compatibility/native-shell-identity`。探测 job 只有 contents:read；独立报告 job 才有 issues:write，只解析和重新验证 JSON，不 checkout 或执行上游。14/14 受控测试覆盖这些失效路径、缓存边界及独立 reporter。

[首轮完整编排](evidence/dsh-20261023/ci-cold-install-red/summary.json)在 npm 冷安装阶段超过原 6 分钟限时，正确记录基础设施错误、停止后续步骤并保留 root，无错误 issue。随后[核对安装 PID 已退出](evidence/dsh-20261023/ci-cold-install-red/release-after-timeout.json)，且 install scripts 已禁用、runtime 尚未启动。此真实 RED 提交 `489ef11`；缓存边界 RED `4239960`，GREEN `23df294`。

安装限时改为 15 分钟，工作流总限时 75 分钟，同一轮共享 npm 下载缓存并使用 prefer-offline。profile、凭据、会话、登记和报告始终独占重建。可选 `DSH_COMPAT_NPM_CACHE` 仅指定已有的绝对本机缓存目录，拒绝文件、链接/链接祖先、网络路径、URL 与相对路径；显式外部缓存不由 CI 删除，summary 记录 retained-externally。默认缓存归 task root 清理。SRI/锁校验保持；候选官方元数据仍重新读取。

[第二轮完整编排](evidence/dsh-20261023/ci-serial/summary.json)实际通过，classification=compatible。基线与当前官方 latest 均为 `0.2.1-rc.2`，依次全新安装、8/8 正式行为探测、自然退出并撤销登记、删除安装，再进入下一次；两个依赖锁字节相同。此轮复用首轮已确认停止的下载缓存；CI 自己的 task root 已删除，显式外部缓存留给本批最终清理。真实运行没有触发失败重试/issue；这些分支由受控测试验证。

GitHub 托管 runner、定时触发和真实 issue 创建尚未运行；工作流文件提交在本地不代表调度已启用，需进入仓库默认分支并开启 Actions 后进行首轮验证，已转入后续任务 C05。超出实验宿主窗口的版本记为 unsupported-release，保持人工评估边界，不据此宣称行为兼容。

## 卸载与清理

功能验收使用的局部官方 npm runtime 与 pnpm 已通过 npm uninstall 正常零退出卸载，[后置检查](evidence/dsh-20261023/uninstall-postconditions.json)确认两个包目录不存在。第二轮 CI 自动清除各次安装和自己的 task root。真实用户 `.dsh`、全局 `dsh` 命令和 `dsh` protocol 注册在本批前后均不存在；预先存在的 `.agents` 保留。

代理尝试以 PowerShell 对两个精确所有权目录执行 Remove-Item，自动审批复核以 `blocked by policy` 拒绝整条操作；命令没有执行，也没有改用其它程序绕过。用户随后删除 C盘超时现场，并明确决定“D盘这个我最后统一删除，你后面就可以放在这里来”。最终只读核对：两个 C盘 CI 根已不存在，D盘根按用户指示保留；正常 Harness/pnpm 包、相关命令进程、用户 `.dsh`、全局命令与 protocol 注册均不存在。D盘根今后按工具划分独立所有权子目录，最终由用户统一删除，不再作为本批待授权清理项。见[原审批记录](evidence/dsh-20261023/cleanup-review.json)、[最终核对与用户决定](evidence/dsh-20261023/cleanup.json)和[清理记录](dsh-cleanup-20261023.md)。

正式 Harness Desktop 安装、UI、退出/卸载生命周期，以及 Linux/macOS 留待独立干净 runner；本批不在已发生清理审批拒绝的机器新增全局 `dsh` protocol 注册。OpenCode 未完成 CI 实跑与被拒绝清理保持其原记录；本批不把它们判为通过。Claude/Codex/Desktop 维护及工具×跨平台策略仍在[后续任务列表](tool-compatibility-ci-tasks.md)，未顺带扩大实施。
