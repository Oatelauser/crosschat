# C04-I03 阶段 A 交付说明（供 root 审查）

执行 `cworker1`，分支 `codex/core-refactor-pre-tui`。派单基线 `521e889d07831244456c80ac804541d7047509e8`；研究文件提交 `86f167e5b518989a0301c2e366c27382e4cffa7c`。本文件所在提交为阶段 A 终点（最终 HEAD 见本轮回报）。开工与收尾均核对：工作区仅原未跟踪 `docs/代码消息投递.md`，未动未 stage。

阶段 A 只新增两份文档，不改产品/测试，不新增功能文件；未下载/执行官方 EXE，未安装/卸载/启停 Desktop 或 Host，未写注册表/协议/用户配置，未发新增网络请求，未跑 npm 全量或原生 probe。

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

## 三、最窄后续实现建议（阶段 B 候选，尚未下发）

只改两个既有文件，不新增功能文件：

- `scripts/dsh-compat-ci.mjs`
  - `parseDshDesktopAdmissionPolicy(input)`：严格校验调用方策略，无默认值。
  - `admitDshDesktopInstaller({ path, artifact, policy, readSignature })`：绝对路径/普通文件 → 重算 SHA-512 与 I02 `artifact.integrity` 相等 → `status === 'Valid'` → subject/thumbprint 严格相等；任一步失败即抛错，调用方不得 spawn。
  - `runDshDesktopInstaller({ admitted, plan, signal, timeoutMs })`：`plan` 必须显式提供 `arguments` 与绝对 `root`；不提供默认静默开关/默认目录/默认卸载器名；复用 `runDshProcess`。
  - `runDshDesktopUninstaller({ admitted, plan, signal, timeoutMs })`：显式提供绝对卸载器路径与参数；只返回进程证据，不设置 `uninstalled`。
- `test/dsh-compat-ci.test.ts`
  - 新增一组准入/执行边界用例，注入 `readSignature` 与进程执行器；不跑真实安装器。
  - 关键反例：签名/摘要不符零安装（spawn 次数 0、无目录）；已有/外来安装不触碰；部分安装保留；未确认 Host 退出零卸载；卸载失败停止序列；卸载退出 0 但注册残留不得 PASS；自有目录删除失败保留归属。
  - 既有用例不改；`main()`、workflow、reporter、UI driver、Web 默认入口、全局安装均不动。

可立即实现的是“失败关闭的准入/执行边界”；必须保留待真实包或干净 runner 验证的是静默参数、目录参数、自启动、卸载器名、默认根、注册表键、发布者默认值与真实签名结果。注入测试不能替代 Desktop 原生验收。

## 四、用户拍板与影响

- 阶段 A 只新增研究/证据文档，**不触发用户拍板**。
- 阶段 B 若按上述范围只改两个既有文件，仍不需要新增功能文件，也不改变既有 CLI/报告/生命周期合同；但需 root 明确白名单后才实施。
- 需要用户决定的事项：真实官方包安装/卸载（独立干净 runner、安装前 baseline、实际执行）、可信发布者策略的具体值、默认 Authenticode 适配器若引入新的用户操作/工具，或任何新增功能文件。当前方案不包含这些。

## 五、边界与风险

- 本阶段不构成 C04 或正式 Desktop 通过证据；真实二进制、签名、安装、UI、Host 自然退出、官方卸载、注册清理、干净 runner 与托管首轮均未验证。
- 不把 NSIS/Electron 常识、OpenCode 或其它产品的参数/GUID/publisher 当作 Harness 事实。
- `uninstalled` 必须由 probe 依据卸载后实际状态给出；不能把官方卸载移入 sequence 的 remove 再要求 probe 事先声称已卸载。现有 I01 合同保持。
- 卸载器保留 Harness home 且锁定残留不令卸载失败；卸载退出码 0 不能证明数据/注册清理。
- 被拒读取与 I02 保留的 TEMP/cache 不属本单清理，均未触碰、未代删、未重试。

## 六、停止

阶段 A 完成。停写等待 root 复审；不自行进入阶段 B 或下一个功能任务，不轮询，不关闭 C04。
