# DeepSeek Harness

crosschat 通过官方 Host 插件桥发现并投递到 Harness 当前运行的根 Agent。它支持完整 ID、名称消歧、空闲唤醒、忙时 `queue/steer`、原生 shell 发信、会话回信，以及既有跨机器路由。无需把模型 API key 交给 crosschat。

桥依赖上游的面集中在官方插件入口；crosschat client 使用自有 protocol=1。Harness 仍处预发布，实验宿主窗口为 `>=0.2.1-rc.2 <0.3.0-0`，窗口内的新版本仍需行为 CI 验证。目前已验证 Windows 上的官方 npm `0.2.1-rc.2`、Web Host 和普通交互会话；正式 Windows Desktop `0.2.1-rc.2` 也已在用户手动安装后，以隔离 profile 和 loopback 模型桩验证真实 UI 收发、技能加载、原生来源及插件开关。用户保留 Desktop 安装，因此官方卸载未测；Host 自然退出证明、干净 runner 和 Linux/macOS 仍未完成，不能由本机人工结果推断通过。

## 安装桥

先按[官方指引](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/README.md)安装 Harness 及其插件管理所需的 pnpm，并安装本次开发版本的 crosschat。确认 `crosschat dsh-bridge-path` 能输出实际存在的 bundle 目录。

对于 npm CLI 的 Web profile，完全退出该 profile 后安装本地 bundle，再正常启动 Web：

```powershell
$bridge = crosschat dsh-bridge-path
dsh plugin --profile web add "file:$bridge" --offline --ignore-scripts
dsh web
```

Plugins 页面也可添加同一个本地 bundle。选择实际使用的 profile；装到另一个 profile 不会让当前会话出现。`dsh-bridge-path` 只读，不会安装插件或修改配置。插件管理器保存选择后，是否立即应用到运行中的 Host 取决于 HMR；**保存依赖不等于已经加载成功**，以安装结果的 `application/warnings` 为准，仅当结果指明未应用或需要重启时再重启该 profile（[Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/boot/plugin-manager/README.md)）。

