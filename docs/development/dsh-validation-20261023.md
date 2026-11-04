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

## 2026-11-03 C10 Harness 原生桥诊断与截止计时修复

用户明确批准doctor文本/JSON/TUI新增同源DSH桥检查：无活桥info、已鉴权并核对owner/协议/版本的实例pass、登记/鉴权/owner/协议/版本/不可达/超时异常warn；新增警告本身不改变退出码。全部桥共享5秒预算，只读、不自动重试、不启动原生工具，token和鉴权地址保持私有。profile/类型未提供时保留未知，健康桥无需打开会话；技能副本与实际加载分别核实。

RED de989e0：15失败/57通过；初次夹具误从源码寻找邻接isolated.js，保留失败后明确使用最终构建的隔离child，再获得针对缺失诊断行为的RED。GREEN26fde78；定向7文件143/143，lint/build及203模块686边导入图通过。CLI两种输出实际启动正式子进程，真实loopback夹具只收到GET /v1/info；原登记字节未改。同步嵌入API仍保留，生产CLI与TUI统一走现有query owner，不用同步接口绕过新原生检查。

Windows ConPTY三场真实键盘验证通过：健康桥列表/详情/筛选/resize、鉴权失败固定码及指引、挂起真实HTTP检查时Ctrl+C取消；每场一次GET，没有隐式重试。最终构建TUI、生产overview与诊断child真实运行；bridge身份响应为本次受控夹具，不冒充正式DSH新增原生验收。三场应用/host均退出0，raw/listener基线和1049/2004终端模式恢复，三个响应关闭，token未进入输出。未启动用户保留的DSH、未使用系统剪贴板或远端。

首轮完整check保留：1失败/2670通过/11原有跳过，失败为既有C2 bounds both runner waits的timedOut=false。实际200次循环复现2次；受控Date.now与自有计时器分别推进的两项回归稳定RED（6bc7ce6）。根因为错误构造仅重新读取壁钟，未保留自有截止计时器已触发这一事实；现有日志不能判定宿主壁钟是否曾跳变。5fe6802仅保留deadlineTriggered并用于错误分类，卸载准入/期限/外部取消/owner守卫及原25ms断言保留。修复后原循环200/200、含C04和C10的定向4文件182/182。随后完整check结果在本节后续补记，不以定向绿覆盖首轮失败。

以下原始转录仅归一CRLF为LF及行尾空白；每项给出该转录的SHA-256。私有登记、模型配置与环境不进入证据。

<details><summary>首次夹具接线失败：源码query误找未构建的邻接JS</summary>

转录SHA-256: 77c41afaec7d7a152bdeed509bd09fde6524c39bd3d82d751701ed6594627ac2

```text

> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test --run test/dsh-adapter.test.ts test/core-diagnostics.test.ts


 RUN  v3.2.7 D:/workspace/CC/multichat

 ❯ test/dsh-adapter.test.ts (57 tests | 13 failed) 2191ms
   ✓ DSH native bridge adapter > keeps same-ID Host and Desktop sessions separate and selects type before owner ambiguity 92ms
   ✓ DSH native bridge adapter > does not reinterpret an unclassified owner as Host or fall back from an absent requested type 13ms
   ✓ DSH native bridge adapter > rejects a changed native profile or endpoint type during the authenticated owner handshake 12ms
   ✓ DSH native bridge adapter > rejects caller-association metadata changed by the responding owner 12ms
   ✓ DSH native bridge adapter > does not probe an unrelated type and still rejects duplicate owners within the selected type 37ms
   ✓ DSH native bridge adapter > discovers authenticated live sessions under the isolated common state root without writes 16ms
   ✓ DSH native bridge adapter > gets the exact opaque native identity and returns null only for an authoritative absent item 15ms
   ✓ DSH native bridge adapter > preserves unknown names and cwd without inventing a current directory 11ms
   ✓ DSH native bridge adapter > pages deterministically and rejects a cursor after the source membership changes 27ms
   ✓ DSH native bridge adapter > refuses duplicate native identities across live instances for list, get and send 29ms
   ✓ DSH native bridge adapter > distinguishes missing registration from malformed records without leaking content 10ms
   ✓ DSH native bridge adapter > ignores a confirmed dead owner record without removing it 17ms
   ✓ DSH native bridge adapter > rejects unsafe registration url before network access (0) 9ms
   ✓ DSH native bridge adapter > rejects unsafe registration url before network access (1) 10ms
   ✓ DSH native bridge adapter > rejects unsafe registration url before network access (2) 11ms
   ✓ DSH native bridge adapter > rejects unsafe registration protocol before network access (3) 9ms
   ✓ DSH native bridge adapter > rejects unsafe registration instanceId before network access (4) 11ms
   ✓ DSH native bridge adapter > rejects unsafe registration token before network access (5) 11ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (0) 14ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (1) 12ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (2) 12ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (3) 9ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (4) 10ms
   ✓ DSH native bridge adapter > treats an unavailable live owner and malformed session response as errors, not empty discovery 36ms
   ✓ DSH native bridge adapter > does not coerce a structured status value into the native idle/running contract 14ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.1-rc.2) 12ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.1-rc.10) 13ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.1) 13ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.2-alpha.1) 13ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.99+build.1) 13ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.0) 11ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.1-beta.1) 11ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.1-rc.1) 11ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.3.0-alpha.1) 11ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.3.0) 11ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.1.99) 11ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.01) 11ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.1-rc.02) 11ms
   ✓ DSH native bridge adapter > sends queue exactly once and checks the admission receipt 14ms
   ✓ DSH native bridge adapter > sends steer exactly once and checks the admission receipt 13ms
   ✓ DSH native bridge adapter > rejects empty identities, empty messages, invalid mode and invalid paging before writes 8ms
   ✓ DSH native bridge adapter > cancels before I/O and bounds a stalled read 68ms
   ✓ DSH native bridge adapter > does not retry a write with a lost or wrong-session receipt, or leak server text 12ms
   ✓ DSH native bridge adapter > reports timed-out writes as uncertain and leaves them unretied 114ms
   × Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations 71ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts 76ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED' 80ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH' 90ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION' 71ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL' 79ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR' 78ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE' 81ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes 75ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying 82ms
     → Diagnostic isolated task exited without a diagnostic result
   × Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection 76ms
     → expected 'Error' to be 'entered' // Object.is equality
   × Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200 268ms
     → expected [ …(8) ] to deep equally contain ObjectContaining{…}
   × Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401 220ms
     → expected [ …(8) ] to deep equally contain ObjectContaining{…}
 ❯ test/core-diagnostics.test.ts (15 tests | 2 failed) 1795ms
   × structured diagnostics > validates native bridge facts and strips secret fields across the diagnostic IPC boundary 14ms
     → Diagnostic result is malformed.
   × structured diagnostics > accepts only fixed native warning reasons and supplies the same guidance to TUI details 1ms
     → Diagnostic result is malformed.
   ✓ structured diagnostics > preserves Harness findings across the JSON boundary and rejects an unknown skill side 2ms
   ✓ structured diagnostics > separates typed checks and severity counts from the shared synchronous CLI rendering 3ms
   ✓ structured diagnostics > keeps stopped-daemon info out of counters and never exposes credential fields in check data 1ms
   ✓ structured diagnostics > parses node configuration from the injected read without opening a real config path or exposing keys 2ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (undefined)  336ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (isolated)  382ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (inherit)  369ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  561ms
   ✓ isolated cancellable diagnostics > rejects an already-cancelled query before creating a worker 1ms
   ✓ isolated cancellable diagnostics > runs blocking work off the caller loop and terminates its worker on cancellation 40ms
   ✓ isolated cancellable diagnostics > releases the worker after success and propagates worker errors without producing a healthy report 40ms
   ✓ isolated cancellable diagnostics > rejects an isolated task that exits without a diagnostic result 18ms
   ✓ isolated cancellable diagnostics > does not return a completed result when cancellation arrives during owner disposal 24ms

⎯⎯⎯⎯⎯⎯ Failed Tests 15 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/core-diagnostics.test.ts > structured diagnostics > validates native bridge facts and strips secret fields across the diagnostic IPC boundary
Error: Diagnostic result is malformed.
 ❯ invalid src/application/diagnostics/query.ts:38:35
     36| };
     37| const record = (value: unknown): value is Record<string, unknown> => t…
     38| function invalid(): never { throw new Error('Diagnostic result is malf…
       |                                   ^
     39| function field(value: unknown, type: FieldType): unknown {
     40|   if (type === 'text' && typeof value === 'string' && value.length <= …
 ❯ src/application/diagnostics/query.ts:62:143
 ❯ src/application/diagnostics/query.ts:61:33
 ❯ parseDiagnosticResult src/application/diagnostics/query.ts:53:31
 ❯ test/core-diagnostics.test.ts:40:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/15]⎯

 FAIL  test/core-diagnostics.test.ts > structured diagnostics > accepts only fixed native warning reasons and supplies the same guidance to TUI details
Error: Diagnostic result is malformed.
 ❯ invalid src/application/diagnostics/query.ts:38:35
     36| };
     37| const record = (value: unknown): value is Record<string, unknown> => t…
     38| function invalid(): never { throw new Error('Diagnostic result is malf…
       |                                   ^
     39| function field(value: unknown, type: FieldType): unknown {
     40|   if (type === 'text' && typeof value === 'string' && value.length <= …
 ❯ src/application/diagnostics/query.ts:62:143
 ❯ src/application/diagnostics/query.ts:61:33
 ❯ parseDiagnosticResult src/application/diagnostics/query.ts:53:31
 ❯ test/core-diagnostics.test.ts:54:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying
Error: Diagnostic isolated task exited without a diagnostic result
 ❯ ChildProcess.onExit src/application/diagnostics/query.ts:125:43
    123|       };
    124|       const onError = (error: Error): void => { reject(error); };
    125|       const onExit = (): void => { reject(new Error('Diagnostic isolat…
       |                                           ^
    126|       detach = () => {
    127|         signal?.removeEventListener('abort', onAbort);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection
AssertionError: expected 'Error' to be 'entered' // Object.is equality

Expected: "entered"
Received: "Error"

 ❯ test/dsh-adapter.test.ts:380:21
    378|     try {
    379|       const state = await Promise.race([entered.then(() => 'entered'),…
    380|       expect(state).toBe('entered');
       |                     ^
    381|       controller.abort();
    382|       expect(await pending).toBe('AbortError');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401
AssertionError: expected [ …(8) ] to deep equally contain ObjectContaining{…}

- Expected:
ObjectContaining {
  "code": "harness-bridge-ready",
  "level": "pass",
}

+ Received:
[
  {
    "code": "node-supported",
    "data": {
      "version": "25.0.0",
    },
    "level": "pass",
  },
  {
    "code": "claude-missing",
    "data": {},
    "level": "warn",
  },
  {
    "code": "codex-missing",
    "data": {},
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-rJWPHA\\.claude\\skills\\crosschat\\SKILL.md",
      "side": "claude",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-rJWPHA\\.codex\\skills\\crosschat\\SKILL.md",
      "side": "codex",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-rJWPHA\\.dsh\\skills\\crosschat\\SKILL.md",
      "side": "harness",
    },
    "level": "warn",
  },
  {
    "code": "identity-clear",
    "data": {},
    "level": "pass",
  },
  {
    "code": "outbox-empty",
    "data": {},
    "level": "pass",
  },
]

 ❯ test/dsh-adapter.test.ts:401:97
    399|     expect(json.status, json.stderr).toBe(0);
    400|     const result = JSON.parse(json.stdout);
    401|     expect(result.groups.flatMap((group: { checks: Array<{ code: strin…
       |                                                                                                 ^
    402|       code: status === 200 ? 'harness-bridge-ready' : 'harness-bridge-…
    403|     }));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/15]⎯


 Test Files  2 failed (2)
      Tests  15 failed | 57 passed (72)
   Start at  22:58:06
   Duration  2.95s (transform 437ms, setup 0ms, collect 1.11s, tests 3.99s, environment 0ms, prepare 214ms)
```

</details>

<details><summary>C10行为RED：15失败/57通过</summary>

转录SHA-256: abb85e1e464d8a4664b4e5868ffdf0c199b99c723f2bfb9dc33fe4c9e3f6ee9b

```text

> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test --run test/dsh-adapter.test.ts test/core-diagnostics.test.ts


 RUN  v3.2.7 D:/workspace/CC/multichat

 ❯ test/core-diagnostics.test.ts (15 tests | 2 failed) 1574ms
   × structured diagnostics > validates native bridge facts and strips secret fields across the diagnostic IPC boundary 13ms
     → Diagnostic result is malformed.
   × structured diagnostics > accepts only fixed native warning reasons and supplies the same guidance to TUI details 1ms
     → Diagnostic result is malformed.
   ✓ structured diagnostics > preserves Harness findings across the JSON boundary and rejects an unknown skill side 3ms
   ✓ structured diagnostics > separates typed checks and severity counts from the shared synchronous CLI rendering 3ms
   ✓ structured diagnostics > keeps stopped-daemon info out of counters and never exposes credential fields in check data 1ms
   ✓ structured diagnostics > parses node configuration from the injected read without opening a real config path or exposing keys 2ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (undefined)  318ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (isolated) 283ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (inherit)  372ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  458ms
   ✓ isolated cancellable diagnostics > rejects an already-cancelled query before creating a worker 1ms
   ✓ isolated cancellable diagnostics > runs blocking work off the caller loop and terminates its worker on cancellation 29ms
   ✓ isolated cancellable diagnostics > releases the worker after success and propagates worker errors without producing a healthy report 45ms
   ✓ isolated cancellable diagnostics > rejects an isolated task that exits without a diagnostic result 23ms
   ✓ isolated cancellable diagnostics > does not return a completed result when cancellation arrives during owner disposal 22ms
 ❯ test/dsh-adapter.test.ts (57 tests | 13 failed) 5177ms
   ✓ DSH native bridge adapter > keeps same-ID Host and Desktop sessions separate and selects type before owner ambiguity 102ms
   ✓ DSH native bridge adapter > does not reinterpret an unclassified owner as Host or fall back from an absent requested type 16ms
   ✓ DSH native bridge adapter > rejects a changed native profile or endpoint type during the authenticated owner handshake 16ms
   ✓ DSH native bridge adapter > rejects caller-association metadata changed by the responding owner 13ms
   ✓ DSH native bridge adapter > does not probe an unrelated type and still rejects duplicate owners within the selected type 42ms
   ✓ DSH native bridge adapter > discovers authenticated live sessions under the isolated common state root without writes 15ms
   ✓ DSH native bridge adapter > gets the exact opaque native identity and returns null only for an authoritative absent item 15ms
   ✓ DSH native bridge adapter > preserves unknown names and cwd without inventing a current directory 16ms
   ✓ DSH native bridge adapter > pages deterministically and rejects a cursor after the source membership changes 22ms
   ✓ DSH native bridge adapter > refuses duplicate native identities across live instances for list, get and send 29ms
   ✓ DSH native bridge adapter > distinguishes missing registration from malformed records without leaking content 10ms
   ✓ DSH native bridge adapter > ignores a confirmed dead owner record without removing it 17ms
   ✓ DSH native bridge adapter > rejects unsafe registration url before network access (0) 10ms
   ✓ DSH native bridge adapter > rejects unsafe registration url before network access (1) 10ms
   ✓ DSH native bridge adapter > rejects unsafe registration url before network access (2) 10ms
   ✓ DSH native bridge adapter > rejects unsafe registration protocol before network access (3) 9ms
   ✓ DSH native bridge adapter > rejects unsafe registration instanceId before network access (4) 10ms
   ✓ DSH native bridge adapter > rejects unsafe registration token before network access (5) 9ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (0) 10ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (1) 10ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (2) 11ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (3) 9ms
   ✓ DSH native bridge adapter > never writes after a failed live service identity handshake (4) 10ms
   ✓ DSH native bridge adapter > treats an unavailable live owner and malformed session response as errors, not empty discovery 37ms
   ✓ DSH native bridge adapter > does not coerce a structured status value into the native idle/running contract 15ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.1-rc.2) 11ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.1-rc.10) 15ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.1) 12ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.2-alpha.1) 14ms
   ✓ DSH native bridge adapter > admits the experimental runtime window after exact owner confirmation (0.2.99+build.1) 13ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.0) 9ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.1-beta.1) 11ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.1-rc.1) 12ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.3.0-alpha.1) 10ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.3.0) 10ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.1.99) 12ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.01) 12ms
   ✓ DSH native bridge adapter > refuses an unsupported or malformed runtime before reads (0.2.1-rc.02) 12ms
   ✓ DSH native bridge adapter > sends queue exactly once and checks the admission receipt 15ms
   ✓ DSH native bridge adapter > sends steer exactly once and checks the admission receipt 12ms
   ✓ DSH native bridge adapter > rejects empty identities, empty messages, invalid mode and invalid paging before writes 7ms
   ✓ DSH native bridge adapter > cancels before I/O and bounds a stalled read 70ms
   ✓ DSH native bridge adapter > does not retry a write with a lost or wrong-session receipt, or leak server text 12ms
   ✓ DSH native bridge adapter > reports timed-out writes as uncertain and leaves them unretied 121ms
   × Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations 401ms
     → expected [ …(8) ] to deep equally contain { …(3) }
   × Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts 396ms
     → expected [] to have a length of 2 but got +0
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED' 411ms
     → expected [ …(8) ] to deep equally contain { Object (code, level, ...) }
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH' 382ms
     → expected [ …(8) ] to deep equally contain { Object (code, level, ...) }
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION' 345ms
     → expected [ …(8) ] to deep equally contain { Object (code, level, ...) }
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL' 336ms
     → expected [ …(8) ] to deep equally contain { Object (code, level, ...) }
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR' 323ms
     → expected [ …(8) ] to deep equally contain { Object (code, level, ...) }
   × Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE' 351ms
     → expected [ …(8) ] to deep equally contain { Object (code, level, ...) }
   × Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes 336ms
     → expected [ …(8) ] to deep equally contain { Object (code, level, ...) }
   × Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying 325ms
     → expected [ …(8) ] to deep equally contain { Object (code, level, ...) }
   × Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection 330ms
     → expected 'resolved' to be 'entered' // Object.is equality
   × Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200 193ms
     → expected [ …(8) ] to deep equally contain ObjectContaining{…}
   × Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401 183ms
     → expected [ …(8) ] to deep equally contain ObjectContaining{…}

⎯⎯⎯⎯⎯⎯ Failed Tests 15 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/core-diagnostics.test.ts > structured diagnostics > validates native bridge facts and strips secret fields across the diagnostic IPC boundary
Error: Diagnostic result is malformed.
 ❯ invalid src/application/diagnostics/query.ts:38:35
     36| };
     37| const record = (value: unknown): value is Record<string, unknown> => t…
     38| function invalid(): never { throw new Error('Diagnostic result is malf…
       |                                   ^
     39| function field(value: unknown, type: FieldType): unknown {
     40|   if (type === 'text' && typeof value === 'string' && value.length <= …
 ❯ src/application/diagnostics/query.ts:62:143
 ❯ src/application/diagnostics/query.ts:61:33
 ❯ parseDiagnosticResult src/application/diagnostics/query.ts:53:31
 ❯ test/core-diagnostics.test.ts:40:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/15]⎯

 FAIL  test/core-diagnostics.test.ts > structured diagnostics > accepts only fixed native warning reasons and supplies the same guidance to TUI details
Error: Diagnostic result is malformed.
 ❯ invalid src/application/diagnostics/query.ts:38:35
     36| };
     37| const record = (value: unknown): value is Record<string, unknown> => t…
     38| function invalid(): never { throw new Error('Diagnostic result is malf…
       |                                   ^
     39| function field(value: unknown, type: FieldType): unknown {
     40|   if (type === 'text' && typeof value === 'string' && value.length <= …
 ❯ src/application/diagnostics/query.ts:62:143
 ❯ src/application/diagnostics/query.ts:61:33
 ❯ parseDiagnosticResult src/application/diagnostics/query.ts:53:31
 ❯ test/core-diagnostics.test.ts:54:20

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations
AssertionError: expected [ …(8) ] to deep equally contain { …(3) }

- Expected:
{
  "code": "harness-bridge-inactive",
  "data": {},
  "level": "info",
}

+ Received:
[
  {
    "code": "node-supported",
    "data": {
      "version": "25.0.0",
    },
    "level": "pass",
  },
  {
    "code": "claude-empty",
    "data": {
      "executable": "unavailable-claude",
    },
    "level": "warn",
  },
  {
    "code": "codex-missing",
    "data": {},
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ks4uai\\.claude\\skills\\crosschat\\SKILL.md",
      "side": "claude",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ks4uai\\.codex\\skills\\crosschat\\SKILL.md",
      "side": "codex",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ks4uai\\.dsh\\skills\\crosschat\\SKILL.md",
      "side": "harness",
    },
    "level": "warn",
  },
  {
    "code": "identity-clear",
    "data": {},
    "level": "pass",
  },
  {
    "code": "outbox-empty",
    "data": {},
    "level": "pass",
  },
]

 ❯ test/dsh-adapter.test.ts:301:60
    299|     const home = await directory();
    300|     const result = await diagnose(home);
    301|     expect(result.groups.flatMap((group) => group.checks)).toContainEq…
       |                                                            ^
    302|     expect(result.summary.failed).toBe(false);
    303|     expect(await readdir(home)).toEqual([]);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts
AssertionError: expected [] to have a length of 2 but got +0

- Expected
+ Received

- 2
+ 0

 ❯ test/dsh-adapter.test.ts:315:20
    313|     const result = await diagnose(desktop.home);
    314|     const checks = result.groups.flatMap((group) => group.checks).filt…
    315|     expect(checks).toHaveLength(2);
       |                    ^
    316|     expect(checks).toEqual(expect.arrayContaining([
    317|       { code: 'harness-bridge-ready', level: 'pass', data: { instanceI…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR'
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE'
AssertionError: expected [ …(8) ] to deep equally contain { Object (code, level, ...) }

- Expected:
{
  "code": "harness-bridge-warning",
  "data": {
    "reason": "DSH_AUTH_REQUIRED",
  },
  "level": "warn",
}

+ Received:
[
  {
    "code": "node-supported",
    "data": {
      "version": "25.0.0",
    },
    "level": "pass",
  },
  {
    "code": "claude-empty",
    "data": {
      "executable": "unavailable-claude",
    },
    "level": "warn",
  },
  {
    "code": "codex-missing",
    "data": {},
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-fXcwTw\\.claude\\skills\\crosschat\\SKILL.md",
      "side": "claude",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-fXcwTw\\.codex\\skills\\crosschat\\SKILL.md",
      "side": "codex",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-fXcwTw\\.dsh\\skills\\crosschat\\SKILL.md",
      "side": "harness",
    },
    "level": "warn",
  },
  {
    "code": "identity-clear",
    "data": {},
    "level": "pass",
  },
  {
    "code": "outbox-empty",
    "data": {},
    "level": "pass",
  },
]

 ❯ test/dsh-adapter.test.ts:343:20
    341|     const result = await diagnose(bridge.home);
    342|     const checks = result.groups.flatMap((group) => group.checks);
    343|     expect(checks).toContainEqual({ code: 'harness-bridge-warning', le…
       |                    ^
    344|     expect(checks).toContainEqual(expect.objectContaining({ code: 'nod…
    345|     expect(result.summary.failed).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes
AssertionError: expected [ …(8) ] to deep equally contain { Object (code, level, ...) }

- Expected:
{
  "code": "harness-bridge-warning",
  "data": {
    "reason": "DSH_REGISTRATION_MALFORMED",
  },
  "level": "warn",
}

+ Received:
[
  {
    "code": "node-supported",
    "data": {
      "version": "25.0.0",
    },
    "level": "pass",
  },
  {
    "code": "claude-empty",
    "data": {
      "executable": "unavailable-claude",
    },
    "level": "warn",
  },
  {
    "code": "codex-missing",
    "data": {},
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ZLrdi2\\.claude\\skills\\crosschat\\SKILL.md",
      "side": "claude",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ZLrdi2\\.codex\\skills\\crosschat\\SKILL.md",
      "side": "codex",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ZLrdi2\\.dsh\\skills\\crosschat\\SKILL.md",
      "side": "harness",
    },
    "level": "warn",
  },
  {
    "code": "identity-clear",
    "data": {},
    "level": "pass",
  },
  {
    "code": "outbox-empty",
    "data": {},
    "level": "pass",
  },
]

 ❯ test/dsh-adapter.test.ts:356:60
    354|     await writeFile(bridge.file, '{private-corrupt-registration');
    355|     const result = await diagnose(bridge.home);
    356|     expect(result.groups.flatMap((group) => group.checks)).toContainEq…
       |                                                            ^
    357|       code: 'harness-bridge-warning', level: 'warn', data: { reason: '…
    358|     });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying
AssertionError: expected [ …(8) ] to deep equally contain { Object (code, level, ...) }

- Expected:
{
  "code": "harness-bridge-warning",
  "data": {
    "reason": "DSH_TIMEOUT",
  },
  "level": "warn",
}

+ Received:
[
  {
    "code": "node-supported",
    "data": {
      "version": "25.0.0",
    },
    "level": "pass",
  },
  {
    "code": "claude-empty",
    "data": {
      "executable": "unavailable-claude",
    },
    "level": "warn",
  },
  {
    "code": "codex-missing",
    "data": {},
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ItRpX6\\.claude\\skills\\crosschat\\SKILL.md",
      "side": "claude",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ItRpX6\\.codex\\skills\\crosschat\\SKILL.md",
      "side": "codex",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-ItRpX6\\.dsh\\skills\\crosschat\\SKILL.md",
      "side": "harness",
    },
    "level": "warn",
  },
  {
    "code": "identity-clear",
    "data": {},
    "level": "pass",
  },
  {
    "code": "outbox-empty",
    "data": {},
    "level": "pass",
  },
]

 ❯ test/dsh-adapter.test.ts:367:60
    365|     const bridge = await fixture({ infoHandler: () => undefined });
    366|     const result = await diagnose(bridge.home);
    367|     expect(result.groups.flatMap((group) => group.checks)).toContainEq…
       |                                                            ^
    368|       code: 'harness-bridge-warning', level: 'warn', data: { reason: '…
    369|     });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection
AssertionError: expected 'resolved' to be 'entered' // Object.is equality

Expected: "entered"
Received: "resolved"

 ❯ test/dsh-adapter.test.ts:384:21
    382|     try {
    383|       const state = await Promise.race([entered.then(() => 'entered'),…
    384|       expect(state).toBe('entered');
       |                     ^
    385|       controller.abort();
    386|       expect(await pending).toBe('AbortError');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/15]⎯

 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200
 FAIL  test/dsh-adapter.test.ts > Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401
AssertionError: expected [ …(8) ] to deep equally contain ObjectContaining{…}

- Expected:
ObjectContaining {
  "code": "harness-bridge-ready",
  "level": "pass",
}

+ Received:
[
  {
    "code": "node-supported",
    "data": {
      "version": "25.0.0",
    },
    "level": "pass",
  },
  {
    "code": "claude-missing",
    "data": {},
    "level": "warn",
  },
  {
    "code": "codex-missing",
    "data": {},
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-RZEEp3\\.claude\\skills\\crosschat\\SKILL.md",
      "side": "claude",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-RZEEp3\\.codex\\skills\\crosschat\\SKILL.md",
      "side": "codex",
    },
    "level": "warn",
  },
  {
    "code": "skill-missing",
    "data": {
      "path": "C:\\Users\\YANGSH~1\\AppData\\Local\\Temp\\crosschat-dsh-adapter-RZEEp3\\.dsh\\skills\\crosschat\\SKILL.md",
      "side": "harness",
    },
    "level": "warn",
  },
  {
    "code": "identity-clear",
    "data": {},
    "level": "pass",
  },
  {
    "code": "outbox-empty",
    "data": {},
    "level": "pass",
  },
]

 ❯ test/dsh-adapter.test.ts:405:97
    403|     expect(json.status, json.stderr).toBe(0);
    404|     const result = JSON.parse(json.stdout);
    405|     expect(result.groups.flatMap((group: { checks: Array<{ code: strin…
       |                                                                                                 ^
    406|       code: status === 200 ? 'harness-bridge-ready' : 'harness-bridge-…
    407|     }));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/15]⎯


 Test Files  2 failed (2)
      Tests  15 failed | 57 passed (72)
   Start at  22:58:39
   Duration  5.79s (transform 532ms, setup 0ms, collect 1.20s, tests 6.75s, environment 0ms, prepare 252ms)
```

</details>

<details><summary>C10定向GREEN：143通过</summary>

