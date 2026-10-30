# C04-I02 交付说明（供 root 审查）

执行 `cworker1`，分支 `codex/core-refactor-pre-tui`，派单基线 `dc983f7f3711a113bdb6d62b2777dafbb2e5ee2b`（开工核对：branch/HEAD/dirty 一致，工作区仅原未跟踪 `docs/代码消息投递.md`，未动未 stage）。任务书 `I02-task.md`。只改白名单内三个既有功能文件，另新增本文件与 `I02-check.txt`。

验收口径是**「官方 Desktop 元数据投影 + 流式下载/校验组件完成」**，不是 C04 通过，也不是官方二进制已验证：本轮只用受控 fetch 响应、独占临时目录与注入 fixture 验证，**没有实际下载、写入或执行任何官方二进制**。

**R1 返修（2026-10-30，基线 `bb40ce93322fe70175e4305df9379f92eb13006b`，任务书 `I02-R1-task.md`，双轴审查 `I02-review.md`）**：root 首轮复审未通过（Standards 4 项最高 P1、Spec 4 项 P2，均有实测复现）。本文件第二节与第三节中「任何失败都释放…」「清理失败在原始错误上附加…」及 URL 前缀/子串校验的表述**首轮过宽**，已由 R1 收口，订正与实际保证见「八、R1 返修」。R1 只改 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts` 与本文件，新增 `I02-R1-check.txt`；`I02-check.txt` 及其末尾尾空格属原始证据，原样保留不改。

## 一、提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| RED | `f14d3f4` | `test/dsh-compat-ci.test.ts` 新增桌面安装包投影与流式校验一组 5 用例；`scripts/dsh-compat-baseline.json` 增 `desktopWindows` 节（五字段固定自研究记录）；`scripts/dsh-compat-ci.mjs` 只加两个空占位导出 |
| GREEN | `c2a2e2f` | `parseDshDesktopWindowsManifest` 与 `downloadDshDesktopInstaller` 最小实现；**删除占位**（任务书允许的显式占位，仅用于让 RED 落在业务断言） |

RED 实测 **5 失败 / 35 通过**，失败全部是业务断言（`AssertionError: expected undefined to deeply equal …` 与 `promise resolved "undefined" instead of rejecting`），没有任何 missing-export / TypeError / ReferenceError 充当 RED。GREEN 同组 **40/40 通过**。两提交均显式路径提交，未 push、未 amend。

## 二、API 与输出

### `parseDshDesktopWindowsManifest(input, platform, arch)`（元数据投影）

unknown 输入按序校验：record 形状与字符串 semver 版本 → 已批准 `>=0.2.1-rc.2 <0.3.0-0` 窗口（复用既有 `semver`/`supported`，窗口外抛 `category:'unsupported'`）→ `platform==='win32' && arch==='x64'` → feed 与 url 都必须是 `https://download.deepseek.com`、无凭据/query/fragment、路径分别在 `/dsh-desk/feeds/win-x64/` 与 `/dsh-desk/bin/win-x64/` 下且无 `latest` 段 → 文件名（URL 末段）包含该版本、不含 `\/:` → `size` 为正安全整数且 ≤512MiB → `sha512` 为规范 64 字节 base64（`85 字符 + [AQgw] + '=='`）。（**R1 订正**：本段"路径前缀+文件名包含版本"的校验首轮过宽——`.txt`/`:8443`/子目录/`rc.22` 子串伪装与数组 sha512 均可混入；现行为精确模板等值+sha512 字符串先验，见「八」。）返回 `{ version, url, size, integrity: 'sha512-<base64>', filename }`——`version` + SRI 形 `integrity` 正是 I01 `knownDesktopArtifact` 需要的发行物身份，可直接交给 `runDshDesktopAttempt` 的 artifact 上下文。

### `downloadDshDesktopInstaller(artifact, { directory, signal, timeoutMs = 120000, fetchImpl = globalThis.fetch })`（流式下载并校验）

