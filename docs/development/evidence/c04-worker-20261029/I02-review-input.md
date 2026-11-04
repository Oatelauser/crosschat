# C04-I02 交付说明（供 root 审查）

执行 `cworker1`，分支 `codex/core-refactor-pre-tui`，派单基线 `dc983f7f3711a113bdb6d62b2777dafbb2e5ee2b`（开工核对：branch/HEAD/dirty 一致，工作区仅原未跟踪 `docs/代码消息投递.md`，未动未 stage）。任务书 `I02-task.md`。只改白名单内三个既有功能文件，另新增本文件与 `I02-check.txt`。

验收口径是**「官方 Desktop 元数据投影 + 流式下载/校验组件完成」**，不是 C04 通过，也不是官方二进制已验证：本轮只用受控 fetch 响应、独占临时目录与注入 fixture 验证，**没有实际下载、写入或执行任何官方二进制**。

**R1 返修（2026-10-30，基线 `bb40ce93322fe70175e4305df9379f92eb13006b`，任务书 `I02-R1-task.md`，双轴审查 `I02-review.md`）**：root 首轮复审未通过（Standards 4 项最高 P1、Spec 4 项 P2，均有实测复现）。本文件第二节与第三节中「任何失败都释放…」「清理失败在原始错误上附加…」及 URL 前缀/子串校验的表述**首轮过宽**，已由 R1 收口，订正与实际保证见「八、R1 返修」。R1 只改 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts` 与本文件，新增 `I02-R1-check.txt`；`I02-check.txt` 及其末尾尾空格属原始证据，原样保留不改。

**R2 返修（2026-10-30，基线 `60cd3f3169c0196d3f42c4537c1e6a69356dfa47`，任务书 `I02-R2-task.md`，双轴审查 `I02-R1-review.md`）**：R1 复审仍余 Standards 3 项 + Spec 3 项（均 P2）：close 另用新预算绕过总截止、冻结/非对象异常丢失保留报告、fixture 实例释放在断言后。第八节 R1 的「close 确认」与「原样抛出冻结异常」表述已由 R2 进一步收口（见「九、R2 返修」）：单一传输截止覆盖 open/唯一 close/最终交付，冻结/假值异常叠加保留信息时改为**带 cause 的可写包装**（引用相等不再是合同）。R2 只改同两个功能文件与本文件，新增 `I02-R2-check.txt`；旧日志原样。

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

## 九、R2 返修（C04-I02-R2）

### 1. 提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| 基线 | `60cd3f3` | root R1 复审提交（本单派单基线） |
| RED | `4aec870` | 只改 `test/dsh-compat-ci.test.ts`：5 类缺口反例（close 内取消/总截止、迟到响应与迟到句柄、冻结/假值叠加保留信息、有限共享清理预算）+ `node:fs/promises` 的 `open` 局部 vi.mock 注入 |
| GREEN | `9699354` | 只改 `scripts/dsh-compat-ci.mjs`（与测试两处非让步修正，见下）：记录结果→有界收尾→最终裁决 |

RED 实测 **5 失败 / 41 通过**，失败全部是业务断言（close 内取消返回 success、迟到 close 在总截止后成功、迟到响应 body 未取消、迟到 open 恢复成功、冻结/假值丢失 partialFile/cause）。GREEN 同组 **46/46**，连跑三次全绿。

**GREEN 内两处测试修正（非产品让步）**：(a) errored 流的 `cancel()` 会以流错误拒绝且已入队 chunk 被丢弃——假值+收尾不明用例改为 pull 延迟报错，使 write/close 换置确实发生；(b) 取消停滞场景中「partial 是否在剩余预算内删净」是时序性的，断言改为确定性双分支「保留⇒已报告 partialFile」，不再碰运气。

### 2. root 缺口 → 修复 → 反例

| 审查项 | 修复 | 覆盖反例 |
| --- | --- | --- |
| close 另用新预算，绕过已有取消/总截止；close 内取消仍返回路径 | 函数重排为**记录结果→有界收尾→最终裁决**，try 内不再 return；唯一 close 与 open、每次读写一样与同一 `expired` race；close 确认后还须 `deadline.signal.aborted === false` 才记录交付；finally 顶部与最终裁决各再复核一次取消（abort 落在收尾期间也作废交付并补删已关文件） | 「voids delivery…」：close 挂起中 caller.abort → 拒绝且保留 partial+`releaseUnclear`；头部耗 80ms 预算后 close 于 130ms 完成仍拒绝（总截止 100ms） |
| 迟到资源无 owner：截止后 fetch 返回的 Response body 未取消 | 响应与 open 都经 `reflect` 包裹；主流程未消费（`responseTaken`/`handleTaken` 为假）而迟到的结果由 disown 路径有界收尾：body → `getReader().cancel()`，句柄 → 有界 close 后删本次创建的文件；标记在 race 消费后置位，disown 处理器在 finally 补挂，顺序保证不误伤主流程正要读的流 | 「keeps late responses and late handles owned after the deadline」：截止后 120ms 到达的 Response 其 body cancel 回调实际触发；截止后 120ms 才 open 的句柄被关闭、文件被删除，绝不从迟到 IO 恢复成功 |
| 清理每项用全新 timeout 无限续期 | finally 使用**有限共享清理预算**（`timeoutMs` 总额，按 `Date.now` 递减）：close→cancel→rm 依序分享；预算耗尽的操作立即如实记 `!done`；某项失败不阻断其余收口；唯一 close 只启动一次（`closing`/`closeConfirmed` 保存状态，不重复启动） | 「enforces the total deadline…」取消停滞子例：bounded 返回、cancel 未落定必入 notes（cleanupNotes 或 releaseUnclear），保留的 partial 必带 `partialFile` |
| 冻结/非对象异常丢失保留报告（partialFile/原因） | 裁决阶段：无保留信息时原样抛出（假值也原样）；有保留信息时先尝试在原异常上附加；不可附加（冻结/假值/原始值非对象）则抛**可写包装 Error**，`cause` 保存原始抛值，`partialFile`/`releaseUnclear`/`cleanupNotes`/`cleanupError` 齐全——引用相等不再是合同，必需信息不丢 | 「wraps frozen and falsy close failures…」：冻结 close 错误 → 包装 `cause` 为同一冻结实例 + partialFile + releaseUnclear；`reject(0)` → `cause === 0` + partialFile；「keeps the cause…」：假值读取错误叠加 close 未确认 → `cause === 0` + partialFile + releaseUnclear；「keeps falsy and frozen stream failures…」（无保留信息）仍原样抛出，`toBe(thrown)` 保持 |
| 已 errored 流的 cancel 拒绝被当泄漏记入 notes | cancel 拒绝=流已终止的正常结果，只有**未落定**才记 unclear（仍在预算内有界） | 上述 falsy 用例不再被 cancel 噪声包装（RED 时曾因此把 `null` 误包成 `cleanupNotes` 包装错误） |
| fixture 实例释放在断言后、finally 仅恢复原型 | 所有换置/捕获的实例句柄收口（恢复原 close 并 await 真实关闭）移入 `finally`，断言抛错也执行；子用例间额外中途释放仅为后续子例起点干净（双释放安全） | 「voids delivery…」「wraps frozen and falsy…」「keeps the cause…」三用例的 finally 结构本身即反例（人为在断言处失败也会关句柄；未单列破坏性用例） |

### 3. 最终形态（对外不变，内部语义）

- API 与参数不变；成功返回 `{ path, filename, version, size, integrity }`，条件收紧为：字节与摘要一致 + 每块 `bytesWritten` 全量 + **唯一 close 在同一传输截止内确认** + 最终复核无取消/超时。
- 失败对象三种形态：原样（无保留信息，含一切假值）；原异常+附加字段（可写对象）；**可写包装**（`message` 含 `String(原始值)`、`cause` 链保留、字段齐全）。
- `settleWithin` 复用；新增局部 `reflect`/`disownResponse`/`disownHandle`，无新对外 API、无状态文件。
- `open` 经 `vi.mock('node:fs/promises')` 局部注入（仅 `open` 一项可替换，其余 passthrough），注入在 finally 恢复。

### 4. 验证

- 定向：`npx vitest run test/dsh-compat-ci.test.ts`（forks/threads max2/min1）GREEN **46/46**，另连跑两次全绿；RED 5 失败 / 41 通过。
- `node --check` 通过；`npm run lint` 0；`npm run check:imports` 203 模块 / 682 边；`npm run build` 通过。
- 代码 diff 空白检查：`git diff --check 60cd3f3..HEAD -- scripts test` **退出 0**（旧原始日志尾空格不在代码 diff，原样保留，分开报告）。
- 完整：GREEN 后一次 `npm run check`（forks/threads max2/min1，未筛/未 skip/未放宽），完整输出与真实退出码见 `I02-R2-check.txt`（345 行，末行 `CHECK_EXIT=0`）。结果：**退出码 0**，231 文件通过 / 3 跳过，**2576 项通过 / 11 跳过**（较 R1 的 2573 净增 3：拆 1 增 4）。首败：一次通过，无首败。

### 5. 未测 / 清理

- 未单列反例：最终裁决阶段的「收尾期间 abort」补删分支（时序窗口无法确定性命中，行为由同路径的 close 内取消反例覆盖其裁决语义）；disown 路径删除迟到文件与调用方立即重试同路径的竞态（真实 fs open 无迟到形态，仅注入可造）；`rm` 删除失败分支仍不可便携模拟（同 R1 口径）。
- 清理：`vi.mock` 的 `open` 注入、原型 `write` 补丁、实例 `close` 换置均在各自用例 finally 恢复/真实关闭；保留 partial 由 fixture 确认句柄关闭后按绝对路径删除；独占 `mkdtemp` 根用后即删；无外网、无官方二进制、无用户状态写入；C04 未关闭。

## 十、R3 返修（C04-I02-R3）

### 1. 提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| 基线 | `2548c08` | root R2 复审提交（本单派单基线） |
| RED-1 | `54a6796` | 只改测试：cleanup 期间取消/总截止两个子例，迟到 open/响应的可读结果与锁释放（新增 `rm` 局部注入） |
| GREEN-1 | `3c15675` | 只改产品：定时器/监听器活到最终裁决；迟到 owner 记录 done/failed 并 `releaseLock`；收尾与最终删除共享有限预算 |
| RED-2 | `6e4d77a` | 只改测试：把迟到 close 失败、close 停滞、迟到 rm 失败、迟到响应拆成独立用例，逐支可独立 RED |
| GREEN-2 | `9b72442` | 只改产品：区分「open 已落定但 close/rm 未落定」与「open 本身未落定」的返回报告 |

RED-1（产品回退到基线、测试为当时版本）**2 失败 / 46 通过**；RED-2（最终测试、产品回退基线）**5 失败 / 46 通过**，五条均为业务断言：cleanup 期间 caller.abort 仍返回成功；迟到 close 失败、close 停滞、迟到 rm 失败都没有 `partialFile`/可读原因；迟到响应没有返回报告。基线运行另会出现 FileHandle 在 GC 期未关闭的 unhandled error（迟到句柄被丢弃），GREEN 后消失。GREEN-2 同组 **51/51**，连跑三次全绿。

拆成 RED-2 的原因：R2 复审要求同时覆盖「close 失败」与「close 停滞」；放在同一用例里时首个断言失败会跳过后续子例，无法逐支证明红，故拆为独立 `it`。

### 2. root 缺口 → 修复 → 反例

| 审查项 | 修复 | 覆盖反例 |
| --- | --- | --- |
| 定时器/取消监听在 finally 顶部 `stop()`，随后 await 收尾；最终用已停止更新的内部 signal 证明「未取消」 | 删除提前 `stop()`；`cancelled()` 同时看外部 signal、仍活的 deadline signal 和墙钟（`Date.now() - startedAt >= timeoutMs`）。收尾与最终裁决完成后才在 finally 释放定时器/监听器，任何抛出也走同一 finally；只有收尾后且 `cancelled() === false` 才返回交付 | 「refuses delivery when cancellation or the total deadline lands during cleanup」：(a) 交付已记录后，收尾中的 body cancel 仍挂起时 caller.abort → 拒绝且目录清空；(b) 响应/写入/close 全部完成后，收尾跨过总截止（80ms）→ 拒绝、`partialFile`+`cleanupError`、文件保留 |
| 迟到资源丢弃 `settleWithin` 的 done/failed 与迟到 close/rm 结果；迟到 reader 未 `releaseLock` | `ownResponse`/`ownHandle` 把 cancel/close/rm 的未落定与失败原因写入 `undecidedResources`；`releaseLock` 在 finally 执行。迟到 IO 只收口与记录，绝不恢复交付，也绝不删除不是本次 `wx` 创建的文件 | 「reports a late file close failure…」：原超时报告 + `partialFile` + `undecidedResources` 含 `a late file close failed: late close refused`，文件保留；「reports a late partial removal failure…」：含 `the late partial removal failed`；「cancels a late response…」：cancel 回调触发且 `body.locked === false` |
| 截止返回时 open/请求仍挂起没有保守报告，也没有持续 owner | 收尾内用剩余预算等待迟到 owner：返回前落定则记录真实结果；未落定则立即写保守报告——响应「未落定」、open「可能已存在」，并保留后台 owner 继续收口。区分「已创建」与「可能已存在」：只有 `created` 才报 `partialFile`，未落定的 open 只报可能存在的路径 | 「reports a late file close that never settles…」：open 已落定、close 停滞 → 返回报告含「had not settled at return」、`partialFile`、`cleanupError`；「keeps late responses and late handles owned after the deadline」仍通过（截止后到达的响应被取消，迟到句柄被关闭并删除） |
| 最终删除重开完整预算 | 收尾与最终删除共用同一 `left()` 剩余预算；预算为 0 时不再启动删除，如实记「cleanup budget was exhausted」 | 上述停滞子例中收尾耗尽 200ms 预算后删除必定记 `cleanupError`，不依赖 rm 与 0ms 定时器的竞争 |
| 假值/冻结失败仍须带报告 | 保持 R2 的 cause 包装：无保留信息原样抛；有保留信息时附加或包装 | 「keeps falsy and frozen stream failures…」仍 `toBe(thrown)`；「wraps frozen and falsy…」仍 `cause` 相等 + `partialFile` |

### 3. R2 表述更正

- 九.2 第 1 行「abort 落在收尾期间也作废交付」在 R2 实现中**不成立**：`stop()` 已先移除外部监听并清定时器，最终裁决读到的 signal 不再更新。R3 才真正覆盖（见上表）。
- 九.2 第 2 行「迟到 close 结果有界收口」只做了动作，未记录 done/failed；close/rm 失败或未落定被静默丢弃，reader 也未 `releaseLock`。R3 更正为可读报告。
- 九.5「真实 fs open 无迟到形态」的表述撤回：异步 `fs.open` 可以迟到（测试以门控注入确定性复现），不得以「不可能迟到」作为不处理理由。
- 九.5「rm 删除失败分支不可便携模拟」不再成立：本机实测 Windows 允许删除仍被句柄持有的文件，不能靠「文件被占用即不可删」制造失败；R3 改用局部 `rm` 注入确定性制造迟到删除失败。
- 九.5「未单列反例：最终裁决阶段的收尾期间 abort 补删分支」已由本单第一个反例覆盖。

### 4. 验证

- 定向：`npx vitest run test/dsh-compat-ci.test.ts`（forks/threads max2/min1）GREEN **51/51**，另连跑两次全绿；RED-2 **5 失败 / 46 通过**。
- `node --check` 通过；`npm run lint` 0；`npm run check:imports` 203 模块 / 682 边；`npm run build` 通过。
- 代码 diff 空白检查：`git diff --check 2548c08..HEAD -- scripts test` 退出 0。
- 完整：GREEN-2 后一次 `npm run check`（forks/threads max2/min1，未筛/未 skip/未放宽），完整输出与真实退出码见 `I02-R3-check.txt`（357 行，末行 `CHECK_EXIT=0`）。结果：**退出码 0**，231 文件通过 / 3 跳过，**2581 项通过 / 11 跳过**（较 R2 的 2576 净增 5，即本单新增五条反例）。首败：一次通过，无首败。

### 5. 未测 / 清理

- 未单列反例：owner 在**返回之后**才落定并记录失败的分支——报告已抛出，无法再附加字段；测试只断言返回时的保守报告与后台收口动作，二者与返回前落定路径共用同一代码。
- 总截止跨界由固定等待（120ms > 80ms）驱动而非假时钟；cancel 的「已开始未完成」由假 reader 门控确定性控制，裁决本身用墙钟而非定时器先后顺序。
- 清理：`open`/`rm` 两处 `vi.mock` 注入、原型 `write` 补丁、实例 `close` 换置均在各自用例 finally 恢复；保留 partial 由 fixture 确认句柄关闭后按绝对路径删除；独占 `mkdtemp` 根用后即删；无外网、无官方二进制、无用户状态修改；C04 未关闭。

## 十一、R3 同单补充（C04-I02-R3 复审两条 P2）

### 1. 提交

| 节点 | 提交 | 内容 |
| --- | --- | --- |
| 基线 | `c813d4e` | root R3 复审（本单派单基线） |
| RED | `04ae24a` | 只改测试：迟到文件只删一次 + 替换文件字节保留；成功收口不虚报 partial；response 已到但 cancel 未决的返回报告 |
| GREEN | `33f9c05` | 只改产品：迟到句柄唯一 close/remove owner，主收尾只消费结果；迟到响应三态记录 |

### 2. 审查项 → 修复 → 反例

| 审查项 | 修复 | 覆盖反例 |
| --- | --- | --- |
| `ownHandle` 已 close+rm，主收尾因 `failed && created` 再 rm 同一路径（双删除 owner；成功删除后虚报 `partialFile`/ENOENT；首次删除后另一 attempt 以 `wx` 创建的替换文件会被第二次删除） | `ownHandle` 改用独立的 `lateFile` 状态，不再置 `created`；该句柄的 close/rm 是唯一 owner，结果（closed、removal outcome）记入状态。主收尾新增 `else if (failed && lateFile)` 分支：只读取真实结果，绝不再次 rm；close 失败/未落定 → `releaseUnclear`+`partialFile`，rm 失败/未落定 → `cleanupError`+`partialFile`，rm 成功 → 不产生任何保留字段 | 「removes a late-created file exactly once and never deletes a replacement」：rm 注入计数，首次删除后写入替换内容；断言 `rmCalls === 1`、替换字节原样保留、无 `partialFile`。「does not report a partial path after a successful late close and removal」：无替换时断言 `rmCalls === 1`、`partialFile`/`cleanupError` 均为 undefined、文件确已删除 |
| `:262` 只在 `!responseOwnerStarted` 时写返回报告，漏「response 已到但 cancel 未落定」；owner 已启动被当成资源已释放，公共收尾预算先耗尽时返回普通超时且无 `undecidedResources` | `ownResponse` 记录 `lateResponse` 状态与 cancel outcome。返回报告分三态：响应未到 → 「had not settled at return」；已到但 cancel 未落定 → 「cancel had not settled at return」；cancel 已落定 → 不报。owner 启动不再等价于释放；`releaseLock` 仍在 cancel 落定后的 finally 执行 | 「reports a late response whose cancel is still undecided when cleanup returns」：timeout 100ms，真实 `ReadableStream` 在 150ms 到达，cancel 由 gate 挂起；断言返回时 `cancelStarted === true`、`undecidedResources` 含「cancel had not settled at return」、`body.locked === true`；释放 gate 后 `locked === false` 且目录为空 |

既有保证未变：最终取消裁决、有限共享收尾预算（`left()`）、`wx` 边界（只清本次创建的文件）、精确元数据/短写/Web 回归、冻结/假值错误的 cause 包装均保持原行为。

### 3. 验证

- 定向：RED **3 失败 / 51 通过**（退出码 1，首败 `expected 2 to be 1` 即双删除）；GREEN **54/54**（退出码 0）。
- `node --check` 通过；`npm run lint` 0；`npm run check:imports` 203 模块 / 682 边；`npm run build` 通过；`git diff --check` 0。
- 完整：GREEN 后一次 `npm run check`（forks/threads max2/min1，未筛/未 skip/未放宽）**退出码 0**，231 文件通过 / 3 跳过，**2584 项通过 / 11 跳过**（较 R3 的 2581 净增 3）。数字与命令见 `I02-R3-supplement-check.txt`（**人工摘要**）；逐字节 stdout/stderr 与退出码见 `I02-R3-supplement-raw.txt`。

### 4. 未测 / 清理

- 未单列反例：迟到 owner 在返回之后才落定并失败——报告已抛出，只能记录后台结果；返回前落定与返回后落定共用同一状态记录代码。
- gate 反例用真实 `ReadableStream` 的 `cancel` 挂起，锁释放由 gate 释放后的轮询断言确认；未引入假时钟。
- 清理：`open`/`rm` 注入与 gate 均在用例 finally 恢复；独占 `mkdtemp` 根与测试写入的替换文件按绝对路径删除；无外网、无官方二进制、无用户状态修改；C04 未关闭。

## 十二、补充收尾修正（C04-I02-R3 同单）

### 1. 提交

| 节点 | 提交 | 内容 |
| --- | --- | --- |
| 基线 | `238f582` | 本单补充交付（复审基线） |
| 收尾 | `6648c91` | 只改测试：gate 解锁与释放等待移入 finally；本文件与 raw 证据随文档提交 |

### 2. 修正

- **gate 用例**（`test/dsh-compat-ci.test.ts:1139` 起）：返回时的 `failure`/`cancelStarted`/`undecidedResources`/`locked` 断言保留在 `try` 内；`release()` 与等待 owner 释放锁移入 `finally`；`finally` 之后再验证 `locked === false` 与目录为空。断言失败不再跳过释放，清理不依赖成功路径。
- **临时反证**：把返回时 `locked` 断言故意翻转为 `false` 并加标记输出，运行得到预期失败（`PROOF_EXIT=1`）且输出 `GATE_RELEASED_IN_FINALLY`，证明断言失败后 `finally` 仍执行；随后还原，未改产品、未提交翻转版本。原始输出见 raw 证据 E 段。
- **证据更正**：`I02-R3-supplement-check.txt` 保留不动，明确为人工摘要；新增 `I02-R3-supplement-raw.txt`（1018 行，A–F 段）逐字节保存 RED、GREEN、第一次完整 check、finally 后定向、临时反证、finally 后完整 check 的 stdout/stderr 与退出码。§十一.3 的引用已同步更正。

### 3. 验证

- finally 修正后定向：`npx vitest run test/dsh-compat-ci.test.ts` **54/54**，退出 0。
- finally 修正后**一次**完整 `npm run check`（forks/threads max2/min1，未筛/未 skip/未放宽）：**退出码 0**，231 文件通过 / 3 跳过，**2584 项通过 / 11 跳过**（与第一次报告一致）。
- 首败：无。E 段失败是人为翻转的预期反证，不是产品/测试缺陷。

### 4. 限制 / 清理

- RED、GREEN 与第一次完整 check 的原始输出是会话内保存的文件，已按原字节并入 raw（含终端颜色控制符）；会话终端之外的更早输出无法核对，未补造。
- 工作树仍仅用户原未跟踪 `docs/代码消息投递.md`；未 push/amend/回退共享文件；未改 `scripts/` 及其它文件；C04 未关闭。
