# C13-I02 交付与事实核对

2026-10-29（UTC+8）。执行者 `cworker1`，root 派单/独立审查。仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`。派单基线 `8f542eb50eec9de63ea0b0625950194561421827`；开工时 HEAD 即该提交，期间并行短柄线提交 `303e7ce`、`3f0519d`、`984b434` 推进 HEAD，`git log 8f542eb..984b434 -- <本单白名单>` 为空，本单独立 commit 的父提交为 `984b434f9281e16b72a6a80e9b80afae0e987321`。无 checkout/pull/reset/clean/stash/amend/push；未跟踪的 `docs/代码消息投递.md` 未改、未 stage。

## 1. 交付文件

| 文件 | 变更 |
| --- | --- |
| `docs/deepseek-harness.md` | 安装桥补"保存≠加载"与"更新与移除"（Web/Desktop 的准确 remove 命令）；让 Agent 使用 crosschat 明确 `install-skills` 只写 `.claude`/`.codex`；运行与维护补四类资产归属与三种生命周期区分 |
| `docs/development/dsh-integration-contract.md` | 新增"生命周期与资产归属（2026-10-29 补记）"，写明当前合同与证据边界；上文批准范围未改 |
| `docs/development/c13-harness-lifecycle-design-20261029.md` | 消除已核实的待核验项（原生 remove 语法、remove→add 顺序）；§三 标注为修复前复现证据；§四 由"建议下一单"改为 I01/R1 实现事实；§五/§六 更新依据与当前边界 |
| `docs/development/evidence/c13-worker-20261029/I02-review-input.md` | 本文件 |

未改产品、测试、README、skills、通信/回信段、root 任务/调度/总表、原证据与 `docs/代码消息投递.md`；未新增功能/运行时文件，未安装/下载软件，未启停原生 Host/Desktop，未读写用户状态/config/auth，未访问模型或试发。

## 2. 事实核对

固定官方提交 `687f282e8625c6b8d11ff58211a90524be2e4317`，本轮以只读方式取回两个源文件核对行号（`raw.githubusercontent.com`，经本机代理），未启动任何原生工具。

| 事实 | 核对方式 | 结果 |
| --- | --- | --- |
| `plugin` 子命令 `--profile` 必填、其余参数原样转交 profile 目录下的 pnpm | `apps/cli/src/args.ts:194–201`：`requiredOption('--profile <name>', ...)`、`argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')`、`resolved = { mode: 'plugin', profile, args }` | 与文档一致；`remove` 是透传的 pnpm 参数 |
| npm CLI 拒绝管理 `desktop` profile | 同文件 199 行 `if (!manageDesktopProfile) rejectElectronProfile(plugin, options.profile)`；拒绝消息在 85 行 `profile "desktop" is managed exclusively by the Electron application` | 一致 |
| Desktop 自带 `resources/runtime/cli/bin/dsh`（Windows 为 `dsh.cmd`），先初始化、完整退出再管理插件 | `apps/desktop/README.md:131` 讲 bundled command runtime；`:133` 要求 launch once → fully quit → `dsh plugin --profile desktop add <package>`、`list`、`remove <package>`；`:135` 要求更新/卸载 Desktop 前先完成 CLI 命令 | 一致 |
| Web 移除用包名 `@crosschat/dsh-bridge` | `integrations/dsh/package.json` 的 `name`；`evidence/dsh-20261023/third-live.json` 的安装输出 `+ @crosschat/dsh-bridge @crosschat/dsh-bridge@file:...` | 添加时是 `file:` 目录、移除用包名，成立 |
| 保存≠加载，取决于 HMR | `docs/research/deepseek-harness-native-contract-20261023.md` 第 44 行（Plugin Manager 固定 permalink） | 沿用既有固定来源 |
| 禁用/启用产生新实例、旧凭据失效、会话保留 | `third-live.json` 的 `lifecycle`：`mechanism=official-plugin-manager-bundle-disable-enable`、`pid` 不变、`previousInstanceId≠newInstanceId`、`previousPortClosed=true`、`previousCredentialRejected=true`、`freshAck=true`、四个 `retainedSessionIds` | 一致；仅 Web |
| 子 scope 撤销只撤身份贡献、HTTP 保留 | `integrations/dsh/bridge.js:183–217` 的 `contribute`/`release` 与既有用例 | 一致 |
| 死 PID 登记只读忽略、不删除 | `dsh-integration-contract.md:25` 与发现侧实现 | 一致 |
| `install-skills` 只写 `.claude`/`.codex` | `src/application/maintenance/skills.ts` 的 `skillDestinations` | 一致 |
| 桥登记 home 与 `DSH_HOME` 无关 | `integrations/dsh/index.js` 以 `config` 调 `mountDshBridge`，未传 `home`；`bridge.js` 取 `options.home ?? homedir()` | 登记固定在用户主目录 |