公共边界先经内部 `desktopInstallerPlan` **重新独立校验**投影（版本/窗口/URL/文件名一致性/size/SRI），再要求 `fetchImpl` 可调用、`timeoutMs` 正整数、`directory` 绝对路径——**没有任何默认目录/cache/系统 TEMP**。fetch 以 `redirect:'error'` + 内部 deadline signal 发起；非成功/无 body 拒绝；`Content-Length` 可缺省，存在时须严格十进制且等于固定 size。以 `wx` 在 `join(directory, filename)` 创建文件（EEXIST 即失败、原文件字节不动），逐块增量 SHA-512 与写盘（不 Buffer.concat 整包），累计超 size 即拒；流结束且字节数与摘要都等于固定元数据才返回 `{ path, filename, version, size, integrity }`。任何失败都释放自己创建的 body reader（cancel）、文件句柄（close）、timer 与 signal listener，并只删除**本次成功创建**的未完成文件；清理失败在原始错误上附加 `partialFile`/`cleanupError`，不替换原始错误。（**R1 订正**：本句首轮过宽——假值失败不触发清理、cancel/close/rm 等待无界、`bytesWritten` 未核对、成功路径吞掉 close 失败；现行为：失败判定不依赖异常真值、全部收口有界、每块写全量且 close 确认后才成功、close 未确认时保留 partial 并如实报告，见「八」。）总期限与外部取消经由同一内部 AbortController，头部等待与每个 body read 都与 deadline race——超时/取消不返回可安装路径。返回值只证明**传输字节与固定元数据一致**，不证明 Authenticode 发布者、安装成功或 Desktop 功能（docstring 同句声明）。

## 三、保证 → 反例（任务书六条）

| 保证 | 测试（`test/dsh-compat-ci.test.ts` 新 describe） | 结果 |
| --- | --- | --- |
| 1. baseline 增独立 `desktopWindows` 节，五字段固定自研究记录；旧 package/packageManager 保持 | 「projects the pinned research metadata…」读取真实 `scripts/dsh-compat-baseline.json` 断言固定投影（含 size 289385456 与固定 sha512）；既有用例继续对 `pinned.package`/`pinned.packageManager` 全等断言 | 通过 |
| 2. 元数据先按 unknown 检查：明确 win32/x64、字符串版本与批准窗口、官方 HTTPS 精确版本化路径（禁 latest/query/fragment/凭据/其它主机）、size 正安全整数 ≤512MiB、sha512 规范 64 字节 base64；输出五字段；不把 Web 包当 Desktop 包 | 同用例：窗口内 `0.2.2` 通过、`0.2.1-rc.1`/`0.3.0-0` 抛 unsupported；linux/arm64 拒；23 条反例逐条抛错（latest 路径、query、fragment、token 凭据、http、registry.npmjs.org Web 包、mac-arm64 路径、目录外路径、http/异主机 feed、size 0/-1/1.5/字符串/512MiB+1、sha512 非法/过短/带前缀、版本 latest/数字/非 semver）；`pinned.package` 与 Web `artifact()` 直接拒 | 通过 |
| 3. 流式+增量 SHA-512、总期限、最多 size 字节、不整包缓冲；拒绝重定向/非成功/无 body；Content-Length 可缺省、存在须严格十进制且等于固定 size；字节与摘要一致才返回；记录只证明传输一致 | 「streams the exact pinned bytes…」分块写入字节全等、缺省 Content-Length 成功、`redirect:'error'` 实测；「rejects redirect, error and missing-body…」302/404/500/无 body、错值/`+36`/`0x24` Content-Length、超量、截断、同尺寸错摘要，全部拒绝且目录为空 | 通过 |
| 4. 调用方独占绝对目录、无任何默认值；文件名来自校验过的元数据；wx 创建不覆盖；失败只清本次创建文件并释放 reader/句柄/timer/listener；EEXIST 原文件字节不变；清理失败如实附加不替换 | 「never overwrites an existing file…」预置文件后下载失败且内容仍为原字节；反例组 `readdirSync(target)` 为空——Windows 下能删即证句柄已释放；相对目录在校验期拒绝（fetch 零调用） | 通过 |
| 5. AbortSignal 等效取消；deadline 覆盖响应头与完整 body；取消/超时不返回可安装路径；不盲重试/不降级/不启动安装包；允许很小的 fetch 注入 | 「enforces the total deadline…」头部永不返回 60ms 超时；body 停滞后超时且 reader cancel 被实际调用、部分文件删除；外部取消 mid-body 同样拒绝且无残留 | 通过 |
| 6. 不接 Web main/Actions，不下载/安装/升级/卸载/启动真实工具，不写注册表/协议/用户配置/auth，不真实试发；官方二进制获取留后续；不声称 C04 通过 | `main()`、`.github/workflows/dsh-compat.yml`、reporter 与全部既有入口零改动（GREEN diff 仅新增两个导出函数及其私有 helper/常量）；测试全部注入 fetch + 独占 mkdtemp | 通过 |

