# C04 Windows 正式包准入与安装/卸载合同研究

2026-11-02（UTC+8）。阶段 A 只读研究：未下载或执行官方 EXE，未安装/卸载/启停 Desktop 或 Host，未写注册表/协议/用户配置，未发新增网络请求。固定上游提交 `687f282e8625c6b8d11ff58211a90524be2e4317`，本文引用其 permalink 前缀：

`https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/`

证据分三级，后文逐项标注：

- **A 固定源码/仓库证据直接证实**：来自固定提交的源码行，或本仓库已验收的 I01/I02 合同与研究记录。
- **B 仅模板/通用推测**：NSIS、Electron Builder 的常见行为，或从 UI 配置外推的命令行行为。**不作为实施事实。**
- **C 待真实发行包或干净 runner 验证**：源码无法固定，或读取被自动审批阻断。

本阶段不重试任务书列出的 5 个被拒资源，也不以换工具、换 URL 或委托其它 agent 的方式绕行；缺失保持待核实。

## 一、固定发行物与可信准入链

| 项目 | 当前已知 | 分级 | 证明边界 |
| --- | --- | --- | --- |
| 平台与版本窗口 | Windows x64；已批准 `>=0.2.1-rc.2 <0.3.0-0` | A | I02 既有窗口；不覆盖其它平台。 |
| 官方 feed | `https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml` | A | 仓库 `scripts/dsh-compat-baseline.json` 已固定。 |
| 精确版本 URL | `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.1-rc.2-win-x64.exe` | A | 元数据固定；不是可变 `latest` 地址。 |
| 字节数与摘要 | `289385456` 字节；SHA-512 `39POl5os…45g==` | A（元数据） | I02 只证明“传输字节与固定元数据一致”；尚无真实下载执行。 |
| 实际二进制内容 | 未验证 | C | 未校验 Authenticode、安装后 runtime descriptor 或文件内容。 |
| 发布者 | 源码无固定主体/指纹 | C | 见第三节；必须由调用方提供已独立核实的策略。 |

**准入链的最小含义**：I02 下载结果（精确 URL、固定大小、SHA-512 校验通过、独占目录、`wx` 创建）只把“候选文件”交给准入层；准入层还必须完成签名身份核验。传输一致不等于发布者可信，也不等于可安装。准入结果只是对本次文件的一次观测，不是可传给任意执行器的不可伪造授权；未来执行层仍须在 spawn 前重新核验它实际执行的字节和目的地。

## 二、安装合同

固定源码事实来自任务书所列 root 独立只读审查结果，本文按同一固定提交引用；这些事实不等于真实发行包已经验证。

| 项目 | 已知 | 分级 | 结论与缺口 |
| --- | --- | --- | --- |
| 安装器类型与模式 | `apps/desktop/scripts/electron-builder-config.mjs:238–261`：NSIS、`oneClick:false`、`perMachine:false`、`allowElevation:false`、`allowToChangeInstallationDirectory:false` | A | 辅助式安装、当前用户级、不请求提权、无“更改安装目录”页面。 |
| 提权与用户范围 | 同上；`apps/desktop/scripts/installer.nsh:32–44` 拒绝 all-users 及已有 HKLM 安装 | A（组合） | 当前用户安装，不走 all-users/HKLM；真实包在干净 runner 上的实际行为仍为 C。 |
| 静默模式 | `apps/desktop/scripts/installer.nsh:70` 存在静默分支 | A（分支存在） | **不能**据此确认 `/S` 开关名、参数拼写或静默时的完整行为；这些是 B/C，不得当事实。 |
| 目录选择 | UI 目录页被禁用（`allowToChangeInstallationDirectory:false`）；`installer.nsh:242` 写 `InstallLocation` | A（源码行为） | 命令行 `/D=` 是否仍生效、`InstallLocation` 的键路径/值、默认安装根均未确证；不能由 UI 配置外推。 |
| 安装后是否启动应用 | 未确证 | C | 任务书明确“静默自启动”尚未确证；不得假设安装后不启动，也不得假设会启动。 |
| 安装产物 | `apps/desktop/README.md:131–141`：内置 `resources/runtime/cli/bin/dsh.cmd`；插件管理前初始化并完整退出，命令结束后才更新/卸载 | A（README 合同） | 真实安装后的文件布局、目录清单与卸载器文件名仍为 C。 |
| 官方卸载入口 | `apps/desktop/installer/uninstall.nsh:12–35` 存在；更新或 `KEEP_APP_DATA` 跳过数据清理，否则处理 Electron APPDATA/updater 缓存，保留 Harness home；锁定残留不令卸载失败 | A（源码行为） | 固定卸载器名、Apps & Features 注册项、卸载参数均未确证；卸载退出码 0 不等于数据/注册全部清理。 |
| 协议注册 | `electron-builder-config.mjs:108` 声明 `dsh` scheme；正式 main 启动调用 `app.setAsDefaultProtocolClient('dsh')`（研究记录） | A（声明/调用） | 实际注册表键、键值、由安装器还是应用创建、卸载是否撤销，均未确证。 |
| 当前用户数据 | 卸载器保留 Harness home 的 sessions/settings/credentials/plugins；不负责撤销用户手动安装的 `dsh` PATH 注册 | A（源码/研究记录） | 本仓库不能把“卸载成功”当作这些状态已清理。 |
| 已有安装冲突 | `installer.nsh:32–44` 拒绝已有 HKLM 安装 | A（源码） | 是否拒绝同版本 HKCU 安装、是否会覆盖/升级，未确证；干净 runner 必须先取安装前 baseline。 |

