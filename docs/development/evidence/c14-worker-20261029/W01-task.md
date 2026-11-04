# C14-W01：Codex 来源关联可行性与最小探针

2026-10-29（用户端时间）。用户指定 root 为分发、验收和审计者，本机 Claude 会话 `cworker1` 为执行者。本单只解决一个问题：当前普通 shell 调用，能否持续、准确地关联实际 Codex CLI 或 Desktop 执行实例。它是 C14 的研究子单，不是 C02/C03 CI，也不意味着交付整个 C14。

## Git 与所有权

- 仓库：`D:/workspace/CC/multichat`；共享分支：`codex/core-refactor-pre-tui`。具体验收基线 SHA 由 root 在正式派单消息中给出。
- 开始前回报实际仓库路径、branch、HEAD、dirty 文件与其他在办任务；目录、分支或基线不一致先报告，不自行 checkout、pull、reset、clean 或 stash。
- 用户授权本地 commit，不授权 push。root 完成基线提交并交出索引后，worker 只 stage 本单白名单内自己修改的文件，做独立提交；禁止 `git add .`、`git add -A`、amend、混入其他任务文件。
- 同一工作区不并行使用 Git index。若 HEAD/branch 在执行中改变，保存本单检查点并报告，不自行合并、回滚或覆盖。root 收到完成报告后才进行审计及后续提交。

## 已知现状与必须读取的材料

1. `AGENTS.md`、`docs/development/code-standards.md`、`docs/development/core-refactor-progress.md`；涉及 TUI 才另读 `docs/development/tui-progress.md`。
2. `docs/development/c14-explicit-tool-design-20261028.md`、`c14-user-command-review.md`、`c14-explicit-tool-validation-20261028.md`。公共确认、去重、失效机制已经实现，不能重新建一套，也不能把旧研究中的“尚未实施”覆盖当前代码事实。
3. `docs/research/c14-codex-claude-caller-identity-20261028.md`：官方固定源码、Hook、进程链及已有两次 Desktop 普通调用观察。
4. `src/application/caller-source/providers.ts`、`service.ts`、`confirmations.ts`、`src/identity.ts`、`src/commands/identity.ts`。
5. `src/commands/codex-wrapper.ts`、`src/codex/launcher-owner.ts`、`session-events.ts`、`desktop-ipc.ts`、`transport.ts`、`rpc.ts`；通过 `rg --files` 核实路径，不假定有 session-bridge.ts。

