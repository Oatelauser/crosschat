# DeepSeek Harness

crosschat 通过官方 Host 插件桥发现并投递到 Harness 当前运行的根 Agent。它支持完整 ID、名称消歧、空闲唤醒、忙时 `queue/steer`、原生 shell 发信、会话回信，以及既有跨机器路由。无需把模型 API key 交给 crosschat。

桥依赖上游的面集中在官方插件入口；crosschat client 使用自有 protocol=1。Harness 仍处预发布，实验宿主窗口为 `>=0.2.1-rc.2 <0.3.0-0`，窗口内的新版本仍需行为 CI 验证。目前实际验证的是 Windows 上的官方 npm `0.2.1-rc.2`、Web Host 和普通交互会话。浏览器 UI、正式 Desktop 安装与 UI、Linux/macOS 尚未完成实测，不能由此推断通过。

## 安装桥

先按[官方指引](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/README.md)安装 Harness 及其插件管理所需的 pnpm，并安装本次开发版本的 crosschat。确认 `crosschat dsh-bridge-path` 能输出实际存在的 bundle 目录。

对于 npm CLI 的 Web profile，完全退出该 profile 后安装本地 bundle，再正常启动 Web：

```powershell
$bridge = crosschat dsh-bridge-path
dsh plugin --profile web add "file:$bridge" --offline --ignore-scripts
dsh web
```

Plugins 页面也可添加同一个本地 bundle。选择实际使用的 profile；装到另一个 profile 不会让当前会话出现。`dsh-bridge-path` 只读，不会安装插件或修改配置。插件管理器保存选择后，是否立即应用到运行中的 Host 取决于 HMR；**保存依赖不等于已经加载成功**，以安装结果的 `application/warnings` 为准，仅当结果指明未应用或需要重启时再重启该 profile（[Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/plugin-manager/README.md)）。

Desktop 具有独立的 `desktop` profile，由它的 Plugins 页面或其内置 `resources/runtime/cli/bin/dsh.cmd` 管理。命令行管理前先启动 Desktop 完成初始化，再完全退出应用；参数沿用 `plugin --profile desktop add "file:<桥目录>"`。系统 npm 的 `dsh` 不负责管理 Desktop profile。此路径来自[官方 Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#bundled-command-runtime)，本批尚未实测正式 Desktop 包。

### 更新与移除

`plugin` 子命令要求显式 `--profile`，其余参数原样转交给该 profile 目录下的 pnpm（[`apps/cli/src/args.ts:194–201`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/src/args.ts#L194-L201)）。卸载 crosschat 前，先从对应 profile 移除 bundle：

```powershell
dsh plugin --profile web remove @crosschat/dsh-bridge
```

添加时写的是 `file:<桥目录>`，移除用包名 `@crosschat/dsh-bridge`（见 `integrations/dsh/package.json`）。Desktop 沿用原有离线管理前提（先启动完成初始化、完整退出），运行其自带的 `resources/runtime/cli/bin/dsh.cmd plugin --profile desktop remove @crosschat/dsh-bridge`（[Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L131-L141)）。crosschat 升级改变了安装路径时，按新目录重新添加即可，不需要先移除；"先 remove 再 add"也不是必需顺序。crosschat 不自动调用原生管理器，也不替用户选择 profile。

## 让 Agent 使用 crosschat

把 crosschat 包中的完整 `skills/crosschat` 目录复制到 `<Harness home>/skills/crosschat`，或项目的 `.agents/skills/crosschat`。保留 `references` 子目录。桥目录的 `../../skills/crosschat` 是该 skill 的随包位置；Harness home 默认为用户的 `.dsh`，使用自定义 `DSH_HOME` 时以实际目录为准。现有 `crosschat install-skills` 只写 `.claude`/`.codex`，没有 Harness 写入行为，这份副本要手工复制和维护。

在 Harness 原生窗口打开目标会话，使其成为 live root Agent，再检查：

```bash
crosschat status --dsh --all --json
crosschat send --to "dsh/<完整会话ID>" --body "请检查这一项"
crosschat send --to "dsh/<完整会话ID>" --delivery steer --body "用户让我追加这项要求"
```

发信方 Agent 在原生 `pwsh/bash` 工具里运行命令；Harness 自动提供当前 `DSH_SESSION_ID`。收到的信封带有回复命令，照该命令回信即可保留会话和跨机路由。所有 `session-...` ID 都保留完整值，不能使用共同的前八位代替身份。外部普通终端可向目标发信，但不应伪造原生身份来冒充 Harness 会话。

`queue` 在目标忙时进入下一轮，`steer` 在下一步加入当前任务；空闲时都会启动处理。受理回执只表示原生 Agent 已接收，不表示模型已理解或完成。子 Agent、未打开的历史会话不在路由范围；找不到目标时 crosschat 报错，由用户在原生 UI 打开所需历史会话。

## 运行与维护

四类东西分开归属：crosschat npm 包（含桥目录与 skill 源）、复制进 Harness 的 skill 副本、所选 profile 里的插件引用、桥运行时登记。crosschat 只写最后一项；登记默认在用户主目录的 `~/.crosschat/dsh/instances`，不随 Harness 的 `DSH_HOME` 迁移，插件配置里已有的显式 `home` 会原样传给桥（`options.home ?? homedir()`）；skill 副本由用户手工复制，`crosschat install-skills` 仍只写 `.claude`/`.codex`；插件引用由 Harness 自己的插件管理器写进 profile。

插件与桥在 Host 进程内运行，几种情况要分清：同一 Host 内禁用插件会走桥的 disposer，撤销它自己的 listener 和登记；重新启用会生成新的实例登记，旧凭据随之失效；只撤销 `shellEnv` 子 scope 时仅撤身份贡献，HTTP 仍继续服务；Host 崩溃可能留下死 PID 登记，发现侧只读忽略、不删除，下次启动写新实例。禁用/启用的实测见[第三轮真实通过](development/evidence/dsh-20261023/third-live.json)，覆盖范围仅官方 npm Web runtime。Web 与 Desktop 的 profile 和插件管理器各归各的，不互相代管。

桥在同机 `127.0.0.1` 随机端口监听，以每次启动的随机 token 认证，登记位于 `~/.crosschat/dsh/instances`。crosschat 核对实例 PID、instance ID、runtime 版本及桥协议。登记是私有凭据，排错时只提供错误码和版本，不粘贴 token。跨机器通信走既有 SSH/TCP crosschat 通道，桥端口保持本机。

未安装桥时，Claude/Codex/OpenCode 的发现和发送照常可用。已有桥但失联、损坏或 owner 冲突时保留来源错误。`DSH_WRITE_UNCERTAIN` 表示写入结果待核实，先查目标历史再决定，系统不会盲目重发。

兼容 CI 的设计、实际覆盖和本次清理证据见[验收记录](development/dsh-validation-20261023.md)。官方插件和 Agent API 并非永久稳定承诺；后续版本通过固定基线、候选复现和 mock 模型检测变化。