**被拒读取造成的确定缺口**：`apps/desktop/tests/windows-installer-smoke.ps1`、`windows-uninstall-smoke.ps1`、`apps/desktop/installer/pages.nsh`、`apps/desktop/windows-signing/README.md`、`apps/desktop/scripts/installed-update-qualification.ts` 未读取。它们可能固定静默参数、自启动、卸载器名或签名策略；本阶段不重试，因此上述 C 项保持 C。

## 三、签名合同

### 1. 三类证据分别证明什么

| 证据 | 证明 | 不证明 |
| --- | --- | --- |
| feed 中的 SHA-512 + 下载后重算摘要 | 收到的字节与固定 feed 元数据一致；传输未截断/未替换为该 feed 之外的字节。 | 发布者是谁；签名是否有效；文件是否可执行；安装是否安全。 |
| Authenticode 状态 `Valid` | 文件带有签名，签名链在 Windows 信任库下可验证，签名后内容未被改动。 | 签名者就是预期的 DeepSeek 发布主体；证书未被误发/滥用；时间戳与吊销状态（本阶段未确证）。 |
| 签名者 Subject（CN/O/C） | 证书声明的组织/名称。 | 该名称就是可信发布者；名称可被同名或相似主体冒充。 |
| 证书 Thumbprint | 精确锁定某一张证书。 | 该指纹来自可信来源；从待校验文件自身回抄的指纹没有独立证明力。 |

### 2. 预期发布者的可信来源

`apps/desktop/scripts/windows-sign.mjs:76–93` 表明发布者由发布环境证书的 CN/O/C 派生；**源码没有可信固定主体或指纹**。因此：

- 不能编造 DeepSeek 主体、thumbprint 或 GUID。
- 不能从同一个待校验文件、签名报告或安装包回抄期望值；那是自证。
- 可信来源必须是独立于待校验文件的材料，例如官方发布签名文档、官方公布的证书指纹/主体、或由用户/发布方书面确认的策略。当前仓库没有这份独立证据；`windows-signing/README.md` 的读取又被拒绝，故此项为 **C**。

### 3. 最窄接口

准入层可以接受调用方提供的已核实策略，但必须**没有默认值**，缺失即拒绝安装：

```text
{ publisher: { subject: string, thumbprint: string } }
```

`subject` 与 `thumbprint` 都要非空、有长度上限，并与 Authenticode 读取结果严格相等。只给 `status: 'Valid'` 不足以放行。当前尚无可信默认值。

这里要区分两类事项：**事实/技术前置**是“必须有一份独立于待校验文件的发布者材料”，以及既有模块内的默认只读签名适配器；前者仍缺证据，后者不新增用户操作。**用户决定**只在真正改变授权或用户操作时成立，例如新增功能文件、要求终端用户手工配置策略、执行真实安装/卸载。`subject+thumbprint` 同时固定是 root 为本轮内部 CI 选定的比较策略，不是上游已证实的发布合同；取得可信策略值本身不自动升级为用户选择题。

## 四、生命周期与归属

沿用 I01 已验收合同，不重写：