既有行为保持：原 35 个用例未改并全部通过；`dshRegressionIdentity`/Web reporter/`serialSequence`/desktop attempt 合同未动；baseline 新节不进入 `main()` 读取路径，Web 默认 main 不变。

## 四、验证

- 定向：`npx vitest run test/dsh-compat-ci.test.ts`（forks/threads max2/min1）GREEN **40/40**；RED 5 失败 / 35 通过（全业务断言）。
- `node --check scripts/dsh-compat-ci.mjs` 通过；`npm run lint` 0 输出；`npm run check:imports` 203 模块 / 682 边；`npm run build`（tsc）通过。
- 完整：GREEN 后一次 `npm run check`（`VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`，未筛套件、未加 skip、未放宽断言），完整 stdout/stderr 与真实退出码见 `I02-check.txt`（345 行，原样保存，末行 `CHECK_EXIT=0`）。结果：**退出码 0**，231 文件通过 / 3 跳过，**2570 项通过 / 11 跳过**（较 I01 收口 2565 增加 5，即本单新增用例）。跳过均为 `test/live/*` 既有实网用例。
- 首败：本轮完整检查一次通过，没有首败需要记录。

## 五、实际改动

- `scripts/dsh-compat-baseline.json`：新增 `desktopWindows` 节（feed/version/url/size/sha512 五字段，逐字取自 `docs/research/deepseek-harness-runtime-probe-20261023.md` 固定记录；研究记录中的 `releaseDate` 非任务书字段，未纳入）。旧 `package`/`packageManager` 原样。
- `scripts/dsh-compat-ci.mjs`：新增常量（`desktopDownloadHost`/`desktopFeedPath`/`desktopBinaryPath`/`desktopMaxInstallerBytes`/`rawDesktopSha512`）、私有 `officialDesktopUrl`/`desktopInstallerPlan`、导出 `parseDshDesktopWindowsManifest`/`downloadDshDesktopInstaller`。全部复用已有 `semver`/`supported`/`sri`/`message` 与既有 node:fs/url/timers 导入，未加依赖。
- `test/dsh-compat-ci.test.ts`：新增一组 5 用例；import 行补 `readdirSync` 与两个新导出。
- 证据：本文件、`I02-check.txt`。

未改：`main()`、workflow、reporter、其它 helper/指南/调度/总表/root 审查与旧日志；`docs/代码消息投递.md` 仍为原未跟踪，未 stage。

## 六、未实现 / 未测

- **官方二进制实际获取未执行**（289385456 字节真实下载、Authenticode/发布者核验、安装、UI、Host、卸载全部留给后续独立步骤）；本单不构成任何官方二进制或 C04 通过证据。
- 清理失败附加分支（`partialFile`/`cleanupError`）已实现但未单测：Windows 下无法便携模拟"句柄已关闭而删除仍失败"。
- 真实 undici 的 abort reason 传递与真实 3xx 重定向行为未实测：测试全走注入 fetch，302 以 `ok:false` 覆盖、真实重定向由 `redirect:'error'` 拒绝；deadline 不依赖 undici 语义（内部 race 强制）。
- 下载目录的祖先 symlink/真实性扫描未做：任务书把"本次独占、绝对、真实目录"定为调用方契约，本单只拒绝相对路径。
- 慢速 trickle 流（chunk 间有延迟但总时长未超期）未单测；超时由 stalled 流覆盖。并发同目标竞态未测（wx 已保证不覆盖）。
- Desktop runner 接线（`main()` 的 Desktop 入口、真实安装器调用）仍属后续单。

