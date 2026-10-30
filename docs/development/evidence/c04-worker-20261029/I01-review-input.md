# C04-I01 交付说明（供 root 审查）

执行 `cworker1`，分支 `codex/core-refactor-pre-tui`，派单基线 `7ecde0b139d8bafed3a0008eecdc14d8c3ccbae1`（开工与结束一致）。任务书 `I01-task.md`。只改白名单内两个既有文件，另新增本文件与 `I01-check.txt`。

**R1 返修（2026-10-29，基线 `209e9a6c9ff4f446dec2d30fc220f06b8a22b6d6`，任务书 `I01-R1-task.md`，审查 `I01-review.md`）**：本文件已按 R1 订正首轮过宽表述，并追加 R1 实际保证与调用方法（见「九、R1 返修」）。R1 只改 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts` 与本文件，新增 `I01-R1-check.txt`；`I01-check.txt` 原样保留，不重复、不改写。

**R2 返修（2026-10-30，基线 `699753ad3039562d397ca076658dc95595b5481b`，任务书 `I01-R2-task.md`）**：收口 R1 复审剩余两项 P2（UUID 类型先验、失败归属完整），见「十、R2 返修」。R2 只改同样两个功能文件与本文件，新增 `I01-R2-check.txt`；此前日志均原样保留。

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
| `runId` | UUID v4，必须**逐字等于**调用方本次交给该 attempt 的运行 ID | R1 前只验格式，sequence 也不绑定本次运行；现在 sequence 每次 attempt 现场生成 `context.runId` 交给 probe，报告不一致即拒 |
| `version` | 等于待测发行物记录的 `version`；内部记录与报告两侧都先验类型/形状再比较 | 版本绑定；两侧同为 `undefined` 不再算相等 |
| `artifactId` | 报告侧必须是非空字符串且为 SHA-512 SRI 形状，并与发行物记录的 `integrity` 相等 | 发行物身份绑定；正式桌面发行物的身份由下一单的下载器给出 |
| `installationId` | UUID，等于本次安装记录的 `installationId`，且**每次 attempt 不得复用** | 绑定同一次安装；sequence 用集合拒绝跨 attempt 复用同一安装身份 |
| `owner` | 非空字符串，等于本次安装记录的 `owner` | 绑定桥/系统登记归属 |
| `instanceId` | UUID，**必须等于调用方 launch 记录中的实例**；sequence 层另要求各 attempt 互不相同 | 本次原生实例；attempt 内对账（对账边界见九·2） |
| `sessionId` | `[A-Za-z0-9._:-]{1,200}`，**必须等于调用方 launch 记录中的会话** | 本次收发与回信所用具体会话 |
| `status` / `stage` / `category` | `passed`→`stage: 'done'`、`category: null`；`failed`→slug `stage`（不得为 `done`）+ `category` 为 `compatibility` 或 `infrastructure` + slug `check` | 与既有 Web 报告同形，便于共用分类 |
| `checks` | 六项各出现一次、`status: 'passed'`、`elapsedMs` 有限非负；少项或重复即拒绝 | 逐项证据，缺 UI 或卸载即不可能 PASS |
| `scope` | 与桌面范围逐键相等 | 见下 |
| `cleanup` | `hostExited`、`uninstalled`、`registrationRemoved`、`systemRegistrationRemoved` 均为 `true`，`forced` 为 `false`，`errors` 缺省或空数组；**PASS 报告必须携带完整且肯定的 cleanup** | 释放证明：宿主自然退出、官方卸载、桥登记与本次安装新增的系统注册都已清理；缺失/未知/强杀不得 PASS，也不能供后续删除 |
| 执行器结果 `process` | `timedOut === false`、`signal === null`、`code` 为 0/1，且**显式 `truncated === false`** | 输出被截断或未声明完整性即视为释放未知；attempt 返回的 `process` 保留 `truncated: false` 事实 |

`checks` 的六项（即“必需证据分别覆盖”的六个面）：

1. `formal-desktop-artifact-and-built-in-runtime-profile`——正式桌面发行物及其内置 runtime/desktop profile
2. `skill-and-plugin-loading`——skill 与插件加载
3. `desktop-ui-send-receive-and-reply`——实际桌面 UI 的发送、接收与回信
4. `host-natural-exit`——Host 自然退出
5. `official-uninstall`——官方卸载
6. `bridge-registration-and-system-registration-cleanup`——桥登记与本次安装新增系统注册的清理

`scope` 逐键固定为：`officialDesktopArtifact: true`、`builtInRuntimeProfile: true`、`skillAndPluginLoading: true`、`desktopUi: true`、`ordinaryWebSessions: false`、`browserUI: false`、`modelIntelligence: false`。Web 的 scope（含 `desktop: false`）与之不相等，所以“把 Web 报告改成 `desktop: true`”也进不来。

## 三、下一单如何消费

1. `install(artifact, label)` 返回 `{ root, installationId, owner }`；`installationId` 与 `owner` 必须由本次安装自己生成且**每次 attempt 不重复**，是报告绑定的依据。若安装已产生自有资源后抛错，请在错误上挂结构化归属 `error.installation = { root: <绝对路径>, installationId, owner }`：sequence 会把它记进 `retainedInstallation`（含 `label`/`version`/`reason`）并停止；没有该结构时按**如实未知**处理，不会凭错误文本猜路径。
2. `probe(installation, artifact, label, context)` 内调用
   `runDshDesktopAttempt({ output, label, artifact, installation, launch, runId: context.runId }, execute)`：
   `execute` 负责启动正式 Desktop、驱动 UI 收发与回信、让 Host 自然退出、执行官方卸载与登记清理，然后把报告写到给定的 `reportPath`（`runId` 必须原样写进报告），并返回子进程结果（含 `truncated`）。`launch` 是调用方**启动前确定**的 `{ instanceId, sessionId }`，必须来自启动步骤而不是报告回抄；缺任一项 attempt 直接抛错，不降级为“任意合法值”。
3. 生命周期交给 `runDshDesktopSequence(builds, { install, probe, remove })`：sequence 每次 attempt 现场生成 `runId` 放入 `context` 交给 probe，并校验回来报告与该 runId、本次 `installationId`/`owner` 相等，且各 attempt 的安装身份与实例身份互不重复；只有报告证明释放完成后才会调用 `remove`；释放未证实时保留归属、记基础设施并终止后续安装，不会盲调卸载。`remove` 只应删自己拥有的目录。
4. `remove` 之外的收口步骤（退出、官方卸载、注册清理）由 runner 在 `execute` 内完成，本核心只认证据、不代替执行。
5. 分类沿用既有规则（同候选同失败才 `regression`），但 Desktop 目前**没有** issue reporter；`dshRegressionIdentity` 会拒绝桌面汇总（`tool` 与 `scope` 不同），下一单接线时再定，本单不扩 Web reporter。

## 四、保证 → 测试映射

| 保证 | 测试（`test/dsh-compat-ci.test.ts`） |
| --- | --- |
| 每个 attempt 用独占报告位置；旧/外来/截断报告不被读 | 「ignores reports outside the exclusive attempt location and never reuses an earlier report」（含两次 attempt 路径不同、复用上一份报告被拒） |
| 只接受正常退出、未超时、输出未截断、可解析、字段完整、与本运行及发行物相符的报告 | 「accepts a fresh desktop report bound to this install, native instance, session and artifact」 |
| 拒绝 Web 报告、`desktop:true` 伪装、旧 run ID、错版本/发行物/安装/owner、格式非法的实例/会话、缺 cleanup（15 个反例逐一断言 `desktop-report` 基础设施失败且无 `cleanup`） | 「rejects web, stale, foreign and incomplete desktop evidence」——**首轮表述订正**：当时并没有“格式合法但与调用方期望不同”的实例/会话反例，也没有把 sequence 的 runId 绑进 attempt；这两点由 R1 补齐（见九） |
| 缺 UI 或官方卸载证据不得 PASS | 同上：删掉 `desktop-ui-send-receive-and-reply` 或 `official-uninstall` 的用例，以及空 checks、重复 check、`stage` 非 `done` |
| 超时/被强杀/输出截断/进程与报告不一致/执行器抛错都算释放未知 | 「keeps release unknown when the session times out, is killed, truncates output or disagrees」 |
| 释放需宿主退出 + 官方卸载 + 两类注册清理，强杀不算 | 「requires the Host exit, official uninstall and both registration cleanups for desktop release」 |
| 严格串行：先释放再装候选；汇总 tool/scope 独立，不进 Web reporter | 「installs the candidate only after a released baseline bound to this run」与「keeps the desktop summary out of the web reporter」——**首轮表述订正**：原用例只证明“释放后才装候选”，未证明候选用的是本次 run/安装身份；R1 补上 runId 与安装身份绑定后，该用例才同时覆盖两者 |
| 释放未知即保留归属、停止后续，不删未知路径、不扫描、不杀进程 | 「retains the first desktop installation and stops when release is unverified」（三种未释放形态下调用只有 `['baseline']`） |
| 注入操作抛错不绕过收口；卸载抛错保留归属；安装抛错不伪造归属 | 「never closes blindly after a thrown desktop operation and keeps ownership when the close fails」 |
| Web 入口与桌面入口互不接受对方报告 | 「keeps the web entry closed to desktop reports and the desktop entry closed to web reports」 |

既有 Web 行为保持：`runDshBuildSequence` 改为消费同一个串行循环（`serialSequence`），过程阶段仍为 `probe-process`、报告阶段仍为 `probe-report`、释放证明仍为 `hasDshRuntimeReleaseProof`、错误文案与调用顺序不变；原有 12 个 Web/工装/reporter 用例未改并全部通过。

## 五、实际改动

- `scripts/dsh-compat-ci.mjs`：新增桌面常量（`desktopTool`/`desktopChecks`/`desktopScope`）、`validDesktopReport`、`desktopFailure`、`desktopExpectation`、`hasDesktopCleanupProof`、`runDshDesktopAttempt`、`runDshDesktopSequence`；把原 `runDshBuildSequence` 的循环抽为私有 `serialSequence`，两入口共用。未改 `main()`、默认 CLI、Web 报告校验、分类与 workflow reporter。
- R1 追加（详见九）：`desktopReportMaxBytes`/`desktopSessionId` 常量、`knownDesktopArtifact`、`desktopBinding`、有界读取 `readDesktopReport`、`intactProcess`/`desktopProcessMatches`、`desktopPartialInstallation`；`validDesktopReport` 改为先验形状后比较、PASS 必须带完整 cleanup；`runDshDesktopAttempt` 增加调用方 `launch` 与 `runId` 期望；`serialSequence` 增加 `context` 与安装抛错的结构化归属收口。
- R2 追加（详见十）：`desktopIdentity` 字符串投影供 `desktopBinding`/`desktopPartialInstallation`/`retainedIdentity` 共用；`validDesktopReport` 对 `runId`/`installationId`/`instanceId` 先验字符串；`serialSequence` 三处 `retainedInstallation` 收敛为 `retain(reason, error)` 并按入口投影身份（Web 无投影，形状不变）。
- `test/dsh-compat-ci.test.ts`：新增 `formal desktop report and lifecycle` 一组 9 个用例；GREEN 中修正该组自身一处反例（错版本原写 `0.2.2`，恰好等于候选版本，改为 `0.3.0`），这是测试缺陷不是产品让步。
- 证据：本文件、`I01-check.txt`、`I01-R1-check.txt`、`I01-R2-check.txt`。

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

## 九、R1 返修（C04-I01-R1）

派单基线 `209e9a6c9ff4f446dec2d30fc220f06b8a22b6d6`，任务书 `I01-R1-task.md`，独立审查 `I01-review.md`。只做离线工装收口，不接真实 Desktop。

### 1. 提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| 基线 | `209e9a6` | root 双轴复审未通过（Standards 2 项 + Spec 4 项） |
| RED | `13b34ef` | 只改 `test/dsh-compat-ci.test.ts`：桌面用例组重写为 R1 反例 |
| GREEN | `d406392` | 只改 `scripts/dsh-compat-ci.mjs` 与一处测试 lint：六项缺口的最小实现 |

RED 实测 **9 失败 / 20 通过**，失败全部是业务断言（`AssertionError`），没有以 missing export / TypeError 代替：

1. attempt 返回的 `process` 只有 3 个键，缺 `truncated`。
2. 格式合法但与调用方期望不同的实例/会话仍 PASS。
3. 缺整个 `cleanup` 的报告仍 PASS。
4. 2 MiB 的合法 JSON 报告仍 PASS。
5. 两侧都缺发行物身份时仍 PASS，且不抛错。
6. 执行器明示 `truncated:true` 仍 PASS。
7. sequence 复用旧 runId 仍推进候选并给 `compatible`。
8. 同一安装身份跨 attempt 复用仍推进到 `remove:candidate`。
9. 部分安装抛错后 `retainedInstallation` 为 `undefined`。

GREEN 同组 **29/29 通过**。

### 2. 六项缺口 → 修复 → 反例

| 缺口（审查项） | 修复 | 覆盖反例 |
| --- | --- | --- |
| Spec 1：实例/会话只验格式，sequence 不绑本次 runId | `desktopExpectation` 要求调用方 `launch`（`instanceId`/`sessionId`）与 `runId` 全部合法，并逐字相等；`runDshDesktopAttempt` 缺期望直接抛错（不降级为任意合法值）。`serialSequence` 新增 `config.context`：sequence 每次 attempt 现场生成 `runId`，作为第 4 参数交给 probe 并用于校验；`installations`/`instances` 集合拒绝跨 attempt 复用安装或实例身份 | 「binds the report to the caller launch instead of the report claim」（不同但合法的实例/会话各一条 + 缺 launch 抛错）；「installs the candidate only after a released baseline bound to this run」（旧 runId 停在第 1 次安装）；「refuses to reuse an installation identity across attempts」 |
| Spec 2：install 产生自有资源后抛错丢归属 | `serialSequence` 在 install 外层 try/catch 调 `config.partialInstallation(error)`（桌面实现 `desktopPartialInstallation`：要求绝对 `root` + UUID `installationId` + 非空 `owner`），成立即写 `summary.retainedInstallation = { label, version, root, installationId, owner, reason }` 再 rethrow；无结构则如实未知，不凭错误文本猜目录，也不调用 probe/remove | 「keeps the owned root of a partially created installation that throws」（真实临时根 + marker；断言根与 marker 未删、归属出现在 summary、probe/remove 零调用） |
| Spec 3：`truncated:true` 仍 PASS、缺 cleanup 仍 PASS | `intactProcess` 要求 `normalProcess` 且 `truncated === false`；attempt 返回的 `process` 保留 `truncated: false`；`validDesktopReport` 的 PASS 分支要求 `hasDesktopCleanupProof(report.cleanup)` | 「keeps release unknown when the session times out, is killed, truncates output or disagrees」（`truncated:true`、缺 `truncated`）；「rejects web, stale, foreign and incomplete desktop evidence」（加 `cleanup: undefined` 一条，共 17 个反例） |
| Standards 1：两侧缺 `artifactId` 因 `undefined === undefined` 而 PASS | `knownDesktopArtifact` 先验调用方记录（非空 `version` + SRI `integrity`），不成立则 attempt 抛错；报告侧要求 `artifactId` 是非空字符串且为 SRI 形状后才做相等比较 | 「never binds two missing artifact identities」 |
| Standards 2：整文件无预算读取 | `readDesktopReport`：`lstat` 预检普通文件/非链接/≤1 MiB → `open` 后 `handle.stat()` 复核 → 循环每次最多读 `预算+1-total` 字节，累计超预算即抛；解析前完成，不“读完再查 length”，预检后继续增长也突破不了预算 | 「rejects a well formed report above the read budget and keeps release unknown」（2 MiB 合法 JSON） |
| Spec：交付证据过宽 | 本文件订正第二节与第四节的首轮表述，并加本节 | — |

### 3. 调用方法与信任边界

- attempt：`runDshDesktopAttempt({ output, label, artifact, installation, launch, runId }, execute)`。`launch = { instanceId, sessionId }` 必须来自**启动准备步骤**，`runId` 由调用方（sequence 的 `context`）给定；缺任一合法值即抛错。
- **可信回传边界**：sequence 看不到 launch 记录（实例/会话在启动后才产生），所以 sequence 层只做 runId/`installationId`/`owner` 逐字绑定、安装与实例身份互不相同、报告形状与释放证明；实例/会话与调用方期望的逐字相等在 attempt 内执行。launch 记录不得从报告回抄，否则就是同一份报告自证。
- 字段变化：attempt 输入新增 `launch`、`runId`，返回 `process` 增 `truncated: false`；`probe` 新增第 4 参数 `context`（Web 入口不传，行为与调用顺序不变）；失败报告仍可带真实原因，但不含 `cleanup`，不会被当作已释放。

### 4. 验证

- 定向：`npx vitest run test/dsh-compat-ci.test.ts`（max2/min1 forks、max2/min1 threads）GREEN **29/29**；RED 9 失败 / 20 通过。
- `node --check scripts/dsh-compat-ci.mjs` 通过；`npm run lint` 首轮报 2 个 `no-unused-vars`（某用例的 install 两个参数都未用），改为无参 install 后 **0**；`npm run check:imports` 203 模块 / 682 边；`npm run build`（tsc）通过。
- 完整：GREEN 后一次 `npm run check`（`VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`，未筛套件、未加 skip、未放宽断言），完整 stdout/stderr 与真实退出码见 `I01-R1-check.txt`（361 行，原样保存）。结果：**退出码 0**，231 文件通过 / 3 跳过，**2559 项通过 / 11 跳过**（较基线 2553 增加 6，即本单新增用例），导入图 203 模块 / 682 边。
- 首败：本轮完整检查一次通过，没有首败需要记录；未因任何失败改写或覆盖该文件。

### 5. 未测 / 清理

- `七、未实现 / 未测` 的整张清单仍然有效：本单只修离线工装，没有下载/安装/UI/注册/用户状态/模型/远端动作。
- R1 未单列反例：“报告是链接或非普通文件”由 `readDesktopReport` 的 `lstat` + `isFile` + 打开后复核拒绝，但未写成用例（在 Windows 建链需要额外权限）；“预检之后文件继续增长”同理只靠有界循环保证，没有做并发写入的时间竞态用例。
- 清理：全部用例使用独占临时目录（`mkdtemp` + 结束时删除），部分安装用例的根也落在该临时目录内；顺带删除了首轮遗留的未跟踪调试产物 `test/.dsh-compat-ci.head.tmp`（未 stage、未提交），未触碰 `docs/代码消息投递.md`。

## 十、R2 返修（C04-I01-R2）

2026-10-30。基线 `699753ad3039562d397ca076658dc95595b5481b`（用户恢复后 root 续档），任务 `I01-R2-task.md`，收口 `I01-R1-review.md` 剩余 Standards/Spec 各 1 项 P2。仍只做离线工装，不接真实 Desktop。

### 1. 提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| 基线 | `699753ad` | root 复审暂停检查点之后的恢复提交 |
| RED | `9c83614` | 只改 `test/dsh-compat-ci.test.ts`：数组 UUID 与完整归属反例 |
| GREEN | `807443d` | 只改 `scripts/dsh-compat-ci.mjs`：类型先验与归属投影的最小实现 |

RED 实测 **4 失败 / 30 通过**，全部业务断言：数组 `installationId`（字符串化后恰为合法 UUID）的序列仍推进 remove 与候选安装；释放未知 / probe 抛错 / remove 抛错三种 `retainedInstallation` 都缺 `installationId`/`owner`（probe 抛错还缺真实 reason）。同组内“两个分别新建但装同一 UUID 的数组绕过实例去重”与“相同字符串实例仍拒”随首条断言一并生效；Web 形状守护用例今日即通过（守护性质）。GREEN 同组 **34/34 通过**。

### 2. 两项保证 → 修复 → 反例

**UUID 先验字符串。** 新增 `desktopIdentity(installation)`：`installationId` 必须 `typeof === 'string'` 且匹配 UUID、`owner` 为非空字符串；`desktopBinding`（`runId` 同样先验字符串）、`desktopExpectation`（`launch.instanceId`）、`validDesktopReport`（`report.runId`/`report.installationId`/`report.instanceId`）与 `desktopPartialInstallation` 全部走同一投影或同样先验，数组等非字符串一律拒绝，不经 Set、stringify 或强转认可。反例：「rejects array UUID identities and never lets equal arrays bypass instance dedup」——数组 `installationId` 的序列在第 1 次 attempt 即停（零 remove、无候选安装）；两个分别新建但装同一 UUID 的数组实例同样在 baseline 被拒；相同字符串实例重复仍拒、合法字符串序列照常 compatible（既有用例保持）。Web 载荷合同未动（`validReport` 的 runId 正则原样）。

**已知失败归属完整。** `serialSequence` 的三处 `retainedInstallation` 收敛为 `retain(reason, error)`：`{ label, version, root, reason }` 加 `config.retainedIdentity(installation, error)` 投影。Web 不配置该投影，记录形状与文案逐字节不变（新守护用例 `toEqual` 全等断言）。Desktop 投影：`desktopIdentity` 有效时补 `installationId`/`owner`；probe 抛错时 `reason` 覆写为真实错误文本（释放未知且无抛错保留原“release unknown”文案；remove 抛错时 reason 本就是真实错误）；无有效身份不伪造、不从错误文本猜路径。反例（均真实独占临时根 + marker）：释放未知 → 调用只有 `['install','probe']`、`retainedInstallation` 含 root/installationId/owner/label/version、marker 未被工装删除；probe 抛错 → 同上且 `reason` 为 `desktop driver crashed mid-session`；remove 抛错 → `['install','probe','remove']`、`reason` 为 `Official uninstall refused`、身份完整。结构化部分安装失败路径不回退（既有用例保持）。

### 3. 字段与边界

- Desktop `retainedInstallation` 为 `{ label, version, root, reason, installationId, owner }`（身份可得时）；Web 维持 `{ label, version, root, reason }`。
- Desktop 下 probe 抛错时 `summary.error` 同步为真实抛错文本（随覆写后的 reason 抛出）；Web 的 `summary.error` 文案不变。
- 不扩第三项研究：打开报告后的 dev/ino 预检-句柄一致性维持 R1 复审“未动态复现风险”的定位，本单未整改也未当作已证实问题。

### 4. 验证

- 定向：`npx vitest run test/dsh-compat-ci.test.ts`（max2/min1）GREEN **34/34**；RED 4 失败 / 30 通过。
- `node --check`、`npm run lint`（0）、`npm run check:imports`（203 模块 / 682 边）、`npm run build` 通过。
- 完整：GREEN 后一次 `npm run check`（forks/threads 均 max2/min1，未筛套件、未加 skip、未放宽断言），完整 stdout/stderr 与真实退出码见 `I01-R2-check.txt`（357 行，原样保存）。结果：**退出码 0**，231 文件通过 / 3 跳过，**2564 项通过 / 11 跳过**（较 R1 的 2559 增加 5，即本单新增用例），导入图 203 模块 / 682 边。
- 首败：本轮完整检查一次通过，没有首败需要记录；未因任何失败改写或覆盖该文件。

### 5. 未测 / 清理

- 未单列反例：attempt 层报告 `runId`/`installationId` 为数组（JSON 往返已使引用不相等，类型收口由 sequence 层反例与 `validDesktopReport` 先验共同覆盖）；dev/ino 一致性见上节定位。
- 清理：三个新用例均使用独占 `mkdtemp` 临时根（含 marker 文件）并在结束时删除，删除前以绝对路径断言归属；无新增调试产物，未触碰 `docs/代码消息投递.md`。