1. **部分安装失败保留归属**：`runDshDesktopSequence` 的 `serialSequence` 在 install 抛错且带结构化安装信息时，记录 `retainedInstallation`（label、version、root、installationId、owner、真实 reason）；不进入 probe/remove，也不安装下一构建。
2. **Host 退出未确认不卸载**：`hasDesktopCleanupProof` 要求 `hostExited === true`；未确认即 release unknown，序列停止。关窗可能只是隐藏，不能当作 Host 已退出。但该证明在 sequence 中是**最终核验**：序列先运行 probe，再核对 cleanup，因此它只阻止后续 `remove`，不能阻止 probe 内部提前 spawn 卸载器。真正的“未退出零卸载”守卫必须放在未来卸载 spawn **之前**；现有卸载接口没有这个 spawn 前守卫，属于待闭合缺口。
3. **官方卸载与注册清理分开核对**：cleanup 分别要求 `uninstalled`、`registrationRemoved`、`systemRegistrationRemoved`，且 `forced === false`、无 errors；卸载器退出码 0 本身不是任何一项的证明。
4. **probe 报告已要求官方卸载完成**：`desktopChecks` 含 `official-uninstall`，PASS 还必须有完整 cleanup 证明。I01 的 probe 合同已经要求“官方卸载完成”，不是本阶段新增的循环要求。
5. **sequence 的 remove 只清自有目录**：`remove` 在 release 证明之后删除本次独占的安装目录/任务目录；不能把官方卸载移到 `remove` 再要求 probe 事先声称已卸载。官方卸载仍发生在 probe/runner 的生命周期内，`remove` 消费释放证明。
6. **系统注册归属**：`dsh` 协议可能由安装器声明，也可能由应用启动时 `setAsDefaultProtocolClient` 创建；两者都可能留下 HKCU 注册。清理证明必须相对安装前 baseline 判断“本次创建”并只撤销本次项，保留用户原有注册。当前仓库只能验证 cleanup 布尔值，不能独立核验注册表；这是 probe/runner 的证据责任。
7. **卸载残留**：卸载器保留 Harness home，且锁定残留不令卸载失败；因此卸载后仍可能有用户数据、缓存或注册项。自有目录清理失败要保留并报告，不得用卸载退出码 0 覆盖。

## 五、阶段 B 已实现的只读准入与未闭合的执行层

### 1. 复用边界与既有进程框架的真实差距

- 安装包来源仍只用 I02 `downloadDshDesktopInstaller` 的返回值；不重写下载器、流式校验或超时框架。
- 准入实现在既有 `scripts/dsh-compat-ci.mjs`，不新增功能文件。
- 安装/卸载执行层本轮不实现。既有 `runDshProcess` **不是完整执行基础**：不接 `AbortSignal`；stdout/stderr 各只保留最后 128000 字符，没有 `truncated` 标记；timeout 发 kill 后立即返回，不等 `close`，也不提供 `signal`/`close` 确认。因此“超时返回”不能当作进程已释放或安装已停止的证明。本轮不借机重写共享进程框架。
- 生命周期仍复用 `runDshDesktopSequence`、`runDshDesktopAttempt`、`hasDesktopCleanupProof`；但 cleanup 是最终核验，只阻止后续 `remove`，不能阻止 probe 内提前 spawn 卸载器，且卸载接口没有 spawn 前 Host 退出守卫。

### 2. 已实现：只读准入组件