转录SHA-256: 56f6011c395cf9292c9370e126f97b1329c07c96ed59b7524b2d9364fdc23c6f

```text

> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test --run test/dsh-adapter.test.ts test/core-diagnostics.test.ts test/doctor-json-cli.test.ts test/doctor.test.ts test/observation-overview.test.ts test/status-doctor-tcp.test.ts test/tui-main-observations.test.ts


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/core-diagnostics.test.ts (15 tests) 1614ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (undefined)  401ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  478ms
 ✓ test/doctor-json-cli.test.ts (3 tests) 4343ms
   ✓ doctor JSON CLI extension > diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it  2437ms
   ✓ doctor JSON CLI extension > returns the structured checks and preserves the existing default report and exit severity  1018ms
   ✓ doctor JSON CLI extension > emits valid structured findings with exit one for a failed check and rejects extra options  886ms
 ✓ test/tui-main-observations.test.ts (3 tests) 1109ms
   ✓ default local observation wiring > preserves native environment paths when the caller has not requested an isolated home  599ms
   ✓ default local observation wiring > installs the five real readonly resources lazily and preserves exact related routes  388ms
 ✓ test/observation-overview.test.ts (18 tests) 831ms
   ✓ safe isolated diagnostics for observation pages > binds the isolated process environment to explicit HOME instead of inherited native data overrides  311ms
 ✓ test/status-doctor-tcp.test.ts (27 tests) 92ms
 ✓ test/dsh-adapter.test.ts (57 tests) 12656ms
   ✓ Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations  349ms
   ✓ Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts  425ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED'  422ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH'  442ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION'  443ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL'  396ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR'  486ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE'  485ms
   ✓ Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes  426ms
   ✓ Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying  5388ms
   ✓ Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection  350ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200  1112ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401  1083ms
 ✓ test/doctor.test.ts (20 tests) 20ms

 Test Files  7 passed (7)
      Tests  143 passed (143)
   Start at  23:00:04
   Duration  13.60s (transform 903ms, setup 0ms, collect 1.64s, tests 20.66s, environment 1ms, prepare 596ms)
```

</details>

<details><summary>Windows ConPTY三场摘要</summary>

转录SHA-256: 2de52bf4d15fc566d8a1489fc09f3fa432782f550ad3e14b557179d993951939

```text
{
  "source": "Windows ConPTY; built TUI with real diagnostic child and owned loopback bridge; bridge itself is a controlled fixture",
  "instanceId": "1a9a7667-8935-4c9c-9a58-f27e61f252a8",
  "results": [
    {
      "scenario": "ready",
      "exit": {
        "code": 0,
        "hostCode": 0
      },
      "terminalRestored": true,
      "secretHidden": true,
      "doctorReads": 1
    },
    {
      "scenario": "auth",
      "exit": {
        "code": 0,
        "hostCode": 0
      },
      "terminalRestored": true,
      "secretHidden": true,
      "doctorReads": 1
    },
    {
      "scenario": "stall",
      "exit": {
        "code": 0,
        "hostCode": 0
      },
      "terminalRestored": true,
      "secretHidden": true,
      "doctorReads": 1
    }
  ],
  "requests": [
    {
      "method": "GET",
      "url": "/v1/info",
      "mode": "ready"
    },
    {
      "method": "GET",
      "url": "/v1/info",
      "mode": "auth"
    },
    {
      "method": "GET",
      "url": "/v1/info",
      "mode": "stall"
    }
  ],
  "closedResponses": 3,
  "registrationUnchanged": true
}
```

</details>

<details><summary>健康场应用事件</summary>

转录SHA-256: 15bdb62b5f4112144f171757a71bf1cd4cce856a9feb0736e175ac298e1dc485

```text
{"event":"doctor","result":{"checks":[{"id":"diagnostic:bfcdfb38b4536c49bd9f81d7c7173ca1a2dbe0b0feae72c9324abc7350017e18:0","group":"环境","code":"node-supported","level":"pass","label":"Node 版本","description":"✅ Node v25.0.0 (≥22)","guidance":"此检查无需处理；需要时在当前机器重新运行体检。","facts":[{"label":"version","value":"25.0.0"}]},{"id":"diagnostic:983e19a75c4c31edbc6949e7b021ee21ce71e430a2898218a2bd9ac0c20253d4:0","group":"环境","code":"claude-empty","level":"warn","label":"Claude 可路由会话","description":"⚠️ claude CLI 可解析（unavailable-claude），但当前无可路由会话（crosschat claude 启动的会话才可接收）","guidance":"在当前机器用 crosschat claude 启动需要接收消息的原生会话，再刷新。","facts":[{"label":"executable","value":"unavailable-claude"}]},{"id":"diagnostic:5bfef07bd26fc257d023b75b874b49a28dcbfbb600d065922353683204df7bb4:0","group":"环境","code":"codex-missing","level":"warn","label":"Codex CLI","description":"⚠️ codex CLI 未安装——纯 claude 互聊可忽略；需要 codex 会话时安装并运行: codex app-server daemon start","guidance":"需要 Codex 通道时先确认已安装 Codex CLI，再由用户在当前机器执行：codex app-server daemon start","facts":[]},{"id":"diagnostic:46b8b51eb324540abf4cca63d31f7cab9772a9c32c107da0f2a2f43db8e37ef6:0","group":"环境","code":"skill-missing","level":"warn","label":"工具技能","description":"⚠️ claude 侧 skill 未安装（D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.claude\\skills\\crosschat\\SKILL.md）；运行 crosschat install-skills","guidance":"由用户在当前机器执行：crosschat install-skills","facts":[{"label":"side","value":"claude"},{"label":"path","value":"D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.claude\\skills\\crosschat\\SKILL.md"}]},{"id":"diagnostic:dbd39cdf1b3dc41de302c417d94adb96bc15ba89f2e95280656d6c2fa872b48f:0","group":"环境","code":"skill-missing","level":"warn","label":"工具技能","description":"⚠️ codex 侧 skill 未安装（D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.codex\\skills\\crosschat\\SKILL.md）；运行 crosschat install-skills","guidance":"由用户在当前机器执行：crosschat install-skills","facts":[{"label":"side","value":"codex"},{"label":"path","value":"D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.codex\\skills\\crosschat\\SKILL.md"}]},{"id":"diagnostic:bae1942ab44d619af86a6175120a9de39dffa72508d7733cd2987cd6298184d0:0","group":"环境","code":"skill-missing","level":"warn","label":"工具技能","description":"⚠️ harness 侧 skill 未安装（D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.dsh\\skills\\crosschat\\SKILL.md）；运行 crosschat install-skills","guidance":"由用户在当前机器执行：crosschat install-skills","facts":[{"label":"side","value":"harness"},{"label":"path","value":"D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.dsh\\skills\\crosschat\\SKILL.md"}]},{"id":"diagnostic:32cc52028de92b67f5848fcf0d3c90edbe41f97d202615112a8cf6a11355c4fa:0","group":"环境","code":"identity-clear","level":"pass","label":"调用身份","description":"✅ 无双身份残留","guidance":"此检查无需处理；需要时在当前机器重新运行体检。","facts":[]},{"id":"diagnostic:be85d452e92a0f53bfa3de0e02c87426d934119337b79a4b67bed4d9370759b1:0","group":"环境","code":"harness-bridge-ready","level":"pass","label":"Harness 桥版本与身份","description":"✅ Harness 桥 1a9a7667-8935-4c9c-9a58-f27e61f252a8；Host PID 21044；runtime 0.2.1-rc.2；profile=desktop，类型=dsh-desktop","guidance":"已核实本次桥的鉴权、owner 与版本；这不证明技能已被当前会话加载。","facts":[{"label":"instanceId","value":"1a9a7667-8935-4c9c-9a58-f27e61f252a8"},{"label":"pid","value":"21044"},{"label":"runtimeVersion","value":"0.2.1-rc.2"},{"label":"profile","value":"desktop"},{"label":"endpointType","value":"desktop"}]},{"id":"diagnostic:4b07c337a06dbacb5370dd6e8b8ac4f62ab84a616287d1accea7eae299894d01:0","group":"其他","code":"outbox-empty","level":"pass","label":"发件箱","description":"✅ 发件箱空（无暂存消息）","guidance":"此检查无需处理；需要时在当前机器重新运行体检。","facts":[]}],"summary":{"pass":4,"warn":5,"error":0,"failed":false},"completeness":"complete","observedAt":1793718265149,"errors":[]}}
{"event":"exit","code":0,"before":{"raw":false,"sigint":0,"sigterm":0},"after":{"raw":false,"sigint":0,"sigterm":0}}
```

</details>

<details><summary>健康场ConPTY完整事件</summary>

转录SHA-256: 8a61ac0b889cbefc7db1bfdd904a1615a90eba9b776044144bdf8ba7dcd5aae4

```text
{"at":1793718264191,"direction":"host","event":"ready","pid":11364,"columns":140,"rows":34}
{"at":1793718264198,"direction":"host","event":"output","data":"G1s/OTAwMWgbWz8xMDA0aA=="}
{"at":1793718264553,"direction":"host","event":"output","data":"G1s/MjVsG1syShtbbRtbSBtdMDtEOlxzb2Z0XG5vZGUuanNcbm9kZS5leGUHG1s/MjVoG1s/MTA0OWg="}
{"at":1793718264554,"direction":"host","event":"output","data":"G1s/MjVsG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLG1tIG1s/MjVo"}
{"at":1793718264572,"direction":"host","event":"output","data":"G1s/MjVs"}
{"at":1793718264601,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718264602,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718264604,"direction":"host","event":"output","data":"G1s/MjAwNGg="}
{"at":1793718264623,"direction":"host","event":"output","data":"Q0Mgwrcg5bel5L2c5Yy6OiDlhajlsYDnnIvmnb8gwrcgY3R4ICAgICAgICAgICAgICAgICA8RW50ZXI+IOi/m+WFpei/nuaOpSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgQ0MbW0sNCuebruaghzog6YCJ5oup55uu5qCH6L+b5YWl5bel5L2c5Yy6ICAgICAgICAgICAgICAgICAgICA8ZD4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfX18gIF9fXyAgICAgDQrop5LoibI6IOWwmuacqumAieaLqSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxyPiDliLfmlrAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8gX198LyBfX3wgICAgDQrmoLjpqow6IOWFqOWxgOWPquivuyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDw/PiDlhajpg6jmjInplK4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IChfX3wgKF9fICAgICANCuW9k+WJjTog6L+e5o6l5LiK5LiL5paHICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDov57mjqXkuIrkuIvmlocgKDpjdHgpIFsxXSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJANCuKUgiAg6L+e5o6lICAgICAgICAgICAgICAgICAgICAgIOexu+WeiyAgICAgICAg55uu5qCHICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSC4oC6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgIOacrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGN0eD4gMS8xIMK3IOWujOaVtBtbSw0KG1tLDQo66LWE5rqQICAv562b6YCJICBFc2Pov5Tlm54gIHHpgIDlh7obW0sbWzExMkM="}
{"at":1793718264623,"direction":"driver","op":"write","data":"DQ=="}
{"at":1793718264682,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718264682,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718264697,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgbG9jYWwgICAgICAgICAgICAgICAgICAgPEVudGVyPiDov5vlhaXotYTmupAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkPiDlj6ror7vor6bmg4UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDmnKzmnLrlt6XkvZzljLogKDpsb2NhbCkgWzldIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUkA0K4pSCICDotYTmupAgICAgICAgICAgICAgICAgICDlkb3ku6QgICAgICAgICAgICAgICAg6K+05piOICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilILigLog5Lya6K+dICAgICAgICAgICAgICAgICAgOnNlc3Npb25zICAgICAgICAgICDkvJror53lj5HnjrDjgIHnrZvpgInkuI7lj6ror7vor6bmg4UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOeKtuaAgeaAu+iniCAgICAgICAgICAgICAgOnN0YXR1cyAgICAgICAgICAgICDlvZPliY3ov57mjqXnirbmgIEgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOaKlemAkuiusOW9lSAgICAgICAgICAgICAgOmRlbGl2ZXJpZXMgICAgICAgICDmipXpgJLlhYPmlbDmja7kuI7lm57miacgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5rue55WZICAgICAgICAgICAgICAgICAgOm91dGJveCAgICAgICAgICAgICDlvoXmipXpgJLpobkgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDkvZPmo4AgICAgICAgICAgICAgICAgICA6ZG9jdG9yICAgICAgICAgICAgIOaMiemcgOajgOafpeS4juWPquivu+WkhOeQhuaMh+W8lSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDmnI3liqEgICAgICAgICAgICAgICAgICA6c2VydmljZXMgICAgICAgICAgIOacrOacuuacjeWKoSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOaXpeW/lyAgICAgICAgICAgICAgICAgIDpsb2dzICAgICAgICAgICAgICAg5pyJ55WM5pel5b+X6K+75Y+WICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDmlofku7YgICAgICAgICAgICAgICAgICA6ZmlsZXMgICAgICAgICAgICAgIOaUtuS7tuS4juaWreeCueWFg+aVsOaNriAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDnu7TmiqQgICAgICAgICAgICAgICAgICA6bWFpbnRlbmFuY2UgICAgICAgIOe7tOaKpOS7u+WKoemihOiniOS4juehruiupCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYDQo8bG9jYWw+IDEvOSDCtyDlrozmlbQbW0sNCumAieaLqeacrOacuui1hOa6kO+8m1RDUCDmmJ/nrqHnkIbor7fov5vlhaUgOnRjcOOAghtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLG1sxMTJD"}
{"at":1793718264774,"direction":"driver","op":"write","data":"OmRvY3Rvcg0="}
{"at":1793718264810,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718264810,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718264823,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBDQxtbSw0K55uu5qCHOiBDMTDpmpTnprvmnKzmnLogICAgICAgICAgICAgICAgICAgICAgICAgICA8RW50ZXI+IOWPquivu+ivpuaDhSDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX19fICBfX18gICAgIA0K6KeS6ImyOiDmnKzmnLrnlKjmiLcgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8cj4g5Yi35pawICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvIF9ffC8gX198ICAgIA0K5qC46aqMOiDmraPlnKjmoLjpqowgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFswXSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJANCuKUgiAg5qOA5p+l6aG5ICAgICAgICAgICAgICAgICAgICDliIbnu4QgICAgICAgICAgICAgICAg57uT5p6cICAgICAgICAgICAg6K+05piOICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSC5q2j5Zyo6K+75Y+W4oCmIEN0cmwrQyDlj5bmtoggICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMOmhuSDCtyDkuI3lj6/nlKggwrcg6K+75Y+W5LitG1tLDQobW0sNCjrotYTmupAgIC/nrZvpgIkgIEVzY+i/lOWbniAgcemAgOWHuhtbSxtbMTEyQw=="}
{"at":1793718265176,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718265176,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718265207,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxFbnRlcj4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNSAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFs5XSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJANCuKUgiAg5qOA5p+l6aG5ICAgICAgICAgICAgICAgICAgICDliIbnu4QgICAgICAgICAgICAgICAg57uT5p6cICAgICAgICAgICAg6K+05piOICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSC4oC6IE5vZGUg54mI5pysICAgICAgICAgICAgICAgICDnjq/looMgICAgICAgICAgICAgICAg6YCa6L+HPHBhc3M+ICAgICAg4pyFIE5vZGUgdjI1LjAuMCAo4omlMjIpICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgQ2xhdWRlIOWPr+i3r+eUseS8muivnSAgICAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDorablkYo8d2Fybj4gICAgICDimqDvuI8gY2xhdWRlIENMSSDlj6/op6PmnpDvvIh1bmF2YWlsYWJsZS1jbGF1ZGXvvInvvIzkvYblvZPliY3igKYgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICBDb2RleCBDTEkgICAgICAgICAgICAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDorablkYo8d2Fybj4gICAgICDimqDvuI8gY29kZXggQ0xJIOacquWuieijheKAlOKAlOe6ryBjbGF1ZGUg5LqS6IGK5Y+v5b+955Wl77yb6ZyA6KaBIGNvZOKApiAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5bel5YW35oqA6IO9ICAgICAgICAgICAgICAgICAg546v5aKDICAgICAgICAgICAgICAgIOitpuWRijx3YXJuPiAgICAgIOKaoO+4jyBjbGF1ZGUg5L6nIHNraWxsIOacquWuieijhe+8iEQ6XHdvcmtzcGFjZVxDQ1xtdWx0aWNoYeKApiAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5bel5YW35oqA6IO9ICAgICAgICAgICAgICAgICAg546v5aKDICAgICAgICAgICAgICAgIOitpuWRijx3YXJuPiAgICAgIOKaoO+4jyBjb2RleCDkvqcgc2tpbGwg5pyq5a6J6KOF77yIRDpcd29ya3NwYWNlXENDXG11bHRpY2hhdOKApiAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5bel5YW35oqA6IO9ICAgICAgICAgICAgICAgICAg546v5aKDICAgICAgICAgICAgICAgIOitpuWRijx3YXJuPiAgICAgIOKaoO+4jyBoYXJuZXNzIOS+pyBza2lsbCDmnKrlronoo4XvvIhEOlx3b3Jrc3BhY2VcQ0NcbXVsdGljaOKApiAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg6LCD55So6Lqr5Lu9ICAgICAgICAgICAgICAgICAg546v5aKDICAgICAgICAgICAgICAgIOmAmui/hzxwYXNzPiAgICAgIOKchSDml6Dlj4zouqvku73mrovnlZkgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICBIYXJuZXNzIOahpeeJiOacrOS4jui6q+S7vSAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDpgJrov4c8cGFzcz4gICAgICDinIUgSGFybmVzcyDmoaUgMWE5YTc2NjctODkzNS00YzljLTlhNTgtZjI3ZTYxZjI1MmE44oCmICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5Y+R5Lu2566xICAgICAgICAgICAgICAgICAgICDlhbbku5YgICAgICAgICAgICAgICAg6YCa6L+HPHBhc3M+ICAgICAg4pyFIOWPkeS7tueuseepuu+8iOaXoOaaguWtmOa2iOaBr++8iSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYDQo8ZG9jdG9yPiAxLzkgwrcg5a6M5pW0G1tLDQo0IOmhuemAmui/h++8jDUg6aG56K2m5ZGK77yMMCDpobnplJnor6/vvJt5IOWkjeWItuaMh+W8le+8jOeUseeUqOaIt+aJp+ihjBtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLG1sxMTJD"}
{"at":1793718265207,"direction":"driver","op":"write","data":"L0hhcm5lc3Mg5qGl54mI5pys5LiO6Lqr5Lu9DQ=="}
{"at":1793718265225,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718265225,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718265230,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxFbnRlcj4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNSAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFsxXSAvSGFybmVzcyDmoaXniYjmnKzkuI7ouqvku70g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQDQrilIIgIOajgOafpemhuSAgICAgICAgICAgICAgICAgICAg5YiG57uEICAgICAgICAgICAgICAgIOe7k+aenCAgICAgICAgICAgIOivtOaYjiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUguKAuiBIYXJuZXNzIOahpeeJiOacrOS4jui6q+S7vSAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDpgJrov4c8cGFzcz4gICAgICDinIUgSGFybmVzcyDmoaUgMWE5YTc2NjctODkzNS00YzljLTlhNTgtZjI3ZTYxZjI1MmE44oCmICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMS8xIMK3IOWujOaVtBtbSw0KNCDpobnpgJrov4fvvIw1IOmhueitpuWRiu+8jDAg6aG56ZSZ6K+v77ybeSDlpI3liLbmjIflvJXvvIznlLHnlKjmiLfmiafooYwbW0sNCjrotYTmupAgIC/nrZvpgIkgIEVzY+i/lOWbniAgcemAgOWHuhtbSxtbMTEyQw=="}
{"at":1793718265325,"direction":"driver","op":"write","data":"ZA=="}
{"at":1793718265325,"direction":"driver","op":"resize","columns":64,"rows":20}
{"at":1793718265329,"direction":"host","event":"resized","columns":64,"rows":20}
{"at":1793718265330,"direction":"host","event":"output","data":"G1s4OzIwOzY0dBtbSOKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSADQo8ZG9jdG9yPiAxLzEgwrcg5a6M5pW0G1tLDQo0IOmhuemAmui/h++8jDUg6aG56K2m5ZGK77yMMCDpobnplJnor6/vvJt5IOWkjeWItuaMh+W8le+8jOeUseeUqOaIt+aJp+ihjBtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLG1szNkM="}
{"at":1793718265344,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718265345,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPOKGkT4g5ZCR5LiK5rua5YqoICAgICAgICAgICAgICAgPC8+IOafpeaJvuivpuaDhSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDIA0K55uu5qCHOiBDMTDpmpTnprvmnKzmnLogICAgICAgICAgICAgICAgICAgICAgICAgICA84oaTPiDlkJHkuIvmu5rliqggICAgICAgICAgICAgICA8Oj4g6LWE5rqQ5LiO562b6YCJICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX19fICBfX18bW0sNCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPFBnVXA+IOS4iuS4gOmhtSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8gX198LyBfX3wbW0sNCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNSAgICAgICAgICAgICAgICA8UGdEbj4g5LiL5LiA6aG1ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IChfX3wgKF9fG1tLDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxIb21lPiDlvIDlpLQgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxfX198XF9fX3wbW0sNCueJiOacrDogQzEwIG5hdGl2ZSBkaWFnbm9zdGljcyBmaXh0dXJlICAgICAgICA8RW5kPiDmnKvlsL4bW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFsxXSAvSGFybmVzcyDmoaXniYjmnKzkuI7ouqvku70g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQG1tLDQrilIJIYXJuZXNzIOahpeeJiOacrOS4jui6q+S7vSDCtyDlj6ror7vor6bmg4UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUguKAuiDmo4Dmn6Xpobk6IEhhcm5lc3Mg5qGl54mI5pys5LiO6Lqr5Lu9ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDs5OEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAg5YiG57uEOiDnjq/looMgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzExNkgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAg5Y6f5aeL5qOA5p+l56CBOiBoYXJuZXNzLWJyaWRnZS1yZWFkeSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDs5NEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAg57uT5p6cOiDpgJrov4c8cGFzcz4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzExMEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAg6K+05piOOiDinIUgSGFybmVzcyDmoaUgMWE5YTc2NjctODkzNS00YzljLTlhNTgtZjI3ZTYxZjI1MmE477ybSG9zDQobWzE5OzY0SHN0IFBJRCAyMTA0NO+8m3J1bnRpbWUgMC4yLjEtcmMuMu+8m3Byb2ZpbGU9ZGVza3RvcO+8jOexu+Weiz1kc2gtZGVza3QNChtbMTk7NjRIdG9wICAgICAgICAg4pSCG1s1MkMNCuKUgiAg5aSE55CG5oyH5byVOiDlt7LmoLjlrp7mnKzmrKHmoaXnmoTpibTmnYPjgIFvd25lciDkuI7niYjmnKzvvJvov5nkuI3or4HmmI7mioDog73lt7LooqsgDQobWzE5OzY0SCDlvZPliY3kvJror53liqDovb3jgIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTE1SA0KICAgICAgICAgICAg4pSCG1s1MUMNCuKUgiAg5omn6KGM5L2N572uOiDlvZPliY3mnKzmnLrvvJtUVUkg5LiN6Ieq5Yqo5omn6KGM5aSE55CG5oyH5byVICAgICAgICAgICAgICAgICAgIBtbMjA7ODRIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgIOmHh+agt+aXtumXtDogMjAyNi0xMS0wM1QxNTowNDoyNS4xNDlaICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDs5MkgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgaW5zdGFuY2VJZDogMWE5YTc2NjctODkzNS00YzljLTlhNTgtZjI3ZTYxZjI1MmE4ICAgICAgICAgICAgIBtbMjA7NzhIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgIHBpZDogMjEwNDQgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzExNkgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgcnVudGltZVZlcnNpb246IDAuMi4xLXJjLjIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTAwSA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICBwcm9maWxlOiBkZXNrdG9wICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMTBIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgIGVuZHBvaW50VHlwZTogZGVza3RvcCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEwNUgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI4SA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjhIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI4SA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjhIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI4SA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjhIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgA0KG1sxOTs2NEjilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIANChtbMTk7NjRI4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYG1s1MkMNCjxkb2N0b3I+IDEvMSDCtyDlrozmlbQbWzQ1Qw0KNCDpobnpgJrov4fvvIw1IOmhueitpuWRiu+8jDAg6aG56ZSZ6K+v77ybeSDlpI3liLbmjIflvJXvvIznlLHnlKjmiLfmiafooYwbWzEyQw=="}
{"at":1793718265345,"direction":"driver","op":"resize","columns":140,"rows":34}
{"at":1793718265346,"direction":"host","event":"output","data":"DQo66LWE5rqQICAv562b6YCJICBFc2Pov5Tlm54gIHHpgIDlh7obWzM2Qw=="}
{"at":1793718265346,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718265346,"direction":"host","event":"resized","columns":140,"rows":34}
{"at":1793718265364,"direction":"host","event":"output","data":"G1tIICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUghtbSw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIIbW0sNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCG1tLDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUghtbSw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIIbW0sNCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYG1tLDQo8ZG9jdG9yPiAxLzEgwrcg5a6M5pW0G1tLDQo0IOmhuemAmui/h++8jDUg6aG56K2m5ZGK77yMMCDpobnplJnor6/vvJt5IOWkjeWItuaMh+W8le+8jOeUseeUqOaIt+aJp+ihjBtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSxtbMTQwQw=="}
{"at":1793718265448,"direction":"driver","op":"write","data":"Gw=="}
{"at":1793718265488,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718265488,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxFbnRlcj4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNSAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFsxXSAvSGFybmVzcyDmoaXniYjmnKzkuI7ouqvku70g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQDQrilIIgIOajgOafpemhuSAgICAgICAgICAgICAgICAgICAg5YiG57uEICAgICAgICAgICAgICAgIOe7k+aenCAgICAgICAgICAgIOivtOaYjiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUguKAuiBIYXJuZXNzIOahpeeJiOacrOS4jui6q+S7vSAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDpgJrov4c8cGFzcz4gICAgICDinIUgSGFybmVzcyDmoaUgMWE5YTc2NjctODkzNS00YzljLTlhNTgtZjI3ZTYxZjI1MmE44oCmICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMS8xIMK3IOWujOaVtBtbSw0KNCDpobnpgJrov4fvvIw1IOmhueitpuWRiu+8jDAg6aG56ZSZ6K+v77ybeSDlpI3liLbmjIflvJXvvIznlLHnlKjmiLfmiafooYwbW0sNCjrotYTmupAgIC/nrZvpgIkgIEVzY+i/lOWbniAgcemAgOWHuhtbSxtbMTEyQw=="}
{"at":1793718265488,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718265560,"direction":"driver","op":"write","data":"cQ=="}
{"at":1793718265570,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718265570,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxFbnRlcj4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNSAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFsxXSAvSGFybmVzcyDmoaXniYjmnKzkuI7ouqvku70g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQDQrilIIgIOajgOafpemhuSAgICAgICAgICAgICAgICAgICAg5YiG57uEICAgICAgICAgICAgICAgIOe7k+aenCAgICAgICAgICAgIOivtOaYjiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUguKAuiBIYXJuZXNzIOahpeeJiOacrOS4jui6q+S7vSAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDpgJrov4c8cGFzcz4gICAgICDinIUgSGFybmVzcyDmoaUgMWE5YTc2NjctODkzNS00YzljLTlhNTgtZjI3ZTYxZjI1MmE44oCmICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMS8xIMK3IOWujOaVtBtbSw0KNCDpobnpgJrov4fvvIw1IOmhueitpuWRiu+8jDAg6aG56ZSZ6K+v77ybeSDlpI3liLbmjIflvJXvvIznlLHnlKjmiLfmiafooYwbW0sNCjrotYTmupAgIC/nrZvpgIkgIEVzY+i/lOWbniAgcemAgOWHuhtbSxtbMTEyQw=="}
{"at":1793718265571,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718265573,"direction":"host","event":"output","data":"G1s/MjAwNGw="}
{"at":1793718265574,"direction":"host","event":"output","data":"G1szNDsyOUgbWz8yNWgbWz8xMDQ5bA=="}
{"at":1793718265576,"direction":"host","event":"output","data":"G1s/MjAwNGw="}
{"at":1793718265581,"direction":"host","event":"output","data":"G1s/MjVsG1tIG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLG1tIG1s/MjVo"}
{"at":1793718265619,"direction":"host","event":"output","data":"G1s/OTAwMWwbWz8xMDA0bA=="}
{"at":1793718265633,"direction":"host","event":"exit","code":0}
{"at":1793718265724,"direction":"driver","event":"host-exit","code":0}
```