## 3. 与任务要求的映射

| 要求 | 落点 |
| --- | --- |
| 四类资产与归属 | 契约新增节第 1 段；指南"运行与维护"第 1 段；方案 §一（原有） |
| skill 仍手工、保留 references、install-skills 未管 Harness | 指南"让 Agent 使用 crosschat"末句 + 运行与维护；契约；方案 §一.2 |
| 两个 profile 管理器分开、不猜默认目标 | 指南"更新与移除"末句与 Desktop 段；契约第 2 段 |
| 保存不等于实际加载 | 指南安装桥段、契约第 3 段 |
| 禁用 / 重启 / shellEnv 子 scope 区别 | 指南运行与维护第 2 段；契约第 3 段；方案 §二 三行 |
| 路径变化才重新添加 | 指南"更新与移除"；方案 §二 更新行 |
| 卸载前移除 bundle 的准确命令 | 指南"更新与移除"；契约第 2 段 |
| 不强加 remove→add 顺序、不造新必需检查 | 指南"更新与移除"；方案 §二 更新行、§五 |
| I01 实现事实与全量待集成分开 | 方案 §四；契约"证据边界"段；指南未宣称整仓通过 |
| 不给固定 permalink 之外的推断 | 全部外部事实均附 `687f282e…` permalink 或本仓证据文件 |

用户操作变化：**无**。新增内容都是既有步骤（安装、按新目录重新添加、卸载前移除 bundle、手工复制 skill）的准确化，未新增命令、默认 profile/home、自动调用或 install-skills 扩大写入。

## 4. 检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 空白/冲突标记 | `git diff --check` | 通过（仅 Git 的 LF→CRLF 提示） |
| 相对链接 | 人工核对 `development/evidence/dsh-20261023/third-live.json`、`evidence/dsh-20261023/third-live.json` | 均指向实际存在的文件 |
| 外部 permalink | `args.ts#L194-L201`、`desktop/README.md#L131-L141`、`desktop/README.md#bundled-command-runtime`、`packages/boot/plugin-manager/README.md` | 前两项按取回源码逐行核对；后两项沿用既有固定来源 |
| 范围 | `git status --porcelain` | 仅本单 3 个已有文档 + 本文件；并行线文件未改、未 stage |

按任务要求只做文档检查：未写文案字符串测试，未跑产品全量或新探针，未重跑/覆盖 I01 两次全量首败证据。

## 5. 未测边界

- 未启动 Web/Desktop 执行 `plugin remove`，命令语法来自固定源码与既有安装证据，不是本轮实测。
- Desktop 的 remove 路径沿用官方 README 的 `remove <package>` 描述；正式 Desktop 包仍未验（C04）。
- 手工复制 skill 是否残留源已删除文件、Harness 是否成功加载该 skill 仍未核实（方案 §二保留）。
- 插件保存后的 HMR 实际行为未在本机复测，沿用官方 Plugin Manager 文档与既有研究记录。

## 6. 下一张真正需要用户决定的最窄事项

**C08：是否让 `install-skills` 写入 Harness 的 skill 目录**（现只写 `.claude`/`.codex`）。它改变用户可见的默认写入范围，需要用户拍板；其余生命周期事项都是既有手工步骤的说明，不需要新授权。