## 七、清理

全部用例经既有 `isolated()`（`mkdtemp` 系统 TEMP + finally `rm`）使用后删除，注入的 ReadableStream/AbortController 随用例结束释放；无新增调试脚本、后台进程或 Temp 残留；未触碰用户目录/注册表/协议；未启动包管理器、Desktop/Host/daemon 或任何模型调用。

## 八、R1 返修（C04-I02-R1）

### 1. 提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| 基线 | `bb40ce9` | root 双轴复审提交（本单派单基线） |
| RED | `a5e707e` | 只改 `test/dsh-compat-ci.test.ts`：8 个缺口反例（含真实 FileHandle 短写/停滞注入与实例级 close 换置） |
| GREEN | `4476f33` | 只改 `scripts/dsh-compat-ci.mjs`（与一处测试串场修正，见下）：四组保证的最小实现 |

RED 实测 **7 失败 / 36 通过**，失败全部是业务断言（不精确 URL/数组 sha512 被接受、早期拒绝 body 未取消、短写返回成功、写停滞与 close 停滞被 bounded-guard 证伪、假值读取错误残留 partial、EEXIST 后 body 未取消），无 missing-export/TypeError 充当 RED。GREEN 同组 **43/43 通过**。

**测试串场修正（GREEN 内，非产品让步）**：close 用例第一个子用例按设计保留 partial 后，fixture 未先真实关闭句柄并删除保留文件就跑第二个子用例，撞出 EEXIST；修正为子用例之间由 fixture 主动 `release`（恢复真实 close 并 await）再删除保留文件——这也是"未确认资源关闭不得删除临时根"的用例内体现。

### 2. root 缺口 → 修复 → 反例

| 审查项 | 修复 | 覆盖反例 |
| --- | --- | --- |
| Standards P1：忽略 `FileHandle.write` 的 `bytesWritten`，短写仍成功（22 声明/1 落盘） | 每块写盘与 deadline race，且 `saved.bytesWritten !== chunk.byteLength` 即拒（零进展同拒）；成功还需**有界 close 确认**（`settleWithin`），close 未落定/抛错都不得返回成功 | 「rejects short and zero-progress disk writes…」：原型补丁做**真实 1 字节短写**（返回真实 bytesWritten:1）与零进展写，逐一拒绝且 partial 删除；「retains the partial…」：close 停滞时拒绝且保留 partial |
| Standards P2：按 failure 真值决定清理，`stream.error(null)` 残留 partial；清理附加假定异常可修改 | 独立 `failed` 标志判定失败与清理，不依赖异常值真伪；`annotate` 先排除 null/非对象，`Object.assign` 再套 try/catch——冻结/不可写异常原样保留，永不被 TypeError 顶掉 | 「keeps falsy and frozen stream failures…」：`null/undefined/0/false/''` 逐一断言 `toBe(thrown)` 原样抛出且 partial 已清；冻结 Error 保持同一实例 |
| Standards P2：HTTP/错长度/EEXIST 时 reader 未取得，body 无取消；reader 收口无 releaseLock | reader 在响应存在即取得（首次 read 前），早期拒绝同样进入 finally 的有界 cancel + `releaseLock` | 「rejects redirect…」：错长度与 404 拒绝后断言 body cancel 回调实际触发；「never overwrites…」：EEXIST 后断言 body 已取消 |
| Standards P2：SHA-512 正则隐式强转，数组伪装通过 | `typeof input.sha512 !== 'string'` 先验，再测规范 base64 形状 | 「projects the pinned…」：数组 sha512/feed/url 逐一拒绝 |
| Spec（URL 精确性）：前缀+版本子串校验接受 `.txt`/`.zip`、`:8443`、nightly 子目录、`rc.22` 子串伪装 | 改为**精确模板等值**：feed 必须等于固定官方 nightly 地址；url 必须等于 `desktopInstallerUrl(version)` 模板（无端口/无 query/fragment/凭据/无 latest/无子目录/后缀固定 .exe）；filename 由模板派生，parser 与 download 公共边界（`desktopInstallerPlan`）同一规则 | 同用例：上述 4 类 URL 与 `.txt`/`.zip` 后缀逐一拒绝；窗口/大小/win-x64/固定 baseline 五字段投影不变 |
| Spec（deadline 无界）：写盘与 finally 的 cancel/close 无界，20ms 截止后 100ms 仍 pending | 写盘与 `expired` race；finally 的 cancel/close/rm 全部走 `settleWithin`（预算 = timeoutMs）；stop() 先清 timer/listener（同步，不会挂起）再逐项有界收口，某项失败不跳过其余 | 「enforces the total deadline…」：写停滞在 deadline 拒绝（bounded-guard 800ms 内返回）；cancel 永不落定时仍有界返回、句柄真实关闭、partial 删除 |
| Spec（释放未确认时的诚实报告） | close 未确认（停滞/失败）时**不删文件**：`releaseUnclear` 数组记录哪项未落定及原因，`partialFile` 指明保留路径；只有 close 确认后才尝试有界 `rm`，rm 失败/未落定记 `cleanupError`；cancel 侧问题记 `cleanupNotes` | 「retains the partial…」：close 停滞与冻结 close 失败两种形态都断言 partial 保留在原路径且原始异常身份不变 |