</details>

<details><summary>鉴权失败场应用事件</summary>

转录SHA-256: 84430f4afadf3ae252ad5f22946dd9c6480e9dc11cf753fbb7ebb85f85616261

```text
{"event":"doctor","result":{"checks":[{"id":"diagnostic:bfcdfb38b4536c49bd9f81d7c7173ca1a2dbe0b0feae72c9324abc7350017e18:0","group":"环境","code":"node-supported","level":"pass","label":"Node 版本","description":"✅ Node v25.0.0 (≥22)","guidance":"此检查无需处理；需要时在当前机器重新运行体检。","facts":[{"label":"version","value":"25.0.0"}]},{"id":"diagnostic:983e19a75c4c31edbc6949e7b021ee21ce71e430a2898218a2bd9ac0c20253d4:0","group":"环境","code":"claude-empty","level":"warn","label":"Claude 可路由会话","description":"⚠️ claude CLI 可解析（unavailable-claude），但当前无可路由会话（crosschat claude 启动的会话才可接收）","guidance":"在当前机器用 crosschat claude 启动需要接收消息的原生会话，再刷新。","facts":[{"label":"executable","value":"unavailable-claude"}]},{"id":"diagnostic:5bfef07bd26fc257d023b75b874b49a28dcbfbb600d065922353683204df7bb4:0","group":"环境","code":"codex-missing","level":"warn","label":"Codex CLI","description":"⚠️ codex CLI 未安装——纯 claude 互聊可忽略；需要 codex 会话时安装并运行: codex app-server daemon start","guidance":"需要 Codex 通道时先确认已安装 Codex CLI，再由用户在当前机器执行：codex app-server daemon start","facts":[]},{"id":"diagnostic:46b8b51eb324540abf4cca63d31f7cab9772a9c32c107da0f2a2f43db8e37ef6:0","group":"环境","code":"skill-missing","level":"warn","label":"工具技能","description":"⚠️ claude 侧 skill 未安装（D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.claude\\skills\\crosschat\\SKILL.md）；运行 crosschat install-skills","guidance":"由用户在当前机器执行：crosschat install-skills","facts":[{"label":"side","value":"claude"},{"label":"path","value":"D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.claude\\skills\\crosschat\\SKILL.md"}]},{"id":"diagnostic:dbd39cdf1b3dc41de302c417d94adb96bc15ba89f2e95280656d6c2fa872b48f:0","group":"环境","code":"skill-missing","level":"warn","label":"工具技能","description":"⚠️ codex 侧 skill 未安装（D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.codex\\skills\\crosschat\\SKILL.md）；运行 crosschat install-skills","guidance":"由用户在当前机器执行：crosschat install-skills","facts":[{"label":"side","value":"codex"},{"label":"path","value":"D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.codex\\skills\\crosschat\\SKILL.md"}]},{"id":"diagnostic:bae1942ab44d619af86a6175120a9de39dffa72508d7733cd2987cd6298184d0:0","group":"环境","code":"skill-missing","level":"warn","label":"工具技能","description":"⚠️ harness 侧 skill 未安装（D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.dsh\\skills\\crosschat\\SKILL.md）；运行 crosschat install-skills","guidance":"由用户在当前机器执行：crosschat install-skills","facts":[{"label":"side","value":"harness"},{"label":"path","value":"D:\\workspace\\CC\\multichat\\node_modules\\.cache\\crosschat-c10-bridge-20261103-moxEhM\\tui-home\\.dsh\\skills\\crosschat\\SKILL.md"}]},{"id":"diagnostic:32cc52028de92b67f5848fcf0d3c90edbe41f97d202615112a8cf6a11355c4fa:0","group":"环境","code":"identity-clear","level":"pass","label":"调用身份","description":"✅ 无双身份残留","guidance":"此检查无需处理；需要时在当前机器重新运行体检。","facts":[]},{"id":"diagnostic:e35c28d5fd4f403398057a8c5d674eb07f39406b607c784d4323765794dd7fbf:0","group":"环境","code":"harness-bridge-warning","level":"warn","label":"Harness 桥异常","description":"⚠️ Harness 桥 DSH_AUTH_REQUIRED——桥拒绝鉴权；核对当前 profile 的插件状态，刷新其最新实例登记后重试诊断。","guidance":"桥拒绝鉴权；核对当前 profile 的插件状态，刷新其最新实例登记后重试诊断。","facts":[{"label":"reason","value":"DSH_AUTH_REQUIRED"}]},{"id":"diagnostic:4b07c337a06dbacb5370dd6e8b8ac4f62ab84a616287d1accea7eae299894d01:0","group":"其他","code":"outbox-empty","level":"pass","label":"发件箱","description":"✅ 发件箱空（无暂存消息）","guidance":"此检查无需处理；需要时在当前机器重新运行体检。","facts":[]}],"summary":{"pass":3,"warn":6,"error":0,"failed":false},"completeness":"complete","observedAt":1793718267413,"errors":[]}}
{"event":"exit","code":0,"before":{"raw":false,"sigint":0,"sigterm":0},"after":{"raw":false,"sigint":0,"sigterm":0}}
```

</details>

<details><summary>鉴权失败场ConPTY完整事件</summary>

转录SHA-256: 9c6b68ca7cdc871a5fa1d40dad22f1986ef8aec90837bca030de45ad42e1c1e4

```text
{"at":1793718266438,"direction":"host","event":"ready","pid":20364,"columns":140,"rows":34}
{"at":1793718266440,"direction":"host","event":"output","data":"G1s/OTAwMWgbWz8xMDA0aA=="}
{"at":1793718266787,"direction":"host","event":"output","data":"G1s/MjVsG1syShtbbRtbSBtdMDtEOlxzb2Z0XG5vZGUuanNcbm9kZS5leGUHG1s/MjVoG1s/MTA0OWg="}
{"at":1793718266788,"direction":"host","event":"output","data":"G1s/MjVsG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLG1tIG1s/MjVo"}
{"at":1793718266806,"direction":"host","event":"output","data":"G1s/MjVs"}
{"at":1793718266835,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718266836,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718266838,"direction":"host","event":"output","data":"G1s/MjAwNGg="}
{"at":1793718266848,"direction":"host","event":"output","data":"Q0Mgwrcg5bel5L2c5Yy6OiDlhajlsYDnnIvmnb8gwrcgY3R4ICAgICAgICAgICAgICAgICA8RW50ZXI+IOi/m+WFpei/nuaOpSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgQ0MbW0sNCuebruaghzog6YCJ5oup55uu5qCH6L+b5YWl5bel5L2c5Yy6ICAgICAgICAgICAgICAgICAgICA8ZD4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfX18gIF9fXyAgICAgDQrop5LoibI6IOWwmuacqumAieaLqSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxyPiDliLfmlrAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8gX198LyBfX3wgICAgDQrmoLjpqow6IOWFqOWxgOWPquivuyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDw/PiDlhajpg6jmjInplK4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IChfX3wgKF9fICAgICANCuW9k+WJjTog6L+e5o6l5LiK5LiL5paHICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDov57mjqXkuIrkuIvmlocgKDpjdHgpIFsxXSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJANCuKUgiAg6L+e5o6lICAgICAgICAgICAgICAgICAgICAgIOexu+WeiyAgICAgICAg55uu5qCHICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSC4oC6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgIOacrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGN0eD4gMS8xIMK3IOWujOaVtBtbSw0KG1tLDQo66LWE5rqQICAv562b6YCJICBFc2Pov5Tlm54gIHHpgIDlh7obW0sbWzExMkM="}
{"at":1793718266849,"direction":"driver","op":"write","data":"DQ=="}
{"at":1793718266908,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718266908,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718266930,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgbG9jYWwgICAgICAgICAgICAgICAgICAgPEVudGVyPiDov5vlhaXotYTmupAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkPiDlj6ror7vor6bmg4UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDmnKzmnLrlt6XkvZzljLogKDpsb2NhbCkgWzldIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUkA0K4pSCICDotYTmupAgICAgICAgICAgICAgICAgICDlkb3ku6QgICAgICAgICAgICAgICAg6K+05piOICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilILigLog5Lya6K+dICAgICAgICAgICAgICAgICAgOnNlc3Npb25zICAgICAgICAgICDkvJror53lj5HnjrDjgIHnrZvpgInkuI7lj6ror7vor6bmg4UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOeKtuaAgeaAu+iniCAgICAgICAgICAgICAgOnN0YXR1cyAgICAgICAgICAgICDlvZPliY3ov57mjqXnirbmgIEgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOaKlemAkuiusOW9lSAgICAgICAgICAgICAgOmRlbGl2ZXJpZXMgICAgICAgICDmipXpgJLlhYPmlbDmja7kuI7lm57miacgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5rue55WZICAgICAgICAgICAgICAgICAgOm91dGJveCAgICAgICAgICAgICDlvoXmipXpgJLpobkgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDkvZPmo4AgICAgICAgICAgICAgICAgICA6ZG9jdG9yICAgICAgICAgICAgIOaMiemcgOajgOafpeS4juWPquivu+WkhOeQhuaMh+W8lSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDmnI3liqEgICAgICAgICAgICAgICAgICA6c2VydmljZXMgICAgICAgICAgIOacrOacuuacjeWKoSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOaXpeW/lyAgICAgICAgICAgICAgICAgIDpsb2dzICAgICAgICAgICAgICAg5pyJ55WM5pel5b+X6K+75Y+WICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDmlofku7YgICAgICAgICAgICAgICAgICA6ZmlsZXMgICAgICAgICAgICAgIOaUtuS7tuS4juaWreeCueWFg+aVsOaNriAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDnu7TmiqQgICAgICAgICAgICAgICAgICA6bWFpbnRlbmFuY2UgICAgICAgIOe7tOaKpOS7u+WKoemihOiniOS4juehruiupCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYDQo8bG9jYWw+IDEvOSDCtyDlrozmlbQbW0sNCumAieaLqeacrOacuui1hOa6kO+8m1RDUCDmmJ/nrqHnkIbor7fov5vlhaUgOnRjcOOAghtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLG1sxMTJD"}
{"at":1793718267007,"direction":"driver","op":"write","data":"OmRvY3Rvcg0="}
{"at":1793718267048,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718267049,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718267064,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBDQxtbSw0K55uu5qCHOiBDMTDpmpTnprvmnKzmnLogICAgICAgICAgICAgICAgICAgICAgICAgICA8RW50ZXI+IOWPquivu+ivpuaDhSDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX19fICBfX18gICAgIA0K6KeS6ImyOiDmnKzmnLrnlKjmiLcgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8cj4g5Yi35pawICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvIF9ffC8gX198ICAgIA0K5qC46aqMOiDmraPlnKjmoLjpqowgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFswXSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJANCuKUgiAg5qOA5p+l6aG5ICAgICAgICAgICAgICAgICAgICDliIbnu4QgICAgICAgICAgICAgICAg57uT5p6cICAgICAgICAgICAg6K+05piOICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSC5q2j5Zyo6K+75Y+W4oCmIEN0cmwrQyDlj5bmtoggICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMOmhuSDCtyDkuI3lj6/nlKggwrcg6K+75Y+W5LitG1tLDQobW0sNCjrotYTmupAgIC/nrZvpgIkgIEVzY+i/lOWbniAgcemAgOWHuhtbSxtbMTEyQw=="}
{"at":1793718267438,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718267438,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718267448,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxFbnRlcj4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNyAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFs5XSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJANCuKUgiAg5qOA5p+l6aG5ICAgICAgICAgICAgICAgICAgICDliIbnu4QgICAgICAgICAgICAgICAg57uT5p6cICAgICAgICAgICAg6K+05piOICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSC4oC6IE5vZGUg54mI5pysICAgICAgICAgICAgICAgICDnjq/looMgICAgICAgICAgICAgICAg6YCa6L+HPHBhc3M+ICAgICAg4pyFIE5vZGUgdjI1LjAuMCAo4omlMjIpICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgQ2xhdWRlIOWPr+i3r+eUseS8muivnSAgICAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDorablkYo8d2Fybj4gICAgICDimqDvuI8gY2xhdWRlIENMSSDlj6/op6PmnpDvvIh1bmF2YWlsYWJsZS1jbGF1ZGXvvInvvIzkvYblvZPliY3igKYgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICBDb2RleCBDTEkgICAgICAgICAgICAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDorablkYo8d2Fybj4gICAgICDimqDvuI8gY29kZXggQ0xJIOacquWuieijheKAlOKAlOe6ryBjbGF1ZGUg5LqS6IGK5Y+v5b+955Wl77yb6ZyA6KaBIGNvZOKApiAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5bel5YW35oqA6IO9ICAgICAgICAgICAgICAgICAg546v5aKDICAgICAgICAgICAgICAgIOitpuWRijx3YXJuPiAgICAgIOKaoO+4jyBjbGF1ZGUg5L6nIHNraWxsIOacquWuieijhe+8iEQ6XHdvcmtzcGFjZVxDQ1xtdWx0aWNoYeKApiAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5bel5YW35oqA6IO9ICAgICAgICAgICAgICAgICAg546v5aKDICAgICAgICAgICAgICAgIOitpuWRijx3YXJuPiAgICAgIOKaoO+4jyBjb2RleCDkvqcgc2tpbGwg5pyq5a6J6KOF77yIRDpcd29ya3NwYWNlXENDXG11bHRpY2hhdOKApiAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5bel5YW35oqA6IO9ICAgICAgICAgICAgICAgICAg546v5aKDICAgICAgICAgICAgICAgIOitpuWRijx3YXJuPiAgICAgIOKaoO+4jyBoYXJuZXNzIOS+pyBza2lsbCDmnKrlronoo4XvvIhEOlx3b3Jrc3BhY2VcQ0NcbXVsdGljaOKApiAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg6LCD55So6Lqr5Lu9ICAgICAgICAgICAgICAgICAg546v5aKDICAgICAgICAgICAgICAgIOmAmui/hzxwYXNzPiAgICAgIOKchSDml6Dlj4zouqvku73mrovnlZkgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICBIYXJuZXNzIOahpeW8guW4uCAgICAgICAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDorablkYo8d2Fybj4gICAgICDimqDvuI8gSGFybmVzcyDmoaUgRFNIX0FVVEhfUkVRVUlSRUTigJTigJTmoaXmi5Lnu53pibTmnYPvvJvmoLjlr7nlvZPigKYgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOWPkeS7tueusSAgICAgICAgICAgICAgICAgICAg5YW25LuWICAgICAgICAgICAgICAgIOmAmui/hzxwYXNzPiAgICAgIOKchSDlj5Hku7bnrrHnqbrvvIjml6DmmoLlrZjmtojmga/vvIkgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMS85IMK3IOWujOaVtBtbSw0KMyDpobnpgJrov4fvvIw2IOmhueitpuWRiu+8jDAg6aG56ZSZ6K+v77ybeSDlpI3liLbmjIflvJXvvIznlLHnlKjmiLfmiafooYwbW0sNCjrotYTmupAgIC/nrZvpgIkgIEVzY+i/lOWbniAgcemAgOWHuhtbSxtbMTEyQw=="}
{"at":1793718267449,"direction":"driver","op":"write","data":"L0hhcm5lc3Mg5qGl5byC5bi4DQ=="}
{"at":1793718267503,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718267504,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718267515,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxFbnRlcj4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNyAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFsxXSAvSGFybmVzcyDmoaXlvILluLgg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQDQrilIIgIOajgOafpemhuSAgICAgICAgICAgICAgICAgICAg5YiG57uEICAgICAgICAgICAgICAgIOe7k+aenCAgICAgICAgICAgIOivtOaYjiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUguKAuiBIYXJuZXNzIOahpeW8guW4uCAgICAgICAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDorablkYo8d2Fybj4gICAgICDimqDvuI8gSGFybmVzcyDmoaUgRFNIX0FVVEhfUkVRVUlSRUTigJTigJTmoaXmi5Lnu53pibTmnYPvvJvmoLjlr7nlvZPigKYgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilJTilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJgNCjxkb2N0b3I+IDEvMSDCtyDlrozmlbQbW0sNCjMg6aG56YCa6L+H77yMNiDpobnorablkYrvvIwwIOmhuemUmeivr++8m3kg5aSN5Yi25oyH5byV77yM55Sx55So5oi35omn6KGMG1tLDQo66LWE5rqQICAv562b6YCJICBFc2Pov5Tlm54gIHHpgIDlh7obW0sbWzExMkM="}
{"at":1793718267552,"direction":"driver","op":"write","data":"ZA=="}
{"at":1793718267553,"direction":"driver","op":"resize","columns":64,"rows":20}
{"at":1793718267557,"direction":"host","event":"resized","columns":64,"rows":20}
{"at":1793718267558,"direction":"host","event":"output","data":"G1s4OzIwOzY0dBtbSOKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSCG1tLDQrilIIbW0sNCuKUghtbSw0K4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSADQo8ZG9jdG9yPiAxLzEgwrcg5a6M5pW0G1tLDQozIOmhuemAmui/h++8jDYg6aG56K2m5ZGK77yMMCDpobnplJnor6/vvJt5IOWkjeWItuaMh+W8le+8jOeUseeUqOaIt+aJp+ihjBtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLG1szNkM="}
{"at":1793718267573,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718267573,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPOKGkT4g5ZCR5LiK5rua5YqoICAgICAgICAgICAgICAgPC8+IOafpeaJvuivpuaDhSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDIA0K55uu5qCHOiBDMTDpmpTnprvmnKzmnLogICAgICAgICAgICAgICAgICAgICAgICAgICA84oaTPiDlkJHkuIvmu5rliqggICAgICAgICAgICAgICA8Oj4g6LWE5rqQ5LiO562b6YCJICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX19fICBfX18bW0sNCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPFBnVXA+IOS4iuS4gOmhtSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8gX198LyBfX3wbW0sNCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNyAgICAgICAgICAgICAgICA8UGdEbj4g5LiL5LiA6aG1ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IChfX3wgKF9fG1tLDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxIb21lPiDlvIDlpLQgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxfX198XF9fX3wbW0sNCueJiOacrDogQzEwIG5hdGl2ZSBkaWFnbm9zdGljcyBmaXh0dXJlICAgICAgICA8RW5kPiDmnKvlsL4bW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFsxXSAvSGFybmVzcyDmoaXlvILluLgg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQG1tLDQrilIJIYXJuZXNzIOahpeW8guW4uCDCtyDlj6ror7vor6bmg4UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUguKAuiDmo4Dmn6Xpobk6IEhhcm5lc3Mg5qGl5byC5bi4ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMDRIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgIOWIhue7hDog546v5aKDICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMTZIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgIOWOn+Wni+ajgOafpeeggTogaGFybmVzcy1icmlkZ2Utd2FybmluZyAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7OTJIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgIOe7k+aenDog6K2m5ZGKPHdhcm4+ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMTBIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgIOivtOaYjjog4pqg77iPIEhhcm5lc3Mg5qGlIERTSF9BVVRIX1JFUVVJUkVE4oCU4oCU5qGl5ouS57ud6Ym05p2D77yb5qC45a+55b2T5YmNIHANChtbMTk7NjRIcHJvZmlsZSDnmoTmj5Lku7bnirbmgIHvvIzliLfmlrDlhbbmnIDmlrDlrp7kvovnmbvorrDlkI7ph43or5Xor4rmlq3jgIIgICAgICAgICAgICAgICAbWzIwOzgwSA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICDlpITnkIbmjIflvJU6IOahpeaLkue7nemJtOadg++8m+aguOWvueW9k+WJjSBwcm9maWxlIOeahOaPkuS7tueKtuaAge+8jOWIt+aWsOWFtuacgOaWsA0KG1sxOTs2M0jmlrDlrp7kvovnmbvorrDlkI7ph43or5Xor4rmlq3jgIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTA5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICDmiafooYzkvY3nva46IOW9k+WJjeacrOacuu+8m1RVSSDkuI3oh6rliqjmiafooYzlpITnkIbmjIflvJUgICAgICAgICAgICAgICAgICAgG1syMDs4NEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAg6YeH5qC35pe26Ze0OiAyMDI2LTExLTAzVDE1OjA0OjI3LjQxM1ogICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzkySA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICByZWFzb246IERTSF9BVVRIX1JFUVVJUkVEICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMDFIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI4SA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjhIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI4SA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjhIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI4SA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjhIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI4SA0KICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIBtbMjA7MTI5SA0KICAgICAgICAgICDilIIbWzUyQw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjhIDQogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgG1syMDsxMjlIDQogICAgICAgICAgIOKUghtbNTJDDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOEgNCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAbWzIwOzEyOUgNCiAgICAgICAgICAg4pSCG1s1MkMNCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgA0KG1sxOTs2NEjilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIANChtbMTk7NjRI4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYG1s1MkMNCjxkb2N0b3I+IDEvMSDCtyDlrozmlbQbWzQ1Qw0KMyDpobnpgJrov4fvvIw2IOmhueitpuWRiu+8jDAg6aG56ZSZ6K+v77ybeSDlpI3liLbmjIflvJXvvIznlLHnlKjmiLfmiafooYwbWzEyQw=="}
{"at":1793718267574,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718267574,"direction":"driver","op":"resize","columns":140,"rows":34}
{"at":1793718267575,"direction":"host","event":"resized","columns":140,"rows":34}
{"at":1793718267581,"direction":"host","event":"output","data":"G1szNDsxSAobW0ggICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCG1tLDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUghtbSw0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIIbW0sNCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCG1tLDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUghtbSw0K4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJgbW0sNCjxkb2N0b3I+IDEvMSDCtyDlrozmlbQbW0sNCjMg6aG56YCa6L+H77yMNiDpobnorablkYrvvIwwIOmhuemUmeivr++8m3kg5aSN5Yi25oyH5byV77yM55Sx55So5oi35omn6KGMG1tLDQo66LWE5rqQICAv562b6YCJICBFc2Pov5Tlm54gIHHpgIDlh7obW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLG1sxNDBD"}
{"at":1793718267677,"direction":"driver","op":"write","data":"Gw=="}
{"at":1793718267719,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718267720,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718267738,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxFbnRlcj4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNyAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFsxXSAvSGFybmVzcyDmoaXlvILluLgg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQDQrilIIgIOajgOafpemhuSAgICAgICAgICAgICAgICAgICAg5YiG57uEICAgICAgICAgICAgICAgIOe7k+aenCAgICAgICAgICAgIOivtOaYjiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUguKAuiBIYXJuZXNzIOahpeW8guW4uCAgICAgICAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDorablkYo8d2Fybj4gICAgICDimqDvuI8gSGFybmVzcyDmoaUgRFNIX0FVVEhfUkVRVUlSRUTigJTigJTmoaXmi5Lnu53pibTmnYPvvJvmoLjlr7nlvZPigKYgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilJTilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJgNCjxkb2N0b3I+IDEvMSDCtyDlrozmlbQbW0sNCjMg6aG56YCa6L+H77yMNiDpobnorablkYrvvIwwIOmhuemUmeivr++8m3kg5aSN5Yi25oyH5byV77yM55Sx55So5oi35omn6KGMG1tLDQo66LWE5rqQICAv562b6YCJICBFc2Pov5Tlm54gIHHpgIDlh7obW0sbWzExMkM="}
{"at":1793718267781,"direction":"driver","op":"write","data":"cQ=="}
{"at":1793718267791,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718267791,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718267794,"direction":"host","event":"output","data":"G1s/MjAwNGw="}
{"at":1793718267795,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxFbnRlcj4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BIMK3IOmHh+agtyAyMzowNDoyNyAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFsxXSAvSGFybmVzcyDmoaXlvILluLgg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSQDQrilIIgIOajgOafpemhuSAgICAgICAgICAgICAgICAgICAg5YiG57uEICAgICAgICAgICAgICAgIOe7k+aenCAgICAgICAgICAgIOivtOaYjiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUguKAuiBIYXJuZXNzIOahpeW8guW4uCAgICAgICAgICAgIOeOr+WigyAgICAgICAgICAgICAgICDorablkYo8d2Fybj4gICAgICDimqDvuI8gSGFybmVzcyDmoaUgRFNIX0FVVEhfUkVRVUlSRUTigJTigJTmoaXmi5Lnu53pibTmnYPvvJvmoLjlr7nlvZPigKYgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilJTilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJgNCjxkb2N0b3I+IDEvMSDCtyDlrozmlbQbW0sNCjMg6aG56YCa6L+H77yMNiDpobnorablkYrvvIwwIOmhuemUmeivr++8m3kg5aSN5Yi25oyH5byV77yM55Sx55So5oi35omn6KGMG1tLDQo66LWE5rqQICAv562b6YCJICBFc2Pov5Tlm54gIHHpgIDlh7obW0sbWz8yNWgbWz8xMDQ5bA=="}
{"at":1793718267798,"direction":"host","event":"output","data":"G1s/MjAwNGw="}
{"at":1793718267803,"direction":"host","event":"output","data":"G1s/MjVsG1tIG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLG1tIG1s/MjVo"}
{"at":1793718267847,"direction":"host","event":"output","data":"G1s/OTAwMWwbWz8xMDA0bA=="}
{"at":1793718267851,"direction":"host","event":"exit","code":0}
{"at":1793718267951,"direction":"driver","event":"host-exit","code":0}
```

</details>

<details><summary>请求取消场应用事件</summary>

转录SHA-256: 85d2ace844098d537add0362bfebc5bf1b3bf1940fe1bde2b1a967e50e580393

```text
{"event":"exit","code":0,"before":{"raw":false,"sigint":0,"sigterm":0},"after":{"raw":false,"sigint":0,"sigterm":0}}
{"event":"doctor","result":{"checks":[],"summary":null,"completeness":"cancelled","observedAt":1793718269663,"errors":[{"source":"doctor","kind":"cancelled","message":"体检已取消","nextStep":"检查此来源的路径、格式或读取能力后按 r 刷新"}]}}
```

</details>

<details><summary>请求取消场ConPTY完整事件</summary>

转录SHA-256: 44d67cfbe1a3bae193a0d8dfedd6c47662b24dd25a6ae270b4c8385a567f4f87

