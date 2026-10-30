# C04-I02 交付说明（供 root 审查）

执行 `cworker1`，分支 `codex/core-refactor-pre-tui`，派单基线 `dc983f7f3711a113bdb6d62b2777dafbb2e5ee2b`（开工核对：branch/HEAD/dirty 一致，工作区仅原未跟踪 `docs/代码消息投递.md`，未动未 stage）。任务书 `I02-task.md`。只改白名单内三个既有功能文件，另新增本文件与 `I02-check.txt`。

验收口径是**「官方 Desktop 元数据投影 + 流式下载/校验组件完成」**，不是 C04 通过，也不是官方二进制已验证：本轮只用受控 fetch 响应、独占临时目录与注入 fixture 验证，**没有实际下载、写入或执行任何官方二进制**。

## 一、提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| RED | `f14d3f4` | `test/dsh-compat-ci.test.ts` 新增桌面安装包投影与流式校验一组 5 用例；`scripts/dsh-compat-baseline.json` 增 `desktopWindows` 节（五字段固定自研究记录）；`scripts/dsh-compat-ci.mjs` 只加两个空占位导出 |
| GREEN | `c2a2e2f` | `parseDshDesktopWindowsManifest` 与 `downloadDshDesktopInstaller` 最小实现；**删除占位**（任务书允许的显式占位，仅用于让 RED 落在业务断言） |

RED 实测 **5 失败 / 35 通过**，失败全部是业务断言（`AssertionError: expected undefined to deeply equal …` 与 `promise resolved "undefined" instead of rejecting`），没有任何 missing-export / TypeError / ReferenceError 充当 RED。GREEN 同组 **40/40 通过**。两提交均显式路径提交，未 push、未 amend。

## 二、API 与输出

### `parseDshDesktopWindowsManifest(input, platform, arch)`（元数据投影）

unknown 输入按序校验：record 形状与字符串 semver 版本 → 已批准 `>=0.2.1-rc.2 <0.3.0-0` 窗口（复用既有 `semver`/`supported`，窗口外抛 `category:'unsupported'`）→ `platform==='win32' && arch==='x64'` → feed 与 url 都必须是 `https://download.deepseek.com`、无凭据/query/fragment、路径分别在 `/dsh-desk/feeds/win-x64/` 与 `/dsh-desk/bin/win-x64/` 下且无 `latest` 段 → 文件名（URL 末段）包含该版本、不含 `\/:` → `size` 为正安全整数且 ≤512MiB → `sha512` 为规范 64 字节 base64（`85 字符 + [AQgw] + '=='`）。返回 `{ version, url, size, integrity: 'sha512-<base64>', filename }`——`version` + SRI 形 `integrity` 正是 I01 `knownDesktopArtifact` 需要的发行物身份，可直接交给 `runDshDesktopAttempt` 的 artifact 上下文。

### `downloadDshDesktopInstaller(artifact, { directory, signal, timeoutMs = 120000, fetchImpl = globalThis.fetch })`（流式下载并校验）

公共边界先经内部 `desktopInstallerPlan` **重新独立校验**投影（版本/窗口/URL/文件名一致性/size/SRI），再要求 `fetchImpl` 可调用、`timeoutMs` 正整数、`directory` 绝对路径——**没有任何默认目录/cache/系统 TEMP**。fetch 以 `redirect:'error'` + 内部 deadline signal 发起；非成功/无 body 拒绝；`Content-Length` 可缺省，存在时须严格十进制且等于固定 size。以 `wx` 在 `join(directory, filename)` 创建文件（EEXIST 即失败、原文件字节不动），逐块增量 SHA-512 与写盘（不 Buffer.concat 整包），累计超 size 即拒；流结束且字节数与摘要都等于固定元数据才返回 `{ path, filename, version, size, integrity }`。任何失败都释放自己创建的 body reader（cancel）、文件句柄（close）、timer 与 signal listener，并只删除**本次成功创建**的未完成文件；清理失败在原始错误上附加 `partialFile`/`cleanupError`，不替换原始错误。总期限与外部取消经由同一内部 AbortController，头部等待与每个 body read 都与 deadline race——超时/取消不返回可安装路径。返回值只证明**传输字节与固定元数据一致**，不证明 Authenticode 发布者、安装成功或 Desktop 功能（docstring 同句声明）。

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
