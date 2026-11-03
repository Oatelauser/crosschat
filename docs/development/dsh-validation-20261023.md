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


## 2026-11-03 C10 Harness 技能诊断：完整检查原始输出

本节为当前诊断切片的新证据，不改变上文 2026-10-23 原生验收范围。代码提交由本轮 git 历史核对；本次未启用 CROSSCHAT_LIVE，max forks/threads=2、min=1；退出码 0。

root独立完成C10的技能副本诊断切片，未派worker；规范/合同为自审，不称独立双人复审。RED提交`5eaec97`，产品`ae0727f`，均在当前`codex/core-refactor-pre-tui`可达。

- 首轮RED命令：`npm test -- doctor.test.ts core-diagnostics.test.ts -t 'Harness|configured Harness|relative Harness'`。6个预期失败、1通过、23项因名称筛选未运行：默认/自定义/相对Harness home没有诊断，JSON边界拒绝`harness`，默认及显式isolated诊断环境仍继承宿主DSH_HOME；inherit场景通过。原始失败在本聊天工具输出保留，未把筛选未运行计为新增skip。
- 同一RED目标修复后7/7通过；补充实际构建CLI与真实技能副本的隔离fixture，以及空home/同目录去重后，9套件105/105通过。真实安装器、Harness runtime、用户配置、模型和远端未用于这批普通测试。
- CLI文本/JSON及TUI使用的结构化诊断共用`skillPlan`，Harness默认/绝对DSH_HOME、references差异及物理目标去重与维护一致。相对DSH_HOME只报warning，不猜当前工作目录，不遮蔽其它工具检查；warning不改既有退出码规则。显式隔离home重置DSH_HOME，nativeEnvironment=inherit继续保留当前机器的配置。
- 通过的是技能副本路径和内容检查，不是实际原生加载或bridge/版本/鉴权诊断。没有修改用户命令、参数、维护写入/删除范围、通信公共线或持久协议；没有新增产品/测试文件。指南只纠正已批准C14语法并说明诊断边界，包描述移除不实的整体“无daemon”承诺。
- 单次完整`npm run check`退出0：lint、203模块/683运行时边、build通过；231文件通过/3原有跳过，2643项通过/11原有跳过。下面完整stdout/stderr保留，不用当次GREEN追认历史通信失败根因。未重复已绿全量，也未按skill默认覆盖率指标替代仓库的有意义行为检查。

<details><summary>npm run check 原始输出</summary>