```text
{"at":1793718268680,"direction":"host","event":"ready","pid":26276,"columns":140,"rows":34}
{"at":1793718268682,"direction":"host","event":"output","data":"G1s/OTAwMWgbWz8xMDA0aA=="}
{"at":1793718269044,"direction":"host","event":"output","data":"G1s/MjVsG1syShtbbRtbSBtdMDtEOlxzb2Z0XG5vZGUuanNcbm9kZS5leGUHG1s/MjVoG1s/MTA0OWg="}
{"at":1793718269045,"direction":"host","event":"output","data":"G1s/MjVsG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLG1tIG1s/MjVo"}
{"at":1793718269063,"direction":"host","event":"output","data":"G1s/MjVs"}
{"at":1793718269086,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718269086,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718269088,"direction":"host","event":"output","data":"G1s/MjAwNGg="}
{"at":1793718269096,"direction":"host","event":"output","data":"Q0Mgwrcg5bel5L2c5Yy6OiDlhajlsYDnnIvmnb8gwrcgY3R4ICAgICAgICAgICAgICAgICA8RW50ZXI+IOi/m+WFpei/nuaOpSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgQ0MbW0sNCuebruaghzog6YCJ5oup55uu5qCH6L+b5YWl5bel5L2c5Yy6ICAgICAgICAgICAgICAgICAgICA8ZD4g5Y+q6K+76K+m5oOFICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBfX18gIF9fXyAgICAgDQrop5LoibI6IOWwmuacqumAieaLqSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxyPiDliLfmlrAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8gX198LyBfX3wgICAgDQrmoLjpqow6IOWFqOWxgOWPquivuyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDw/PiDlhajpg6jmjInplK4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IChfX3wgKF9fICAgICANCuW9k+WJjTog6L+e5o6l5LiK5LiL5paHICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDov57mjqXkuIrkuIvmlocgKDpjdHgpIFsxXSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJANCuKUgiAg6L+e5o6lICAgICAgICAgICAgICAgICAgICAgIOexu+WeiyAgICAgICAg55uu5qCHICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSC4oC6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgIOacrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGN0eD4gMS8xIMK3IOWujOaVtBtbSw0KG1tLDQo66LWE5rqQICAv562b6YCJICBFc2Pov5Tlm54gIHHpgIDlh7obW0sbWzExMkM="}
{"at":1793718269096,"direction":"driver","op":"write","data":"DQ=="}
{"at":1793718269156,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718269156,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgbG9jYWwgICAgICAgICAgICAgICAgICAgPEVudGVyPiDov5vlhaXotYTmupAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIENDG1tLDQrnm67moIc6IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkPiDlj6ror7vor6bmg4UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9fXyAgX19fICAgICANCuinkuiJsjog5pys5py655So5oi3ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHI+IOWIt+aWsCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLyBfX3wvIF9ffCAgICANCuaguOmqjDog5pyq6K6k6K+BICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDmnKzmnLrlt6XkvZzljLogKDpsb2NhbCkgWzldIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUkA0K4pSCICDotYTmupAgICAgICAgICAgICAgICAgICDlkb3ku6QgICAgICAgICAgICAgICAg6K+05piOICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilILigLog5Lya6K+dICAgICAgICAgICAgICAgICAgOnNlc3Npb25zICAgICAgICAgICDkvJror53lj5HnjrDjgIHnrZvpgInkuI7lj6ror7vor6bmg4UgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOeKtuaAgeaAu+iniCAgICAgICAgICAgICAgOnN0YXR1cyAgICAgICAgICAgICDlvZPliY3ov57mjqXnirbmgIEgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOaKlemAkuiusOW9lSAgICAgICAgICAgICAgOmRlbGl2ZXJpZXMgICAgICAgICDmipXpgJLlhYPmlbDmja7kuI7lm57miacgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAg5rue55WZICAgICAgICAgICAgICAgICAgOm91dGJveCAgICAgICAgICAgICDlvoXmipXpgJLpobkgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDkvZPmo4AgICAgICAgICAgICAgICAgICA6ZG9jdG9yICAgICAgICAgICAgIOaMiemcgOajgOafpeS4juWPquivu+WkhOeQhuaMh+W8lSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDmnI3liqEgICAgICAgICAgICAgICAgICA6c2VydmljZXMgICAgICAgICAgIOacrOacuuacjeWKoSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgIOaXpeW/lyAgICAgICAgICAgICAgICAgIDpsb2dzICAgICAgICAgICAgICAg5pyJ55WM5pel5b+X6K+75Y+WICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDmlofku7YgICAgICAgICAgICAgICAgICA6ZmlsZXMgICAgICAgICAgICAgIOaUtuS7tuS4juaWreeCueWFg+aVsOaNriAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICDnu7TmiqQgICAgICAgICAgICAgICAgICA6bWFpbnRlbmFuY2UgICAgICAgIOe7tOaKpOS7u+WKoemihOiniOS4juehruiupCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSU4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSYDQo8bG9jYWw+IDEvOSDCtyDlrozmlbQbW0sNCumAieaLqeacrOacuui1hOa6kO+8m1RDUCDmmJ/nrqHnkIbor7fov5vlhaUgOnRjcOOAghtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLG1sxMTJD"}
{"at":1793718269156,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718269247,"direction":"driver","op":"write","data":"OmRvY3Rvcg0="}
{"at":1793718269288,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718269288,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718269302,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBDQxtbSw0K55uu5qCHOiBDMTDpmpTnprvmnKzmnLogICAgICAgICAgICAgICAgICAgICAgICAgICA8RW50ZXI+IOWPquivu+ivpuaDhSDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX19fICBfX18gICAgIA0K6KeS6ImyOiDmnKzmnLrnlKjmiLcgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8cj4g5Yi35pawICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvIF9ffC8gX198ICAgIA0K5qC46aqMOiDmraPlnKjmoLjpqowgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8Pz4g5YWo6YOo5oyJ6ZSuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfCAoX198IChfXyAgICAgDQrlvZPliY06IEMxMOmalOemu+acrOacuiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBcX19ffFxfX198ICAgIA0K54mI5pysOiBDMTAgbmF0aXZlIGRpYWdub3N0aWNzIGZpeHR1cmUbW0sNCuKUjOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCDkvZPmo4AgKDpkb2N0b3IpIFswXSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilJANCuKUgiAg5qOA5p+l6aG5ICAgICAgICAgICAgICAgICAgICDliIbnu4QgICAgICAgICAgICAgICAg57uT5p6cICAgICAgICAgICAg6K+05piOICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSC5q2j5Zyo6K+75Y+W4oCmIEN0cmwrQyDlj5bmtoggICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMOmhuSDCtyDkuI3lj6/nlKggwrcg6K+75Y+W5LitG1tLDQobW0sNCjrotYTmupAgIC/nrZvpgIkgIEVzY+i/lOWbniAgcemAgOWHuhtbSxtbMTEyQw=="}
{"at":1793718269410,"direction":"driver","op":"write","data":"Aw=="}
{"at":1793718269440,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718269441,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBDQxtbSw0K55uu5qCHOiBDMTDpmpTnprvmnKzmnLogICAgICAgICAgICAgICAgICAgICAgICAgICA8RW50ZXI+IOWPquivu+ivpuaDhSDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX19fICBfX18gICAgIA0K6KeS6ImyOiDmnKzmnLrnlKjmiLcgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8cj4g5Yi35pawICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvIF9ffC8gX198ICAgIA0K5qC46aqMOiDmnKrorqTor4EgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDw/PiDlhajpg6jmjInplK4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IChfX3wgKF9fICAgICANCuW9k+WJjTogQzEw6ZqU56a75pys5py6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxfX198XF9fX3wgICAgDQrniYjmnKw6IEMxMCBuYXRpdmUgZGlhZ25vc3RpY3MgZml4dHVyZRtbSw0K4pSM4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAIOS9k+ajgCAoOmRvY3RvcikgWzBdIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUkA0K4pSCICDmo4Dmn6XpobkgICAgICAgICAgICAgICAgICAgIOWIhue7hCAgICAgICAgICAgICAgICDnu5PmnpwgICAgICAgICAgICDor7TmmI4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilILor7vlj5blt7Llj5bmtoggwrcg5b2T5YmN57uT5p6c5LiN5a6M5pW077yMcumHjeaWsOivu+WPliAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMOmhuSDCtyDlt7Llj5bmtogbW0sNCuivu+WPluW3suWPlua2iO+8m+W9k+WJjeWGheWuueWPr+iDveS4jeWujOaVtOOAghtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLG1sxMTJD"}
{"at":1793718269441,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718269442,"direction":"driver","op":"write","data":"cQ=="}
{"at":1793718269452,"direction":"host","event":"output","data":"G1s/MjAyNmg="}
{"at":1793718269452,"direction":"host","event":"output","data":"G1s/MjAyNmw="}
{"at":1793718269454,"direction":"host","event":"output","data":"G1s/MjAwNGw="}
{"at":1793718269456,"direction":"host","event":"output","data":"G1tIQ0Mgwrcg5bel5L2c5Yy6OiDmnKzmnLogwrcgZG9jdG9yICAgICAgICAgICAgICAgICAgPGk+IOivu+WPluS/oeaBryDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBDQxtbSw0K55uu5qCHOiBDMTDpmpTnprvmnKzmnLogICAgICAgICAgICAgICAgICAgICAgICAgICA8RW50ZXI+IOWPquivu+ivpuaDhSDDlyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX19fICBfX18gICAgIA0K6KeS6ImyOiDmnKzmnLrnlKjmiLcgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8cj4g5Yi35pawICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvIF9ffC8gX198ICAgIA0K5qC46aqMOiDmnKrorqTor4EgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDw/PiDlhajpg6jmjInplK4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB8IChfX3wgKF9fICAgICANCuW9k+WJjTogQzEw6ZqU56a75pys5py6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxfX198XF9fX3wgICAgDQrniYjmnKw6IEMxMCBuYXRpdmUgZGlhZ25vc3RpY3MgZml4dHVyZRtbSw0K4pSM4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAIOS9k+ajgCAoOmRvY3RvcikgWzBdIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUkA0K4pSCICDmo4Dmn6XpobkgICAgICAgICAgICAgICAgICAgIOWIhue7hCAgICAgICAgICAgICAgICDnu5PmnpwgICAgICAgICAgICDor7TmmI4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilILor7vlj5blt7Llj5bmtoggwrcg5b2T5YmN57uT5p6c5LiN5a6M5pW077yMcumHjeaWsOivu+WPliAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIOKUgg0K4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSCDQrilIIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilIINCuKUlOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUmA0KPGRvY3Rvcj4gMOmhuSDCtyDlt7Llj5bmtogbW0sNCuivu+WPluW3suWPlua2iO+8m+W9k+WJjeWGheWuueWPr+iDveS4jeWujOaVtOOAghtbSw0KOui1hOa6kCAgL+etm+mAiSAgRXNj6L+U5ZueICBx6YCA5Ye6G1tLG1s/MjVoG1s/MTA0OWw="}
{"at":1793718269458,"direction":"host","event":"output","data":"G1s/MjAwNGw="}
{"at":1793718269463,"direction":"host","event":"output","data":"G1s/MjVsG1tIG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLDQobW0sNChtbSw0KG1tLG1tIG1s/MjVo"}
{"at":1793718269679,"direction":"host","event":"output","data":"G1s/OTAwMWwbWz8xMDA0bA=="}
{"at":1793718269684,"direction":"host","event":"exit","code":0}
{"at":1793718269775,"direction":"driver","event":"host-exit","code":0}
```

</details>

<details><summary>一次性终端夹具源码：只替换发现/剪贴板，诊断调用正式实现</summary>

转录SHA-256: 09bbea8fc4bf9589130d6da6f221e9eac5ee15c23c4dadbba2e33ec76f1ef801

```text

import fs from 'node:fs/promises';
import path from 'node:path';
import {runTui} from "file:///D:/workspace/CC/multichat/dist/tui/main.js";
import {createLocalOverview} from "file:///D:/workspace/CC/multichat/dist/application/observations/overview.js";
import {createDoctorResource} from "file:///D:/workspace/CC/multichat/dist/tui/resources/overview.js";
import {createResourceRegistry,defaultResources} from "file:///D:/workspace/CC/multichat/dist/tui/resources/registry.js";
const home=process.env.C10_FIXTURE_HOME;
const events=process.env.C10_FIXTURE_EVENTS;
const before={raw:process.stdin.isRaw,sigint:process.listenerCount('SIGINT'),sigterm:process.listenerCount('SIGTERM')};
const overview=createLocalOverview({home,discovery:{execute:async()=>{throw new Error('No discovery is needed in this doctor-only fixture');}},env:{PATH:'',CROSSCHAT_CLAUDE_BIN:'unavailable-claude',CROSSCHAT_CODEX_BIN:'unavailable-codex'}});
const original=overview.readDoctor;
overview.readDoctor=async request=>{const result=await original(request);await fs.appendFile(events,JSON.stringify({event:'doctor',result})+'\n');return result;};
const doctor=createDoctorResource({overview});
const code=await runTui({home,contexts:[{id:'local',kind:'local',label:'C10隔离本机'}],
registry:createResourceRegistry(defaultResources.map(resource=>resource.id==='doctor'?doctor.resource:resource)),adapters:{doctor:doctor.adapter},clipboard:async()=>{throw new Error('No system clipboard in this fixture');},version:'C10 native diagnostics fixture'});
await fs.appendFile(events,JSON.stringify({event:'exit',code,before,after:{raw:process.stdin.isRaw,sigint:process.listenerCount('SIGINT'),sigterm:process.listenerCount('SIGTERM')}})+'\n');
process.exitCode=code;
```

</details>

<details><summary>首轮完整check：1失败/2670通过/11原有跳过</summary>

转录SHA-256: 90901575ca41d819440a1d8d0a4c7a5b363ec80b7efc25cbccf7ddf8aec2edca