当前产品基线已包含W00测试隔离与W04短柄互斥修复，root最终完整检查2433项通过、11项原有跳过，证据见同目录 `W04-final-review.md`。Windows ConPTY和Harness npm/Web成绩不证明Codex新来源链已经通过。当前Codex Provider保持 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED`；共享确认状态机通过不代表真实未知入口已允许人工确认一次长期复用。

## 实施步骤

1. **复核证据链。** 对照已固定官方源码及本地实现，列出原生 thread/root-session/tool-call 字段的执行位置与覆盖顺序，Hook 的 session/turn/tool-use 字段，app-server 的命令 item/事件，Desktop IPC 的 owner 证据。明确哪些字段实际可关联，哪些只是同名字符串或候选元数据；记录真实版本、提交及读取范围。
2. **先验证最窄路线。** 优先比较：实际成功的 CLI 受控连接＋本次 call；原生执行实例指纹（PID、创建时间、可执行来源）＋当前 thread/call；原生 Hook 对逐调用的登记。不能把协议 processId 直接当 OS PID。Desktop 研究是否能把当前 call 与 owner 精确对账，单独注明公开与私有接口。
3. **需要时补最小探针。** 本单不安装新软件；仅使用已有正式CLI或公开固定源码，在任务独占环境配本机脚本模型，原生普通shell输出允许字段的存在性或散列。私有测试profile可研究最小Hook；不修改用户配置、不依赖个人模型key。优先复用现有mock、驱动和隔离工装，不另建大型框架。原生多调用观察与测试手填环境必须分开留证；若正式工具不可用则准确记录未验证，不安装补齐、不宣称上游不支持。
4. **核对必要反例。** 同一 ID 在 CLI/Desktop 同时存在、Desktop 启动嵌套 CLI、同 daemon 多窗口、旧 originator 标签、PID 重用、实例重启、持续 exec/write_stdin、Hook 缺失或迟到。能原生验证的原生验证；只能隔离构造的注明 fixture，未测项如实列出，不从一个正向观察宣称全覆盖。
5. **写出可实施的下一单。** 每条路线给出“已原生验证／源码可行待实测／受限可行／仍未核实”的准确结论，说明适用范围、失效条件、维护成本、具体修改文件和验收场景。若需新 Hook/插件安装、配置要求或用户确认策略，提交具体方案由 root 汇总给用户，不在本单直接上线。

如果必须由当前 root 的 Codex Desktop 普通 shell 采样，先向 root 发 `NEED_ROOT_PROBE`，说明需要回答的具体关联问题、待审脚本路径、允许输出和副作用；不得通过向用户其他会话投递测试任务替代。其他独立研究继续推进，不空等。

## 文件白名单与边界

允许新增或修改：

- `docs/research/c14-codex-source-feasibility-20261029.md`：最终研究报告及执行中可续接检查点。
- `docs/research/evidence/c14-codex-source-20261029/`：脱敏、限量的原始证据和清理记录；不保存工具凭据、完整环境、聊天历史或无关进程命令行。
- 必要时新增 `scripts/codex-caller-source-probe.mjs`、`test/codex-caller-source-probe.test.ts` 及 `test/helpers/codex-caller-source-probe.mjs`；只做隔离研究/只读探针，不接产品默认路径。复杂探针要有有意义的取消、输出限制或清理行为测试；不为凑数量镜像实现。

本单不改 `src/**`、CLI 用户命令、skill、全量任务总表、既有 Harness/OpenCode 文件或已接受证据，不做全仓格式化。若确需超出白名单，先给 root 明确文件和原因，不能先写后补报。root 负责全局任务状态。

所有 send 继续要求显式收件 tool；Q8 保留原生身份匹配且固定收件目标明确时正常回信。不能靠活 Desktop owner、任意 Desktop 祖先、历史 source/originator、收件 `--tool` 或裸 ID 全局缓存推定来源。真实未知入口的人工 fallback 保持关闭；失败不缩小支持范围、不增加统一禁发、不自动重发不明写入。

## 验证与清理

- 纯研究不为已有产品重复跑全量测试；若新增可执行探针，执行对应 npm/Vitest、ESLint、node 语法检查，并按代码规范运行 `npm run check`。不修改/跳过旧测试掩盖失败。
- 不安装或卸载用户已有软件，不重启/终止用户 Desktop，不连接生产远端，不在远端 Linux 安装 Codex，不改全局配置。
- 临时软件仅放任务独占 D 盘目录，带 ownership；结束停止自己的子进程、移除自己的便携运行时与 profile、归还临时配置。递归删除前验证绝对路径和归属；任何删除若被 `blocked by policy` 拒绝，不换机制重试，保留路径报告，由 root 沿用用户统一清理约定。
- 保留报告、必要脚本和验收证据；清理本单临时下载、日志和进程，不删除其他任务资料。worker 不擅自删 C14 全任务；root 验收后移除活动子单引用，保留本任务书和审计记录作为证据。

## 完成报告（必须逐项回复 root）

用仓库 `node dist/cli.js send` 回到原分发聊天，显式收件 `--tool codex-desktop`，使用正式派单给出的已核实完整typed ref（旧c14已撞号）；重要状态与完成报告使用 `--delivery steer` 追加当前协作任务，不重复发送纯确认。只有引用明确失败且原目标与收件类型已核实时，才按仓库skill恢复；写入不明不重发。只声明有依据的结果，不把delivered当验收。报告包括：

1. `C14-W01`、完成／部分完成／需要决定，以及仓库路径、branch、基线 SHA、最终 SHA。
2. 自己修改的完整文件列表、各文件目的、独立 commit SHA；无改动也明确说明。提交前后重新核对 branch/HEAD，报告剩余 dirty 的归属。
3. 每条候选路线的证据、结论、精确适用范围；CLI 与 Desktop 分开，源码／fixture／原生实测分开。原生证据给文件定位，未测明确写未测。
4. 实际执行的检查命令、退出码、数量及未通过项；有新增探针则说明有意义的 RED/GREEN。
5. 下一单建议：预计修改哪些模块、如何接共享 Provider、验收反例、必要用户决定及不确定性。
6. 本单进程、安装/profile、临时目录的清理清单，遗留路径、原因与归属。若切换其他任务，先在报告中保存当前步骤和复现命令，避免依赖聊天记忆。

完成后停止本单写入，等 root 复核；不自行领取 OpenCode、C13 或其他任务，不连续互发纯确认回执。