Desktop 具有独立的 `desktop` profile，由它的 Plugins 页面或其内置 `resources/runtime/cli/bin/dsh.cmd` 管理。命令行管理前先启动 Desktop 完成初始化，再完全退出应用；参数沿用 `plugin --profile desktop add "file:<桥目录>"`。系统 npm 的 `dsh` 不负责管理 Desktop profile。此路径来自[官方 Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#bundled-command-runtime)，已在正式 Windows 包的隔离 desktop profile 实测内置 CLI 安装及移除插件；实际发行物与旧源码研究的 build commit 不同，不能宣称一一对应。

### 更新与移除

`plugin` 子命令要求显式 `--profile`，其余参数原样转交给该 profile 目录下的 pnpm（[`apps/cli/src/args.ts:194–201`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/src/args.ts#L194-L201)）。卸载 crosschat 前，先从对应 profile 移除 bundle：

```powershell
dsh plugin --profile web remove @crosschat/dsh-bridge
```

添加时写的是 `file:<桥目录>`，移除用包名 `@crosschat/dsh-bridge`（见 `integrations/dsh/package.json`）。Desktop 沿用原有离线管理前提（先启动完成初始化、完整退出），运行其自带的 `resources/runtime/cli/bin/dsh.cmd plugin --profile desktop remove @crosschat/dsh-bridge`（[Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#L131-L141)）。crosschat 升级改变了安装路径时，按新目录重新添加即可，不需要先移除；"先 remove 再 add"也不是必需顺序。crosschat 不自动调用原生管理器，也不替用户选择 profile。

## 让 Agent 使用 crosschat

把 crosschat 包中的完整 `skills/crosschat` 目录复制到 `<Harness home>/skills/crosschat`，或项目的 `.agents/skills/crosschat`。保留 `references` 子目录。桥目录的 `../../skills/crosschat` 是该 skill 的随包位置；Harness home 默认为用户的 `.dsh`，使用自定义 `DSH_HOME` 时以实际目录为准。`crosschat install-skills` 现在把同一份技能覆盖安装到 Claude、Codex 和 Harness 三个目标（Harness 为 `<DSH_HOME>/skills/crosschat`，未设置或为空时 `<home>/.dsh/skills/crosschat`；`DSH_HOME` 必须是绝对路径）。项目内的 `.agents/skills/crosschat` 仍需手工复制，crosschat 不扫描项目或历史副本。

更新会覆盖安装源中同名的技能和 references，保留目标目录里的额外文件；doctor 比较安装源中的文件，额外文件不算内容不一致。`crosschat uninstall` 删除当前目标的整个 `skills/crosschat` 目录，包括这些额外文件，保留 Harness home、其它技能、profile、插件配置和聊天。改变 `DSH_HOME` 后，旧位置及项目副本仍由用户单独维护。`install-skills --dir <root>` 把三侧目标都放在指定 root 下，忽略宿主 `DSH_HOME`；卸载依当时的 home/`DSH_HOME` 重新计算当前目标，没有历史位置账本。

在 Harness 原生窗口打开目标会话，使其成为 live root Agent，再检查：

```bash
crosschat status --dsh --all --json
crosschat send --to "<完整会话ID>" --tool dsh --body "请检查这一项"
crosschat send --to "<完整会话ID>" --tool dsh --delivery steer --body "用户让我追加这项要求"
```

发信方 Agent 在原生 `pwsh/bash` 工具里运行命令；Harness 自动提供当前 `DSH_SESSION_ID`。收到的信封带有回复命令，照该命令回信即可保留会话和跨机路由。所有 `session-...` ID 都保留完整值，不能使用共同的前八位代替身份。外部普通终端可向目标发信，但不应伪造原生身份来冒充 Harness 会话。

`--tool` 始终表示收件类型，名称和原生 ID 中的斜杠保留原值；不再把 `dsh/` 加到 ID 前面。npm/Web Host 使用 `dsh`，正式 Desktop 使用发现结果对应的 `dsh-desktop`。本次正式 Desktop 的两条实际 UI 会话已完成原生 shell 发信及按真实 `cA000` hint 回信，不能靠修改类型参数代替原生验证。

`crosschat doctor` 和 `crosschat doctor --json` 使用与技能安装、TUI 维护和卸载相同的目标计划，检查 Harness 的 `SKILL.md` 及安装源中的全部 references。`DSH_HOME` 未设置或为空时检查 `<home>/.dsh/skills/crosschat`；绝对路径覆盖默认目录，相对路径产生警告，不按当前工作目录猜测。相同物理目标只检查一次。诊断只读，不覆盖过期文件，不扫描项目或历史副本；“与安装源一致”仅证明技能副本内容匹配，不证明原生会话已加载技能或插件。

doctor 文本、JSON 和 TUI 还会复用发现侧的桥握手，核对每个活实例的鉴权、owner、协议和原生版本：无活桥为 info；核对通过为 pass，显示完整实例 ID、Host PID、runtime 及已确认的 profile/类型，原生提供 profile 目录时一并显示；登记损坏、鉴权/owner/版本等异常为带固定错误码及恢复指引的 warn。新增警告本身不改变退出码，已有 error 仍决定失败。空会话的健康桥也可通过，桥握手不读取会话聊天。

同次诊断还读取当前 Harness home 已有的 profiles，以及活桥已核实的 profile 目录。未声明桥引用显示 info；已声明但缺少安装或元数据损坏显示 warn；桥安装文件与当前 crosschat 随包源一致显示 pass，内容不同显示 warn，并给出实际位置和版本。相同包版本不能证明文件已更新，内容不同也不直接判定用户定制已经过期。普通 pnpm/file 安装链接会解析到实际目标；未核实的 profile 链接保留警告。

活桥与 profile 检查共享 5 秒预算，没有自动重试；取消会回收诊断子进程和请求。文件读取上限为每项 64KiB，目录枚举有界，超限保留警告。诊断保留原文件，输出中不含 token、鉴权地址、依赖地址或完整秘密配置。profile 和技能目录可能来自不同位置；桥未运行不等于软件或插件未安装，安装文件一致也不等于运行中的 Host 已加载这版。静态配置不足以证明最终禁用/启用状态时，按 live 握手或原生 Plugins 页面核实。

`queue` 在目标忙时进入下一轮，`steer` 在下一步加入当前任务；空闲时都会启动处理。受理回执只表示原生 Agent 已接收，不表示模型已理解或完成。子 Agent、未打开的历史会话不在路由范围；找不到目标时 crosschat 报错，由用户在原生 UI 打开所需历史会话。

## 运行与维护

四类东西分开归属：crosschat npm 包（含桥目录与 skill 源）、复制进 Harness 的 skill 副本、所选 profile 里的插件引用、桥运行时登记。crosschat 只写最后一项和技能副本；登记默认在用户主目录的 `~/.crosschat/dsh/instances`，不随 Harness 的 `DSH_HOME` 迁移，插件配置里已有的显式 `home` 会原样传给桥（`options.home ?? homedir()`）；skill 副本由 `crosschat install-skills`、TUI 维护和 `crosschat uninstall` 共用同一目标计划覆盖安装或移除（Claude、Codex、Harness 三处，项目 `.agents/skills` 不在其中），插件引用由 Harness 自己的插件管理器写进 profile。

插件与桥在 Host 进程内运行，几种情况要分清：同一 Host 内禁用插件会走桥的 disposer，撤销它自己的 listener 和登记；重新启用会生成新的实例登记，旧凭据随之失效；只撤销 `shellEnv` 子 scope 时仅撤身份贡献，HTTP 仍继续服务；Host 崩溃可能留下死 PID 登记，发现侧只读忽略、不删除，下次启动写新实例。npm Web 的禁用/启用实测见[第三轮真实通过](development/evidence/dsh-20261023/third-live.json)。正式 Desktop 也已通过其原生 Plugins UI 验证登记撤销/新实例和会话保留，但本轮未单独重测旧凭据失效；见[Desktop 验证边界](development/evidence/c04-worker-20261029/I03-C3-execution-plan.md#11-正式desktop人工原生验收与运行数据清理)。Web 与 Desktop 的 profile 和插件管理器各归各的，不互相代管。

桥在同机 `127.0.0.1` 随机端口监听，以每次启动的随机 token 认证，登记位于 `~/.crosschat/dsh/instances`。crosschat 核对实例 PID、instance ID、runtime 版本及桥协议。登记是私有凭据，排错时只提供错误码和版本，不粘贴 token。跨机器通信走既有 SSH/TCP crosschat 通道，桥端口保持本机。

未安装桥时，Claude/Codex/OpenCode 的发现和发送照常可用。已有桥但失联、损坏或 owner 冲突时保留来源错误。`DSH_WRITE_UNCERTAIN` 表示写入结果待核实，先查目标历史再决定，系统不会盲目重发。

兼容 CI 的设计、实际覆盖和本次清理证据见[验收记录](development/dsh-validation-20261023.md)。官方插件和 Agent API 并非永久稳定承诺；后续版本通过固定基线、候选复现和 mock 模型检测变化。
