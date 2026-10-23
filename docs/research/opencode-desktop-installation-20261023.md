# OpenCode Windows 桌面发布包安装与清理调查

2026-10-23。本文仅记录官方发布元数据、发布源码与打包器源码调查；本文作者未安装或执行桌面包。安装、真实 UI 验证和清理结果应另记验收证据，不能用本文替代。

## 当前构建与来源

当日 GET [官方桌面更新元数据](https://opencode.ai/update/api/latest/desktop/opencode) 返回 `2.1.3`，`metadata.github.sha` 为 `37d973754ba6cc31732f93421c0c18b675841573`。以下 OpenCode 源码均固定到该提交，不能只沿用此前 `bb25...` 的调查。

| 字段 | Windows x64 发布值 |
| --- | --- |
| 文件 | `opencode-desktop-win-x64.exe` |
| 不可变 URL | `https://opencode.ai/files/bin/2.1.3/opencode-desktop-win-x64.exe` |
| 大小 | `250321424` 字节 |
| SHA-256 | `18ed79327878bd373a65e9ce96020439bd7618661a11d62046aeab53422f6912` |
| 更新元数据中的 Windows releaseDate | `2026-10-22T12:00:49.112Z` |

应先解析一次元数据，再按其中固定 URL 下载并核对大小、摘要与 Windows 签名，不重新查询 `latest` 拼接下载地址。[官方下载页](https://opencode.ai/download)的 Windows x64 按钮也属于该分发渠道。源码 package.json 的版本文字可能由发布流水线替换，实际版本仍应读取安装后应用元数据及 `resources/opencode-cli.version`。

桌面 updater 明确 `autoDownload=false`，Windows 下 `autoInstallOnAppQuit=false`；本轮不触发下载/安装更新动作，以保留精确版本。[updater platform](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/gui-extensions/src/updater/platform.ts)

## 安装器与注册项

[发布打包配置](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/electron-builder.config.ts)固定 `appId=ai.opencode.desktop`、`productName=OpenCode`，Windows 为 NSIS、`oneClick:true`、`perMachine:false`。自定义安装宏只给安装目录及其后代增加 Chromium sandbox 的读取/执行 ACL，没有自定义卸载宏。[installer.nsh](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/resources/windows/installer.nsh)

该发布源码使用 `app-builder-lib/electron-builder 26.15.7`。[依赖版本](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/package.json)对应的 [NSIS 安装区段](https://unpkg.com/app-builder-lib@26.15.7/templates/nsis/installSection.nsh)表明，静默 one-click 安装仅在显式 `--force-run` 时启动应用；普通 `/S` 不执行安装后的 `StartApp`。`--no-desktop-shortcut` 可以阻止桌面快捷方式，但默认仍创建开始菜单快捷方式。[快捷方式宏](https://unpkg.com/app-builder-lib@26.15.7/templates/nsis/include/installer.nsh)

安装命令建议参数为 `/S --no-desktop-shortcut /D=<owned-root>\install`。`/D=` 必须最后、为绝对路径且不能带引号；使用无空格目录简化进程参数转义。NSIS 26.15.7 的 [multiUser.nsh](https://unpkg.com/app-builder-lib@26.15.7/templates/nsis/multiUser.nsh)显式支持 one-click 下 `/D` 覆盖。[NSIS 官方参数说明](https://nsis.sourceforge.io/Docs/Chapter3.html#installerusage)

预期项如下；仍应在安装后读取实际值，不能仅按推导删除：

| 项目 | 源码推导 |
| --- | --- |
| Windows executable | `<install>\OpenCode.exe` |
| 卸载器 | `<install>\Uninstall OpenCode.exe` |
| 安装 GUID | `d074f30d-5f88-5885-b075-be1348cc7676` |
| 安装 key | `HKCU\Software\d074f30d-5f88-5885-b075-be1348cc7676` |
| 卸载 key | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\d074f30d-5f88-5885-b075-be1348cc7676`，x64 registry view |
| 开始菜单 | 当前用户 Programs 目录下 `OpenCode.lnk`；未配置 menuCategory |
| 桌面快捷方式 | 当前用户 Desktop 目录下 `OpenCode.lnk`；本次使用 `--no-desktop-shortcut` |
| installer 缓存 | 真正 Windows LocalAppData 下 `<sanitized package name>-updater\installer.exe`；以源码 `@opencode/desktop` 推导为 `@opencodedesktop-updater\installer.exe`，安装后核对 |

GUID 按打包器的 `UUID.v5(appId, namespace=50e065bc-3134-11e6-9bab-38c9862bdaf3)`计算。[NsisTarget](https://unpkg.com/app-builder-lib@26.15.7/out/targets/nsis/NsisTarget.js)；[UUID 实现](https://unpkg.com/builder-util-runtime@9.7.0/out/uuid.js)。installer cache 名称来自 [AppInfo.updaterCacheDirName](https://unpkg.com/app-builder-lib@26.15.7/out/appInfo.js)，安装过程会把当前安装器复制到 Windows `$LOCALAPPDATA`。[安装宏](https://unpkg.com/app-builder-lib@26.15.7/templates/nsis/include/installer.nsh)

**`/D` 和环境变量不能当作全部安装影响都已隔离的证明，HKCU 注册尤其仍属于当前 Windows 账户。** 开始菜单、installer cache 和注册表应先做基线，卸载后按实际差异核对。若基线发现同 appId 的已有安装，不能运行此安装器：NSIS 会读取同 GUID 的旧卸载信息并尝试卸载旧版本，即使 `/D` 指向另一个目录。[旧版卸载逻辑](https://unpkg.com/app-builder-lib@26.15.7/templates/nsis/include/installUtil.nsh)

本轮静默安装后只读观察修正了上表的缓存/快捷方式落点：在本机这次传入受控 APPDATA/LOCALAPPDATA 后，实际 installer cache 和开始菜单快捷方式落在 owned task root 的 `profile/AppData` 子树，未落到此前列举的个人默认目录。运行证据优先于源码中的 `$LOCALAPPDATA`/`$SMPROGRAMS` 静态推导；不能由一次结果外推所有 Windows 机器的已知文件夹行为。

## 发布版运行隔离

[configureApplication](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/configure.ts)在首个 Electron window 前运行，发布包也接受 `OPENCODE_DESKTOP_TEST_ROOT`：

- `userData=<test-root>/desktop`，`sessionData=<test-root>/session`，编译缓存位于 userData。
- XDG data/config/cache/state 分别设到 `<test-root>` 对应子目录。
- 不修改 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`，也不修改系统账户、注册表或所有已知文件夹。
- 只有 `OPENCODE_TEST_ONBOARDING=1` 才修改 documents 并使用随机 onboarding root 和内存 DB；本轮不应混用它冒充持久发布版环境。

存在必须处理的状态目录细节：[preferApplicationEnvironment](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/environment.ts)在 Windows 不读取登录 shell 环境，并会删除 `XDG_STATE_HOME`。因此只设置 `TEST_ROOT=<temp>` 会让早期 probe 与稍后 service ensure 使用不同 registration 目录。官方 client 缺省采用 `homedir()/.local/state/opencode/service.json`。[client fallback](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/client/src/service-probe.ts)

建议布局：

```text
owned-root/
  install/                  官方安装文件
  profile/                  HOME、USERPROFILE、OPENCODE_TEST_HOME
    .local/                 OPENCODE_DESKTOP_TEST_ROOT
      state/opencode/       初始 XDG 路径与删除变量后的 home fallback 相同
      config/opencode/      mock provider 配置、受控 service 端口
      data/opencode/        数据库、日志
      cache/opencode/
      desktop/              Electron profile、staged CLI、logs、Crashpad
      session/              Chromium session data
  appdata/                  APPDATA
  localappdata/             LOCALAPPDATA
  tmp/                      TEMP、TMP
  workspace/                仅测试项目
```

`TEMP/TMP` 也必须隔离：[global-roots](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/util/src/global-roots.ts)将本机临时目录固定为 `os.tmpdir()/opencode`。模型只用 `127.0.0.1` mock provider，显式禁用真实 model catalog 拉取、升级与其他工具配置读取；不要从父环境继承模型 key 或其他会话身份。启动命令、诊断用 `--help/--version`、安装器及卸载器都须传相同受控环境，不能裸启动。

建议先预置同路径 `OPENCODE_CONFIG_DIR=<profile>/.local/config/opencode`、`OPENCODE_DB` 和空 `OPENCODE_MODELS_PATH`，并配置随机空闲 service 端口。数据库和 session 数据隔离仍须通过真实路径、PID 与文件写入检查验证，不把上述源码推导称作运行证据。

## 内置服务、身份和进程归属

发布桌面从 `resources/opencode-cli.exe` 读取 `opencode-cli.version`，把 CLI 复制到 `userData/cli/<version>-<arch>/opencode-cli.exe` 后启动；正常有 version 文件时不需要执行 `--version`。[DesktopCli](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/service/desktop-cli.ts)

桌面先用 bundled version 对已有服务做早期只读 probe，再 `Service.ensure()`，没有可用服务才以 staged CLI 执行 `serve --service`。发布版的 `OPENCODE_DESKTOP_ISOLATED_SERVER` 分支不生效，因为它明确要求 `!app.isPackaged`。[background-service](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/service/background-service.ts)；[早期 probe](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/service/sidecar-probe.ts)

服务 contender 以 `detached:true` 启动并继承桌面当前环境；关闭桌面窗口不能当作服务已经退出。应记录应用 PID、所有子进程，以及 registration 的服务 PID/可执行文件路径，再按真实 owner 收口。[spawnServiceContender](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/client/src/service-contender.ts)

发布桌面日志、网络日志与 Crashpad 有明确 userData 内路径。[DesktopLogging](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/native/logging.ts)。但 onboarding 调用 `finishFirstLaunchOnboarding(true)` 会创建 `app.getPath("documents")` 下默认项目；不能假定必须等用户点击后才会发生。为避免 fresh profile 的自动首启逻辑写真实 Documents，本轮 fixture 必须在启动前写 `<TEST_ROOT>/desktop/opencode.settings`，内容 `{"firstLaunchOnboardingComplete":true}`。官方初始化在该布尔值存在时直接返回，不再推断首启；据此明确不把本轮称作首启 onboarding 验收。另不触发 debug 日志导出，因为它使用系统 downloads。[onboarding](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/onboarding.ts)；[设置键](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/storage/keys.ts)

## 协议注册与 UI 验证入口

发布版 `prepareDesktop` 无条件调用 `app.setAsDefaultProtocolClient("opencode")`。`OPENCODE_DESKTOP_DISABLE_PROTOCOL_REGISTRATION=1` 只能阻止开发版注册，不能当发布版隔离开关。须保存并在卸载后复核 `HKCU\Software\Classes\opencode` 等实际协议注册，保护此前状态。[environment](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/environment.ts)

源码仅在开发版**自动附加** remote debugging port，未见删除用户显式 Chromium `--remote-debugging-port` 的代码。因此“发布版不自动开 CDP”是源码事实；“发布版显式传开关仍一定不能用 CDP”尚不能成立，需由真实发布包验证，且只能监听 loopback，不修改 app.asar 或伪装开发构建。[configure](https://github.com/anomalyco/opencode/blob/37d973754ba6cc31732f93421c0c18b675841573/packages/desktop/src/main/lifecycle/configure.ts)

## 卸载与核对清单

1. 首先保存安装前应用目录、安装 key、卸载 key、`opencode://` 协议、开始菜单/桌面快捷方式、updater cache 和默认个人 profile 目录的基线。
2. 安装后读取真实 `QuietUninstallString`，核对其程序位于本次唯一 install 目录；保留 installer/内置 CLI/staged CLI 的版本、摘要、签名及归属。
3. 完成验证后关闭 UI，单独停止 owned registration 对应的服务 PID，等待 renderer、GPU、Crashpad 和工具子进程退出；不能按 `OpenCode` 名称批量杀进程。
4. 使用实际官方 quiet uninstaller，通常等价于 `Uninstall OpenCode.exe /currentuser /S`，轮询进程与安装文件实际消失。正常卸载不要加 `--delete-app-data`：该选项按包名扫描用户 appdata，不懂本次 TEST_ROOT 的所有路径。[卸载模板](https://unpkg.com/app-builder-lib@26.15.7/templates/nsis/uninstaller.nsh)
5. 默认卸载会移除安装文件、快捷方式及安装/卸载 registry，但默认保留 appdata；检查而不假定 runtime 注册的协议及 installer cache 都已清除。只按基线差异和本次归属恢复/移除。
6. 最后核对 staged CLI、所有隔离 profile/db/cache、mock 服务、受控临时目录与下载，并保留代码、摘要、UI/协议验收证据。若删除/卸载被自动审批拦截，应如实记录待清理路径，不宣称卸载完成，不改名搬迁绕过。

本清单不授权修改第三方既有数据，也不意味着已经完成真实发布包的自动化或卸载验收。
