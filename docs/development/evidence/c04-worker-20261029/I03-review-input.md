# C04-I03 交付说明（阶段 A/B，供 root 审查）

执行 `cworker1`，分支 `codex/core-refactor-pre-tui`。阶段 A 派单基线 `521e889d07831244456c80ac804541d7047509e8`，研究文件提交 `86f167e5b518989a0301c2e366c27382e4cffa7c`。阶段 B 新基线 `e1dbefda0e3f7785d6088f1cb7afded1390bc06b`；RED 提交 `4c1e7c977a9ea88c0172263cb7d9a07e7af21e44`，GREEN 与文档同提交（最终 HEAD 见本轮回报）。开工与收尾均核对：工作区仅原未跟踪 `docs/代码消息投递.md`，未动未 stage。

阶段 A 只新增两份文档；阶段 B 只改 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts` 和本目录证据文档，不新增功能文件。两个阶段均未下载/执行官方 EXE，未安装/卸载/启停 Desktop 或 Host，未写注册表/协议/用户配置，未发新增网络请求，未跑真实签名环境或原生 probe。

## 一、交付

| 文件 | 内容 |
| --- | --- |
| `docs/research/c04-windows-installer-contract-20261102.md` | 固定发行物与准入链、安装合同、签名合同、生命周期与归属、最小实施方案、验收入口；逐项标注 A 固定源码直接证实 / B 模板或通用推测 / C 待真实包或 runner 验证。 |
| 本文件 | 基线、交付、已知/未知、最窄后续实现建议、用户拍板与边界。 |

核对方式：`git diff --check` 通过；只按显式路径提交；未 push/amend/checkout/pull/reset/clean/stash。

## 二、合同结论

### 1. 已由固定源码/仓库证据直接证实（A）

- 固定 Windows x64 发行物：官方 feed、精确版本 URL、`289385456` 字节、固定 SHA-512；I02 只证明传输字节与元数据一致，不证明发布者或可安装性。
- `apps/desktop/scripts/electron-builder-config.mjs:238–261`：NSIS、`oneClick:false`、`perMachine:false`、`allowElevation:false`、`allowToChangeInstallationDirectory:false`。
- `apps/desktop/scripts/installer.nsh:32–44`：拒绝 all-users 及已有 HKLM 安装。
- `apps/desktop/scripts/installer.nsh:70`：存在静默分支（只证明分支存在，不证明开关名）。
- `apps/desktop/scripts/installer.nsh:242`：写 `InstallLocation`（不证明键路径/值/默认根）。
- `apps/desktop/installer/uninstall.nsh:12–35`：更新或 `KEEP_APP_DATA` 跳过数据清理，否则处理 Electron APPDATA/updater 缓存，保留 Harness home；锁定残留不令卸载失败。
- `apps/desktop/README.md:131–141`：内置 `resources/runtime/cli/bin/dsh.cmd`；插件管理前初始化并完整退出，命令结束后才更新/卸载。
- `electron-builder-config.mjs:108` 声明 `dsh` scheme；正式 main 启动调用 `app.setAsDefaultProtocolClient('dsh')`。
- I01 生命周期合同：部分安装保留 root/installationId/owner；Host 退出未确认不卸载；官方卸载与两类注册清理分开要求；sequence 的 remove 只在释放证明后清自有目录。

### 2. 仍缺证据（C，不得猜）

- `/S`、`/D=` 的确切拼写与语义；静默自启动；固定卸载器名。
- 默认安装根、`InstallLocation` 的键路径/值、卸载注册表项/GUID、产品名。
- `dsh` 协议注册的实际键、由安装器还是应用创建、卸载是否撤销。
- 默认发布者主体/指纹、时间戳与吊销行为。
- 真实二进制内容、Authenticode 结果、安装后文件布局、是否启动应用、同版本 HKCU 冲突/升级行为。
- 被拒读取的 5 个固定提交资源：`windows-installer-smoke.ps1`、`windows-uninstall-smoke.ps1`、`pages.nsh`、`windows-signing/README.md`、`installed-update-qualification.ts`。本阶段未重试、未换工具/URL/委托绕行，缺口保留。

### 3. 签名结论

- SHA-512 只证明传输与 feed 元数据一致；Authenticode `Valid` 只证明签名链可验证且签名后未改动；Subject/Thumbprint 只证明证书声明/精确证书身份。
- `apps/desktop/scripts/windows-sign.mjs:76–93`：发布者由发布环境证书 CN/O/C 派生，源码没有可信固定主体/指纹。
- 因此预期发布者必须来自独立于待校验文件的材料；当前没有可信默认值。不得编造 DeepSeek 主体、thumbprint 或 GUID，也不得从待校验文件/报告回抄期望值。
- 最窄接口是调用方提供 `{ publisher: { subject, thumbprint } }`，缺失即拒绝；只给 `status:'Valid'` 不放行。

## 三、阶段 B：已实现的只读准入（同单）

阶段 B 只改两个既有文件，不新增功能文件：

- `scripts/dsh-compat-ci.mjs`
  - 私有 `parseDshDesktopPublisherPolicy`：严格校验 `{ publisher: { subject, thumbprint } }`，无默认值；缺失/畸形在文件读取和子进程前拒绝。
  - 公开 `admitDshDesktopInstaller({ path, artifact, policy, readSignature?, signal?, timeoutMs? })`：复用 `desktopInstallerPlan` 重推导发行物身份；绝对本地路径、普通独占文件；流式 SHA-512 按固定大小有界；同一句柄前后状态核验；签名先按 unknown 解析，只有 `Valid` 且 subject/thumbprint 严格相符才通过。
  - 既有模块内的默认 Windows 只读签名适配器：`powershell.exe` + 常量脚本 + `-NoProfile -NonInteractive -WindowStyle Hidden -Command`，路径通过 `DSH_ADMIT_SIGNATURE_PATH` 环境字段传递，`shell:false`、`windowsHide:true`、64 KiB 输出上限、等待 `close`。
  - 单一截止覆盖读盘、签名读取和最终裁决；取消/超时不返回成功；`finally` 关闭句柄、清除 timer/listener。
- `test/dsh-compat-ci.test.ts`
  - 新增 9 条准入用例，注入 `readSignature` 与受控 `spawn`；不跑真实安装器，不读取用户证书。
  - 反例覆盖：策略缺失/畸形、发行物身份不符、大小/摘要不符、链接/非普通文件、读后替换、签名状态/subject/thumbprint 不符、坏 JSON/数组/null、预先/执行中取消、超时、默认适配器输出超限/异常退出/信号/spawn 错误/挂起。
  - 既有 54 条用例不改；`main()`、workflow、reporter、UI driver、Web 默认入口、全局安装均不动。

**未实现、也不得据此执行的部分**：没有 `runDshDesktopInstaller`/`runDshDesktopUninstaller` wrapper；显式 `arguments` + 绝对 `root` 只是声明，不证明安装位置；卸载 spawn 前没有 Host 退出守卫；`runDshProcess` 不接 `AbortSignal`，stdout/stderr 各只保留最后 128000 字符且无 `truncated` 标记，timeout kill 后立即返回、不等 `close`；准入结果不绑定未来实际执行的字节。真实安装/卸载必须等独立干净 runner、安装前 baseline、目的地约束方案和独立可信发布者策略。

必须保留待真实包或干净 runner 验证的是静默参数、目录参数、自启动、卸载器名、默认根、注册表键、发布者默认值与真实签名结果。注入测试不能替代 Desktop 原生验收。

### 4. R1 同单返修（只读准入）

新基线 `b5dbe7c18298593307a59b33b00b4d1b055f51f9`。四组反例先 RED（`7 failed | 63 passed`），最小 GREEN 后定向 `70 passed`；完整原始输出与真实退出码见 `I03-B-R1-check.txt`。

- **签名期间一致性**：签名结束后、解析与裁决前，重新读取同一句柄和路径状态并与 open 后状态比较。反例：注入签名读取器同长改写文件再返回合法签名，准入拒绝 `stage=file`；未改文件照常通过。R1 当时的复核仅是 `dev/ino/nlink/size/mtime/ctime/birthtime` 状态指纹；R2 复审用真实入口证明同长改写可保持全部状态字段相等，因此 R3 在同一句柄上补做了从偏移 0 的有界内容摘要复核（见第 6 节），不再把状态指纹当作内容身份。该内容复核也不消除本次核验后到未来执行的窗口。
- **有界等待与迟到 owner**：`lstat`、`open`、句柄 `stat`、分块 read、读后与签名后状态复核全部与同一截止竞争。反例：open 停滞、lstat 停滞时，`timeoutMs=30` 均在返回时给出 `stage=cancelled` 与 `unresolvedResources`；迟到 open 的本次句柄由 `lateOpen` owner 用固定 1 s 预算唯一 close，返回不恢复成功、不写删输入。返回后实际落定不改变已返回结论。
- **默认签名 child 有限收尾**：只有观察到 `close` 才认定进程退出。反例：kill 返回 false 且不发 close 时，输出超限与取消都在 1 s 后报告 `releaseUnclear`（`did not close`），`destroy`/`unref` 父侧管道与进程引用、data 监听归零；迟到 close/error 仍有 owner 且无未处理错误。spawn error 不声称已看到 close。
- **唯一 close 与错误保真**：close 只启动一次并保存落定/未决结果，成功路径与失败 `finally` 共用。反例：真实 `FileHandle` close 拒绝时调用恰为 1 次，准入报 `stage=cleanup`；冻结签名主错加 close 失败时保留 `stage=signature`、原 `cause`、`originalError`，并附 `cleanupError`/`cleanupCause`；没有额外清理问题时不包装。

**未测与边界**：文件等待与 child 收尾均用注入/合成验证，未跑真实 PowerShell、用户证书或官方 EXE；失败清理预算固定 1 s，耗尽只报告未决/未确认，返回后迟到完成不构成已释放证明；准入结果仍不构成执行授权。

### 5. R2 同单返修（只读准入）

新基线 `23584f753a967daea24199ce4fcbc9408143d5ab`，产品代码仍为 R1 的 `fe96cb7`。两处组合缺口先 RED（`4 failed | 70 passed`，`RED_EXIT=1`），最小 GREEN 后定向 `74 passed`；完整原始输出见 `I03-B-R2-check.txt`。

- **child error 共用有限收口**：spawn 返回后的 `error` 事件不再直接 `finish`，而是进入与超限/取消相同的 `beginRelease`：保留首个 `pendingError`；已进入收尾时后续 error 不顶替主因、不清 close 等待 timer；只有 `close` 才确认退出，1 s 内未见 close 则报告 `releaseUnclear`（did not close），并 `destroy`/`unref` 父侧管道与进程引用、移除 data 监听。反例：error 且无 close 时 kill/destroy/unref 均 > 0、无未处理错误；error 后 close 及时则不报释放未确认；70 KiB 超限后 kill 失败再触发 EPERM error 时，仍返回输出超限主因。
- **总截止与先前签名失败叠加**：`signatureOutcome.stopped` 不再按 late error 的 `stage` 丢弃信息；默认适配器先完成自己的 1 s close 等待，返回时保留实际主因/cause 与 `releaseUnclear`，并附 `unresolvedResources`，不返回成功。反例：70 KiB、kill=false、无 close、`timeoutMs=50`，约 1 s 后返回 `stage=signature`、输出超限信息与未 close 报告，父侧管道/引用已释放；仅取消、超限但 close 及时、冻结主错加文件 close 失败等既有用例继续通过。
- **边界**：两个 1 s 收尾预算彼此独立（child close 等待、文件清理各一）；返回时的 `releaseUnclear`/`unresolvedResources` 仍是快照。未重开 R1 已修的文件一致性/等待/迟到 open/唯一 close 实现。

**R2 验证（口径订正）**：`node --check`、对应 ESLint、`npm run build`、`git diff --check` 通过。首次 GREEN 实际退出 1：`2 failed | 72 passed`，另有 1 个 FileHandle GC 未处理错误；随后重跑 `74 passed`、退出 0，不能写成首 GREEN 通过。两条失败不是注入未生效或时序噪声：其中签名期间同长改写用例后经真实入口复现为产品内容漏检（见 R3），另一条 `late close failure` 用例是 fixture 没有拥有迟到真实句柄的登记/关闭（见 R3）。一次完整 `npm run check` 退出 1：`13 failed | 2591 passed | 11 skipped`，8 个文件失败，首败在 `test/c14-conversation-refinement.test.ts`，其余集中在 `conversations`/`conversation-state-concurrency` 及依赖会话状态的用例；这些失败文件本轮零 diff。未连续重跑全量、未扩大白名单；不把 13 条都断言为同一已证原因。

### 6. R3 同单返修（内容复核与 fixture 迟到句柄）

新基线 `f38458fd5385a04706b283d696f66bdbf324c345`，产品仍为 R2 的 `915ba9f`。两个已证问题先 RED（`2 failed | 74 passed`，`RED_EXIT=1`），最小 GREEN 后定向 `76 passed`；完整原始输出见 `I03-B-R3-check.txt`。

- **同指纹、不同内容必须拒绝**：签名读取成功后、成功裁决前，在本次同一句柄上从偏移 0 再做一次有界流式 SHA-512；内容与固定摘要不符即 `stage=file`。保留原路径/句柄状态一致性检查、总截止与取消、唯一 close。确定性反例：真实小文件、真实 `readSignature` 同长改写，`lstat`/`handle.stat` 固定为第一次有效指纹（同长同 mtime/ctime），当前实现曾通过并返回不相符的 `integrity`；GREEN 拒绝。另一反例把签名后的第二次读取停在显式偏移上，`timeoutMs=30` 返回 `stage=cancelled`、`unresolvedResources` 含 `read`，真实 close 恰为 1 次。第二次读取同样受总截止约束，不整包缓冲。
- **fixture 独立等待迟到 open 并实际 close**：`lateOpen` helper 现在拥有每次实际 open 的完成 promise（真实句柄 + swap 登记），`settle()` 先释放 gate、等待已启动 open、恢复真实 `close` 并 await 其关闭；`finally` 先 `settle()` 再恢复注入和删根。迟到 close failure 用例改为先 `arrived()` 再等产品返回，确保命中“句柄已到、close 拒绝/未落定”阶段，未放宽断言。受控反证：产品已返回且 helper 尚未登记任何句柄时释放 gate，真实句柄到达后由 fixture 恢复并 close，随后 `stat()` 报 `EBADF`。
- **边界**：内容复核只覆盖本次核验内签名结束到裁决前，不消除核验结束到未来执行的替换窗口；fixture 修复只改测试，不改 I02 下载产品合同。

**R3 验证**：`node --check`、对应 ESLint、`npm run build`、`git diff --check` 通过；定向套件 `76 passed`。一次完整 `npm run check`（四个 VITEST 上限 2/1，未启用 `CROSSCHAT_LIVE`）退出 1：`11 failed | 2595 passed | 11 skipped`，7 个文件失败，首败在 `test/caller-source-service.test.ts`（`SOURCE_STATE_BUSY`，来自 `withStateLock acquired=false`），其余仍在会话状态/句柄相关用例；失败文件本轮零 diff。按任务原样保留原始输出，未连续重跑全量、未扩大白名单，不逐条断言为同一原因。

**R1 验证**：`node --check`、对应 ESLint、`npm run build`、代码范围 `git diff --check` 通过；定向套件 `70 passed`。一次完整 `npm run check`（四个 VITEST 上限 2/1）退出 1：4 个失败都在 `test/conversations.test.ts` 与 `test/conversation-state-concurrency.test.ts` 的会话锁用例，不属本轮改动模块；完整 stdout/stderr、首败与 `FULL_CHECK_EXIT=1` 保留在 `I03-B-R1-check.txt`。单文件复跑仍红；独立只读探针显示 `withStateLock` 按 temp 目录哈希选择 20000–39999 端口，新随机目录多次命中 `EADDRINUSE`，`recordConversation` 依既有 best-effort 语义静默放弃写入。该锁实现不在 R1 白名单内，未修改；R1 定向套件为绿，但完整检查未绿，交 root 判定。

## 四、用户拍板与影响

- 阶段 A 只新增研究/证据文档，**不触发用户拍板**。
- 阶段 B 只改两个既有文件和证据文档，不新增功能文件、依赖或用户命令，也不改变既有 CLI/报告/生命周期合同；**不触发用户拍板**。
- 默认 Authenticode 适配器在既有模块内实现，不引入新的用户操作/工具，属于技术前置，不是用户决定。`subject+thumbprint` 同时固定是 root 为本轮内部 CI 选定的比较策略，不是上游已证实合同；当前没有可信默认值，未来策略值仍须独立材料，但资料核实本身不自动升级为用户选择题。
- 需要用户决定的事项：真实官方包安装/卸载（独立干净 runner、安装前 baseline、实际执行）、要求终端用户手工配置策略、任何新增功能文件或必需用户操作变化。当前方案不包含这些。

## 五、边界与风险

- 本阶段不构成 C04 或正式 Desktop 通过证据；真实二进制、签名、安装、UI、Host 自然退出、官方卸载、注册清理、干净 runner 与托管首轮均未验证。
- 不把 NSIS/Electron 常识、OpenCode 或其它产品的参数/GUID/publisher 当作 Harness 事实。
- `uninstalled` 必须由 probe 依据卸载后实际状态给出；不能把官方卸载移入 sequence 的 remove 再要求 probe 事先声称已卸载。现有 I01 合同保持。
- 卸载器保留 Harness home 且锁定残留不令卸载失败；卸载退出码 0 不能证明数据/注册清理。
- 被拒读取与 I02 保留的 TEMP/cache 不属本单清理，均未触碰、未代删、未重试。

## 六、阶段 B 交付与验证记录

- 基线/提交：新基线 `e1dbefda0e3f7785d6088f1cb7afded1390bc06b`；RED `4c1e7c977a9ea88c0172263cb7d9a07e7af21e44`；GREEN 与两份文档、`I03-B-check.txt` 同提交，最终 HEAD 见本轮回报。只按显式路径本地 checkpoint，无 push/amend/切分支/共享回退。
- RED：新增 9 条准入用例先失败（`9 failed | 54 passed`），证明是业务断言而非 missing export；完整输出与 `RED_EXIT=1` 在 `I03-B-check.txt`。
- GREEN：定向套件 `63 passed`，`GREEN_EXIT=0`；`node --check` 通过；`npx eslint scripts/dsh-compat-ci.mjs test/dsh-compat-ci.test.ts` 通过；`npm run build` 通过。
- 完整检查：四个 `VITEST_MAX/MIN_FORKS/THREADS=2/1` 下只跑一次 `npm run check`，`231` 个文件通过、`2593` 个测试通过、`11` 个既有 live 用例跳过，`FULL_CHECK_EXIT=0`；完整 stdout/stderr 在 `I03-B-check.txt`，未筛全量、未增 skip、未改语义。
- 清理：只使用本轮独占 TEMP fixture；测试在 `finally` 释放 gate/句柄/补丁。未触碰旧日志、baseline、root 记录、被拒 5 个 HTTP 资源或 I02/W05 历史 TEMP/cache。

## 七、停止

阶段 B、同单 R1、R2 与 R3 交付完成。停写等待 root 双轴复审；不自行进入安装/卸载执行阶段、不关闭 I03 整体或 C04，不轮询。完整检查的会话锁相关失败已如实保留，未以定向绿替代，也未修改白名单外实现。