```text

> @oatelauser/crosschat@1.10.0 check
> npm run lint && npm run check:imports && npm run build && npm test


> @oatelauser/crosschat@1.10.0 lint
> eslint src test


> @oatelauser/crosschat@1.10.0 check:imports
> node scripts/runtime-import-graph.mjs

Runtime import graph: 203 modules, 683 edges; no cycles or boundary violations.

> @oatelauser/crosschat@1.10.0 build
> tsc


> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/serve-star-lifecycle.test.ts (11 tests) 17056ms
   ✓ 033 热加星：不重启即托管即收发 > 在跑 serve + CLI --add-star 经管理插座：回执生效、自登记落位、聚合器播种、新星上 node/sender 完整收发  1586ms
   ✓ 033 删星：即时收尾 + 直报已删 + 最后一颗可删 > 热删 beta：在跑连接收"星已删除"断开、node.json 摘条、死钥直报、邻星零中断  2359ms
   ✓ 033 插座冷热路径与 stop 收口 > 回执超时绝不回落直写：插座连上但无回执 → 报错重试、台账零改动  10005ms
   ✓ 033 插座冷热路径与 stop 收口 > stop 收口：serve 停机后状态 stopped、插座随进程撤（CLI 退冷路径）  1523ms
   ✓ 036 按星机器名（--star --show-name）热闭环 > 按星只重挂该星：条目覆盖落 node.json、注册表该星 machineName 更新、邻星回落全局不变；--list 显示随条目；'' 清除回落全局  1538ms
 ✓ test/dsh-compat-ci.test.ts (102 tests) 18020ms
   ✓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause  1009ms
   ✓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause  1004ms
   ✓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot  1007ms
   ✓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes  1007ms
   ✓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release  1122ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation  432ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline  660ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned  1113ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return  2033ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return  386ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes  1009ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation  1061ms
   ✓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early  1018ms
   ✓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error  1021ms
   ✓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline  1017ms
 ✓ test/session-star.test.ts (40 tests) 6664ms
   ✓ 018 批二：启动器入星链路 > spawn 会话→自动拉聚合器→attach→三段直达；退出即 detach  636ms
   ✓ 018 批二：启动器入星链路 > 多星：--connect 可重复，两会话成员表各自 attach（win 带杠 mid 形态）  690ms
   ✓ 018 批二：启动器入星链路 > 021 断连静默：聚合器被杀→重连提示落日志、控制台零输出、成员籍自动恢复  1585ms
   ✓ 统一恢复入口（启动器重声明或显式管理，册落盘不丢） > 聚合器重启保留离线册位，存活的原生会话也须明确重声明（linux 32-hex 形态）  303ms
   ✓ 统一恢复入口（启动器重声明或显式管理，册落盘不丢） > broker/node 重启册位不丢，已有成员与新会话统一由显式 adopt 恢复  314ms
   ✓ 018 批二：9b 降级告警（不只日志） > NodeClient.warn 直打一行；warnIfBrokerLacksSessionCaps 对老 broker 出声、新 broker 静默  322ms
   ✓ 028 双模式与命令面 > 双模式集成：永久退出留册、裸 resume 不归队、明确选择恢复；--rm 退出清册  889ms
 ✓ test/conversation-state-concurrency.test.ts (11 tests) 9583ms
   ✓ conversation state cross-process writes > independent processes allocating at once never share a handle and each resolves to its own ref  410ms
   ✓ conversation state cross-process writes > a live writer on an aliased path blocks every other write path until it releases  2195ms
   ✓ conversation state cross-process writes > a send that cannot take the lock delivers nothing, then succeeds once released  1175ms
   ✓ conversation state cross-process writes > a stuck holder still exits within its barrier deadline  5116ms
probe failed: root-not-exclusive:C:\Users\YANGSH~1\AppData\Local\Temp\c14w05-test-n94hfU\previous-run
 ✓ test/serve-admin-key.test.ts (7 tests) 6223ms
   ✓ 034 挑战应答全链与角色矩阵 > admin 握手（钥匙永不过线）→ 读/发/删全过 → 成员/星管逐格 → 重放拒绝 → 被吊钥 BAD_AUTH → 审计在场  2883ms
   ✓ 034 挑战应答全链与角色矩阵 > CLI 远程管理路由：--via tcp:<星> 成员读（星钥）+ 星管写（adminKey 挑战应答）  1546ms
   ✓ 034 set-port 无命令回归（旗标+插座 op 全删） > 管理插座 set-port op 已删（未知 op 拒绝、台账零改动）  1521ms
usage: node scripts/codex-call-correlation-probe.mjs --root <owned temp dir> [--evidence <json>]
 ✓ test/codex-call-correlation-probe.test.ts (56 tests) 5539ms
   ✓ codex call correlation probe: bounded reads and processes > kills a timed-out child together with its descendant and waits for close  1812ms
   ✓ codex call correlation probe: bounded reads and processes > stops a cancelled child through the abort signal  525ms
   ✓ codex call correlation probe: run root and main chain > keeps the root when the run is cancelled  624ms
   ✓ codex call correlation probe: run root and main chain > keeps the run root when the launched process never closed  1468ms
 ✓ test/endpoint-protocol.test.ts (5 tests) 5462ms
   ✓ endpoint identity capability guard > does not replay an uncertain lifecycle removal while readonly roster still reports the same temporary member  5413ms
 ✓ test/serve-sessions.test.ts (37 tests) 4943ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 028 claude 活性：扫描核验——死 claude 成员转下线（教学）、活成员续投  533ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > C14 Codex 活性：核实实际 CLI 端点后续投，原生不存在的同类成员转下线  546ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 029 临时成员异常死亡：对账验死报 member-remove 清册零痕迹（不留下线态）  736ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > delegates name following to a third provider without reviving a released manual membership  323ms
   ✓ 028 册（roster）：落盘/跨机拒绝/extends 胜复活/member-remove > 028 下线成员随 roster 帧下发（offlineSessions 单列；sessions 保持活成员语义）  441ms
   ✓ 018 9b：老 broker（proto:1）降级的协议侧 > connect 携带 caps；info.caps 缺端点能力时拒绝类型化 attach，且不发 sessions 帧  316ms
 ✓ test/serve-multistar.test.ts (20 tests) 4523ms
   ✓ 032 多星握手与星域隔离 > 钥匙不属任何星 → BAD_AUTH（跨星错钥匙不放行）  522ms
   ✓ 032 bootstrap 与 CLI > 033 serve 永不造星：空表首启零星合法（不建星、不写 node.json），教学指 --add-star  1511ms
   ✓ 032 bootstrap 与 CLI > 内挂聚合器不写 status-node 文件（非独立进程）  1510ms
 ✓ test/broker-revocation.test.ts (12 tests) 4136ms
   ✓ broker credential revocation > local remove-node immediately revokes every node/sender using that credential and retains offline permanent members in its star  906ms
   ✓ broker credential revocation > remote remove-node has the same immediate effect while members and star admins retain their three-layer limits  699ms
   ✓ broker credential revocation > local remove-admin-key closes only authenticated sessions of the removed credential, including unique-prefix selection  1121ms
   ✓ broker credential revocation > marks a revoked session unusable before close completes without affecting another credential  335ms
   ✓ broker credential revocation > finishes target pending work and file routes on revocation before the close callback, ignoring late target results  311ms
 ✓ test/local-service-inspection.test.ts (6 tests) 3454ms
   ✓ owned service inspection and guard workers > reclaims an inspector blocked in spawnSync, including its owned probe child, before cancellation returns  634ms
   ✓ owned service inspection and guard workers > uses the real process wrapper for successful inspection/guard IPC and releases it before returning  796ms
   ✓ owned service inspection and guard workers > reclaims a real wrapper and its controlled blocked probe when its read timeout expires  1783ms
 ✓ test/maintenance-boundaries.test.ts (5 tests) 3131ms
   ✓ TUI maintenance source and copy boundaries > closes unreadable sources and bounds directory enumeration before accepting a skill plan  2962ms
 ✓ test/opencode-desktop-fixture.test.ts (13 tests) 2856ms
   ✓ official desktop test environment > reports an unregistered executable under the owned run before allowing cleanup  2125ms
   ✓ official desktop test environment > retains a locked-log diagnostic while collecting remaining logs for teardown  325ms
 ✓ test/local-service-owned-stop.test.ts (6 tests) 3248ms
   ✓ TUI owned service stop process trees > releases a hung OS scanner and its helper before completing cancellation without claiming the external stop was undone  469ms
   ✓ TUI owned service stop process trees > bounds a nonresponding stop job and reclaims its full scanner tree on timeout  1323ms
   ✓ TUI owned service stop process trees > runs the actual stop process wrapper and prior stop worker with the same fixed target, then releases the wrapper  548ms
   ✓ TUI owned service stop process trees > retains prior request validation inside the real wrapper before any stop business call  433ms
   ✓ TUI owned service stop process trees > uses the owned stop default from the managed task and waits for tree cleanup before returning an uncertain issued result  466ms
 ✓ test/doctor-json-cli.test.ts (3 tests) 2293ms
   ✓ doctor JSON CLI extension > diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it  1020ms
   ✓ doctor JSON CLI extension > returns the structured checks and preserves the existing default report and exit severity  503ms
   ✓ doctor JSON CLI extension > emits valid structured findings with exit one for a failed check and rejects extra options  769ms
 ✓ test/serve-node.test.ts (30 tests) 2931ms
   ✓ B0 starId handshake > 036 无 id 星（手编形状）：连接按 BAD_AUTH 拒——broker 机跑一次 serve 补 id  583ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker queue self-delivery: the receipt ref carries the registry starId  665ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker steer self-delivery: the receipt ref carries the registry starId  612ms
 ✓ test/tui-controller.test.ts (25 tests) 2089ms
 ✓ test/ssh-native-authentication.test.ts (3 tests) 2820ms
   ✓ SSH application native ASKPASS integration > reuses authentication across refreshes, retains strict host checking and forgets credentials when configuration changes  1633ms
   ✓ SSH application native ASKPASS integration > preserves full Windows ASKPASS fingerprints and offers no approval for a changed known host  558ms
   ✓ SSH application native ASKPASS integration > cancels a pending native authentication helper when the active connection closes  628ms
 ✓ test/core-diagnostics.test.ts (13 tests) 1855ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (undefined)  374ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (isolated)  307ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (inherit)  381ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  570ms
 ✓ test/core-code-standards.test.ts (2 tests) 2889ms
   ✓ progressive typed lint rules > rejects floating promises, async void callbacks and value imports used only as types  2866ms
 ✓ test/revocation-pause.test.ts (13 tests) 1758ms
   ✓ explicit credential revocation pauses this star > stops one launcher supervisor without restarting it or disrupting another star  1196ms
 ✓ test/send-log.test.ts (10 tests) 2264ms
   ✓ appendSendLog > rotates past 5MiB instead of truncating: the bulk moves whole to .old, the new entry starts a fresh file  2103ms
 ✓ test/session-membership.test.ts (16 tests) 1813ms
   ✓ session membership application boundary > adopts an anonymous full native ref through the shared aggregator and verifies broker roster authority  559ms
   ✓ session membership application boundary > adopts and removes a typed Codex member without overwriting the same native ID on another endpoint  553ms
 ✓ test/caller-source-confirmations.test.ts (21 tests) 1668ms
   ✓ source classification shared across native sessions > reports bounded busy without mutating state when an unrelated listener occupies its mutex port  1051ms
 ✓ test/ssh-target-lifecycle.test.ts (4 tests) 1300ms
   ✓ SSH target identity and process completion > bounds a child that never closes, reports incomplete cleanup, and removes its owned listeners  1074ms
 ✓ test/tui-workspaces.test.ts (10 tests) 1214ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (updated)  373ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (failed)  347ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (cancelled)  301ms
 ✓ test/tui-composition.test.ts (15 tests) 1190ms
 ✓ test/tui-cli.test.ts (11 tests) 1791ms
   ✓ CLI TUI command isolation > keeps "--help" independent from TUI and Ink modules  360ms
   ✓ CLI TUI command isolation > keeps "tui" independent from TUI and Ink modules  322ms
   ✓ CLI TUI command isolation > rejects unsupported TUI arguments without importing the renderer  335ms
 ✓ test/ssh-askpass-bridge.test.ts (3 tests) 1876ms
   ✓ owned native SSH ASKPASS bridge > uses a real local helper to pass one bounded prompt without storing the password in files, argv or environment  595ms
   ✓ owned native SSH ASKPASS bridge > closes a pending helper and cancels its challenge when the owned bridge is disposed  701ms
   ✓ owned native SSH ASKPASS bridge > rejects an oversized or cancelled answer without writing any secret material to stderr  579ms
 ✓ test/runtime-import-graph.test.ts (9 tests) 1900ms
   ✓ core source architecture > has no runtime dependency cycle or broken local import  757ms
   ✓ core source architecture > keeps node configuration and connection selection independent of commands and clients  582ms
   ✓ core source architecture > keeps every application adapter independent of command and UI entry points  460ms
 ✓ test/maintenance.test.ts (21 tests) 1205ms
   ✓ owned maintenance worker lifecycle > runs actual plans and filesystem effects through the default built worker using only isolated fixture paths  745ms
 ✓ test/observation-overview.test.ts (18 tests) 880ms
   ✓ safe isolated diagnostics for observation pages > binds the isolated process environment to explicit HOME instead of inherited native data overrides  323ms
 ✓ test/via-tcp.test.ts (36 tests) 1335ms
   ✓ runViaTcpSend against a real broker > times out with TCP_TRANSPORT_FAILED and the 勿盲目重发 wording  419ms
 ✓ test/ssh-application.test.ts (15 tests) 997ms
 ✓ test/tui-filters.test.ts (9 tests) 905ms
 ✓ test/tui-send-command.test.ts (5 tests) 1270ms
   ✓ TUI send command templates > round-trips opaque arguments through the current platform shell  1264ms
 ✓ test/dsh-cli.test.ts (4 tests) 687ms
   ✓ DeepSeek Harness CLI composition > connects real send dependencies to Harness delivery with an explicit mode  673ms
 ✓ test/tui-observation-navigation.test.ts (4 tests) 775ms
   ✓ observation resource routes > keeps related route caches separate, canonicalizes query order, clears associations on direct commands and restores the source  347ms
 ✓ test/status-remote.test.ts (16 tests) 921ms
   ✓ CLI：runViaTcpStatus 传输腿 > 版本偏差：旧 broker 对 status-query 无行为 → 超时教学  417ms
 ✓ test/tui-main-observations.test.ts (3 tests) 935ms
   ✓ default local observation wiring > preserves native environment paths when the caller has not requested an isolated home  447ms
   ✓ default local observation wiring > installs the five real readonly resources lazily and preserves exact related routes  370ms
 ✓ test/serve-broker.test.ts (33 tests) 882ms
 ✓ test/outbox.test.ts (24 tests) 1120ms
   ✓ park > refuses honestly at the per-thread cap and leaves the file untouched  747ms
 ✓ test/remote-discovery-cli.test.ts (2 tests) 1170ms
   ✓ built discover CLI endpoint > rejects invalid JSON and oversized input before provider execution  894ms
 ✓ test/codex-session-events.test.ts (2 tests) 580ms
   ✓ Codex per-window native protocol selection > only successful native selection and first accepted input affect this window, never global notifications or failed resume  360ms
 ✓ test/dsh-adapter.test.ts (44 tests) 820ms
 ✓ test/claude-session-events.test.ts (2 tests) 540ms
   ✓ Claude window session event binding > keeps blank startup unregistered, resumes exact IDs, ignores end/compact and never persists prompt content  300ms
 ✓ test/tui-form.test.ts (5 tests) 541ms
 ✓ test/tui-sensitive-result.test.ts (2 tests) 453ms
 ✓ test/tui-main-sessions.test.ts (3 tests) 495ms
 ✓ test/dsh-bridge.test.ts (32 tests) 641ms
 ✓ test/tcp-peer-naming-transport.test.ts (8 tests) 588ms
 ✓ test/c14-conversation-refinement.test.ts (24 tests) 790ms
 ✓ test/remote-discovery-tcp.test.ts (6 tests) 620ms
   ✓ TCP complete read-only discovery > reads 100 anonymous sessions across real broker/node WebSockets and resolves full-ID details  379ms
 ✓ test/tui-follow.test.ts (6 tests) 379ms
 ✓ test/pipe-transport.test.ts (6 tests | 3 skipped) 378ms
   ✓ WindowsNamedPipeTransport > reports PIPE_WRITE_UNCERTAIN when the server cuts the connection mid-write  316ms
 ✓ test/revocation-auth-race.test.ts (2 tests) 416ms
   ✓ revocation during current process lifecycles > a corrupt self-aggregator pause does not become an unhandled rejection in the broker  366ms
 ✓ test/cli-args.test.ts (18 tests) 507ms
 ✓ test/tui-context-source.test.ts (7 tests) 356ms
 ✓ test/install-skills.test.ts (12 tests) 452ms
 ✓ test/smoke.test.ts (2 tests) 488ms
 ✓ test/tui-layout-paging.test.tsx (3 tests) 358ms
 ✓ test/local-service-worker-boundary.test.ts (8 tests) 660ms
 ✓ test/claude-compat-ci.test.ts (15 tests) 419ms
 ✓ test/tcp-session-operations.test.ts (7 tests) 458ms
 ✓ test/serve-b21.test.ts (29 tests) 390ms
 ✓ test/remote-discovery-node.test.ts (8 tests) 283ms
 ✓ test/opencode-adapter.test.ts (26 tests) 364ms
 ✓ test/serve-f0.test.ts (19 tests) 379ms
 ✓ test/broker-discovery.test.ts (17 tests) 335ms
 ✓ test/conversations.test.ts (26 tests) 380ms
 ✓ test/send-command.test.ts (57 tests) 430ms
 ✓ test/tcp-exact-transport.test.ts (3 tests) 280ms
 ✓ test/caller-source-state-lock.test.ts (2 tests) 285ms
 ✓ test/claude-compat-fixture.test.ts (19 tests) 298ms
 ✓ test/core-sessions-readers.test.ts (13 tests) 280ms
 ✓ test/caller-source-providers.test.ts (14 tests) 296ms
 ✓ test/tui-clipboard.test.ts (5 tests) 285ms
 ✓ test/core-services-background.test.ts (5 tests) 258ms
 ✓ test/codex-aggregate-discovery.test.ts (11 tests) 184ms
 ✓ test/serve-cli.test.ts (32 tests) 299ms
 ✓ test/serve-tool-type-bridge.test.ts (6 tests) 215ms
 ✓ test/conversation-handle-ring.test.ts (9 tests) 261ms
 ✓ test/dsh-node-members.test.ts (1 test) 191ms
 ✓ test/tui-mutation-navigation.test.ts (1 test) 147ms
 ✓ test/tool-type-routing-state.test.ts (32 tests) 225ms
 ✓ test/tcp-configuration-management.test.ts (7 tests) 222ms
 ✓ test/tui-view.test.tsx (13 tests) 204ms
 ✓ test/c14-explicit-send.test.ts (29 tests) 216ms
 ✓ test/file-channel.test.ts (10 tests) 190ms
 ✓ test/tui-main-preferences.test.ts (2 tests) 130ms
 ✓ test/session-membership-exact.test.ts (9 tests) 216ms
 ✓ test/tui-session-view.test.tsx (8 tests) 192ms
 ✓ test/core-queries.test.ts (17 tests) 173ms
 ✓ test/watchdog.test.ts (10 tests) 192ms
 ✓ test/tcp-application.test.ts (13 tests) 226ms
 ✓ test/tui-terminal.test.ts (8 tests) 124ms
 ✓ test/codex-deliver.test.ts (26 tests) 112ms
 ✓ test/tcp-transport.test.ts (7 tests) 190ms
 ✓ test/send-handle.test.ts (10 tests) 180ms
 ✓ test/discovery-service.test.ts (10 tests) 164ms
 ✓ test/tui-workspace-layout.test.tsx (8 tests) 147ms
(node:9200) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/tcp-configuration.test.ts (8 tests) 145ms
 ✓ test/desktop-metadata.test.ts (5 tests) 138ms
 ✓ test/claude-compat-lifecycle.test.ts (4 tests) 150ms
 ✓ test/via-send.test.ts (42 tests) 138ms
 ✓ test/observation-logs.test.ts (11 tests) 184ms
 ✓ test/desktop-ipc.test.ts (21 tests) 87ms
 ✓ test/tui-sessions.test.ts (22 tests) 81ms
 ✓ test/dsh-live-fixture.test.ts (18 tests) 133ms
 ✓ test/local-services.test.ts (11 tests) 113ms
 ✓ test/ssh-managed-profiles.test.ts (5 tests) 112ms
 ✓ test/tui-contexts.test.ts (13 tests) 120ms
 ✓ test/tcp-machine-transaction.test.ts (9 tests) 99ms
 ✓ test/uninstall.test.ts (10 tests) 72ms
 ✓ test/dsh-send.test.ts (16 tests) 84ms
 ✓ test/outbox-ownership.test.ts (15 tests) 114ms
 ✓ test/tool-type-observations.test.ts (7 tests) 112ms
 ✓ test/status-doctor-tcp.test.ts (27 tests) 116ms
 ✓ test/tui-input.test.tsx (21 tests) 110ms
 ✓ test/status-conversations.test.ts (20 tests) 104ms
 ✓ test/opencode-compat-fixture.test.ts (7 tests) 97ms
 ✓ test/codex-target-diagnostics.test.ts (13 tests) 73ms
 ✓ test/observation-communications.test.ts (11 tests) 87ms
 ✓ test/codex-rpc.test.ts (11 tests) 68ms
 ✓ test/tcp-snapshot-transport.test.ts (2 tests) 93ms
 ✓ test/dsh-mock-model.test.ts (5 tests) 93ms
 ✓ test/caller-source-service.test.ts (11 tests) 94ms
 ✓ test/codex-routing.test.ts (15 tests) 64ms
 ✓ test/dsh-runtime-driver.test.ts (3 tests) 95ms
 ✓ test/state-paths.test.ts (9 tests) 83ms
 ✓ test/tcp-management-exact.test.ts (8 tests) 103ms
 ✓ test/tui-context-actions.test.ts (3 tests) 75ms
 ✓ test/session-selection.test.ts (3 tests) 59ms
 ✓ test/session-operations.test.ts (4 tests) 69ms
 ✓ test/core-cleanup.test.ts (5 tests) 94ms
 ✓ test/claude-wrapper.test.ts (16 tests | 2 skipped) 78ms
 ✓ test/opencode-members.test.ts (7 tests) 63ms
 ✓ test/conversation-summary.test.ts (15 tests) 81ms
 ✓ test/core-management.test.ts (12 tests) 65ms
 ✓ test/tcp-cold-management.test.ts (5 tests) 98ms
 ✓ test/serve-registry.test.ts (10 tests) 61ms
 ✓ test/tui-registry.test.ts (5 tests) 64ms
 ✓ test/opencode-desktop-probe.test.ts (9 tests) 66ms
 ✓ test/status-summary.test.ts (14 tests) 54ms
 ✓ test/rollout-meta.test.ts (13 tests) 51ms
 ✓ test/delivery-mode.test.ts (15 tests) 48ms
 ✓ test/opencode-desktop-ci.test.ts (13 tests) 83ms
 ✓ test/tcp-local-management.test.ts (6 tests) 58ms
 ✓ test/status-filters.test.ts (20 tests) 51ms
 ✓ test/clean.test.ts (10 tests) 52ms
 ✓ test/identity-command.test.ts (7 tests) 72ms
 ✓ test/tui-tcp.test.ts (24 tests) 50ms
 ✓ test/native-rename-providers.test.ts (6 tests) 65ms
 ✓ test/dsh-members.test.ts (13 tests) 72ms
 ✓ test/c14-native-send-seams.test.ts (17 tests) 42ms
 ✓ test/tcp-management-boundaries.test.ts (4 tests) 38ms
 ✓ test/discovery-ssh.test.ts (7 tests) 35ms
 ✓ test/tui-table.test.ts (23 tests) 34ms
 ✓ test/rate-limit.test.ts (6 tests) 27ms
 ✓ test/node-config.test.ts (9 tests) 26ms
 ✓ test/core-services.test.ts (5 tests) 30ms
 ✓ test/tui-text.test.ts (52 tests) 26ms
 ✓ test/doctor.test.ts (20 tests) 26ms
 ✓ test/opencode-send.test.ts (9 tests) 27ms
 ✓ test/session-star-logging.test.ts (2 tests) 19ms
 ✓ test/serve-management-errors.test.ts (6 tests) 20ms
 ✓ test/tcp-management.test.ts (15 tests) 23ms
 ✓ test/c14-tool-addressing.test.ts (8 tests) 17ms
 ✓ test/tui-star-audit.test.ts (2 tests) 19ms
 ✓ test/tui-ssh.test.ts (7 tests) 20ms
 ✓ test/tcp-machine-workspace.test.ts (8 tests) 18ms
 ✓ test/core-send.test.ts (4 tests) 22ms
 ✓ test/tui-communications.test.ts (13 tests) 22ms
 ✓ test/core-send-diagnostics.test.ts (6 tests) 24ms
 ✓ test/native-endpoint-types.test.ts (10 tests) 20ms
 ✓ test/tui-tcp-targets.test.ts (2 tests) 19ms
 ✓ test/tcp-empty-node-config.test.ts (3 tests) 17ms
 ✓ test/opencode-tui.test.ts (9 tests) 18ms
 ✓ test/codex-pagination.test.ts (5 tests) 18ms
 ✓ test/tui-logs.test.ts (5 tests) 17ms
 ✓ test/session-membership-machine.test.ts (4 tests) 14ms
 ✓ test/tui-maintenance.test.ts (6 tests) 11ms
 ✓ test/star-snapshot.test.ts (1 test) 16ms
 ✓ test/tui-overview.test.ts (4 tests) 13ms
 ✓ test/tcp-node-naming-lifecycle.test.ts (6 tests) 14ms
 ✓ test/session-membership-ipv6.test.ts (2 tests) 14ms
 ✓ test/tui-connections.test.ts (7 tests) 10ms
 ✓ test/core-sessions.test.ts (8 tests) 10ms
 ✓ test/registry.test.ts (6 tests) 9ms
 ✓ test/ref.test.ts (25 tests) 13ms
 ✓ test/dsh-identity.test.ts (19 tests) 14ms
 ✓ test/tui-page-presentation.test.ts (3 tests) 13ms
 ✓ test/dsh-composition.test.ts (5 tests) 11ms
 ✓ test/tool-type-discovery-state.test.ts (6 tests) 13ms
 ✓ test/dsh-status.test.ts (7 tests) 9ms
 ✓ test/tui-ssh-management.test.ts (3 tests) 11ms
 ✓ test/opencode-status.test.ts (6 tests) 7ms
 ✓ test/opencode-identity.test.ts (18 tests) 9ms
 ✓ test/opencode-composition.test.ts (4 tests) 9ms
 ✓ test/c14-discovery-tui.test.ts (3 tests) 8ms
 ✓ test/core-members.test.ts (8 tests) 9ms
 ✓ test/resolve.test.ts (24 tests) 8ms
 ✓ test/tui-services.test.ts (4 tests) 8ms
 ✓ test/dsh-tui.test.ts (3 tests) 7ms
 ✓ test/codex-proxy-env.test.ts (2 tests) 12ms
 ✓ test/ssh-interaction.test.ts (6 tests) 9ms
 ✓ test/deliver.test.ts (5 tests) 15ms
 ✓ test/dsh-reader.test.ts (11 tests) 15ms
 ✓ test/discovery-command.test.ts (2 tests) 9ms
 ✓ test/key-file.test.ts (6 tests) 13ms
 ✓ test/envelope.test.ts (20 tests) 8ms
 ✓ test/core-local-discovery.test.ts (3 tests) 9ms
 ✓ test/codex-caller-source-probe.test.ts (14 tests) 8ms
 ✓ test/local-service-stop-target.test.ts (3 tests) 6ms
 ✓ test/opencode-desktop-process-race.test.ts (3 tests) 6ms
 ✓ test/opencode-wrapper.test.ts (3 tests) 5ms
 ✓ test/compat-reply.test.ts (9 tests) 5ms
 ✓ test/tcp-management-state.test.ts (3 tests) 5ms
 ✓ test/codex-launcher-owner.test.ts (2 tests) 9ms
 ✓ test/codex-wrapper.test.ts (6 tests) 7ms
 ✓ test/frame.test.ts (5 tests) 4ms
 ✓ test/limits.test.ts (11 tests) 5ms
 ✓ test/claude-compat-evidence.test.ts (5 tests) 4ms
 ✓ test/remote-discovery-protocol.test.ts (10 tests) 3ms
 ✓ test/local-service-readiness.test.ts (1 test) 3ms
 ✓ test/serve-protocol.test.ts (3 tests) 4ms
 ✓ test/credential-revoked-protocol.test.ts (6 tests) 2ms
 ✓ test/c14-envelope-tool.test.ts (3 tests) 3ms
 ✓ test/opencode-ref-boundary.test.ts (2 tests) 3ms
 ✓ test/tui-status.test.ts (4 tests) 5ms
 ✓ test/tui-ssh-authentication-prompt.test.ts (1 test) 7ms
 ↓ test/live/claude-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/codex-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/status-live.test.ts (2 tests | 2 skipped)

 Test Files  231 passed | 3 skipped (234)
      Tests  2643 passed | 11 skipped (2654)
   Start at  21:19:34
   Duration  127.88s (transform 4.31s, setup 0ms, collect 28.80s, tests 165.21s, environment 45ms, prepare 22.77s)

```

</details>