```text

> @oatelauser/crosschat@1.10.0 check
> npm run lint && npm run check:imports && npm run build && npm test


> @oatelauser/crosschat@1.10.0 lint
> eslint src test


> @oatelauser/crosschat@1.10.0 check:imports
> node scripts/runtime-import-graph.mjs

Runtime import graph: 203 modules, 686 edges; no cycles or boundary violations.

> @oatelauser/crosschat@1.10.0 build
> tsc


> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/serve-star-lifecycle.test.ts (11 tests) 17023ms
   ✓ 033 热加星：不重启即托管即收发 > 在跑 serve + CLI --add-star 经管理插座：回执生效、自登记落位、聚合器播种、新星上 node/sender 完整收发  1558ms
   ✓ 033 删星：即时收尾 + 直报已删 + 最后一颗可删 > 热删 beta：在跑连接收"星已删除"断开、node.json 摘条、死钥直报、邻星零中断  2352ms
   ✓ 033 插座冷热路径与 stop 收口 > 回执超时绝不回落直写：插座连上但无回执 → 报错重试、台账零改动  10015ms
   ✓ 033 插座冷热路径与 stop 收口 > stop 收口：serve 停机后状态 stopped、插座随进程撤（CLI 退冷路径）  1528ms
   ✓ 036 按星机器名（--star --show-name）热闭环 > 按星只重挂该星：条目覆盖落 node.json、注册表该星 machineName 更新、邻星回落全局不变；--list 显示随条目；'' 清除回落全局  1532ms
 ❯ test/dsh-compat-ci.test.ts (105 tests | 1 failed) 18112ms
   ✓ DeepSeek Harness official npm artifact constraints > pins the scoped npm artifact, package manager and the supported prerelease window 5ms
   ✓ DeepSeek Harness official npm artifact constraints > rejects unrelated or mutable sources, malformed SRI and package-manager drift 1ms
   ✓ DeepSeek Harness official npm artifact constraints > verifies the exact downloaded archive bytes using canonical SHA-512 SRI 0ms
   ✓ DeepSeek Harness isolated npm download cache > uses a shared run-owned default and marks an explicit existing external cache for retention 13ms
   ✓ DeepSeek Harness isolated npm download cache > rejects relative paths, URLs, network paths, files and externally labelled owned paths 11ms
   ✓ DeepSeek Harness isolated npm download cache > rejects directory links and linked ancestors before using an external cache 10ms
   ✓ DeepSeek Harness controlled desktop process > validates execution inputs and honors pre-cancellation without spawning 2ms
   ✓ DeepSeek Harness controlled desktop process > returns stdout, stderr and exit facts only after close 2ms
   ✓ DeepSeek Harness controlled desktop process > runs a real controlled Node child and reports only its own close 246ms
   ✓ DeepSeek Harness controlled desktop process > preserves nonzero and signal exit facts 1ms
   ✓ DeepSeek Harness controlled desktop process > keeps cancellation and timeout primary even if close later reports zero 37ms
   ✓ DeepSeek Harness controlled desktop process > shares one byte budget across stdout and stderr and marks truncation 1ms
   ✓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause  1009ms
   ✓ DeepSeek Harness controlled desktop process > waits for close when kill throws and reports the stop request separately 1ms
   ✓ DeepSeek Harness controlled desktop process > counts the spawn attempt against the deadline and refuses an overdue success 161ms
   ✓ DeepSeek Harness controlled desktop process > keeps only bounded copies of the bytes inside the output budget 2ms
   ✓ DeepSeek Harness controlled desktop process > keeps falsy first causes and marks the failure explicitly 1ms
   ✓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause  1005ms
   ✓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot  1004ms
   ✓ DeepSeek Harness controlled desktop process > clears the fixture cleanup wait once the real child is known closed 44ms
   ✓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes  1005ms
   ✓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release  1121ms
   ✓ DeepSeek Harness guarded desktop uninstall > never calls uninstall without a complete natural exit observation for this Host 2ms
   ✓ DeepSeek Harness guarded desktop uninstall > binds every identity to the caller and returns process facts without claiming cleanup 2ms
   ✓ DeepSeek Harness guarded desktop uninstall > refuses pre-cancellation and a Host observation that consumes the total deadline 42ms
   ✓ DeepSeek Harness guarded desktop uninstall > preserves a runner failure and installation ownership even for falsy causes 1ms
   ✓ DeepSeek Harness guarded desktop uninstall > ignores a late Host observation after cancellation and releases its abort listener 1ms
   × DeepSeek Harness guarded desktop uninstall > bounds both runner waits and records when uninstall was already invoked 68ms
     → expected Error: Desktop uninstall was cancelled or… { …(5) } to match object { timedOut: true, …(2) }
(2 matching properties omitted from actual)
   ✓ DeepSeek Harness guarded desktop uninstall > rejects abnormal uninstall records and preserves executor causes without retrying 1ms
   ✓ DeepSeek Harness guarded desktop uninstall > validates caller identities before either operation and keeps the captured binding 1ms
   ✓ DeepSeek Harness guarded desktop uninstall > refuses an incomplete process observation before invoking uninstall 1ms
   ✓ DeepSeek Harness fresh process and cleanup evidence > runs only controlled child processes and reports normal and timed-out termination distinctly 221ms
   ✓ DeepSeek Harness fresh process and cleanup evidence > uses a unique empty report location and a caller-chosen UUID for every attempt 9ms
   ✓ DeepSeek Harness fresh process and cleanup evidence > rejects wrong run IDs, incomplete PASS evidence, timeout/signal and process/report disagreement 14ms
   ✓ DeepSeek Harness fresh process and cleanup evidence > requires all four exact cleanup booleans and refuses forced or unknown release 0ms
   ✓ DeepSeek Harness baseline and candidate lifecycle > removes each released install before the next and retries the same pinned candidate 1ms
   ✓ DeepSeek Harness baseline and candidate lifecycle > retains unknown runtime state and never advances or removes it 0ms
   ✓ DeepSeek Harness baseline and candidate lifecycle > keeps the web retainedInstallation shape unchanged when a probe fails 0ms
   ✓ DeepSeek Harness baseline and candidate lifecycle > does not turn installation, readiness, cleanup, baseline failure or flaky checks into issues 1ms
   ✓ DeepSeek Harness independent issue reporter > creates only one deduplicated issue after independently verifying genuine scoped regression evidence 10ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > accepts a fresh desktop report bound to this install, native instance, session and artifact 5ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > binds the report to the caller launch instead of the report claim 6ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > rejects web, stale, foreign and incomplete desktop evidence 41ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > ignores reports outside the exclusive attempt location and never reuses an earlier report 11ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > rejects a well formed report above the read budget and keeps release unknown 9ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > never binds two missing artifact identities 4ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > keeps release unknown when the session times out, is killed, truncates output or disagrees 11ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > requires the Host exit, official uninstall and both registration cleanups for desktop release 0ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > installs the candidate only after a released baseline bound to this run 1ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > refuses to reuse an installation identity across attempts 0ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > keeps the desktop summary out of the web reporter 0ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > retains the first desktop installation and stops when release is unverified 0ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > never closes blindly after a thrown desktop operation and keeps ownership when the close fails 0ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > keeps the owned root of a partially created installation that throws 3ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > keeps the web entry closed to desktop reports and the desktop entry closed to web reports 0ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > rejects array UUID identities and never lets equal arrays bypass instance dedup 0ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > retains the full ownership after a normal install when release is unknown 3ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > retains the full ownership with the real reason when the desktop probe throws 3ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > retains the full ownership when the official close fails 3ms
   ✓ DeepSeek Harness formal desktop report and lifecycle > keeps String(value) as the real reason when the probe throws a falsy value 13ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > projects the pinned research metadata and refuses masquerading or inexact desktop sources 2ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > streams the exact pinned bytes into the exclusive directory and proves only the transfer 14ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > rejects redirect, error and missing-body responses and size or digest disagreements without keeping partials 9ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation  438ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > rejects short and zero-progress disk writes instead of trusting the stream digest 5ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > voids delivery when cancellation or the total deadline lands during the close 161ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > wraps frozen and falsy close failures with the retained path and the original cause 6ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline  599ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps the cause and the retained path when a falsy read failure meets an unclear release 96ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > refuses delivery when cancellation or the total deadline lands during cleanup 132ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned  1108ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return  2028ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late partial removal failure with the path and keeps the file owned 260ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > removes a late-created file exactly once and never deletes a replacement 274ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > does not report a partial path after a successful late close and removal 256ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > closes a real late handle that arrives after the product returned even when its close was replaced 136ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late response whose cancel is still undecided when cleanup returns 267ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return  378ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps falsy and frozen stream failures as real failures and still cleans the owned partial 12ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > never overwrites an existing file and re-checks the projection before any network call 4ms
   ✓ DeepSeek Harness desktop installer admission > admits the exact verified file and matching publisher without writing an installation 6ms
   ✓ DeepSeek Harness desktop installer admission > rejects a missing or malformed publisher policy before any file read or child process 2ms
   ✓ DeepSeek Harness desktop installer admission > rejects inexact artifact identities and file size or digest disagreements 4ms
   ✓ DeepSeek Harness desktop installer admission > rejects links and non-regular files 4ms
   ✓ DeepSeek Harness desktop installer admission > rejects a file replaced between the read and the final state check 3ms
   ✓ DeepSeek Harness desktop installer admission > rejects a signature status, subject or thumbprint that disagrees with the policy 14ms
   ✓ DeepSeek Harness desktop installer admission > rejects pre-cancelled, timed-out and externally cancelled admissions without success 65ms
   ✓ DeepSeek Harness desktop installer admission > uses the bounded Windows Authenticode adapter with the path in an environment field 7ms
   ✓ DeepSeek Harness desktop installer admission > keeps the native signature reader independent of inherited PSModulePath without changing the caller environment 5ms
   ✓ DeepSeek Harness desktop installer admission > keeps the native signature reader independent of inherited psmodulepath without changing the caller environment 4ms
   ✓ DeepSeek Harness desktop installer admission > uses native Windows signature modules rather than executing an inherited shadow module  320ms
   ✓ DeepSeek Harness desktop installer admission > rejects default-adapter output, JSON and process failures 74ms
   ✓ DeepSeek Harness desktop installer admission > rejects same-fingerprint content rewritten while its signature is being read 5ms
   ✓ DeepSeek Harness desktop installer admission > bounds the post-signature content read and still closes the handle 37ms
   ✓ DeepSeek Harness desktop installer admission > rejects a path replaced while the post-signature content is being re-read 6ms
   ✓ DeepSeek Harness desktop installer admission > bounds a stalled open, owns the late handle and closes it once 53ms
   ✓ DeepSeek Harness desktop installer admission > bounds a stalled metadata read 34ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes  1009ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation  1063ms
   ✓ DeepSeek Harness desktop installer admission > starts the real file close only once when it rejects 5ms
   ✓ DeepSeek Harness desktop installer admission > preserves a frozen signature failure alongside the close failure 4ms
   ✓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early  1010ms
   ✓ DeepSeek Harness desktop installer admission > finishes a spawned child error once its close is observed 5ms
   ✓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error  1007ms
   ✓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline  1007ms
 ✓ test/conversation-state-concurrency.test.ts (11 tests) 9391ms
   ✓ conversation state cross-process writes > independent processes allocating at once never share a handle and each resolves to its own ref  354ms
   ✓ conversation state cross-process writes > a live writer on an aliased path blocks every other write path until it releases  2171ms
   ✓ conversation state cross-process writes > a send that cannot take the lock delivers nothing, then succeeds once released  1172ms
   ✓ conversation state cross-process writes > a stuck holder still exits within its barrier deadline  5129ms
 ✓ test/dsh-adapter.test.ts (57 tests) 12869ms
   ✓ Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations  498ms
   ✓ Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts  490ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED'  411ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH'  380ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION'  420ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL'  488ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR'  388ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE'  381ms
   ✓ Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes  347ms
   ✓ Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying  5408ms
   ✓ Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection  456ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200  1189ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401  1123ms
 ✓ test/session-star.test.ts (40 tests) 6383ms
   ✓ 018 批二：启动器入星链路 > spawn 会话→自动拉聚合器→attach→三段直达；退出即 detach  638ms
   ✓ 018 批二：启动器入星链路 > 多星：--connect 可重复，两会话成员表各自 attach（win 带杠 mid 形态）  695ms
   ✓ 018 批二：启动器入星链路 > 021 断连静默：聚合器被杀→重连提示落日志、控制台零输出、成员籍自动恢复  1590ms
   ✓ 统一恢复入口（启动器重声明或显式管理，册落盘不丢） > broker/node 重启册位不丢，已有成员与新会话统一由显式 adopt 恢复  301ms
   ✓ 018 批二：9b 降级告警（不只日志） > NodeClient.warn 直打一行；warnIfBrokerLacksSessionCaps 对老 broker 出声、新 broker 静默  316ms
   ✓ 028 双模式与命令面 > 双模式集成：永久退出留册、裸 resume 不归队、明确选择恢复；--rm 退出清册  850ms
 ✓ test/serve-admin-key.test.ts (7 tests) 6132ms
   ✓ 034 挑战应答全链与角色矩阵 > admin 握手（钥匙永不过线）→ 读/发/删全过 → 成员/星管逐格 → 重放拒绝 → 被吊钥 BAD_AUTH → 审计在场  2898ms
   ✓ 034 挑战应答全链与角色矩阵 > CLI 远程管理路由：--via tcp:<星> 成员读（星钥）+ 星管写（adminKey 挑战应答）  1528ms
   ✓ 034 set-port 无命令回归（旗标+插座 op 全删） > 管理插座 set-port op 已删（未知 op 拒绝、台账零改动）  1509ms
probe failed: root-not-exclusive:C:\Users\YANGSH~1\AppData\Local\Temp\c14w05-test-FhCdo7\previous-run
 ✓ test/endpoint-protocol.test.ts (5 tests) 5454ms
   ✓ endpoint identity capability guard > does not replay an uncertain lifecycle removal while readonly roster still reports the same temporary member  5412ms
usage: node scripts/codex-call-correlation-probe.mjs --root <owned temp dir> [--evidence <json>]
 ✓ test/codex-call-correlation-probe.test.ts (56 tests) 5256ms
   ✓ codex call correlation probe: bounded reads and processes > kills a timed-out child together with its descendant and waits for close  1819ms
   ✓ codex call correlation probe: bounded reads and processes > stops a cancelled child through the abort signal  429ms
   ✓ codex call correlation probe: run root and main chain > keeps the root when the run is cancelled  551ms
   ✓ codex call correlation probe: run root and main chain > keeps the run root when the launched process never closed  1468ms
 ✓ test/serve-sessions.test.ts (37 tests) 4752ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 028 claude 活性：扫描核验——死 claude 成员转下线（教学）、活成员续投  527ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > C14 Codex 活性：核实实际 CLI 端点后续投，原生不存在的同类成员转下线  527ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 029 临时成员异常死亡：对账验死报 member-remove 清册零痕迹（不留下线态）  731ms
   ✓ 028 册（roster）：落盘/跨机拒绝/extends 胜复活/member-remove > 028 下线成员随 roster 帧下发（offlineSessions 单列；sessions 保持活成员语义）  435ms
   ✓ 018 9b：老 broker（proto:1）降级的协议侧 > connect 携带 caps；info.caps 缺端点能力时拒绝类型化 attach，且不发 sessions 帧  310ms
 ✓ test/serve-multistar.test.ts (20 tests) 4482ms
   ✓ 032 多星握手与星域隔离 > 钥匙不属任何星 → BAD_AUTH（跨星错钥匙不放行）  518ms
   ✓ 032 bootstrap 与 CLI > 033 serve 永不造星：空表首启零星合法（不建星、不写 node.json），教学指 --add-star  1508ms
   ✓ 032 bootstrap 与 CLI > 内挂聚合器不写 status-node 文件（非独立进程）  1513ms
 ✓ test/doctor-json-cli.test.ts (3 tests) 4828ms
   ✓ doctor JSON CLI extension > diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it  2433ms
   ✓ doctor JSON CLI extension > returns the structured checks and preserves the existing default report and exit severity  1433ms
   ✓ doctor JSON CLI extension > emits valid structured findings with exit one for a failed check and rejects extra options  960ms
 ✓ test/broker-revocation.test.ts (12 tests) 3908ms
   ✓ broker credential revocation > local remove-node immediately revokes every node/sender using that credential and retains offline permanent members in its star  868ms
   ✓ broker credential revocation > remote remove-node has the same immediate effect while members and star admins retain their three-layer limits  612ms
   ✓ broker credential revocation > local remove-admin-key closes only authenticated sessions of the removed credential, including unique-prefix selection  1043ms
   ✓ broker credential revocation > marks a revoked session unusable before close completes without affecting another credential  310ms
   ✓ broker credential revocation > finishes target pending work and file routes on revocation before the close callback, ignoring late target results  323ms
 ✓ test/opencode-desktop-fixture.test.ts (13 tests) 2447ms
   ✓ official desktop test environment > reports an unregistered executable under the owned run before allowing cleanup  1832ms
 ✓ test/local-service-inspection.test.ts (6 tests) 3480ms
   ✓ owned service inspection and guard workers > reclaims an inspector blocked in spawnSync, including its owned probe child, before cancellation returns  505ms
   ✓ owned service inspection and guard workers > uses the real process wrapper for successful inspection/guard IPC and releases it before returning  902ms
   ✓ owned service inspection and guard workers > reclaims a real wrapper and its controlled blocked probe when its read timeout expires  1852ms
 ✓ test/local-service-owned-stop.test.ts (6 tests) 2775ms
   ✓ TUI owned service stop process trees > releases a hung OS scanner and its helper before completing cancellation without claiming the external stop was undone  352ms
   ✓ TUI owned service stop process trees > bounds a nonresponding stop job and reclaims its full scanner tree on timeout  1262ms
   ✓ TUI owned service stop process trees > runs the actual stop process wrapper and prior stop worker with the same fixed target, then releases the wrapper  374ms
   ✓ TUI owned service stop process trees > retains prior request validation inside the real wrapper before any stop business call  377ms
   ✓ TUI owned service stop process trees > uses the owned stop default from the managed task and waits for tree cleanup before returning an uncertain issued result  403ms
 ✓ test/maintenance-boundaries.test.ts (5 tests) 2755ms
   ✓ TUI maintenance source and copy boundaries > closes unreadable sources and bounds directory enumeration before accepting a skill plan  2639ms
 ✓ test/serve-node.test.ts (30 tests) 2402ms
   ✓ B0 starId handshake > 036 无 id 星（手编形状）：连接按 BAD_AUTH 拒——broker 机跑一次 serve 补 id  571ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker queue self-delivery: the receipt ref carries the registry starId  486ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker steer self-delivery: the receipt ref carries the registry starId  467ms
 ✓ test/core-code-standards.test.ts (2 tests) 2221ms
   ✓ progressive typed lint rules > rejects floating promises, async void callbacks and value imports used only as types  2201ms
 ✓ test/ssh-native-authentication.test.ts (3 tests) 2506ms
   ✓ SSH application native ASKPASS integration > reuses authentication across refreshes, retains strict host checking and forgets credentials when configuration changes  1509ms
   ✓ SSH application native ASKPASS integration > preserves full Windows ASKPASS fingerprints and offers no approval for a changed known host  515ms
   ✓ SSH application native ASKPASS integration > cancels a pending native authentication helper when the active connection closes  481ms
 ✓ test/tui-controller.test.ts (25 tests) 1995ms
 ✓ test/send-log.test.ts (10 tests) 1495ms
   ✓ appendSendLog > rotates past 5MiB instead of truncating: the bulk moves whole to .old, the new entry starts a fresh file  1360ms
 ✓ test/caller-source-confirmations.test.ts (21 tests) 1538ms
   ✓ source classification shared across native sessions > reports bounded busy without mutating state when an unrelated listener occupies its mutex port  1056ms
 ✓ test/revocation-pause.test.ts (13 tests) 1614ms
   ✓ explicit credential revocation pauses this star > stops one launcher supervisor without restarting it or disrupting another star  1179ms
 ✓ test/session-membership.test.ts (16 tests) 1668ms
   ✓ session membership application boundary > adopts an anonymous full native ref through the shared aggregator and verifies broker roster authority  534ms
   ✓ session membership application boundary > adopts and removes a typed Codex member without overwriting the same native ID on another endpoint  534ms
 ✓ test/core-diagnostics.test.ts (15 tests) 1357ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  463ms
 ✓ test/ssh-askpass-bridge.test.ts (3 tests) 1429ms
   ✓ owned native SSH ASKPASS bridge > uses a real local helper to pass one bounded prompt without storing the password in files, argv or environment  402ms
   ✓ owned native SSH ASKPASS bridge > closes a pending helper and cancels its challenge when the owned bridge is disposed  553ms
   ✓ owned native SSH ASKPASS bridge > rejects an oversized or cancelled answer without writing any secret material to stderr  473ms
 ✓ test/tui-cli.test.ts (11 tests) 1457ms
 ✓ test/ssh-target-lifecycle.test.ts (4 tests) 1285ms
   ✓ SSH target identity and process completion > bounds a child that never closes, reports incomplete cleanup, and removes its owned listeners  1067ms
 ✓ test/runtime-import-graph.test.ts (9 tests) 1329ms
   ✓ core source architecture > has no runtime dependency cycle or broken local import  506ms
   ✓ core source architecture > keeps node configuration and connection selection independent of commands and clients  375ms
   ✓ core source architecture > keeps every application adapter independent of command and UI entry points  385ms
 ✓ test/tui-workspaces.test.ts (10 tests) 1140ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (updated)  342ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (failed)  348ms
 ✓ test/tui-composition.test.ts (15 tests) 1143ms
 ✓ test/tui-main-observations.test.ts (3 tests) 777ms
   ✓ default local observation wiring > preserves native environment paths when the caller has not requested an isolated home  316ms
   ✓ default local observation wiring > installs the five real readonly resources lazily and preserves exact related routes  351ms
 ✓ test/via-tcp.test.ts (36 tests) 1167ms
   ✓ runViaTcpSend against a real broker > times out with TCP_TRANSPORT_FAILED and the 勿盲目重发 wording  416ms
 ✓ test/maintenance.test.ts (21 tests) 1022ms
   ✓ owned maintenance worker lifecycle > runs actual plans and filesystem effects through the default built worker using only isolated fixture paths  612ms
 ✓ test/tui-send-command.test.ts (5 tests) 1016ms
   ✓ TUI send command templates > round-trips opaque arguments through the current platform shell  1012ms
 ✓ test/ssh-application.test.ts (15 tests) 985ms
 ✓ test/tui-filters.test.ts (9 tests) 903ms
 ✓ test/remote-discovery-cli.test.ts (2 tests) 807ms
   ✓ built discover CLI endpoint > rejects invalid JSON and oversized input before provider execution  609ms
 ✓ test/status-remote.test.ts (16 tests) 862ms
   ✓ CLI：runViaTcpStatus 传输腿 > 版本偏差：旧 broker 对 status-query 无行为 → 超时教学  411ms
 ✓ test/observation-overview.test.ts (18 tests) 772ms
   ✓ safe isolated diagnostics for observation pages > retains native data environment overrides in inherit mode while binding crosschat sources to the requested HOME  325ms
 ✓ test/outbox.test.ts (24 tests) 785ms
   ✓ park > refuses honestly at the per-thread cap and leaves the file untouched  521ms
 ✓ test/tui-observation-navigation.test.ts (4 tests) 747ms
   ✓ observation resource routes > keeps related route caches separate, canonicalizes query order, clears associations on direct commands and restores the source  338ms
 ✓ test/serve-broker.test.ts (33 tests) 778ms
 ✓ test/dsh-cli.test.ts (4 tests) 614ms
   ✓ DeepSeek Harness CLI composition > connects real send dependencies to Harness delivery with an explicit mode  600ms
 ✓ test/codex-session-events.test.ts (2 tests) 558ms
   ✓ Codex per-window native protocol selection > only successful native selection and first accepted input affect this window, never global notifications or failed resume  345ms
 ✓ test/tui-form.test.ts (5 tests) 504ms
 ✓ test/send-command.test.ts (57 tests) 305ms
 ✓ test/claude-session-events.test.ts (2 tests) 535ms
   ✓ Claude window session event binding > keeps blank startup unregistered, resumes exact IDs, ignores end/compact and never persists prompt content  302ms
 ✓ test/dsh-bridge.test.ts (32 tests) 562ms
 ✓ test/tcp-peer-naming-transport.test.ts (8 tests) 503ms
 ✓ test/c14-conversation-refinement.test.ts (24 tests) 517ms
 ✓ test/remote-discovery-tcp.test.ts (6 tests) 496ms
 ✓ test/tui-sensitive-result.test.ts (2 tests) 422ms
 ✓ test/cli-args.test.ts (18 tests) 459ms
 ✓ test/revocation-auth-race.test.ts (2 tests) 381ms
   ✓ revocation during current process lifecycles > a corrupt self-aggregator pause does not become an unhandled rejection in the broker  334ms
 ✓ test/tui-main-sessions.test.ts (3 tests) 457ms
 ✓ test/install-skills.test.ts (12 tests) 339ms
 ✓ test/local-service-worker-boundary.test.ts (8 tests) 397ms
 ✓ test/smoke.test.ts (2 tests) 418ms
 ✓ test/pipe-transport.test.ts (6 tests | 3 skipped) 391ms
   ✓ WindowsNamedPipeTransport > reports PIPE_WRITE_UNCERTAIN when the server cuts the connection mid-write  322ms
 ✓ test/tui-follow.test.ts (6 tests) 381ms
 ✓ test/claude-compat-ci.test.ts (15 tests) 348ms
 ✓ test/serve-b21.test.ts (29 tests) 317ms
 ✓ test/conversations.test.ts (26 tests) 318ms
 ✓ test/broker-discovery.test.ts (17 tests) 318ms
 ✓ test/tcp-session-operations.test.ts (7 tests) 335ms
 ✓ test/tui-context-source.test.ts (7 tests) 327ms
 ✓ test/opencode-adapter.test.ts (26 tests) 313ms
 ✓ test/tui-layout-paging.test.tsx (3 tests) 320ms
 ✓ test/caller-source-providers.test.ts (14 tests) 261ms
 ✓ test/serve-f0.test.ts (19 tests) 309ms
 ✓ test/remote-discovery-node.test.ts (8 tests) 280ms
 ✓ test/serve-cli.test.ts (32 tests) 218ms
 ✓ test/tcp-exact-transport.test.ts (3 tests) 246ms
 ✓ test/session-membership-exact.test.ts (9 tests) 162ms
 ✓ test/claude-compat-fixture.test.ts (19 tests) 259ms
 ✓ test/core-sessions-readers.test.ts (13 tests) 279ms
 ✓ test/caller-source-state-lock.test.ts (2 tests) 251ms
 ✓ test/core-services-background.test.ts (5 tests) 222ms
 ✓ test/tui-clipboard.test.ts (5 tests) 244ms
 ✓ test/serve-tool-type-bridge.test.ts (6 tests) 190ms
 ✓ test/conversation-handle-ring.test.ts (9 tests) 194ms
 ✓ test/tool-type-routing-state.test.ts (32 tests) 202ms
 ✓ test/tui-workspace-layout.test.tsx (8 tests) 136ms
 ✓ test/tcp-configuration-management.test.ts (7 tests) 205ms
 ✓ test/codex-aggregate-discovery.test.ts (11 tests) 184ms
 ✓ test/dsh-node-members.test.ts (1 test) 203ms
 ✓ test/c14-explicit-send.test.ts (29 tests) 196ms
 ✓ test/tui-view.test.tsx (13 tests) 183ms
 ✓ test/core-queries.test.ts (17 tests) 153ms
 ✓ test/tcp-application.test.ts (13 tests) 180ms
 ✓ test/file-channel.test.ts (10 tests) 180ms
 ✓ test/send-handle.test.ts (10 tests) 157ms
 ✓ test/watchdog.test.ts (10 tests) 159ms
(node:6508) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/desktop-metadata.test.ts (5 tests) 127ms
 ✓ test/discovery-service.test.ts (10 tests) 146ms
 ✓ test/tcp-transport.test.ts (7 tests) 154ms
 ✓ test/claude-compat-lifecycle.test.ts (4 tests) 134ms
 ✓ test/tui-session-view.test.tsx (8 tests) 181ms
 ✓ test/tcp-configuration.test.ts (8 tests) 111ms
 ✓ test/tui-mutation-navigation.test.ts (1 test) 141ms
 ✓ test/tui-main-preferences.test.ts (2 tests) 132ms
 ✓ test/via-send.test.ts (42 tests) 110ms
 ✓ test/observation-logs.test.ts (11 tests) 104ms
 ✓ test/codex-deliver.test.ts (26 tests) 126ms
 ✓ test/tui-terminal.test.ts (8 tests) 114ms
 ✓ test/dsh-live-fixture.test.ts (18 tests) 97ms
 ✓ test/outbox-ownership.test.ts (15 tests) 124ms
 ✓ test/local-services.test.ts (11 tests) 132ms
 ✓ test/tui-contexts.test.ts (13 tests) 126ms
 ✓ test/caller-source-service.test.ts (11 tests) 113ms
 ✓ test/status-conversations.test.ts (20 tests) 97ms
 ✓ test/tcp-machine-transaction.test.ts (9 tests) 103ms
 ✓ test/ssh-managed-profiles.test.ts (5 tests) 106ms
 ✓ test/status-doctor-tcp.test.ts (27 tests) 105ms
 ✓ test/tool-type-observations.test.ts (7 tests) 94ms
 ✓ test/dsh-runtime-driver.test.ts (3 tests) 93ms
 ✓ test/observation-communications.test.ts (11 tests) 95ms
 ✓ test/tui-input.test.tsx (21 tests) 86ms
 ✓ test/opencode-compat-fixture.test.ts (7 tests) 87ms
 ✓ test/tcp-snapshot-transport.test.ts (2 tests) 86ms
 ✓ test/desktop-ipc.test.ts (21 tests) 94ms
 ✓ test/dsh-send.test.ts (16 tests) 82ms
 ✓ test/dsh-mock-model.test.ts (5 tests) 82ms
 ✓ test/tcp-management-exact.test.ts (8 tests) 83ms
 ✓ test/state-paths.test.ts (9 tests) 76ms
 ✓ test/conversation-summary.test.ts (15 tests) 70ms
 ✓ test/tui-sessions.test.ts (22 tests) 81ms
 ✓ test/core-cleanup.test.ts (5 tests) 62ms
 ✓ test/session-operations.test.ts (4 tests) 64ms
 ✓ test/opencode-desktop-ci.test.ts (13 tests) 63ms
 ✓ test/codex-target-diagnostics.test.ts (13 tests) 69ms
 ✓ test/codex-routing.test.ts (15 tests) 65ms
 ✓ test/claude-wrapper.test.ts (16 tests | 2 skipped) 73ms
 ✓ test/tui-context-actions.test.ts (3 tests) 65ms
 ✓ test/uninstall.test.ts (10 tests) 68ms
 ✓ test/tui-registry.test.ts (5 tests) 62ms
 ✓ test/session-selection.test.ts (3 tests) 68ms
 ✓ test/tcp-cold-management.test.ts (5 tests) 58ms
 ✓ test/opencode-desktop-probe.test.ts (9 tests) 59ms
 ✓ test/core-management.test.ts (12 tests) 61ms
 ✓ test/serve-registry.test.ts (10 tests) 60ms
 ✓ test/opencode-members.test.ts (7 tests) 67ms
 ✓ test/rollout-meta.test.ts (13 tests) 49ms
 ✓ test/identity-command.test.ts (7 tests) 55ms
 ✓ test/codex-rpc.test.ts (11 tests) 59ms
 ✓ test/delivery-mode.test.ts (15 tests) 45ms
 ✓ test/tcp-local-management.test.ts (6 tests) 49ms
 ✓ test/clean.test.ts (10 tests) 46ms
 ✓ test/status-summary.test.ts (14 tests) 57ms
 ✓ test/status-filters.test.ts (20 tests) 44ms
 ✓ test/native-rename-providers.test.ts (6 tests) 40ms
 ✓ test/tui-tcp.test.ts (24 tests) 50ms
 ✓ test/dsh-members.test.ts (13 tests) 45ms
 ✓ test/discovery-ssh.test.ts (7 tests) 36ms
 ✓ test/serve-management-errors.test.ts (6 tests) 22ms
 ✓ test/c14-native-send-seams.test.ts (17 tests) 37ms
 ✓ test/tui-table.test.ts (23 tests) 38ms
 ✓ test/tcp-management-boundaries.test.ts (4 tests) 37ms
 ✓ test/tcp-management.test.ts (15 tests) 26ms
 ✓ test/opencode-send.test.ts (9 tests) 24ms
 ✓ test/core-services.test.ts (5 tests) 24ms
 ✓ test/node-config.test.ts (9 tests) 25ms
 ✓ test/rate-limit.test.ts (6 tests) 25ms
 ✓ test/tui-text.test.ts (52 tests) 26ms
 ✓ test/core-send.test.ts (4 tests) 19ms
 ✓ test/tui-tcp-targets.test.ts (2 tests) 16ms
 ✓ test/doctor.test.ts (20 tests) 24ms
 ✓ test/c14-tool-addressing.test.ts (8 tests) 18ms
 ✓ test/core-send-diagnostics.test.ts (6 tests) 19ms
 ✓ test/session-star-logging.test.ts (2 tests) 17ms
 ✓ test/opencode-tui.test.ts (9 tests) 19ms
 ✓ test/tui-star-audit.test.ts (2 tests) 19ms
 ✓ test/tui-ssh.test.ts (7 tests) 19ms
 ✓ test/tcp-empty-node-config.test.ts (3 tests) 16ms
 ✓ test/tcp-node-naming-lifecycle.test.ts (6 tests) 16ms
 ✓ test/session-membership-machine.test.ts (4 tests) 16ms
 ✓ test/native-endpoint-types.test.ts (10 tests) 14ms
 ✓ test/codex-pagination.test.ts (5 tests) 14ms
 ✓ test/tcp-machine-workspace.test.ts (8 tests) 17ms
 ✓ test/tui-logs.test.ts (5 tests) 14ms
 ✓ test/ref.test.ts (25 tests) 11ms
 ✓ test/tui-connections.test.ts (7 tests) 11ms
 ✓ test/tui-communications.test.ts (13 tests) 11ms
 ✓ test/tui-overview.test.ts (4 tests) 12ms
 ✓ test/session-membership-ipv6.test.ts (2 tests) 12ms
 ✓ test/tui-maintenance.test.ts (6 tests) 10ms
 ✓ test/dsh-identity.test.ts (19 tests) 12ms
 ✓ test/tui-page-presentation.test.ts (3 tests) 12ms
 ✓ test/star-snapshot.test.ts (1 test) 11ms
 ✓ test/opencode-identity.test.ts (18 tests) 9ms
 ✓ test/tui-ssh-management.test.ts (3 tests) 9ms
 ✓ test/core-sessions.test.ts (8 tests) 10ms
 ✓ test/dsh-composition.test.ts (5 tests) 11ms
 ✓ test/tool-type-discovery-state.test.ts (6 tests) 9ms
 ✓ test/core-local-discovery.test.ts (3 tests) 8ms
 ✓ test/dsh-status.test.ts (7 tests) 7ms
 ✓ test/opencode-composition.test.ts (4 tests) 10ms
 ✓ test/codex-proxy-env.test.ts (2 tests) 9ms
 ✓ test/c14-discovery-tui.test.ts (3 tests) 8ms
 ✓ test/core-members.test.ts (8 tests) 8ms
 ✓ test/resolve.test.ts (24 tests) 7ms
 ✓ test/registry.test.ts (6 tests) 8ms
 ✓ test/key-file.test.ts (6 tests) 7ms
 ✓ test/ssh-interaction.test.ts (6 tests) 7ms
 ✓ test/tui-services.test.ts (4 tests) 10ms
 ✓ test/codex-caller-source-probe.test.ts (14 tests) 8ms
 ✓ test/dsh-reader.test.ts (11 tests) 9ms
 ✓ test/deliver.test.ts (5 tests) 7ms
 ✓ test/discovery-command.test.ts (2 tests) 6ms
 ✓ test/dsh-tui.test.ts (3 tests) 7ms
 ✓ test/envelope.test.ts (20 tests) 6ms
 ✓ test/compat-reply.test.ts (19 tests) 7ms
 ✓ test/opencode-status.test.ts (6 tests) 6ms
 ✓ test/local-service-stop-target.test.ts (3 tests) 4ms
 ✓ test/tcp-management-state.test.ts (3 tests) 5ms
 ✓ test/codex-launcher-owner.test.ts (2 tests) 5ms
 ✓ test/opencode-desktop-process-race.test.ts (3 tests) 4ms
 ✓ test/frame.test.ts (5 tests) 4ms
 ✓ test/opencode-wrapper.test.ts (3 tests) 5ms
 ✓ test/codex-wrapper.test.ts (6 tests) 4ms
 ✓ test/claude-compat-evidence.test.ts (5 tests) 3ms
 ✓ test/serve-protocol.test.ts (3 tests) 3ms
 ✓ test/limits.test.ts (11 tests) 4ms
 ✓ test/local-service-readiness.test.ts (1 test) 4ms
 ✓ test/credential-revoked-protocol.test.ts (6 tests) 4ms
 ✓ test/remote-discovery-protocol.test.ts (10 tests) 3ms
 ✓ test/tui-status.test.ts (4 tests) 3ms
 ✓ test/c14-envelope-tool.test.ts (3 tests) 3ms
 ✓ test/opencode-ref-boundary.test.ts (2 tests) 3ms
 ✓ test/tui-ssh-authentication-prompt.test.ts (1 test) 3ms
 ↓ test/live/claude-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/codex-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/status-live.test.ts (2 tests | 2 skipped)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/dsh-compat-ci.test.ts > DeepSeek Harness guarded desktop uninstall > bounds both runner waits and records when uninstall was already invoked
AssertionError: expected Error: Desktop uninstall was cancelled or… { …(5) } to match object { timedOut: true, …(2) }
(2 matching properties omitted from actual)

- Expected
+ Received

- {
+ Error {
    "installation": {
      "installationId": "947ca838-4f2c-4646-a3d3-5374c38c49d6",
      "owner": "c04-c2",
      "root": "D:\\workspace\\CC\\multichat\\owned-fixture",
    },
-   "timedOut": true,
+   "timedOut": false,
    "uninstallStarted": true,
  }

 ❯ test/dsh-compat-ci.test.ts:438:9
    436|       const uninstall = vi.fn(async () => { if (phase === 'uninstall')…
    437|       try {
    438|         await expect(runDshDesktopUninstall({ ...input, timeoutMs: 25 …
       |         ^
    439|           observeHostExit: async () => { if (phase === 'observe') awai…
    440|         })).rejects.toMatchObject({ timedOut: true, uninstallStarted: …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 230 passed | 3 skipped (234)
      Tests  1 failed | 2670 passed | 11 skipped (2682)
   Start at  23:05:29
   Duration  121.33s (transform 3.25s, setup 0ms, collect 22.98s, tests 167.49s, environment 38ms, prepare 19.01s)
```

</details>

<details><summary>夹具命令失败：Vitest不接受repeat参数，未运行测试</summary>

转录SHA-256: e7b1877b2eadfe37dacc662aad0b978b9c766e3a1ea2932fbc074e48dfb54cc9

```text

> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test --run test/dsh-compat-ci.test.ts -t bounds both runner waits --repeat 10

file:///D:/workspace/CC/multichat/node_modules/vitest/dist/chunks/cac.BfaZ95xE.js:404
          throw new CACError(`Unknown option \`${name.length > 1 ? `--${name}` : `-${name}`}\``);
                ^