| 边界 | 实现 | 行为 |
| --- | --- | --- |
| 准入策略 | 私有 `parseDshDesktopPublisherPolicy` | 只接受 `{ publisher: { subject, thumbprint } }`；两者非空、长度/十六进制格式有界；无默认值；缺失或畸形在文件读取和子进程前拒绝。 |
| 发行物身份 | 复用 `desktopInstallerPlan` | 重新推导版本、精确 URL、filename、size、SRI，不信任调用方记录的成功字段。 |
| 文件 | `lstat` + `open('r')` + 句柄 `stat` | 绝对本地路径；拒绝链接、非普通文件、`nlink !== 1`、大小不符；读盘前后以及**签名结束后、本次裁决前**都复核句柄与路径的 `dev/ino/nlink/size/mtime/ctime/birthtime`。该状态指纹不是内容身份：签名读取成功后，在**同一句柄**上从偏移 0 再做一次有界流式 SHA-512 核对，内容不等于固定摘要即 `stage=file` 拒绝；不整包缓冲。 |
| 摘要 | 流式 SHA-512 | 64 KiB 分块，按固定大小有界，不整包 `Buffer.concat`；大小或摘要不符拒绝。 |
| 签名 | 注入或默认 Windows 适配器 | 默认 `powershell.exe`：常量脚本、`-NoProfile -NonInteractive -WindowStyle Hidden -Command`、路径放 `DSH_ADMIT_SIGNATURE_PATH` 环境字段、`shell:false`、`windowsHide:true`、64 KiB 输出上限。只有观察到 `close` 才认定子进程已退出；kill 失败或无 close 时，有限等待后报告释放未确认，并 `destroy`/`unref` 父侧管道和进程引用、移除 data 监听；迟到 close/error 仍有 owner 且不产生未处理错误。spawn 返回后的 `error` 事件不直接结束：它进入同一条有限收尾，只保留首个主因（超限/取消先行时 error 不覆盖），见到 close 才确认退出，否则报告未确认并释放父侧。输出先按 unknown 解析；只有 `status === 'Valid'` 且 subject/thumbprint 与策略严格相符才通过。 |
| 取消与资源 | 单一截止 + 有限收尾预算 | 同一截止与 `lstat`/`open`/句柄 `stat`/分块 read/前后状态复核/签名读取/成功裁决竞争；预先取消、执行中取消或超时都不返回成功，也不在取消后启动签名。截止时未落定的操作在错误中如实记录为 `unresolvedResources`；迟到 open 的本次句柄由后台 owner 唯一关闭并记录 `lateOpen`，不恢复成功、不写删输入。失败清理另有固定 1 s 预算，预算耗尽按未决/未确认报告，不重新打开无限等待。总截止落在签名读取上时，默认适配器先走完自己的 1 s close 等待，返回值保留其实际主因/cause 与 `releaseUnclear`（不按 `stage` 丢弃），并附 `unresolvedResources`；即使 late 值成功也不返回成功。 |
| 唯一 close 与错误保真 | 单一 close 状态 | 文件 `close` 只启动一次并保存落定/未决结果；成功路径与失败 `finally` 共用该结果，不重复调用。close 失败或未落定不能交付成功。原始文件/签名失败与清理失败并存时，保留主因、已有 `cause`、`cleanupError`/`cleanupCause`；冻结或假值异常用明确包装保留 `stage`、原始 `cause` 与 `originalError`，不吞掉清理信息；没有额外清理问题时不包装。 |
| 返回值 | `{ path, version, size, integrity, filename, publisher }` | 只报告本次观测；不启动安装器/卸载器，不写安装目录、注册表、协议或用户配置。 |

该结果**不是**可伪造的安装授权：它不把“已核验的字节”绑定到未来实际执行的进程，也不承诺核验结束后到执行之间文件不变。未来执行层必须重新核验实际执行文件与目的地。

### 3. 未实现且不得据此执行的部分

- 本轮没有 `runDshDesktopInstaller` / `runDshDesktopUninstaller` wrapper，也不修改 `runDshProcess`、`main()`、workflow、reporter、UI 或 baseline。
- 显式 `arguments` + 绝对 `root` 只是调用方**声明**，不证明安装器实际写入的位置；不能据此保证外来安装不受影响。安装目的地约束、安装前 baseline 和失败关闭仍需具体方案与证据。
- 卸载器 spawn 前的 Host 退出守卫尚未实现；最终 `hasDesktopCleanupProof` 不能替代它。
- 准入结果不绑定实际执行字节；执行层必须对即将 spawn 的同一文件重新读盘、重算摘要并重验签名。
- `runDshProcess` 目前不能兑现 `signal`，超时返回也不是释放确认；执行层若需要这些保证，必须另行闭合，不能把普通进程 wrapper 记为已具备安全安装能力。
- 准入组件的有限收尾预算（文件清理与签名子进程各 1 s）只保证返回时如实报告未决/未确认，不保证之后一定落定；返回后迟到完成可能发生，文档和结果不得把它写成已释放。

### 4. 必须保留待证据、不得猜的部分

- `/S`、`/D=` 的确切拼写与语义；静默自启动；固定卸载器名。
- 默认安装根、`InstallLocation` 的键路径/值、卸载注册表项/GUID、产品名。
- `dsh` 协议注册的实际键与卸载撤销行为。
- 默认发布者主体/指纹、时间戳与吊销行为。
- 真实包安装后是否启动应用、实际文件布局、同版本 HKCU 冲突/升级行为。

这些需要真实官方包在独立干净 runner 上观测；注入测试只能证明边界拒绝与签名解析，不证明 Desktop 原生行为。

### 5. 文件与范围

