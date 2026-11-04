# C04-I01：正式 Desktop 报告与生命周期编排

2026-10-29（UTC+8）。执行者为 Claude `cworker1`，root 为 Codex Desktop **多工具适配**。本任务独立可读；不要求旧聊天上下文。只执行本单，完成报告后停写，root 复审后继续派单。

## 授权与基线

用户已授权按既定顺序连续开发至人为喊停或必须拍板；技能文件可新增，其它新增功能文件或必需用户操作变化仍须拍板。本单复用既有脚本和测试，仅开发正式 Harness Desktop 的离线报告/编排核心；不新增功能文件，不改用户操作。正式桌面实际安装、UI、退出和卸载仍须独立干净 runner 验证，本单不在开发者机器执行这些动作。

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；真实派单基线以 root 消息的明确 SHA 为准。开工与结束核对 branch/HEAD/dirty。共享无关提交推进时，核对基线祖先及白名单无冲突后继续；不 checkout/pull/reset/clean/stash/amend/push，不回退他方文件归责，不全仓 stage。原未跟踪 `docs/代码消息投递.md` 不动、不 stage。

最小读取顺序：AGENTS.md、代码规范、本单、`tool-integration-standard.md` 中 INT-01/03/05/14/15、`dsh-integration-contract.md`、现有 `scripts/dsh-compat-ci.mjs` 与 `test/dsh-compat-ci.test.ts`。按需读现有 `dsh-compat.mjs` 与 fixture，不读整批历史。C08 默认三侧维护已验收，见相邻 `c08-worker-20261029/I01-final-review.md`；通信与来源产品改动归现有 Bug修复2，本单不认领。

## 产出和边界

现有工装明确是 npm/Web、`desktop:false`，不能把 profile 改名后充作 Desktop 已验证。请在同一既有编排模块内实现清晰独立的 Desktop 报告核验与串行生命周期入口，供下一单真实 runner 接入；先用注入的受控操作和临时报告验证它。不要先修改生产 Web 默认入口、既有报告范围或 reporter。

1. **新鲜且绑定本次。** 每个 Desktop attempt 使用独占报告位置和调用方生成的运行 ID。只接受正常退出、未超时、未截断、可解析且字段完整、与本次运行及待测发行物版本/身份相符的报告。Web 报告、旧报告、错误 run ID/版本/owner 或缺失必要证据必须拒绝。设计最小内部报告合同，并在交付说明写清字段及下一单如何消费，不把内部合同描述成已核实的上游 API。
2. **Desktop 范围单独表达。** 必需证据分别覆盖正式桌面发行物及内置 runtime/desktop profile、skill/插件加载、实际桌面 UI 收发与回信、Host 自然退出、官方卸载、桥登记与该安装新增系统注册的清理。报告必须关联同一安装/原生实例与具体会话，不能仅凭 `desktop:true` 或 Web 通过认定；字段校验只证明报告一致性，不是抗伪造或原生事实证明。缺 UI/卸载证据不得 PASS。
3. **生命周期。** 同一基线/候选串行：本次实例退出与官方卸载/注册清理确认后才允许后一次安装；无法核实释放、强杀、报告/进程不一致、卸载失败时保留本次归属、报基础设施/未核实并停止后续。不得为了清理删未知路径、扫描宿主或杀用户进程。不要让注入操作的抛错绕过必要收口，也不要在释放未知时盲调卸载。是否需要重试沿用现有同候选/同失败规则，不能重新解析漂移候选或因无证据重发业务消息。
4. **保留 Web。** 既有 npm/Web 函数、默认 CLI、报告校验、分类和 issue reporter 行为保持。可复用纯串行/校验逻辑，但不造通用平台框架，不用“接受所有 endpoint”放宽旧报告。只为眼前两个入口收敛必要重复。

验收是“离线 Desktop 工装核心完成”，不是 C04 通过。真实发行物下载器/安装器、UI driver、runner 接线与托管首轮尚未实现，必须列出，不制造桌面 PASS 原生证据。

## 白名单

- 既有 `scripts/dsh-compat-ci.mjs`
- 既有 `test/dsh-compat-ci.test.ts`
- 本目录可新增 `I01-review-input.md`、`I01-check.txt`，仅作开发证据

其它源码、helper、workflow、package/dependency、指南/skill、root 总表/调度/任务书、C08 记录和全部旧原始证据不改。本单不需要新参数、原生扩展、浏览器依赖或公共命令。若这两个既有文件无法清晰承载必要职责，先报具体新增文件及理由，不塞入无关模块或偷偷建功能文件。

## 实施与验证

按现有 npm/Vitest 做有意义 RED→GREEN：先保存业务断言失败 checkpoint，再实现同组通过并保存 GREEN checkpoint；不能只以导出不存在/TypeError作全部 RED。测试独占 fixture，不依赖真实用户目录、进程或网络。包含正常串行、Web/旧/错身份/缺 UI/缺卸载/异常退出报告拒绝、释放未知零后续安装、卸载抛错与多次 attempt 不复用报告。用可观察调用顺序和实际临时报告检验，不镜像内部状态，也不引入固定覆盖率门槛。

先跑本套件与相关 Web 工装回归、`node --check`、对应 ESLint/build，再一次完整 `npm run check`（max2/min1 forks 与 threads）。完整 stdout/stderr+真实退出码落 `I01-check.txt`，不 tail/过滤/覆写首败，不加 skip 或放宽原有语义。若首败不是本单，记录可证事实与未确认项，不把一次隔离通过写成根因证明。临时根删除前核对绝对路径、归属与受控进程关闭；正常无须子进程的场景不生新进程。

不安装/升级/卸载原生或全局工具，不读取用户 config/auth，不触碰注册表/协议，不启停 Desktop/Host/daemon，不访问模型/远端或真实试发，不 push 或触发 Actions。

## 回报与通信

只 commit 本单显式路径，新证据逐项 add，不夹带共享 index；使用当前 shell 正确引号，勿把 PowerShell `@` 标记写进 bash commit。报告基线/父提交/RED/GREEN、字段与保证→测试、真实验证与首败、改动文件、未测/下一步、清理。不要自行关闭 C04、领下一单或轮询。

固定用仓库 `node dist/cli.js send`，最新程序 hint 的 conversation+tool 保持，正文 stdin，`--delivery steer`。**不要用 Claude ListAgents/SendMessage 联系 Codex Desktop**。hint 缺 tool 时保留引用、只读核实收件类型；仅明确引用失效后，核实原 root 名称 **多工具适配**/完整 ID 与 `codex-desktop` 再恢复，不猜短柄，不因 queued/parked/unconfirmed 盲重发。收到本单后直接执行，不要求纯确认回信。