CACError: Unknown option `--repeat`
    at Command.checkUnknownOptions (file:///D:/workspace/CC/multichat/node_modules/vitest/dist/chunks/cac.BfaZ95xE.js:404:17)
    at CAC.runMatchedCommand (file:///D:/workspace/CC/multichat/node_modules/vitest/dist/chunks/cac.BfaZ95xE.js:604:13)
    at CAC.parse (file:///D:/workspace/CC/multichat/node_modules/vitest/dist/chunks/cac.BfaZ95xE.js:545:12)
    at file:///D:/workspace/CC/multichat/node_modules/vitest/dist/cli.js:27:13
    at ModuleJob.run (node:internal/modules/esm/module_job:377:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:691:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v25.0.0
```

</details>

<details><summary>200次实际计时循环：2次错误分类</summary>

转录SHA-256: ca5925ae97c82bae93ccf8c8e80ef9aa281fa0dbe950928e4bb35403e49726cf

```text
{
  "runs": 200,
  "failures": [
    {
      "iteration": 60,
      "phase": "observe",
      "timedOut": false,
      "cancelled": false,
      "stage": "desktop-host-exit",
      "uninstallStarted": false,
      "invoked": 0,
      "cause": "Desktop uninstall total deadline expired"
    },
    {
      "iteration": 70,
      "phase": "uninstall",
      "timedOut": false,
      "cancelled": false,
      "stage": "desktop-uninstall",
      "uninstallStarted": true,
      "invoked": 1,
      "cause": "Desktop uninstall total deadline expired"
    }
  ]
}
```

</details>

<details><summary>受控时钟RED：2失败，105为名称过滤未运行</summary>

转录SHA-256: a75865907eae58c51d91220d56cec8d4a2e933bff36771c9a9305dd6b693bc88

```text

> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test --run test/dsh-compat-ci.test.ts -t classifies its own fired deadline


 RUN  v3.2.7 D:/workspace/CC/multichat

 ❯ test/dsh-compat-ci.test.ts (107 tests | 2 failed | 105 skipped) 69ms
   ↓ DeepSeek Harness official npm artifact constraints > pins the scoped npm artifact, package manager and the supported prerelease window
   ↓ DeepSeek Harness official npm artifact constraints > rejects unrelated or mutable sources, malformed SRI and package-manager drift
   ↓ DeepSeek Harness official npm artifact constraints > verifies the exact downloaded archive bytes using canonical SHA-512 SRI
   ↓ DeepSeek Harness isolated npm download cache > uses a shared run-owned default and marks an explicit existing external cache for retention
   ↓ DeepSeek Harness isolated npm download cache > rejects relative paths, URLs, network paths, files and externally labelled owned paths
   ↓ DeepSeek Harness isolated npm download cache > rejects directory links and linked ancestors before using an external cache
   ↓ DeepSeek Harness controlled desktop process > validates execution inputs and honors pre-cancellation without spawning
   ↓ DeepSeek Harness controlled desktop process > returns stdout, stderr and exit facts only after close
   ↓ DeepSeek Harness controlled desktop process > runs a real controlled Node child and reports only its own close
   ↓ DeepSeek Harness controlled desktop process > preserves nonzero and signal exit facts
   ↓ DeepSeek Harness controlled desktop process > keeps cancellation and timeout primary even if close later reports zero
   ↓ DeepSeek Harness controlled desktop process > shares one byte budget across stdout and stderr and marks truncation
   ↓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause
   ↓ DeepSeek Harness controlled desktop process > waits for close when kill throws and reports the stop request separately
   ↓ DeepSeek Harness controlled desktop process > counts the spawn attempt against the deadline and refuses an overdue success
   ↓ DeepSeek Harness controlled desktop process > keeps only bounded copies of the bytes inside the output budget
   ↓ DeepSeek Harness controlled desktop process > keeps falsy first causes and marks the failure explicitly
   ↓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause
   ↓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot
   ↓ DeepSeek Harness controlled desktop process > clears the fixture cleanup wait once the real child is known closed
   ↓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes
   ↓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release
   ↓ DeepSeek Harness guarded desktop uninstall > never calls uninstall without a complete natural exit observation for this Host
   ↓ DeepSeek Harness guarded desktop uninstall > binds every identity to the caller and returns process facts without claiming cleanup
   ↓ DeepSeek Harness guarded desktop uninstall > refuses pre-cancellation and a Host observation that consumes the total deadline
   ↓ DeepSeek Harness guarded desktop uninstall > preserves a runner failure and installation ownership even for falsy causes
   ↓ DeepSeek Harness guarded desktop uninstall > ignores a late Host observation after cancellation and releases its abort listener
   ↓ DeepSeek Harness guarded desktop uninstall > bounds both runner waits and records when uninstall was already invoked
   × DeepSeek Harness guarded desktop uninstall > classifies its own fired deadline even when the wall clock has not reached it (observe) 41ms
     → expected Error: Desktop uninstall was cancelled or… { …(5) } to match object { timedOut: true, …(3) }
(1 matching property omitted from actual)
   × DeepSeek Harness guarded desktop uninstall > classifies its own fired deadline even when the wall clock has not reached it (uninstall) 26ms
     → expected Error: Desktop uninstall was cancelled or… { …(5) } to match object { timedOut: true, …(3) }
(1 matching property omitted from actual)
   ↓ DeepSeek Harness guarded desktop uninstall > rejects abnormal uninstall records and preserves executor causes without retrying
   ↓ DeepSeek Harness guarded desktop uninstall > validates caller identities before either operation and keeps the captured binding
   ↓ DeepSeek Harness guarded desktop uninstall > refuses an incomplete process observation before invoking uninstall
   ↓ DeepSeek Harness fresh process and cleanup evidence > runs only controlled child processes and reports normal and timed-out termination distinctly
   ↓ DeepSeek Harness fresh process and cleanup evidence > uses a unique empty report location and a caller-chosen UUID for every attempt
   ↓ DeepSeek Harness fresh process and cleanup evidence > rejects wrong run IDs, incomplete PASS evidence, timeout/signal and process/report disagreement
   ↓ DeepSeek Harness fresh process and cleanup evidence > requires all four exact cleanup booleans and refuses forced or unknown release
   ↓ DeepSeek Harness baseline and candidate lifecycle > removes each released install before the next and retries the same pinned candidate
   ↓ DeepSeek Harness baseline and candidate lifecycle > retains unknown runtime state and never advances or removes it
   ↓ DeepSeek Harness baseline and candidate lifecycle > keeps the web retainedInstallation shape unchanged when a probe fails
   ↓ DeepSeek Harness baseline and candidate lifecycle > does not turn installation, readiness, cleanup, baseline failure or flaky checks into issues
   ↓ DeepSeek Harness independent issue reporter > creates only one deduplicated issue after independently verifying genuine scoped regression evidence
   ↓ DeepSeek Harness formal desktop report and lifecycle > accepts a fresh desktop report bound to this install, native instance, session and artifact
   ↓ DeepSeek Harness formal desktop report and lifecycle > binds the report to the caller launch instead of the report claim
   ↓ DeepSeek Harness formal desktop report and lifecycle > rejects web, stale, foreign and incomplete desktop evidence
   ↓ DeepSeek Harness formal desktop report and lifecycle > ignores reports outside the exclusive attempt location and never reuses an earlier report
   ↓ DeepSeek Harness formal desktop report and lifecycle > rejects a well formed report above the read budget and keeps release unknown
   ↓ DeepSeek Harness formal desktop report and lifecycle > never binds two missing artifact identities
   ↓ DeepSeek Harness formal desktop report and lifecycle > keeps release unknown when the session times out, is killed, truncates output or disagrees
   ↓ DeepSeek Harness formal desktop report and lifecycle > requires the Host exit, official uninstall and both registration cleanups for desktop release
   ↓ DeepSeek Harness formal desktop report and lifecycle > installs the candidate only after a released baseline bound to this run
   ↓ DeepSeek Harness formal desktop report and lifecycle > refuses to reuse an installation identity across attempts
   ↓ DeepSeek Harness formal desktop report and lifecycle > keeps the desktop summary out of the web reporter
   ↓ DeepSeek Harness formal desktop report and lifecycle > retains the first desktop installation and stops when release is unverified
   ↓ DeepSeek Harness formal desktop report and lifecycle > never closes blindly after a thrown desktop operation and keeps ownership when the close fails
   ↓ DeepSeek Harness formal desktop report and lifecycle > keeps the owned root of a partially created installation that throws
   ↓ DeepSeek Harness formal desktop report and lifecycle > keeps the web entry closed to desktop reports and the desktop entry closed to web reports
   ↓ DeepSeek Harness formal desktop report and lifecycle > rejects array UUID identities and never lets equal arrays bypass instance dedup
   ↓ DeepSeek Harness formal desktop report and lifecycle > retains the full ownership after a normal install when release is unknown
   ↓ DeepSeek Harness formal desktop report and lifecycle > retains the full ownership with the real reason when the desktop probe throws
   ↓ DeepSeek Harness formal desktop report and lifecycle > retains the full ownership when the official close fails
   ↓ DeepSeek Harness formal desktop report and lifecycle > keeps String(value) as the real reason when the probe throws a falsy value
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > projects the pinned research metadata and refuses masquerading or inexact desktop sources
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > streams the exact pinned bytes into the exclusive directory and proves only the transfer
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > rejects redirect, error and missing-body responses and size or digest disagreements without keeping partials
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > rejects short and zero-progress disk writes instead of trusting the stream digest
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > voids delivery when cancellation or the total deadline lands during the close
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > wraps frozen and falsy close failures with the retained path and the original cause
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps the cause and the retained path when a falsy read failure meets an unclear release
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > refuses delivery when cancellation or the total deadline lands during cleanup
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late partial removal failure with the path and keeps the file owned
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > removes a late-created file exactly once and never deletes a replacement
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > does not report a partial path after a successful late close and removal
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > closes a real late handle that arrives after the product returned even when its close was replaced
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late response whose cancel is still undecided when cleanup returns
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps falsy and frozen stream failures as real failures and still cleans the owned partial
   ↓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > never overwrites an existing file and re-checks the projection before any network call
   ↓ DeepSeek Harness desktop installer admission > admits the exact verified file and matching publisher without writing an installation
   ↓ DeepSeek Harness desktop installer admission > rejects a missing or malformed publisher policy before any file read or child process
   ↓ DeepSeek Harness desktop installer admission > rejects inexact artifact identities and file size or digest disagreements
   ↓ DeepSeek Harness desktop installer admission > rejects links and non-regular files
   ↓ DeepSeek Harness desktop installer admission > rejects a file replaced between the read and the final state check
   ↓ DeepSeek Harness desktop installer admission > rejects a signature status, subject or thumbprint that disagrees with the policy
   ↓ DeepSeek Harness desktop installer admission > rejects pre-cancelled, timed-out and externally cancelled admissions without success
   ↓ DeepSeek Harness desktop installer admission > uses the bounded Windows Authenticode adapter with the path in an environment field
   ↓ DeepSeek Harness desktop installer admission > keeps the native signature reader independent of inherited PSModulePath without changing the caller environment
   ↓ DeepSeek Harness desktop installer admission > keeps the native signature reader independent of inherited psmodulepath without changing the caller environment
   ↓ DeepSeek Harness desktop installer admission > uses native Windows signature modules rather than executing an inherited shadow module
   ↓ DeepSeek Harness desktop installer admission > rejects default-adapter output, JSON and process failures
   ↓ DeepSeek Harness desktop installer admission > rejects same-fingerprint content rewritten while its signature is being read
   ↓ DeepSeek Harness desktop installer admission > bounds the post-signature content read and still closes the handle
   ↓ DeepSeek Harness desktop installer admission > rejects a path replaced while the post-signature content is being re-read
   ↓ DeepSeek Harness desktop installer admission > bounds a stalled open, owns the late handle and closes it once
   ↓ DeepSeek Harness desktop installer admission > bounds a stalled metadata read
   ↓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes
   ↓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation
   ↓ DeepSeek Harness desktop installer admission > starts the real file close only once when it rejects
   ↓ DeepSeek Harness desktop installer admission > preserves a frozen signature failure alongside the close failure
   ↓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early
   ↓ DeepSeek Harness desktop installer admission > finishes a spawned child error once its close is observed
   ↓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error
   ↓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/dsh-compat-ci.test.ts > DeepSeek Harness guarded desktop uninstall > classifies its own fired deadline even when the wall clock has not reached it (observe)
 FAIL  test/dsh-compat-ci.test.ts > DeepSeek Harness guarded desktop uninstall > classifies its own fired deadline even when the wall clock has not reached it (uninstall)
AssertionError: expected Error: Desktop uninstall was cancelled or… { …(5) } to match object { timedOut: true, …(3) }
(1 matching property omitted from actual)

- Expected
+ Received

- {
+ Error {
    "cancelled": false,
    "installation": {
      "installationId": "c421dc4c-c630-4bd7-9ff7-2021801a3835",
      "owner": "c04-c2",
      "root": "D:\\workspace\\CC\\multichat\\owned-fixture",
    },
-   "timedOut": true,
+   "timedOut": false,
    "uninstallStarted": false,
  }

 ❯ test/dsh-compat-ci.test.ts:458:29
    456|       }).then(() => undefined, (error: unknown) => error);
    457|       await vi.advanceTimersByTimeAsync(25);
    458|       expect(await settled).toMatchObject({ timedOut: true, cancelled:…
       |                             ^
    459|         uninstallStarted: phase === 'uninstall', installation: input.i…
    460|       expect(uninstall).toHaveBeenCalledTimes(phase === 'uninstall' ? …

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 105 skipped (107)
   Start at  23:09:19
   Duration  610ms (transform 211ms, setup 0ms, collect 261ms, tests 69ms, environment 0ms, prepare 114ms)
```

</details>

<details><summary>修复后原循环：200/200</summary>

转录SHA-256: dc7ae461a95adf288ce1ab81405767acfbefffcfba5de1702d9f0669fb579d1e

```text
{
  "runs": 200,
  "failures": []
}
```

</details>

<details><summary>修复后定向GREEN：182通过</summary>

转录SHA-256: 882f67b51eb093367590ef2ec53f014413a522fea1192e1955c967eb91854230

```text

> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test --run test/dsh-compat-ci.test.ts test/dsh-adapter.test.ts test/core-diagnostics.test.ts test/doctor-json-cli.test.ts


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/dsh-adapter.test.ts (57 tests) 12556ms
   ✓ Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations  336ms
   ✓ Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts  469ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED'  422ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH'  482ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION'  381ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL'  411ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR'  376ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE'  380ms
   ✓ Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes  338ms
   ✓ Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying  5416ms
   ✓ Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection  371ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200  1150ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401  1078ms
 ✓ test/doctor-json-cli.test.ts (3 tests) 4102ms
   ✓ doctor JSON CLI extension > diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it  2189ms
   ✓ doctor JSON CLI extension > returns the structured checks and preserves the existing default report and exit severity  1078ms
   ✓ doctor JSON CLI extension > emits valid structured findings with exit one for a failed check and rejects extra options  834ms
 ✓ test/dsh-compat-ci.test.ts (107 tests) 18324ms
   ✓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause  1010ms
   ✓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause  1014ms
   ✓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot  1016ms
   ✓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes  1009ms
   ✓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release  1116ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation  443ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline  636ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned  1132ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return  2026ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return  381ms
   ✓ DeepSeek Harness desktop installer admission > uses native Windows signature modules rather than executing an inherited shadow module  359ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes  1009ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation  1036ms
   ✓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early  1009ms
   ✓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error  1008ms
   ✓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline  1019ms
 ✓ test/core-diagnostics.test.ts (15 tests) 1319ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  391ms

 Test Files  4 passed (4)
      Tests  182 passed (182)
   Start at  23:09:41
   Duration  21.24s (transform 656ms, setup 0ms, collect 1.45s, tests 36.30s, environment 1ms, prepare 409ms)
```

</details>

最终完整check退出0：2673通过/11原有跳过，231文件通过/3跳过；lint/build及203模块686边导入图通过。最后产品含26fde78诊断与5fe6802截止分类修复，另有同次受验的CLI help文字同步。没有新增跳过或放宽原有断言。

<details><summary>修复后完整check原始输出</summary>

转录SHA-256: 210e9c776ea6db32fe7d62b569270ed7389445da324b83a033c1fa9258c2aa7e

```text

> @oatelauser/crosschat@1.10.0 check
> npm run lint && npm run check:imports && npm run build && npm test


> @oatelauser/crosschat@1.10.0 lint
> eslint src test


> @oatelauser/crosschat@1.10.0 check:imports
> node scripts/runtime-import-graph.mjs

Runtime import graph: 203 modules, 686 edges; no cycles or boundary violations.

> @oatelauser/crosschat@1.10.0 build
> tsc


> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/serve-star-lifecycle.test.ts (11 tests) 17015ms
   ✓ 033 热加星：不重启即托管即收发 > 在跑 serve + CLI --add-star 经管理插座：回执生效、自登记落位、聚合器播种、新星上 node/sender 完整收发  1568ms
   ✓ 033 删星：即时收尾 + 直报已删 + 最后一颗可删 > 热删 beta：在跑连接收"星已删除"断开、node.json 摘条、死钥直报、邻星零中断  2348ms
   ✓ 033 插座冷热路径与 stop 收口 > 回执超时绝不回落直写：插座连上但无回执 → 报错重试、台账零改动  10003ms
   ✓ 033 插座冷热路径与 stop 收口 > stop 收口：serve 停机后状态 stopped、插座随进程撤（CLI 退冷路径）  1529ms
   ✓ 036 按星机器名（--star --show-name）热闭环 > 按星只重挂该星：条目覆盖落 node.json、注册表该星 machineName 更新、邻星回落全局不变；--list 显示随条目；'' 清除回落全局  1534ms
 ✓ test/dsh-compat-ci.test.ts (107 tests) 18272ms
   ✓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause  1009ms
   ✓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause  1001ms
   ✓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot  1004ms
   ✓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes  1010ms
   ✓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release  1126ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation  440ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline  628ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned  1119ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return  2027ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return  401ms
   ✓ DeepSeek Harness desktop installer admission > uses native Windows signature modules rather than executing an inherited shadow module  322ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes  1022ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation  1049ms
   ✓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early  1006ms
   ✓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error  1032ms
   ✓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline  1008ms
 ✓ test/conversation-state-concurrency.test.ts (11 tests) 9316ms
   ✓ conversation state cross-process writes > independent processes allocating at once never share a handle and each resolves to its own ref  354ms
   ✓ conversation state cross-process writes > a live writer on an aliased path blocks every other write path until it releases  2168ms
   ✓ conversation state cross-process writes > a send that cannot take the lock delivers nothing, then succeeds once released  1150ms
   ✓ conversation state cross-process writes > a stuck holder still exits within its barrier deadline  5106ms
 ✓ test/dsh-adapter.test.ts (57 tests) 12389ms
   ✓ Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations  529ms
   ✓ Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts  444ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED'  380ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH'  352ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION'  351ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL'  383ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR'  358ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE'  350ms
   ✓ Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes  324ms
   ✓ Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying  5339ms
   ✓ Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection  448ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200  1265ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401  1104ms
 ✓ test/session-star.test.ts (40 tests) 6356ms
   ✓ 018 批二：启动器入星链路 > spawn 会话→自动拉聚合器→attach→三段直达；退出即 detach  636ms
   ✓ 018 批二：启动器入星链路 > 多星：--connect 可重复，两会话成员表各自 attach（win 带杠 mid 形态）  682ms
   ✓ 018 批二：启动器入星链路 > 021 断连静默：聚合器被杀→重连提示落日志、控制台零输出、成员籍自动恢复  1590ms
   ✓ 018 批二：9b 降级告警（不只日志） > NodeClient.warn 直打一行；warnIfBrokerLacksSessionCaps 对老 broker 出声、新 broker 静默  316ms
   ✓ 028 双模式与命令面 > 双模式集成：永久退出留册、裸 resume 不归队、明确选择恢复；--rm 退出清册  862ms
 ✓ test/serve-admin-key.test.ts (7 tests) 6140ms
   ✓ 034 挑战应答全链与角色矩阵 > admin 握手（钥匙永不过线）→ 读/发/删全过 → 成员/星管逐格 → 重放拒绝 → 被吊钥 BAD_AUTH → 审计在场  2885ms
   ✓ 034 挑战应答全链与角色矩阵 > CLI 远程管理路由：--via tcp:<星> 成员读（星钥）+ 星管写（adminKey 挑战应答）  1547ms
   ✓ 034 set-port 无命令回归（旗标+插座 op 全删） > 管理插座 set-port op 已删（未知 op 拒绝、台账零改动）  1510ms
probe failed: root-not-exclusive:C:\Users\YANGSH~1\AppData\Local\Temp\c14w05-test-Ucp8vJ\previous-run
 ✓ test/endpoint-protocol.test.ts (5 tests) 5470ms
   ✓ endpoint identity capability guard > does not replay an uncertain lifecycle removal while readonly roster still reports the same temporary member  5420ms
usage: node scripts/codex-call-correlation-probe.mjs --root <owned temp dir> [--evidence <json>]
 ✓ test/codex-call-correlation-probe.test.ts (56 tests) 5209ms
   ✓ codex call correlation probe: bounded reads and processes > kills a timed-out child together with its descendant and waits for close  1806ms
   ✓ codex call correlation probe: bounded reads and processes > stops a cancelled child through the abort signal  420ms
   ✓ codex call correlation probe: run root and main chain > keeps the root when the run is cancelled  545ms
   ✓ codex call correlation probe: run root and main chain > keeps the run root when the launched process never closed  1479ms
 ✓ test/serve-sessions.test.ts (37 tests) 4802ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 028 claude 活性：扫描核验——死 claude 成员转下线（教学）、活成员续投  526ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > C14 Codex 活性：核实实际 CLI 端点后续投，原生不存在的同类成员转下线  529ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 029 临时成员异常死亡：对账验死报 member-remove 清册零痕迹（不留下线态）  740ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > delegates name following to a third provider without reviving a released manual membership  301ms
   ✓ 028 册（roster）：落盘/跨机拒绝/extends 胜复活/member-remove > 028 下线成员随 roster 帧下发（offlineSessions 单列；sessions 保持活成员语义）  422ms
   ✓ 018 9b：老 broker（proto:1）降级的协议侧 > connect 携带 caps；info.caps 缺端点能力时拒绝类型化 attach，且不发 sessions 帧  311ms
 ✓ test/serve-multistar.test.ts (20 tests) 4423ms
   ✓ 032 多星握手与星域隔离 > 钥匙不属任何星 → BAD_AUTH（跨星错钥匙不放行）  518ms
   ✓ 032 bootstrap 与 CLI > 033 serve 永不造星：空表首启零星合法（不建星、不写 node.json），教学指 --add-star  1517ms
   ✓ 032 bootstrap 与 CLI > 内挂聚合器不写 status-node 文件（非独立进程）  1514ms
 ✓ test/doctor-json-cli.test.ts (3 tests) 4058ms
   ✓ doctor JSON CLI extension > diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it  2193ms
   ✓ doctor JSON CLI extension > returns the structured checks and preserves the existing default report and exit severity  1018ms
   ✓ doctor JSON CLI extension > emits valid structured findings with exit one for a failed check and rejects extra options  847ms
 ✓ test/broker-revocation.test.ts (12 tests) 3875ms
   ✓ broker credential revocation > local remove-node immediately revokes every node/sender using that credential and retains offline permanent members in its star  884ms
   ✓ broker credential revocation > remote remove-node has the same immediate effect while members and star admins retain their three-layer limits  633ms
   ✓ broker credential revocation > local remove-admin-key closes only authenticated sessions of the removed credential, including unique-prefix selection  1052ms
   ✓ broker credential revocation > marks a revoked session unusable before close completes without affecting another credential  309ms
 ✓ test/local-service-inspection.test.ts (6 tests) 3154ms
   ✓ owned service inspection and guard workers > reclaims an inspector blocked in spawnSync, including its owned probe child, before cancellation returns  386ms
   ✓ owned service inspection and guard workers > uses the real process wrapper for successful inspection/guard IPC and releases it before returning  697ms
   ✓ owned service inspection and guard workers > reclaims a real wrapper and its controlled blocked probe when its read timeout expires  1846ms
 ✓ test/local-service-owned-stop.test.ts (6 tests) 2675ms
   ✓ TUI owned service stop process trees > releases a hung OS scanner and its helper before completing cancellation without claiming the external stop was undone  325ms
   ✓ TUI owned service stop process trees > bounds a nonresponding stop job and reclaims its full scanner tree on timeout  1308ms
   ✓ TUI owned service stop process trees > runs the actual stop process wrapper and prior stop worker with the same fixed target, then releases the wrapper  364ms
   ✓ TUI owned service stop process trees > retains prior request validation inside the real wrapper before any stop business call  335ms
   ✓ TUI owned service stop process trees > uses the owned stop default from the managed task and waits for tree cleanup before returning an uncertain issued result  336ms
 ✓ test/maintenance-boundaries.test.ts (5 tests) 2827ms
   ✓ TUI maintenance source and copy boundaries > closes unreadable sources and bounds directory enumeration before accepting a skill plan  2713ms
 ✓ test/ssh-native-authentication.test.ts (3 tests) 2262ms
   ✓ SSH application native ASKPASS integration > reuses authentication across refreshes, retains strict host checking and forgets credentials when configuration changes  1298ms
   ✓ SSH application native ASKPASS integration > preserves full Windows ASKPASS fingerprints and offers no approval for a changed known host  451ms
   ✓ SSH application native ASKPASS integration > cancels a pending native authentication helper when the active connection closes  512ms
 ✓ test/opencode-desktop-fixture.test.ts (13 tests) 2192ms
   ✓ official desktop test environment > reports an unregistered executable under the owned run before allowing cleanup  1597ms
 ✓ test/serve-node.test.ts (30 tests) 2479ms
   ✓ B0 starId handshake > 036 无 id 星（手编形状）：连接按 BAD_AUTH 拒——broker 机跑一次 serve 补 id  574ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker queue self-delivery: the receipt ref carries the registry starId  496ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker steer self-delivery: the receipt ref carries the registry starId  540ms
 ✓ test/core-code-standards.test.ts (2 tests) 1957ms
   ✓ progressive typed lint rules > rejects floating promises, async void callbacks and value imports used only as types  1938ms
 ✓ test/tui-controller.test.ts (25 tests) 2075ms
 ✓ test/session-membership.test.ts (16 tests) 1620ms
   ✓ session membership application boundary > adopts an anonymous full native ref through the shared aggregator and verifies broker roster authority  537ms
   ✓ session membership application boundary > adopts and removes a typed Codex member without overwriting the same native ID on another endpoint  531ms
 ✓ test/revocation-pause.test.ts (13 tests) 1630ms
   ✓ explicit credential revocation pauses this star > stops one launcher supervisor without restarting it or disrupting another star  1187ms
 ✓ test/caller-source-confirmations.test.ts (21 tests) 1660ms
   ✓ source classification shared across native sessions > reports bounded busy without mutating state when an unrelated listener occupies its mutex port  1065ms
 ✓ test/send-log.test.ts (10 tests) 1628ms
   ✓ appendSendLog > rotates past 5MiB instead of truncating: the bulk moves whole to .old, the new entry starts a fresh file  1512ms
 ✓ test/tui-cli.test.ts (11 tests) 1469ms
 ✓ test/ssh-askpass-bridge.test.ts (3 tests) 1460ms
   ✓ owned native SSH ASKPASS bridge > uses a real local helper to pass one bounded prompt without storing the password in files, argv or environment  497ms
   ✓ owned native SSH ASKPASS bridge > closes a pending helper and cancels its challenge when the owned bridge is disposed  518ms
   ✓ owned native SSH ASKPASS bridge > rejects an oversized or cancelled answer without writing any secret material to stderr  444ms
 ✓ test/runtime-import-graph.test.ts (9 tests) 1462ms
   ✓ core source architecture > has no runtime dependency cycle or broken local import  580ms
   ✓ core source architecture > keeps node configuration and connection selection independent of commands and clients  421ms
   ✓ core source architecture > keeps every application adapter independent of command and UI entry points  386ms
 ✓ test/core-diagnostics.test.ts (15 tests) 1440ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (inherit)  310ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  449ms
 ✓ test/ssh-target-lifecycle.test.ts (4 tests) 1274ms
   ✓ SSH target identity and process completion > bounds a child that never closes, reports incomplete cleanup, and removes its owned listeners  1053ms
 ✓ test/via-tcp.test.ts (36 tests) 1191ms
   ✓ runViaTcpSend against a real broker > times out with TCP_TRANSPORT_FAILED and the 勿盲目重发 wording  420ms
 ✓ test/tui-composition.test.ts (15 tests) 1190ms
 ✓ test/tui-workspaces.test.ts (10 tests) 1200ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (updated)  355ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (failed)  374ms
 ✓ test/maintenance.test.ts (21 tests) 1020ms
   ✓ owned maintenance worker lifecycle > runs actual plans and filesystem effects through the default built worker using only isolated fixture paths  631ms
 ✓ test/tui-send-command.test.ts (5 tests) 1067ms
   ✓ TUI send command templates > round-trips opaque arguments through the current platform shell  1063ms
 ✓ test/ssh-application.test.ts (15 tests) 964ms
 ✓ test/tui-filters.test.ts (9 tests) 891ms
 ✓ test/remote-discovery-cli.test.ts (2 tests) 933ms
   ✓ built discover CLI endpoint > rejects invalid JSON and oversized input before provider execution  667ms
 ✓ test/status-remote.test.ts (16 tests) 891ms
   ✓ CLI：runViaTcpStatus 传输腿 > 版本偏差：旧 broker 对 status-query 无行为 → 超时教学  407ms
 ✓ test/outbox.test.ts (24 tests) 942ms
   ✓ park > refuses honestly at the per-thread cap and leaves the file untouched  654ms
 ✓ test/serve-broker.test.ts (33 tests) 887ms
 ✓ test/tui-main-observations.test.ts (3 tests) 804ms
   ✓ default local observation wiring > preserves native environment paths when the caller has not requested an isolated home  334ms
   ✓ default local observation wiring > installs the five real readonly resources lazily and preserves exact related routes  353ms
 ✓ test/observation-overview.test.ts (18 tests) 822ms
   ✓ safe isolated diagnostics for observation pages > binds the isolated process environment to explicit HOME instead of inherited native data overrides  302ms
   ✓ safe isolated diagnostics for observation pages > retains native data environment overrides in inherit mode while binding crosschat sources to the requested HOME  300ms
 ✓ test/tui-observation-navigation.test.ts (4 tests) 779ms
   ✓ observation resource routes > keeps related route caches separate, canonicalizes query order, clears associations on direct commands and restores the source  363ms
 ✓ test/dsh-cli.test.ts (4 tests) 555ms
   ✓ DeepSeek Harness CLI composition > connects real send dependencies to Harness delivery with an explicit mode  545ms
 ✓ test/dsh-bridge.test.ts (32 tests) 480ms
 ✓ test/codex-session-events.test.ts (2 tests) 565ms
   ✓ Codex per-window native protocol selection > only successful native selection and first accepted input affect this window, never global notifications or failed resume  350ms
 ✓ test/claude-session-events.test.ts (2 tests) 538ms
 ✓ test/c14-conversation-refinement.test.ts (24 tests) 406ms
 ✓ test/tui-form.test.ts (5 tests) 514ms
 ✓ test/tcp-peer-naming-transport.test.ts (8 tests) 455ms
 ✓ test/remote-discovery-tcp.test.ts (6 tests) 461ms
 ✓ test/cli-args.test.ts (18 tests) 445ms
 ✓ test/tui-main-sessions.test.ts (3 tests) 463ms
 ✓ test/tui-sensitive-result.test.ts (2 tests) 457ms
   ✓ one-time sensitive mutation results > uses a constant safe copy error, discards the result on interrupt and clears it on disposal  306ms
 ✓ test/smoke.test.ts (2 tests) 414ms
 ✓ test/local-service-worker-boundary.test.ts (8 tests) 353ms
 ✓ test/pipe-transport.test.ts (6 tests | 3 skipped) 369ms
   ✓ WindowsNamedPipeTransport > reports PIPE_WRITE_UNCERTAIN when the server cuts the connection mid-write  307ms
 ✓ test/tui-follow.test.ts (6 tests) 360ms
 ✓ test/revocation-auth-race.test.ts (2 tests) 385ms
   ✓ revocation during current process lifecycles > a corrupt self-aggregator pause does not become an unhandled rejection in the broker  342ms
 ✓ test/claude-compat-ci.test.ts (15 tests) 341ms
 ✓ test/install-skills.test.ts (12 tests) 331ms
 ✓ test/tcp-session-operations.test.ts (7 tests) 354ms
 ✓ test/tui-context-source.test.ts (7 tests) 342ms
 ✓ test/tui-layout-paging.test.tsx (3 tests) 310ms
 ✓ test/conversations.test.ts (26 tests) 280ms
 ✓ test/broker-discovery.test.ts (17 tests) 319ms
 ✓ test/serve-b21.test.ts (29 tests) 327ms
 ✓ test/opencode-adapter.test.ts (26 tests) 311ms
 ✓ test/serve-f0.test.ts (19 tests) 296ms
 ✓ test/send-command.test.ts (57 tests) 325ms
 ✓ test/remote-discovery-node.test.ts (8 tests) 261ms
 ✓ test/core-sessions-readers.test.ts (13 tests) 259ms
 ✓ test/caller-source-providers.test.ts (14 tests) 265ms
 ✓ test/claude-compat-fixture.test.ts (19 tests) 269ms
 ✓ test/caller-source-state-lock.test.ts (2 tests) 248ms
 ✓ test/tcp-exact-transport.test.ts (3 tests) 253ms
 ✓ test/tui-clipboard.test.ts (5 tests) 255ms
 ✓ test/core-services-background.test.ts (5 tests) 233ms
 ✓ test/serve-cli.test.ts (32 tests) 247ms
 ✓ test/tcp-configuration-management.test.ts (7 tests) 204ms
 ✓ test/tool-type-routing-state.test.ts (32 tests) 175ms
 ✓ test/dsh-node-members.test.ts (1 test) 174ms
 ✓ test/conversation-handle-ring.test.ts (9 tests) 206ms
 ✓ test/c14-explicit-send.test.ts (29 tests) 185ms
 ✓ test/serve-tool-type-bridge.test.ts (6 tests) 199ms
 ✓ test/codex-aggregate-discovery.test.ts (11 tests) 201ms
 ✓ test/tui-view.test.tsx (13 tests) 180ms
 ✓ test/tui-session-view.test.tsx (8 tests) 172ms
 ✓ test/tcp-application.test.ts (13 tests) 171ms
 ✓ test/file-channel.test.ts (10 tests) 183ms
 ✓ test/session-membership-exact.test.ts (9 tests) 171ms
 ✓ test/watchdog.test.ts (10 tests) 165ms
 ✓ test/send-handle.test.ts (10 tests) 167ms
 ✓ test/tcp-transport.test.ts (7 tests) 156ms
 ✓ test/core-queries.test.ts (17 tests) 164ms
 ✓ test/discovery-service.test.ts (10 tests) 154ms
 ✓ test/tui-mutation-navigation.test.ts (1 test) 159ms
 ✓ test/tui-workspace-layout.test.tsx (8 tests) 133ms
 ✓ test/claude-compat-lifecycle.test.ts (4 tests) 135ms
 ✓ test/local-services.test.ts (11 tests) 93ms
 ✓ test/tui-main-preferences.test.ts (2 tests) 144ms
(node:38520) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/desktop-metadata.test.ts (5 tests) 121ms
 ✓ test/codex-deliver.test.ts (26 tests) 126ms
 ✓ test/tui-contexts.test.ts (13 tests) 101ms
 ✓ test/outbox-ownership.test.ts (15 tests) 97ms
 ✓ test/tui-terminal.test.ts (8 tests) 131ms
 ✓ test/caller-source-service.test.ts (11 tests) 92ms
 ✓ test/tcp-configuration.test.ts (8 tests) 134ms
 ✓ test/ssh-managed-profiles.test.ts (5 tests) 103ms
 ✓ test/via-send.test.ts (42 tests) 128ms
 ✓ test/observation-logs.test.ts (11 tests) 117ms
 ✓ test/status-doctor-tcp.test.ts (27 tests) 114ms
 ✓ test/tcp-machine-transaction.test.ts (9 tests) 102ms
 ✓ test/dsh-live-fixture.test.ts (18 tests) 110ms
 ✓ test/observation-communications.test.ts (11 tests) 91ms
 ✓ test/status-conversations.test.ts (20 tests) 97ms
 ✓ test/tool-type-observations.test.ts (7 tests) 83ms
 ✓ test/desktop-ipc.test.ts (21 tests) 83ms
 ✓ test/dsh-runtime-driver.test.ts (3 tests) 86ms
 ✓ test/opencode-compat-fixture.test.ts (7 tests) 91ms
 ✓ test/tcp-snapshot-transport.test.ts (2 tests) 85ms
 ✓ test/tui-input.test.tsx (21 tests) 92ms
 ✓ test/tcp-management-exact.test.ts (8 tests) 80ms
 ✓ test/dsh-mock-model.test.ts (5 tests) 88ms
 ✓ test/dsh-send.test.ts (16 tests) 88ms
 ✓ test/tui-sessions.test.ts (22 tests) 90ms
 ✓ test/state-paths.test.ts (9 tests) 74ms
 ✓ test/claude-wrapper.test.ts (16 tests | 2 skipped) 68ms
 ✓ test/conversation-summary.test.ts (15 tests) 83ms
 ✓ test/session-selection.test.ts (3 tests) 65ms
 ✓ test/codex-target-diagnostics.test.ts (13 tests) 76ms
 ✓ test/opencode-members.test.ts (7 tests) 60ms
 ✓ test/uninstall.test.ts (10 tests) 65ms
 ✓ test/codex-routing.test.ts (15 tests) 77ms
 ✓ test/tui-context-actions.test.ts (3 tests) 64ms
 ✓ test/session-operations.test.ts (4 tests) 75ms
 ✓ test/opencode-desktop-ci.test.ts (13 tests) 54ms
 ✓ test/core-cleanup.test.ts (5 tests) 63ms
 ✓ test/tui-registry.test.ts (5 tests) 61ms
 ✓ test/serve-registry.test.ts (10 tests) 60ms
 ✓ test/core-management.test.ts (12 tests) 58ms
 ✓ test/opencode-desktop-probe.test.ts (9 tests) 56ms
 ✓ test/codex-rpc.test.ts (11 tests) 57ms
 ✓ test/status-summary.test.ts (14 tests) 50ms
 ✓ test/tcp-cold-management.test.ts (5 tests) 60ms
 ✓ test/identity-command.test.ts (7 tests) 56ms
 ✓ test/tui-tcp.test.ts (24 tests) 42ms
 ✓ test/rollout-meta.test.ts (13 tests) 57ms
 ✓ test/tcp-local-management.test.ts (6 tests) 44ms
 ✓ test/clean.test.ts (10 tests) 49ms
 ✓ test/dsh-members.test.ts (13 tests) 44ms
 ✓ test/status-filters.test.ts (20 tests) 52ms
 ✓ test/delivery-mode.test.ts (15 tests) 54ms
 ✓ test/native-rename-providers.test.ts (6 tests) 37ms
 ✓ test/tui-table.test.ts (23 tests) 34ms
 ✓ test/c14-native-send-seams.test.ts (17 tests) 36ms
 ✓ test/tcp-management-boundaries.test.ts (4 tests) 34ms
 ✓ test/discovery-ssh.test.ts (7 tests) 30ms
 ✓ test/tcp-management.test.ts (15 tests) 24ms
 ✓ test/tui-text.test.ts (52 tests) 26ms
 ✓ test/node-config.test.ts (9 tests) 24ms
 ✓ test/rate-limit.test.ts (6 tests) 24ms
 ✓ test/core-services.test.ts (5 tests) 27ms
 ✓ test/opencode-send.test.ts (9 tests) 29ms
 ✓ test/doctor.test.ts (20 tests) 22ms
 ✓ test/serve-management-errors.test.ts (6 tests) 20ms
 ✓ test/opencode-tui.test.ts (9 tests) 14ms
 ✓ test/tui-star-audit.test.ts (2 tests) 16ms
 ✓ test/core-send-diagnostics.test.ts (6 tests) 20ms
 ✓ test/tui-ssh.test.ts (7 tests) 15ms
 ✓ test/core-send.test.ts (4 tests) 16ms
 ✓ test/c14-tool-addressing.test.ts (8 tests) 20ms
 ✓ test/session-star-logging.test.ts (2 tests) 18ms
 ✓ test/tcp-machine-workspace.test.ts (8 tests) 18ms
 ✓ test/tcp-empty-node-config.test.ts (3 tests) 16ms
 ✓ test/session-membership-machine.test.ts (4 tests) 16ms
 ✓ test/tcp-node-naming-lifecycle.test.ts (6 tests) 13ms
 ✓ test/tui-tcp-targets.test.ts (2 tests) 17ms
 ✓ test/codex-pagination.test.ts (5 tests) 14ms
 ✓ test/tui-logs.test.ts (5 tests) 16ms
 ✓ test/native-endpoint-types.test.ts (10 tests) 15ms
 ✓ test/tui-overview.test.ts (4 tests) 10ms
 ✓ test/session-membership-ipv6.test.ts (2 tests) 12ms
 ✓ test/dsh-identity.test.ts (19 tests) 11ms
 ✓ test/tui-page-presentation.test.ts (3 tests) 10ms
 ✓ test/tui-communications.test.ts (13 tests) 11ms
 ✓ test/tui-connections.test.ts (7 tests) 11ms
 ✓ test/star-snapshot.test.ts (1 test) 14ms
 ✓ test/ref.test.ts (25 tests) 12ms
 ✓ test/dsh-composition.test.ts (5 tests) 9ms
 ✓ test/tui-maintenance.test.ts (6 tests) 11ms
 ✓ test/opencode-composition.test.ts (4 tests) 11ms
 ✓ test/core-sessions.test.ts (8 tests) 10ms
 ✓ test/tui-services.test.ts (4 tests) 9ms
 ✓ test/tui-ssh-management.test.ts (3 tests) 8ms
 ✓ test/dsh-reader.test.ts (11 tests) 8ms
 ✓ test/opencode-identity.test.ts (18 tests) 10ms
 ✓ test/tool-type-discovery-state.test.ts (6 tests) 11ms
 ✓ test/codex-proxy-env.test.ts (2 tests) 9ms
 ✓ test/core-members.test.ts (8 tests) 9ms
 ✓ test/codex-caller-source-probe.test.ts (14 tests) 8ms
 ✓ test/core-local-discovery.test.ts (3 tests) 8ms
 ✓ test/registry.test.ts (6 tests) 7ms
 ✓ test/c14-discovery-tui.test.ts (3 tests) 10ms
 ✓ test/ssh-interaction.test.ts (6 tests) 9ms
 ✓ test/dsh-status.test.ts (7 tests) 10ms
 ✓ test/compat-reply.test.ts (19 tests) 6ms
 ✓ test/deliver.test.ts (5 tests) 7ms
 ✓ test/resolve.test.ts (24 tests) 8ms
 ✓ test/dsh-tui.test.ts (3 tests) 8ms
 ✓ test/key-file.test.ts (6 tests) 7ms
 ✓ test/discovery-command.test.ts (2 tests) 5ms
 ✓ test/opencode-status.test.ts (6 tests) 6ms
 ✓ test/envelope.test.ts (20 tests) 6ms
 ✓ test/codex-launcher-owner.test.ts (2 tests) 5ms
 ✓ test/opencode-wrapper.test.ts (3 tests) 4ms
 ✓ test/tcp-management-state.test.ts (3 tests) 4ms
 ✓ test/limits.test.ts (11 tests) 4ms
 ✓ test/local-service-readiness.test.ts (1 test) 4ms
 ✓ test/opencode-desktop-process-race.test.ts (3 tests) 5ms
 ✓ test/local-service-stop-target.test.ts (3 tests) 6ms
 ✓ test/frame.test.ts (5 tests) 3ms
 ✓ test/credential-revoked-protocol.test.ts (6 tests) 3ms
 ✓ test/claude-compat-evidence.test.ts (5 tests) 3ms
 ✓ test/codex-wrapper.test.ts (6 tests) 4ms
 ✓ test/remote-discovery-protocol.test.ts (10 tests) 4ms
 ✓ test/opencode-ref-boundary.test.ts (2 tests) 2ms
 ✓ test/tui-status.test.ts (4 tests) 3ms
 ✓ test/tui-ssh-authentication-prompt.test.ts (1 test) 2ms
 ✓ test/serve-protocol.test.ts (3 tests) 3ms
 ✓ test/c14-envelope-tool.test.ts (3 tests) 3ms
 ↓ test/live/claude-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/codex-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/status-live.test.ts (2 tests | 2 skipped)

 Test Files  231 passed | 3 skipped (234)
      Tests  2673 passed | 11 skipped (2684)
   Start at  23:12:02
   Duration  120.13s (transform 3.32s, setup 0ms, collect 22.83s, tests 166.03s, environment 36ms, prepare 18.76s)
```

</details>

本轮收尾：18份stdout/终端/复现资料已逐项与以上转录核对；自有loopback server与ConPTY/诊断进程均已结束，三场response均关闭。对owner任务、绝对realpath、固定目录名及全部无链接子树核实后，已删除本轮C10缓存根和其中测试home/profile/桥token；原生DSH安装未启动或变更。未新增永久文件，历史被拒缓存及用户文档未触碰。

## 2026-11-03 C08 技能更新与卸载CLI端到端补验

79196b2补齐I01-final-review明确保留的CLI顶层卸载验收，产品行为保持既有合同。两项真实构建CLI fixture分别使用默认与自定义Harness home；先安装、改旧SKILL/reference、增加额外文件、再次覆盖更新，再执行uninstall --yes。递归删除前逐项realpath确认实际目标均属于本次独占根。已确认更新覆盖源内同名文件并保留额外文件；卸载删除当前crosschat技能整个目录及本次crosschat状态，保留Harness profile/插件引用/设置/聊天、其它技能、旧Harness home和项目副本。原生DSH没有启动，个人文件和模型key未进入fixture。

定向实际5文件56/56（名称过滤同时包含tui-maintenance）；最新完整check退出0：**2675通过/11原有跳过，231文件通过/3跳过，lint/build及203模块686边导入图通过**。这是现有Windows行为补验，不等于npm/Web所有加载组合、POSIX或三平台CI完成。覆盖/额外文件、历史/项目副本的现有语义已写入工具指南；未新增命令、历史目录账本或永久文件。

<details><summary>C08补验后的完整check原始输出</summary>

转录SHA-256: eb540a402d6073af7fc9d2f5d89b10f7587092a44f7e99dc5705d5882bfacfcd

```text

> @oatelauser/crosschat@1.10.0 check
> npm run lint && npm run check:imports && npm run build && npm test


> @oatelauser/crosschat@1.10.0 lint
> eslint src test


> @oatelauser/crosschat@1.10.0 check:imports
> node scripts/runtime-import-graph.mjs

Runtime import graph: 203 modules, 686 edges; no cycles or boundary violations.

> @oatelauser/crosschat@1.10.0 build
> tsc


> @oatelauser/crosschat@1.10.0 test
> vitest run --dir test


 RUN  v3.2.7 D:/workspace/CC/multichat

 ✓ test/serve-star-lifecycle.test.ts (11 tests) 17010ms
   ✓ 033 热加星：不重启即托管即收发 > 在跑 serve + CLI --add-star 经管理插座：回执生效、自登记落位、聚合器播种、新星上 node/sender 完整收发  1574ms
   ✓ 033 删星：即时收尾 + 直报已删 + 最后一颗可删 > 热删 beta：在跑连接收"星已删除"断开、node.json 摘条、死钥直报、邻星零中断  2342ms
   ✓ 033 插座冷热路径与 stop 收口 > 回执超时绝不回落直写：插座连上但无回执 → 报错重试、台账零改动  10007ms
   ✓ 033 插座冷热路径与 stop 收口 > stop 收口：serve 停机后状态 stopped、插座随进程撤（CLI 退冷路径）  1526ms
   ✓ 036 按星机器名（--star --show-name）热闭环 > 按星只重挂该星：条目覆盖落 node.json、注册表该星 machineName 更新、邻星回落全局不变；--list 显示随条目；'' 清除回落全局  1525ms
 ✓ test/dsh-compat-ci.test.ts (107 tests) 18265ms
   ✓ DeepSeek Harness controlled desktop process > uses one bounded release after child and pipe failures without replacing the first cause  1018ms
   ✓ DeepSeek Harness controlled desktop process > records later pipe, child and release problems without replacing the first cause  1011ms
   ✓ DeepSeek Harness controlled desktop process > keeps late pipe errors owned after return without changing the snapshot  1009ms
   ✓ DeepSeek Harness controlled desktop process > records a pipe error raised synchronously while releasing the pipes  1011ms
   ✓ DeepSeek Harness controlled desktop process > lets the fixture end and await its own real child when the product cannot confirm release  1113ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > enforces the total deadline over headers and body and honors external cancellation  446ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > keeps late responses and late handles owned after the deadline  655ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close failure with the path and keeps the file owned  1109ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > reports a late file close that never settles as undecided at return  2025ms
   ✓ DeepSeek Harness official Windows desktop installer metadata and streaming verification > cancels a late response, releases its lock and reports it as undecided at return  394ms
   ✓ DeepSeek Harness desktop installer admission > uses native Windows signature modules rather than executing an inherited shadow module  305ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release and clears parent pipes  1017ms
   ✓ DeepSeek Harness desktop installer admission > reports an unconfirmed signature child release on cancellation  1063ms
   ✓ DeepSeek Harness desktop installer admission > owns a spawned child error without a close instead of returning early  1013ms
   ✓ DeepSeek Harness desktop installer admission > keeps the overflow failure when a failed stop reports an error  1010ms
   ✓ DeepSeek Harness desktop installer admission > keeps the signature failure and release state across the total deadline  1018ms
 ✓ test/conversation-state-concurrency.test.ts (11 tests) 9303ms
   ✓ conversation state cross-process writes > independent processes allocating at once never share a handle and each resolves to its own ref  337ms
   ✓ conversation state cross-process writes > a live writer on an aliased path blocks every other write path until it releases  2156ms
   ✓ conversation state cross-process writes > a send that cannot take the lock delivers nothing, then succeeds once released  1162ms
   ✓ conversation state cross-process writes > a stuck holder still exits within its barrier deadline  5103ms
 ✓ test/dsh-adapter.test.ts (57 tests) 12502ms
   ✓ Harness read-only bridge diagnostics > reports no live bridge as info without creating or repairing registrations  537ms
   ✓ Harness read-only bridge diagnostics > verifies every instance without listing or creating sessions and publishes only safe facts  379ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_AUTH_REQUIRED'  373ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_OWNER_MISMATCH'  426ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_VERSION'  397ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNSUPPORTED_PROTOCOL'  370ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_PROTOCOL_ERROR'  408ms
   ✓ Harness read-only bridge diagnostics > keeps other findings and warns without failing doctor for 'DSH_UNAVAILABLE'  358ms
   ✓ Harness read-only bridge diagnostics > reports a corrupt registration without leaking or replacing its original bytes  388ms
   ✓ Harness read-only bridge diagnostics > bounds a stalled handshake to one shared five-second budget without retrying  5350ms
   ✓ Harness read-only bridge diagnostics > cancels an in-flight handshake and releases the owned process and connection  379ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 200  1226ms
   ✓ Harness read-only bridge diagnostics > uses the same native facts in the actual CLI text and JSON, HTTP 401  1147ms
 ✓ test/session-star.test.ts (40 tests) 6441ms
   ✓ 018 批二：启动器入星链路 > spawn 会话→自动拉聚合器→attach→三段直达；退出即 detach  649ms
   ✓ 018 批二：启动器入星链路 > 多星：--connect 可重复，两会话成员表各自 attach（win 带杠 mid 形态）  689ms
   ✓ 018 批二：启动器入星链路 > 021 断连静默：聚合器被杀→重连提示落日志、控制台零输出、成员籍自动恢复  1586ms
   ✓ 018 批二：9b 降级告警（不只日志） > NodeClient.warn 直打一行；warnIfBrokerLacksSessionCaps 对老 broker 出声、新 broker 静默  317ms
   ✓ 028 双模式与命令面 > 双模式集成：永久退出留册、裸 resume 不归队、明确选择恢复；--rm 退出清册  873ms
 ✓ test/serve-admin-key.test.ts (7 tests) 6128ms
   ✓ 034 挑战应答全链与角色矩阵 > admin 握手（钥匙永不过线）→ 读/发/删全过 → 成员/星管逐格 → 重放拒绝 → 被吊钥 BAD_AUTH → 审计在场  2891ms
   ✓ 034 挑战应答全链与角色矩阵 > CLI 远程管理路由：--via tcp:<星> 成员读（星钥）+ 星管写（adminKey 挑战应答）  1540ms
   ✓ 034 set-port 无命令回归（旗标+插座 op 全删） > 管理插座 set-port op 已删（未知 op 拒绝、台账零改动）  1509ms
probe failed: root-not-exclusive:C:\Users\YANGSH~1\AppData\Local\Temp\c14w05-test-NydYGu\previous-run
 ✓ test/endpoint-protocol.test.ts (5 tests) 5468ms
   ✓ endpoint identity capability guard > does not replay an uncertain lifecycle removal while readonly roster still reports the same temporary member  5423ms
usage: node scripts/codex-call-correlation-probe.mjs --root <owned temp dir> [--evidence <json>]
 ✓ test/codex-call-correlation-probe.test.ts (56 tests) 5256ms
   ✓ codex call correlation probe: bounded reads and processes > kills a timed-out child together with its descendant and waits for close  1805ms
   ✓ codex call correlation probe: bounded reads and processes > stops a cancelled child through the abort signal  428ms
   ✓ codex call correlation probe: run root and main chain > keeps the root when the run is cancelled  556ms
   ✓ codex call correlation probe: run root and main chain > keeps the run root when the launched process never closed  1498ms
 ✓ test/serve-sessions.test.ts (37 tests) 4678ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 028 claude 活性：扫描核验——死 claude 成员转下线（教学）、活成员续投  528ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > C14 Codex 活性：核实实际 CLI 端点后续投，原生不存在的同类成员转下线  539ms
   ✓ 018 NodeClient 聚合器：attach IPC / 重播 / 双活性 > 029 临时成员异常死亡：对账验死报 member-remove 清册零痕迹（不留下线态）  728ms
   ✓ 028 册（roster）：落盘/跨机拒绝/extends 胜复活/member-remove > 028 下线成员随 roster 帧下发（offlineSessions 单列；sessions 保持活成员语义）  420ms
   ✓ 018 9b：老 broker（proto:1）降级的协议侧 > connect 携带 caps；info.caps 缺端点能力时拒绝类型化 attach，且不发 sessions 帧  314ms
 ✓ test/serve-multistar.test.ts (20 tests) 4409ms
   ✓ 032 多星握手与星域隔离 > 钥匙不属任何星 → BAD_AUTH（跨星错钥匙不放行）  512ms
   ✓ 032 bootstrap 与 CLI > 033 serve 永不造星：空表首启零星合法（不建星、不写 node.json），教学指 --add-star  1523ms
   ✓ 032 bootstrap 与 CLI > 内挂聚合器不写 status-node 文件（非独立进程）  1509ms
 ✓ test/doctor-json-cli.test.ts (3 tests) 4155ms
   ✓ doctor JSON CLI extension > diagnoses the exact custom Harness copy installed by the shared maintenance plan without repairing it  2193ms
   ✓ doctor JSON CLI extension > returns the structured checks and preserves the existing default report and exit severity  1066ms
   ✓ doctor JSON CLI extension > emits valid structured findings with exit one for a failed check and rejects extra options  895ms
 ✓ test/broker-revocation.test.ts (12 tests) 3887ms
   ✓ broker credential revocation > local remove-node immediately revokes every node/sender using that credential and retains offline permanent members in its star  857ms
   ✓ broker credential revocation > remote remove-node has the same immediate effect while members and star admins retain their three-layer limits  655ms
   ✓ broker credential revocation > local remove-admin-key closes only authenticated sessions of the removed credential, including unique-prefix selection  1034ms
   ✓ broker credential revocation > marks a revoked session unusable before close completes without affecting another credential  319ms
   ✓ broker credential revocation > finishes target pending work and file routes on revocation before the close callback, ignoring late target results  301ms
 ✓ test/maintenance-boundaries.test.ts (5 tests) 2629ms
   ✓ TUI maintenance source and copy boundaries > closes unreadable sources and bounds directory enumeration before accepting a skill plan  2528ms
 ✓ test/local-service-inspection.test.ts (6 tests) 2992ms
   ✓ owned service inspection and guard workers > reclaims an inspector blocked in spawnSync, including its owned probe child, before cancellation returns  424ms
   ✓ owned service inspection and guard workers > uses the real process wrapper for successful inspection/guard IPC and releases it before returning  605ms
   ✓ owned service inspection and guard workers > reclaims a real wrapper and its controlled blocked probe when its read timeout expires  1745ms
 ✓ test/local-service-owned-stop.test.ts (6 tests) 2670ms
   ✓ TUI owned service stop process trees > releases a hung OS scanner and its helper before completing cancellation without claiming the external stop was undone  326ms
   ✓ TUI owned service stop process trees > bounds a nonresponding stop job and reclaims its full scanner tree on timeout  1280ms
   ✓ TUI owned service stop process trees > runs the actual stop process wrapper and prior stop worker with the same fixed target, then releases the wrapper  406ms
   ✓ TUI owned service stop process trees > retains prior request validation inside the real wrapper before any stop business call  335ms
   ✓ TUI owned service stop process trees > uses the owned stop default from the managed task and waits for tree cleanup before returning an uncertain issued result  316ms
 ✓ test/serve-node.test.ts (30 tests) 2572ms
   ✓ B0 starId handshake > 036 无 id 星（手编形状）：连接按 BAD_AUTH 拒——broker 机跑一次 serve 补 id  580ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker queue self-delivery: the receipt ref carries the registry starId  569ms
   ✓ B1 multi-star: delivery pipeline stamps starId into issued refs > broker steer self-delivery: the receipt ref carries the registry starId  542ms
 ✓ test/ssh-native-authentication.test.ts (3 tests) 2340ms
   ✓ SSH application native ASKPASS integration > reuses authentication across refreshes, retains strict host checking and forgets credentials when configuration changes  1340ms
   ✓ SSH application native ASKPASS integration > preserves full Windows ASKPASS fingerprints and offers no approval for a changed known host  512ms
   ✓ SSH application native ASKPASS integration > cancels a pending native authentication helper when the active connection closes  488ms
 ✓ test/opencode-desktop-fixture.test.ts (13 tests) 2249ms
   ✓ official desktop test environment > reports an unregistered executable under the owned run before allowing cleanup  1666ms
 ✓ test/tui-controller.test.ts (25 tests) 1991ms
 ✓ test/core-code-standards.test.ts (2 tests) 1960ms
   ✓ progressive typed lint rules > rejects floating promises, async void callbacks and value imports used only as types  1943ms
 ✓ test/caller-source-confirmations.test.ts (21 tests) 1652ms
   ✓ source classification shared across native sessions > reports bounded busy without mutating state when an unrelated listener occupies its mutex port  1063ms
 ✓ test/revocation-pause.test.ts (13 tests) 1666ms
   ✓ explicit credential revocation pauses this star > stops one launcher supervisor without restarting it or disrupting another star  1199ms
 ✓ test/send-log.test.ts (10 tests) 1528ms
   ✓ appendSendLog > rotates past 5MiB instead of truncating: the bulk moves whole to .old, the new entry starts a fresh file  1405ms
 ✓ test/tui-cli.test.ts (11 tests) 1322ms
 ✓ test/session-membership.test.ts (16 tests) 1667ms
   ✓ session membership application boundary > adopts an anonymous full native ref through the shared aggregator and verifies broker roster authority  544ms
   ✓ session membership application boundary > adopts and removes a typed Codex member without overwriting the same native ID on another endpoint  534ms
 ✓ test/ssh-askpass-bridge.test.ts (3 tests) 1439ms
   ✓ owned native SSH ASKPASS bridge > uses a real local helper to pass one bounded prompt without storing the password in files, argv or environment  484ms
   ✓ owned native SSH ASKPASS bridge > closes a pending helper and cancels its challenge when the owned bridge is disposed  526ms
   ✓ owned native SSH ASKPASS bridge > rejects an oversized or cancelled answer without writing any secret material to stderr  428ms
 ✓ test/runtime-import-graph.test.ts (9 tests) 1431ms
   ✓ core source architecture > has no runtime dependency cycle or broken local import  554ms
   ✓ core source architecture > keeps node configuration and connection selection independent of commands and clients  411ms
   ✓ core source architecture > keeps every application adapter independent of command and UI entry points  397ms
 ✓ test/uninstall.test.ts (12 tests) 1528ms
   ✓ runUninstall > preserves native, historical and project data across actual CLI skill update/uninstall (default Harness home)  744ms
   ✓ runUninstall > preserves native, historical and project data across actual CLI skill update/uninstall (custom Harness home)  712ms
 ✓ test/core-diagnostics.test.ts (15 tests) 1591ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (undefined)  338ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (isolated)  312ms
   ✓ isolated cancellable diagnostics > keeps Harness home inside the selected diagnostic environment (inherit)  311ms
   ✓ isolated cancellable diagnostics > terminates a real probe child through the default built isolation path on cancellation  493ms
 ✓ test/ssh-target-lifecycle.test.ts (4 tests) 1274ms
   ✓ SSH target identity and process completion > bounds a child that never closes, reports incomplete cleanup, and removes its owned listeners  1059ms
 ✓ test/tui-workspaces.test.ts (10 tests) 1246ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (updated)  364ms
   ✓ independent TUI workspaces > rechecks the role when history returns to a different star (failed)  384ms
 ✓ test/via-tcp.test.ts (36 tests) 1162ms
   ✓ runViaTcpSend against a real broker > times out with TCP_TRANSPORT_FAILED and the 勿盲目重发 wording  426ms
 ✓ test/tui-composition.test.ts (15 tests) 1179ms
 ✓ test/tui-send-command.test.ts (5 tests) 1000ms
   ✓ TUI send command templates > round-trips opaque arguments through the current platform shell  996ms
 ✓ test/maintenance.test.ts (21 tests) 1077ms
   ✓ owned maintenance worker lifecycle > runs actual plans and filesystem effects through the default built worker using only isolated fixture paths  650ms
 ✓ test/ssh-application.test.ts (15 tests) 995ms
 ✓ test/outbox.test.ts (24 tests) 970ms
   ✓ park > refuses honestly at the per-thread cap and leaves the file untouched  637ms
 ✓ test/remote-discovery-cli.test.ts (2 tests) 911ms
   ✓ built discover CLI endpoint > rejects invalid JSON and oversized input before provider execution  641ms
 ✓ test/tui-filters.test.ts (9 tests) 881ms
 ✓ test/status-remote.test.ts (16 tests) 870ms
   ✓ CLI：runViaTcpStatus 传输腿 > 版本偏差：旧 broker 对 status-query 无行为 → 超时教学  421ms
 ✓ test/serve-broker.test.ts (33 tests) 771ms
 ✓ test/observation-overview.test.ts (18 tests) 804ms
   ✓ safe isolated diagnostics for observation pages > retains native data environment overrides in inherit mode while binding crosschat sources to the requested HOME  311ms
 ✓ test/tui-main-observations.test.ts (3 tests) 769ms
   ✓ default local observation wiring > installs the five real readonly resources lazily and preserves exact related routes  355ms
 ✓ test/tui-observation-navigation.test.ts (4 tests) 771ms
   ✓ observation resource routes > keeps related route caches separate, canonicalizes query order, clears associations on direct commands and restores the source  354ms
 ✓ test/codex-session-events.test.ts (2 tests) 564ms
   ✓ Codex per-window native protocol selection > only successful native selection and first accepted input affect this window, never global notifications or failed resume  355ms
 ✓ test/dsh-cli.test.ts (4 tests) 525ms
   ✓ DeepSeek Harness CLI composition > connects real send dependencies to Harness delivery with an explicit mode  514ms
 ✓ test/claude-session-events.test.ts (2 tests) 552ms
 ✓ test/tui-form.test.ts (5 tests) 511ms
 ✓ test/dsh-bridge.test.ts (32 tests) 514ms
 ✓ test/tui-main-sessions.test.ts (3 tests) 458ms
 ✓ test/remote-discovery-tcp.test.ts (6 tests) 399ms
 ✓ test/tui-sensitive-result.test.ts (2 tests) 435ms
 ✓ test/tcp-peer-naming-transport.test.ts (8 tests) 442ms
 ✓ test/smoke.test.ts (2 tests) 425ms
 ✓ test/cli-args.test.ts (18 tests) 484ms
 ✓ test/revocation-auth-race.test.ts (2 tests) 398ms
   ✓ revocation during current process lifecycles > a corrupt self-aggregator pause does not become an unhandled rejection in the broker  352ms
 ✓ test/c14-conversation-refinement.test.ts (24 tests) 471ms
 ✓ test/pipe-transport.test.ts (6 tests | 3 skipped) 378ms
   ✓ WindowsNamedPipeTransport > reports PIPE_WRITE_UNCERTAIN when the server cuts the connection mid-write  314ms
 ✓ test/tui-follow.test.ts (6 tests) 399ms
 ✓ test/tcp-session-operations.test.ts (7 tests) 358ms
 ✓ test/local-service-worker-boundary.test.ts (8 tests) 390ms
 ✓ test/tui-context-source.test.ts (7 tests) 307ms
 ✓ test/claude-compat-ci.test.ts (15 tests) 328ms
 ✓ test/install-skills.test.ts (12 tests) 345ms
 ✓ test/serve-b21.test.ts (29 tests) 354ms
 ✓ test/send-command.test.ts (57 tests) 357ms
 ✓ test/broker-discovery.test.ts (17 tests) 307ms
 ✓ test/opencode-adapter.test.ts (26 tests) 332ms
 ✓ test/tui-layout-paging.test.tsx (3 tests) 308ms
 ✓ test/serve-f0.test.ts (19 tests) 284ms
 ✓ test/conversations.test.ts (26 tests) 294ms
 ✓ test/claude-compat-fixture.test.ts (19 tests) 267ms
 ✓ test/caller-source-providers.test.ts (14 tests) 247ms
 ✓ test/remote-discovery-node.test.ts (8 tests) 289ms
 ✓ test/core-sessions-readers.test.ts (13 tests) 240ms
 ✓ test/tui-clipboard.test.ts (5 tests) 237ms
 ✓ test/tcp-exact-transport.test.ts (3 tests) 251ms
 ✓ test/caller-source-state-lock.test.ts (2 tests) 234ms
 ✓ test/serve-cli.test.ts (32 tests) 243ms
 ✓ test/core-services-background.test.ts (5 tests) 232ms
 ✓ test/conversation-handle-ring.test.ts (9 tests) 217ms
 ✓ test/tcp-configuration-management.test.ts (7 tests) 204ms
 ✓ test/codex-aggregate-discovery.test.ts (11 tests) 197ms
 ✓ test/serve-tool-type-bridge.test.ts (6 tests) 191ms
 ✓ test/file-channel.test.ts (10 tests) 173ms
 ✓ test/c14-explicit-send.test.ts (29 tests) 188ms
 ✓ test/tool-type-routing-state.test.ts (32 tests) 181ms
 ✓ test/tui-view.test.tsx (13 tests) 190ms
 ✓ test/dsh-node-members.test.ts (1 test) 201ms
 ✓ test/tcp-application.test.ts (13 tests) 167ms
 ✓ test/tui-session-view.test.tsx (8 tests) 172ms
 ✓ test/send-handle.test.ts (10 tests) 139ms
 ✓ test/session-membership-exact.test.ts (9 tests) 159ms
 ✓ test/core-queries.test.ts (17 tests) 145ms
 ✓ test/watchdog.test.ts (10 tests) 162ms
 ✓ test/tui-mutation-navigation.test.ts (1 test) 155ms
 ✓ test/tcp-transport.test.ts (7 tests) 136ms
 ✓ test/discovery-service.test.ts (10 tests) 146ms
 ✓ test/tui-main-preferences.test.ts (2 tests) 131ms
 ✓ test/claude-compat-lifecycle.test.ts (4 tests) 119ms
 ✓ test/tcp-configuration.test.ts (8 tests) 132ms
 ✓ test/tui-terminal.test.ts (8 tests) 131ms
 ✓ test/tui-workspace-layout.test.tsx (8 tests) 131ms
 ✓ test/via-send.test.ts (42 tests) 116ms
 ✓ test/codex-deliver.test.ts (26 tests) 115ms
(node:4464) ExperimentalWarning: SQLite is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
 ✓ test/desktop-metadata.test.ts (5 tests) 122ms
 ✓ test/observation-logs.test.ts (11 tests) 115ms
 ✓ test/dsh-live-fixture.test.ts (18 tests) 115ms
 ✓ test/status-doctor-tcp.test.ts (27 tests) 106ms
 ✓ test/ssh-managed-profiles.test.ts (5 tests) 103ms
 ✓ test/tcp-machine-transaction.test.ts (9 tests) 99ms
 ✓ test/tui-contexts.test.ts (13 tests) 98ms
 ✓ test/outbox-ownership.test.ts (15 tests) 112ms
 ✓ test/status-conversations.test.ts (20 tests) 90ms
 ✓ test/local-services.test.ts (11 tests) 97ms
 ✓ test/caller-source-service.test.ts (11 tests) 92ms
 ✓ test/tui-input.test.tsx (21 tests) 96ms
 ✓ test/observation-communications.test.ts (11 tests) 88ms
 ✓ test/opencode-compat-fixture.test.ts (7 tests) 88ms
 ✓ test/tui-sessions.test.ts (22 tests) 76ms
 ✓ test/dsh-mock-model.test.ts (5 tests) 79ms
 ✓ test/dsh-runtime-driver.test.ts (3 tests) 86ms
 ✓ test/dsh-send.test.ts (16 tests) 86ms
 ✓ test/desktop-ipc.test.ts (21 tests) 81ms
 ✓ test/tcp-snapshot-transport.test.ts (2 tests) 72ms
 ✓ test/conversation-summary.test.ts (15 tests) 84ms
 ✓ test/tool-type-observations.test.ts (7 tests) 98ms
 ✓ test/tcp-management-exact.test.ts (8 tests) 74ms
 ✓ test/codex-routing.test.ts (15 tests) 67ms
 ✓ test/codex-target-diagnostics.test.ts (13 tests) 70ms
 ✓ test/session-operations.test.ts (4 tests) 72ms
 ✓ test/state-paths.test.ts (9 tests) 78ms
 ✓ test/claude-wrapper.test.ts (16 tests | 2 skipped) 66ms
 ✓ test/session-selection.test.ts (3 tests) 59ms
 ✓ test/tui-context-actions.test.ts (3 tests) 68ms
 ✓ test/core-cleanup.test.ts (5 tests) 63ms
 ✓ test/tui-registry.test.ts (5 tests) 54ms
 ✓ test/tcp-cold-management.test.ts (5 tests) 77ms
 ✓ test/serve-registry.test.ts (10 tests) 75ms
 ✓ test/core-management.test.ts (12 tests) 55ms
 ✓ test/opencode-members.test.ts (7 tests) 59ms
 ✓ test/rollout-meta.test.ts (13 tests) 43ms
 ✓ test/codex-rpc.test.ts (11 tests) 67ms
 ✓ test/identity-command.test.ts (7 tests) 55ms
 ✓ test/opencode-desktop-probe.test.ts (9 tests) 63ms
 ✓ test/opencode-desktop-ci.test.ts (13 tests) 60ms
 ✓ test/delivery-mode.test.ts (15 tests) 46ms
 ✓ test/status-filters.test.ts (20 tests) 50ms
 ✓ test/status-summary.test.ts (14 tests) 55ms
 ✓ test/clean.test.ts (10 tests) 51ms
 ✓ test/dsh-members.test.ts (13 tests) 46ms
 ✓ test/tcp-local-management.test.ts (6 tests) 45ms
 ✓ test/tui-tcp.test.ts (24 tests) 43ms
 ✓ test/native-rename-providers.test.ts (6 tests) 40ms
 ✓ test/c14-native-send-seams.test.ts (17 tests) 37ms
 ✓ test/tui-table.test.ts (23 tests) 34ms
 ✓ test/discovery-ssh.test.ts (7 tests) 45ms
 ✓ test/tcp-management-boundaries.test.ts (4 tests) 37ms
 ✓ test/opencode-send.test.ts (9 tests) 32ms
 ✓ test/core-services.test.ts (5 tests) 35ms
 ✓ test/node-config.test.ts (9 tests) 28ms
 ✓ test/tui-text.test.ts (52 tests) 31ms
 ✓ test/rate-limit.test.ts (6 tests) 26ms
 ✓ test/tcp-management.test.ts (15 tests) 24ms
 ✓ test/doctor.test.ts (20 tests) 24ms
 ✓ test/core-send-diagnostics.test.ts (6 tests) 17ms
 ✓ test/serve-management-errors.test.ts (6 tests) 22ms
 ✓ test/c14-tool-addressing.test.ts (8 tests) 17ms
 ✓ test/tcp-machine-workspace.test.ts (8 tests) 16ms
 ✓ test/session-star-logging.test.ts (2 tests) 16ms
 ✓ test/tui-tcp-targets.test.ts (2 tests) 14ms
 ✓ test/session-membership-machine.test.ts (4 tests) 15ms
 ✓ test/tcp-empty-node-config.test.ts (3 tests) 13ms
 ✓ test/tui-star-audit.test.ts (2 tests) 20ms
 ✓ test/core-send.test.ts (4 tests) 22ms
 ✓ test/tui-logs.test.ts (5 tests) 15ms
 ✓ test/native-endpoint-types.test.ts (10 tests) 16ms
 ✓ test/tui-ssh.test.ts (7 tests) 17ms
 ✓ test/codex-pagination.test.ts (5 tests) 13ms
 ✓ test/opencode-tui.test.ts (9 tests) 13ms
 ✓ test/star-snapshot.test.ts (1 test) 10ms
 ✓ test/tcp-node-naming-lifecycle.test.ts (6 tests) 16ms
 ✓ test/session-membership-ipv6.test.ts (2 tests) 11ms
 ✓ test/ref.test.ts (25 tests) 15ms
 ✓ test/tui-communications.test.ts (13 tests) 12ms
 ✓ test/dsh-identity.test.ts (19 tests) 15ms
 ✓ test/tool-type-discovery-state.test.ts (6 tests) 10ms
 ✓ test/tui-connections.test.ts (7 tests) 10ms
 ✓ test/opencode-composition.test.ts (4 tests) 10ms
 ✓ test/core-sessions.test.ts (8 tests) 9ms
 ✓ test/tui-overview.test.ts (4 tests) 9ms
 ✓ test/dsh-status.test.ts (7 tests) 7ms
 ✓ test/tui-page-presentation.test.ts (3 tests) 11ms
 ✓ test/opencode-identity.test.ts (18 tests) 10ms
 ✓ test/c14-discovery-tui.test.ts (3 tests) 9ms
 ✓ test/tui-maintenance.test.ts (6 tests) 10ms
 ✓ test/ssh-interaction.test.ts (6 tests) 7ms
 ✓ test/codex-proxy-env.test.ts (2 tests) 9ms
 ✓ test/core-members.test.ts (8 tests) 10ms
 ✓ test/dsh-composition.test.ts (5 tests) 11ms
 ✓ test/tui-services.test.ts (4 tests) 8ms
 ✓ test/resolve.test.ts (24 tests) 7ms
 ✓ test/tui-ssh-management.test.ts (3 tests) 9ms
 ✓ test/codex-caller-source-probe.test.ts (14 tests) 7ms
 ✓ test/dsh-tui.test.ts (3 tests) 7ms
 ✓ test/core-local-discovery.test.ts (3 tests) 8ms
 ✓ test/dsh-reader.test.ts (11 tests) 8ms
 ✓ test/key-file.test.ts (6 tests) 8ms
 ✓ test/registry.test.ts (6 tests) 8ms
 ✓ test/deliver.test.ts (5 tests) 8ms
 ✓ test/compat-reply.test.ts (19 tests) 8ms
 ✓ test/opencode-status.test.ts (6 tests) 7ms
 ✓ test/envelope.test.ts (20 tests) 7ms
 ✓ test/local-service-stop-target.test.ts (3 tests) 5ms
 ✓ test/discovery-command.test.ts (2 tests) 5ms
 ✓ test/opencode-desktop-process-race.test.ts (3 tests) 6ms
 ✓ test/codex-launcher-owner.test.ts (2 tests) 6ms
 ✓ test/limits.test.ts (11 tests) 3ms
 ✓ test/tcp-management-state.test.ts (3 tests) 4ms
 ✓ test/opencode-wrapper.test.ts (3 tests) 5ms
 ✓ test/local-service-readiness.test.ts (1 test) 4ms
 ✓ test/codex-wrapper.test.ts (6 tests) 5ms
 ✓ test/remote-discovery-protocol.test.ts (10 tests) 3ms
 ✓ test/claude-compat-evidence.test.ts (5 tests) 4ms
 ✓ test/frame.test.ts (5 tests) 3ms
 ✓ test/credential-revoked-protocol.test.ts (6 tests) 3ms
 ✓ test/serve-protocol.test.ts (3 tests) 3ms
 ✓ test/tui-status.test.ts (4 tests) 3ms
 ✓ test/c14-envelope-tool.test.ts (3 tests) 3ms
 ✓ test/opencode-ref-boundary.test.ts (2 tests) 2ms
 ✓ test/tui-ssh-authentication-prompt.test.ts (1 test) 2ms
 ↓ test/live/claude-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/codex-live.test.ts (2 tests | 2 skipped)
 ↓ test/live/status-live.test.ts (2 tests | 2 skipped)

 Test Files  231 passed | 3 skipped (234)
      Tests  2675 passed | 11 skipped (2686)
   Start at  23:23:02
   Duration  120.34s (transform 3.24s, setup 0ms, collect 22.75s, tests 167.23s, environment 37ms, prepare 18.64s)
```

</details>

C08补验fixture由测试afterAll回收；本轮完整日志经逐字归一转录核对后，其独占缓存根也已按owner/realpath核实删除。用户保留的DSH安装仍在，不触碰历史缓存和用户未跟踪文档。

## 2026-11-03/04 C10 profile插件静态诊断

用户澄清新增文件审批指crosschat持久数据（如home/.crosschat），代码、测试等开发文件直接推进；本切片沿现有doctor入口及info/pass/warn规则实现，没有新增持久数据或命令参数。只读当前Harness home的profiles与活桥核实的profileDir，报告未声明引用、缺失/损坏安装、实际位置/版本及当前随包七项文件的内容差异。正常pnpm/file包链接解析到真实目标；未核实profile链接不递归发现。读取每项64KiB、目录100项有界，活桥与静态读取共享5秒总预算。安装文件一致不证明当前Host加载了这版，单一静态disabled字段不代替bundle/profile/home/launch合成或原生UI证据。

正式Windows包0.2.1-rc.2的main bundle只读核实了默认home/.dsh及profiles/desktop规则；打包后没有独立lib/paths.js、lib/node-environment.js，先前ENOENT保留为研究定位结果。插件管理器按devDependencies→dependencies→optionalDependencies合并直接依赖，诊断仅提取本桥字段，不输出依赖spec、秘密配置或源码。未再次启动正式DSH UI。

TDD链：c20502e为14失败/1通过的行为RED，5f0abca初版GREEN；15c7c81补齐短读误判和已变文件的profile反例，2失败/16通过，a0b7f09修复；c4cd458接线RED3失败/33通过，e3b777e最终同源接线及可复跑ConPTY helper。reader首次lint指出finally显式throw，改为close后保留首个结果/错误；helper首次lint需要node:process显式导入，最终检查均通过。没有放宽产品断言，超时夹具改为到达IO gate后受控推进计时，迟到真实句柄确实close。

完整check退出0：**2696通过/11原有跳过，232文件通过/3跳过**，lint、204模块688边导入图和build通过；max workers/threads=2、min=1，未启用CROSSCHAT_LIVE。定向5文件114/114，最终静态单套20/20。最终构建ConPTY三场（内容一致/不同/未声明）两轮均通过；筛选、详情、resize、正常退出及终端raw/监听/模式恢复通过，profile字节保持，私有字段未输出。桥/配置均是隔离fixture，不将其冒充正式工具新增原生验收。

[验证摘要](evidence/c10-profile-20261103/validation.json)和[27份原始日志/事件的脱敏证据包](evidence/c10-profile-20261103/raw-evidence-redacted.zip)已归档。ZIP SHA-256=4825755b498bc4b502d54f527572fca52613a6888fd6d9522908d71966cc4793，65946字节；CRC及逐项SHA核对通过。排除fixture安装/配置目录，文本用户home及owned根已脱敏，ConPTY帧按实际输出保留。两个ConPTY round及诊断进程均正常退出，单测迟到IO gate均释放；核实owner/realpath后删除本轮临时根，D:/soft/DeepSeek Harness/DeepSeek Harness.exe仍在。

用户要求准备暂停后只做此证据/清理/续接收口，未启动新开发、push或Actions。


## 2026-11-04 C09 正式npm/Web来源与TUI流程

用户恢复任务后，root独立补验现有实现，未派worker、未修改产品代码、命令参数或持久数据格式。验收工装与两项边界测试提交75ffc7b；定向三文件19/19，单次完整npm run check为2698通过/11原有跳过，232文件通过/3跳过，lint/build与204模块688边导入图通过，最多2/最少1 worker，完整检查未启用CROSSCHAT_LIVE。

正式npm产物仍为固定0.2.1-rc.2、pnpm11.28.5，两个下载包经既有SHA-512校验，在独占目录npm install --ignore-scripts安装。正式管理器安装生产桥，真实Web Host创建两条同名会话；普通原生pwsh工具取得identified/dsh/native/verified/instance来源。生产鉴权reader→DiscoveryService→构建TUI在Windows ConPTY中验证列表、同名完整ID筛选、完整命令/ref复制、只读详情/原生指引、工具筛选和刷新选择。npm实际标题投影两条均显示C09-SAME-TITLE；这不证明此前正式Desktop标题为空的原因已解决。

实际原生插件停用后来源返回unavailable而非完整空列表；重新启用后恢复相同完整会话ID。维护页默认取消没有执行，明确确认后真实worker安装三侧技能，Harness副本与随包源相同，原生profile package.json字节保持。真实受控broker/node收编经实际reader核实入口类型的已有根会话；共享成员页显示在线、完整机器/原生ID并复制带--tool dsh的完整TCP命令。没有修改选择/成员增强机制、发信、连接远端或使用系统剪贴板；普通成员显示验收不等于C18专属增强完成。48×16与140×36 resize、正常退出后raw模式、信号及resize监听、终端模式恢复通过。

五次记录全部保留：第一至三次工装依次误等旧式“1项”、不存在的维护“影响范围已更新”和“星成员”文字，真实界面/维护已按现有实现完成；第四次工装attach未传endpoint，成员复制按合同禁用，第五次用鉴权来源的host类型声明后通过。这些不是产品RED/GREEN或四个兼容回归。两项普通回归覆盖Host/Desktop同ID仍独立及不完整快照禁止复制；新测试从已有正确行为直接通过。

[摘要](evidence/c09-dsh-20261104/validation.json)与[27项脱敏原始证据](evidence/c09-dsh-20261104/raw-evidence-redacted.zip)已归档，ZIP 106141字节，SHA-256=d32fea87d2143b175bbd8a1141c88650408611c1b453ae4879dd64da456593d4，CRC/逐项SHA核对通过。排除安装/profile配置与下载包，保留五次运行及最终完整检查。各正式runtime正常停止、登记与原生run目录移除；最终所有者匹配、相关进程为0。总安装/缓存根自动删除被拒（blocked by policy，仅此原因），未换工具重试；用户随后手动删除，代理只读确认不存在，D:/soft/DeepSeek Harness保留。

本次为npm/Web Host真实来源＋终端验收，不含浏览器UI、正式Desktop同一TUI流程、干净runner/托管或其它平台；C09及共享父项剩余范围保留。


## 2026-11-04 C09 正式Desktop来源、维护诊断与成员页

产品保持e3b777e，本轮仅更新验收工装；代码d8ac696，最终完整check退出0，2698通过/11原有跳过，232文件通过/3跳过，lint/build与204模块688边导入图通过，最多2/最少1 worker。使用用户保留的D:/soft/DeepSeek Harness 0.2.1-rc.2，沿隔离HOME/DSH_HOME/appdata/user-data-dir、loopback模型及内置CLI合同执行。初始化/插件安装、默认工作区和原生会话数据均在本次根内，workspace注册的真实路径已检查。未执行原生安装、升级或官方卸载。

正式聊天界面的Input.insertText/发送按钮触发本轮唯一marker；实际pwsh工具的唯一tool_use_id返回identified/dsh-desktop/native/instance/verified来源和完整ID，模型请求与界面ACK均核实。生产reader与真实ConPTY完成工具/完整ID筛选、完整命令/ref、原生指引、刷新选择；维护页真实worker安装/更新三侧技能；诊断页核实当前原生profile的活桥、静态插件和Harness技能副本一致。真实受控broker/node持有这条精确Desktop根会话，共享成员页复制带--tool dsh-desktop的完整TCP命令。48×16/140×36 resize及raw/监听/终端模式恢复通过。没有新增持久数据格式、用户命令或成员增强机制；C18专属增强仍另验。

最终应用正常Quit且C1关闭0；持有精确Host操作系统句柄观察退出0。没有观测私有shutdown-complete或停止升级，不能据此声称Host自然退出或使C2准入通过。最后三次原生运行分别通过维护诊断、加入真实成员页、再核实完整收尾；最终摘要仅采用round-OwE72q。早期失败均不追认为通过：第一次只等profile文件就Quit触发inactive-context错误，原始process JSON在引入分轮目录前被覆盖，保留明确标注的工具输出转录；首轮TUI使用旧ACK/无界debugger关闭，身份断言失败且C1超时，现存raw保留；下一轮错误使用隔离诊断环境，按设计检查home/.dsh而非显式DSH_HOME，改为与生产TUI一致的继承模式并锁定全部fixture路径。后续用唯一marker/tool_use_id排除历史工具结果，debugger关闭有界，各轮独立证据目录，清理失败不会跳过后续资源或提前报告通过。

[摘要](evidence/c09-desktop-20261104/validation.json)与[74项脱敏原始证据](evidence/c09-desktop-20261104/raw-evidence-redacted.zip)已归档，ZIP 119485字节，SHA-256=b082e72e23dddcea49d56a720e69bb1d9fa83cc52a59df4c1533a17bbbfb3f48，CRC/逐项SHA核对通过；排除native安装/profile/凭据与tui输入配置。归档前核实相关测试进程0、用户PATH无测试根。总根删除再次被自动审批以blocked by policy拒绝，未重试；用户随后手动删除，代理只读确认不存在，原DSH软件保留。此轮未触发Actions、写远端、派worker或改用户文档。

结合前述npm/Web来源、C10诊断ConPTY及既有共享TUI故障/取消证据，C09的DSH Windows基础TUI切片已验收，移出活动实施范围；其它工具与平台/CI继续按总表，不关闭整个C09父项。

## 2026-11-04 C11 Windows npm/Web本地从零序列

最终工装8137e1a，产品仍为e3b777e；root独立开发/自审，无worker或独立复审。新增独立六阶段探针、报告合同和手动workflow，复用原固定包摘要/pnpm与串行安装owner，C05默认入口及原八项通信检查保留。真实官方npm 0.2.1-rc.2基线→0.2.1-rc.5候选均六项通过，compatible/notify=false，无重试、外部Issue或Actions执行。各次原生Host/登记/run目录与串行安装根正常清理；loopback模型只给定固定工具调用，不使用个人key或证明模型智能。

六阶段覆盖官方profile/桥安装与三侧skill维护；原生skill工具完整返回当前正文；原生pwsh的verified来源与按实际hint双向回信；同源doctor文本/JSON及真实ConPTY列表、精确复制、维护默认取消/实际安装、真实broker/node成员页、resize/终端恢复；覆盖更新保留额外文件；停止Host后官方plugin remove，再crosschat uninstall，profile和两条真实聊天原始文件哈希保持。使用本地构建dist及随包skill/bridge源码，不冒充已发布crosschat npm包的安装验收。完整check退出0：**2732通过/11原有跳过，233文件通过/3跳过，lint/build及204模块688边检查通过**；最多2/最少1 worker，未启用live。脚本另做ESLint通过。

保留全部失效证据：首次成员复制工装等瞬时提示而非实际页/clipboard事件，前三项通过后失败；随后fixture.stop缺失，前四项通过，驱动stop/close同owner收口。两次原报告默认category=compatibility，不改写raw；调查确认为工装问题，没有生成外部报告。首个单版本成功遗漏TUI应用JSONL，因为run根先删除，未补造该文件；后续序列均在关闭前保存原始JSONL。Windows文件symlink fixture因EPERM失败，改为只注入文件系统link元数据，保留真实有效报告字节，不skip或放宽校验。

加强聊天保留检查后，直接在压缩字节查正文、一次性解压仅首帧的两轮基线/候选均在第六项失败，按infrastructure记录、baseline-failed/notify=false，全部清理。DSH聊天为zstd多帧追加；独立双帧诊断确认Node单次解压只消费首帧，最终通过公开info.bytesWritten逐帧核验、有总输出上限，并拒绝损坏尾部。4项内容与2项多帧反例先RED再GREEN；最终单版本及完整双版本均核实本轮skill/request/reply真实内容后，再做原始字节哈希比较，未放宽断言或改原生存储。

[摘要](evidence/c11-dsh-20261104/validation.json)与[202项脱敏原始证据](evidence/c11-dsh-20261104/raw-evidence-redacted.zip)归档，ZIP 945024字节，SHA-256=779568e4c0c0c3263dfdada90c2ea5e57e0d3b75a09b4403d26dd31ffb5365a6；CRC及逐项SHA核验通过。排除原生profile/凭据/聊天存储、安装包/runtime及npm缓存。归档后只读核实本轮相关进程0；独占安装/缓存总根自动删除被拒，原因仅blocked by policy，未换工具重试，用户随后手动删除，代理只读核实目录不存在，用户DSH软件保留。

C11的Windows npm/Web本地切片移出活动实施；新workflow只手动，报告job仅处理有界JSON、不checkout/执行原生代码、默认分支才有Issue写权限，并独立重核基线/同一候选两次失败/唯一运行身份/精确scope/完整清理及去重。离线反例含清理失败伪装兼容回归，不以summary自称regression直接发Issue。当前本地Node25.0.0，不能替代workflow的GitHub Node22首轮、定时、artifact读取和权限实证；C11其它工具/正式Desktop、C04完整生命周期及C00/C12三平台仍保留。托管集成边界见[前置核实](dsh-hosted-preflight-20261104.md)。未新增产品持久数据格式、命令参数或用户操作要求。