- 只改 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts` 和两份证据/研究文档；不新增功能文件、依赖或用户命令。
- 不改 `main()` 的 Desktop 入口、`.github/workflows/dsh-compat.yml`、reporter、UI driver、Web 默认入口或全局安装。
- 默认签名适配器位于既有模块内，不新增用户操作，属于技术前置而非用户决定。用户决定只在真实安装/卸载、新增功能文件或必需用户操作变化时触发；可信策略值本身仍需独立材料，但不自动升级为用户选择题。

## 六、验收入口与反例

| 保证 | 反例/验收点 | 接线点 |
| --- | --- | --- |
| 签名/摘要不符零安装 | 摘要不符、`status !== 'Valid'`、subject 不符、thumbprint 不符、策略缺失/空串：准入抛错，spawn 调用次数为 0，未创建安装目录 | `admitDshDesktopInstaller` + 注入 `readSignature` 与进程执行器 |
| 准入结果不绑定执行字节 | 准入通过后文件被替换：未来执行层不得直接 spawn 已返回的 `path`；必须在 spawn 前对同一路径重新读盘、重算摘要并重验签名 | 未来执行层；本轮不实现 |
| 已有/外来安装不触碰 | 安装前 baseline 发现已有 HKLM/HKCU 安装或外来目录：拒绝安装；不调用卸载器、不删除目录。显式 `arguments` + 绝对 `root` 只是声明，不构成安装位置证明 | install 操作 pre-check + 目的地约束证据；本轮未实现 |
| 部分安装保留 | 安装器异常退出或超时，但已产生 root：`retainedInstallation` 保留 root/installationId/owner/reason；不 probe、不 remove、不装下一构建 | 既有 `serialSequence` |
| 未确认 Host 退出零卸载 | 卸载 spawn **之前**未确认 Host 已退出：不得 spawn 卸载器。现有 `hasDesktopCleanupProof` 只在 probe 之后核验，不能阻止 probe 内提前卸载 | 未来卸载接口的 spawn 前守卫；本轮未实现 |
| 卸载失败停止序列 | 卸载器异常/超时，或 probe 报 `uninstalled:false`：release unknown，不进入 candidate | probe + sequence |
| 卸载退出 0 但注册残留 | `systemRegistrationRemoved:false` 或 `registrationRemoved:false`：不得 PASS | cleanup 布尔值 + probe 观测 |
| 自有目录删除失败 | remove 抛错：保留归属并停止；不得报告 installationCleanup=removed | 既有 `serialSequence`/`remove` |
| 真实原生验收 | 独立干净 runner + 安装前 baseline（进程、目录、注册表、协议）；安装；观测；Host 自然退出；官方卸载；卸载后对比；证据保留 | 不属于本阶段；注入测试不能替代 |

## 七、边界与结论

- 本阶段只确证了部分合同：安装器模式、当前用户/无提权、all-users/HKLM 拒绝、静默分支存在、`InstallLocation` 写入、卸载器数据行为、内置 runtime、协议声明均有固定源码证据；静默开关、目录参数、自启动、固定卸载器名、默认安装根、注册表键、发布者默认值均缺证据。
- 阶段 B 已实现证据支持的只读准入组件：策略缺省拒绝、同一普通独占文件的流式摘要与前后状态核验、**签名期间文件一致性复核**、签名 `Valid` + subject/thumbprint 比对、单一截止覆盖全部文件等待、迟到句柄 owner、签名子进程有限收尾与释放未确认报告、唯一 close 与清理错误保真。R1 反例还确认：清理预算耗尽只报告未决/未确认，之后实际落定不改变已返回结论；`unresolvedResources` 是返回时的保守快照，不是后续完成的证明。R2 补确认：spawn 后的 child `error` 与超限/取消共用同一条有限收尾，首个主因不被后续 error 顶替；总截止与先前的签名失败叠加时，签名主因和 `releaseUnclear` 仍随返回可观察，不因 `stage` 被丢弃。R3 补确认：同指纹同长改写不是已修正——签名后同一句柄的第二次内容摘要核对才提供内容身份，该读取同样受总截止/取消约束；测试 fixture 对迟到真实句柄另行等待登记并实际 close。它不启动安装器，不构成不可伪造的安装授权，也不消除本次核验结束到未来执行之间的替换窗口。
- 安装/卸载执行层仍未实现：显式 `arguments` + 绝对 `root` 不证明安装位置，卸载 spawn 前没有 Host 退出守卫，`runDshProcess` 不能兑现 `signal` 且超时返回不是 close/释放证明。真实安装/卸载必须等独立干净 runner、安装前 baseline、目的地约束方案和独立可信的发布者策略。
- 不把 NSIS/Electron 常识、OpenCode 或其它产品的参数/GUID/publisher 当作 Harness 事实。
- 不声称 C04 或正式 Desktop 已通过；不关闭 C04。
