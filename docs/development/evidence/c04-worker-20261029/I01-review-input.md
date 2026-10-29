# C04-I01 交付说明（供 root 审查）

执行 `cworker1`，分支 `codex/core-refactor-pre-tui`，派单基线 `7ecde0b139d8bafed3a0008eecdc14d8c3ccbae1`（开工与结束一致）。任务书 `I01-task.md`。只改白名单内两个既有文件，另新增本文件与 `I01-check.txt`。

验收口径是**“离线 Desktop 工装核心完成”**，不是 C04 通过：正式 Desktop 的下载、安装、UI 驱动、Host 退出、官方卸载与系统注册清理都还没有真实执行过，本单不产生任何桌面 PASS 的原生证据。

## 一、提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| RED | `b906c45` | `test/dsh-compat-ci.test.ts` 新增桌面报告与生命周期用例；`scripts/dsh-compat-ci.mjs` 只加 3 行临时别名（桌面入口先复用 Web 实现） |
| GREEN | `1125c90` | 独立桌面报告核验、串行生命周期入口、两条入口共用串行循环；删除临时别名 |

两提交均在本分支可达，未 squash、未 amend、未 push。

**RED 里为什么有 3 行临时别名**：桌面入口是新增能力，若不先让名字存在，RED 只会得到“导出不存在”的 TypeError。别名让 RED 跑在业务断言上，实测 7 项失败、16 项通过，失败原因都是业务语义：

- 合法的桌面报告被 Web 校验判为 `failed`（tool 名与 scope 不同）——`stage: 'probe-report'` 而非 `done`。
- `hasDesktopCleanupProof`（当时即 Web 的释放证明）对桌面清理记录返回 `false`（缺 `runtimeStopped`）。
- 桌面序列的汇总 `tool` 是 `dsh-web-runtime`，且 Web 校验拒绝桌面报告后序列停在第 1 次安装，调用序列明显短于期望。

GREEN 删除别名后同组 23/23 通过。

## 二、内部报告合同（Desktop）

这是**本单自定的内部合同**，不是已核实的上游 API。字段校验只证明报告与本次运行自洽，**不是抗伪造手段，也不是原生事实的证明**。

| 字段 | 要求 | 含义 |
| --- | --- | --- |
| `schema` | `1` | 合同版本 |
| `tool` | `dsh-desktop` | 与 Web 的 `dsh-web-runtime` 分开，Web 报告因此必然被拒 |
| `platform` / `arch` | `win32` / `x64` | 与现有工装一致 |
| `runId` | UUID v4，等于本次 attempt 由调用方生成的运行 ID | attempt 独占目录 + 调用方运行 ID，旧报告不会被读 |
| `version` | 等于待测发行物记录的 `version` | 版本绑定 |
| `artifactId` | 等于待测发行物记录的 `integrity`（SHA-512 SRI） | 发行物身份绑定；正式桌面发行物的身份由下一单的下载器给出 |
| `installationId` | UUID，等于本次安装记录的 `installationId` | 绑定同一次安装 |
| `owner` | 非空字符串，等于本次安装记录的 `owner` | 绑定桥/系统登记归属 |
| `instanceId` | UUID | 本次原生实例（由调用方每次启动生成） |
| `sessionId` | `[A-Za-z0-9._:-]{1,200}` | 本次收发与回信所用具体会话 |
| `status` / `stage` / `category` | `passed`→`stage: 'done'`、`category: null`；`failed`→slug `stage`（不得为 `done`）+ `category` 为 `compatibility` 或 `infrastructure` + slug `check` | 与既有 Web 报告同形，便于共用分类 |
| `checks` | 六项各出现一次、`status: 'passed'`、`elapsedMs` 有限非负；少项或重复即拒绝 | 逐项证据，缺 UI 或卸载即不可能 PASS |
| `scope` | 与桌面范围逐键相等 | 见下 |
| `cleanup` | `hostExited`、`uninstalled`、`registrationRemoved`、`systemRegistrationRemoved` 均为 `true`，`forced` 为 `false`，`errors` 缺省或空数组 | 释放证明：宿主自然退出、官方卸载、桥登记与本次安装新增的系统注册都已清理 |