### 3. 字段与行为变化（相对首轮）

- 失败对象可附加字段：`partialFile`（绝对路径）、`cleanupError`（rm 失败/未落定原因）、`releaseUnclear`（close 未确认时的逐项说明）、`cleanupNotes`（其余收口问题）；仅在相应情况出现，成功返回不携带。
- 成功条件收紧为：字节总数与摘要一致 **且** 每块 `bytesWritten` 全量 **且** close 在预算内确认完成。
- `parseDshDesktopWindowsManifest` 的 URL/feed 由"前缀+包含版本"改为模板等值；对外返回形状不变（`{version,url,size,integrity,filename}`）。
- 新增私有 `settleWithin`；移除首轮的 `officialDesktopUrl` 通用形状校验（避免第二套漂移规则）。

### 4. 验证

- 定向：`npx vitest run test/dsh-compat-ci.test.ts`（forks/threads max2/min1）GREEN **43/43**；RED 7 失败 / 36 通过。
- `node --check scripts/dsh-compat-ci.mjs` 通过；`npm run lint` 0；`npm run check:imports` 203 模块 / 682 边；`npm run build` 通过。
- 代码 diff 空白检查：`git diff --check bb40ce9..HEAD -- scripts test` **退出 0**（首轮报告的尾空格问题只在原始 `I02-check.txt` 末尾，属原始证据，本单未改写，与前次检查分开报告）。
- 完整：GREEN 后一次 `npm run check`（forks/threads max2/min1，未筛套件、未加 skip、未放宽断言），完整输出与真实退出码见 `I02-R1-check.txt`（346 行，末行 `CHECK_EXIT=0`）。结果：**退出码 0**，231 文件通过 / 3 跳过，**2573 项通过 / 11 跳过**（较首轮 2570 增加 3，即本单新增用例）。首败：一次通过，无首败。

### 5. 未测 / 清理

- 未单测：partial `rm` 删除失败/未落定分支（`cleanupError`）——Windows 下无法便携模拟"句柄已确认关闭而删除仍失败"；实现已按有界+附加字段处理。`open()` 本身停滞未设界：原规格保证列举的是响应头/body/写盘等待，真实 fs open 无已知停滞路径，如实说明不冒充已覆盖。真实 undici abort/3xx 语义同首轮口径（全部注入 fetch，`redirect:'error'`）。
- 注入方式说明：`FileHandle.close` 是实例自有绑定属性（原型上不存在），close 停滞/失败用例经原型 `write` 补丁捕获模块内部实例后在其上换置 close 实现，子用例间与 finally 均恢复真实 close 并 await——所有原型/实例补丁在 finally 恢复，保留的 partial 由 fixture 确认句柄关闭后按绝对路径删除，独占 `mkdtemp` 根用后即删。
- 第六节其余未测边界（真实下载、目录祖先扫描、trickle 流、runner 接线）维持不变；C04 未关闭。