`checks` 的六项（即“必需证据分别覆盖”的六个面）：

1. `formal-desktop-artifact-and-built-in-runtime-profile`——正式桌面发行物及其内置 runtime/desktop profile
2. `skill-and-plugin-loading`——skill 与插件加载
3. `desktop-ui-send-receive-and-reply`——实际桌面 UI 的发送、接收与回信
4. `host-natural-exit`——Host 自然退出
5. `official-uninstall`——官方卸载
6. `bridge-registration-and-system-registration-cleanup`——桥登记与本次安装新增系统注册的清理

`scope` 逐键固定为：`officialDesktopArtifact: true`、`builtInRuntimeProfile: true`、`skillAndPluginLoading: true`、`desktopUi: true`、`ordinaryWebSessions: false`、`browserUI: false`、`modelIntelligence: false`。Web 的 scope（含 `desktop: false`）与之不相等，所以“把 Web 报告改成 `desktop: true`”也进不来。

## 三、下一单如何消费

1. `install(artifact, label)` 返回 `{ root, installationId, owner }`；`installationId` 与 `owner` 必须由本次安装自己生成，是报告绑定的依据。
2. `probe` 内调用 `runDshDesktopAttempt({ output, label, artifact, installation }, execute)`：`execute` 负责启动正式 Desktop、驱动 UI 收发与回信、让 Host 自然退出、执行官方卸载与登记清理，然后把报告写到给定的 `reportPath`（`runId` 必须原样写进报告），并返回子进程结果。attempt 自带独占临时目录与运行 ID，陈旧/外来报告不会被读取。
3. 生命周期交给 `runDshDesktopSequence(builds, { install, probe, remove })`：只有报告证明释放完成后才会调用 `remove`；释放未证实时保留归属、记基础设施并终止后续安装，不会盲调卸载。`remove` 只应删自己拥有的目录。
4. `remove` 之外的收口步骤（退出、官方卸载、注册清理）由 runner 在 `execute` 内完成，本核心只认证据、不代替执行。
5. 分类沿用既有规则（同候选同失败才 `regression`），但 Desktop 目前**没有** issue reporter；`dshRegressionIdentity` 会拒绝桌面汇总（`tool` 与 `scope` 不同），下一单接线时再定，本单不扩 Web reporter。

## 四、保证 → 测试映射

| 保证 | 测试（`test/dsh-compat-ci.test.ts`） |
| --- | --- |
| 每个 attempt 用独占报告位置与调用方运行 ID；旧/外来/截断报告不被读 | 「ignores reports outside the exclusive attempt location and never reuses an earlier report」（含两次 attempt 路径不同、复用上一份报告被拒） |
| 只接受正常退出、未超时、可解析、字段完整、与本运行及发行物相符的报告 | 「accepts a fresh desktop report bound to this install, native instance, session and artifact」 |
| 拒绝 Web 报告、`desktop:true` 伪装、旧 run ID、错版本/发行物/安装/owner/实例/会话 | 「rejects web, stale, foreign and incomplete desktop evidence」（15 个反例逐一断言 `desktop-report` 基础设施失败且无 `cleanup`） |
| 缺 UI 或官方卸载证据不得 PASS | 同上：删掉 `desktop-ui-send-receive-and-reply` 或 `official-uninstall` 的用例，以及空 checks、重复 check、`stage` 非 `done` |
| 超时/被强杀/进程与报告不一致/执行器抛错都算释放未知 | 「keeps release unknown when the desktop session times out, is killed, disagrees or throws」 |
| 释放需宿主退出 + 官方卸载 + 两类注册清理，强杀不算 | 「requires the Host exit, official uninstall and both registration cleanups for desktop release」 |
| 严格串行：先释放再装候选；汇总 tool/scope 独立，不进 Web reporter | 「installs the candidate only after the released desktop baseline and stays out of the web reporter」（调用顺序、`tool`、`scope`、`regression` 汇总仍被 `dshRegressionIdentity` 拒绝） |
| 释放未知即保留归属、停止后续，不删未知路径、不扫描、不杀进程 | 「retains the first desktop installation and stops when release is unverified」（三种未释放形态下调用只有 `['baseline']`） |
| 注入操作抛错不绕过收口；卸载抛错保留归属；安装抛错不伪造归属 | 「never closes blindly after a thrown desktop operation and keeps ownership when the close fails」 |
| Web 入口与桌面入口互不接受对方报告 | 「keeps the web entry closed to desktop reports and the desktop entry closed to web reports」 |

既有 Web 行为保持：`runDshBuildSequence` 改为消费同一个串行循环（`serialSequence`），过程阶段仍为 `probe-process`、报告阶段仍为 `probe-report`、释放证明仍为 `hasDshRuntimeReleaseProof`、错误文案与调用顺序不变；原有 12 个 Web/工装/reporter 用例未改并全部通过。

## 五、实际改动

- `scripts/dsh-compat-ci.mjs`：新增桌面常量（`desktopTool`/`desktopChecks`/`desktopScope`）、`validDesktopReport`、`desktopFailure`、`desktopExpectation`、`hasDesktopCleanupProof`、`runDshDesktopAttempt`、`runDshDesktopSequence`；把原 `runDshBuildSequence` 的循环抽为私有 `serialSequence`，两入口共用。未改 `main()`、默认 CLI、Web 报告校验、分类与 workflow reporter。
- `test/dsh-compat-ci.test.ts`：新增 `formal desktop report and lifecycle` 一组 9 个用例；GREEN 中修正该组自身一处反例（错版本原写 `0.2.2`，恰好等于候选版本，改为 `0.3.0`），这是测试缺陷不是产品让步。
- 证据：本文件、`I01-check.txt`。

未改：`docs/代码消息投递.md`（仍为原未跟踪，未 stage）、workflow、根任务书与 C08/C13 记录。

## 六、验证

- 定向：`npx vitest run test/dsh-compat-ci.test.ts`（max2/min1 forks、max2/min1 threads）**23/23 通过**；RED 时为 7 失败 / 16 通过。
- `node --check scripts/dsh-compat-ci.mjs` 通过；`npm run lint` 无输出；`npm run check:imports` 203 模块 / 682 边无环无边界违规；`npm run build`（tsc）通过。
- 完整：GREEN 后一次 `npm run check`，`VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`，未筛套件、未加 skip、未放宽断言。完整 stdout/stderr 与真实退出码见 `I01-check.txt`（356 行，原样保存）。结果 **退出码 0**：231 文件通过 / 3 跳过；**2553 项通过 / 11 跳过**（较基线 2544 增加 9，即本单新增用例）。跳过均为 `test/live/*` 既有实网用例。
- 首败：本轮完整检查一次通过，没有首败需要记录。

## 七、未实现 / 未测（下一单清单）

- 正式桌面发行物的下载器与校验器（本单只按“发行物记录的 version + integrity”绑定，发行物形状由下一单定义）。
- 安装器、桌面 UI driver（真实 UI 收发与回信）、Host 自然退出的实际执行、官方卸载与系统注册/协议清理的实际执行。
- runner 接线：`main()` 里还没有 Desktop 入口，`CROSSCHAT_LIVE` 实跑路径未接；托管 runner 首轮、定时与 artifact/report 链未做。
- 未安装或启停 Desktop/Host、未触碰注册表/协议、未读用户配置或鉴权、未访问模型/远端、未真实试发；未 push、未触发 Actions。
- 报告字段只证明自洽；跨平台（Windows x64 以外）未涉及。
- 桌面汇总目前没有 issue reporter，`regression` 结果只会留在汇总里。

## 八、清理

全部用例使用用例独占临时目录（`mkdtemp`）并在结束时删除；`runDshDesktopAttempt` 的独占目录落在用例给定的 `output` 内。未写用户目录、未启动包管理器、未留下调试脚本或后台进程。
