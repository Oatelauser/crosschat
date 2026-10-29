# 工具完整接入审计

历史快照：下文保留2026-10-27规范审计时的事实和25项索引。2026-10-28类型寻址已另行[开发验收](tool-type-validation-20261028.md)，最新类型以[永久合同](../tool-types.md)为准，活动范围以[全量待办](tool-compatibility-ci-tasks.md)为准；不把旧“C14未定”描述用于当前状态。

2026-10-27，Asia/Shanghai。对应[统一接入规范](tool-integration-standard.md)，完成本批 C07 的规范制定与源码/既有证据核对。审计基于 HEAD `ce0737bd7359dfbf8b4323ba13be8ffc1a3ef64f` 加当前工作区；工作区已有其它聊天修改，未覆盖。本文是事实快照，不代表本次运行了历史测试或验收了缺失功能。

## 状态口径

实现分类为“已有、复用、部分、缺失、能力待核实、原生不适用”；验证独立记录为“源码、既有受控测试、既有真实原生/终端/界面证据、未验证”。代码存在不等于该入口实测通过，缺少证据也不直接判定原生不支持。

当前四个 Provider 家族有七类接入入口，其中 Harness npm/Web 指 npm CLI 启动的 Web Host 和普通交互 Agent，不代表独立终端聊天 UI 或浏览器 UI 已验证。ZCode 已按用户决定暂缓，不计为完成，也不阻塞本批基础接入。

## 逐入口总览

| 入口 | 原生接入与已知验证范围 | 技能／插件维护现状 | TUI／诊断与类型缺口 | CI 剩余工作 |
| --- | --- | --- | --- | --- |
| Claude Code CLI | 已有原生 messaging、发现、身份、收发及回信；Windows 2.1.309 兼容序列已验；选择跟随另有 2.1.310 原生证据。 | 默认 `.claude/skills` 已有 installer/维护/卸载；自定义 `CLAUDE_CONFIG_DIR` 与维护目标不统一。无需新增 Harness 式 Host 插件。 | 共享 TUI/成员管理已有验收；doctor 有基础 Claude 检查，自定义配置、四家身份及全量教学仍待核对。 | Windows 工装已有，托管首轮 C06；完整安装/技能/更新链 C11，三平台 C12。 |
| Codex CLI | 已有 app-server、发现、完整 thread ID、身份/回信与原生调度；0.163.0 的 CLI 及选择/改名有独立证据，不扩称所有服务版本均通过。 | 默认 `.codex/skills` 已接；`CODEX_HOME` 与固定技能根不统一。 | 基础 TUI/doctor 已有；CLI/Desktop 部分原生端点区分已有，完整类型＋名称/ID 寻址仍待 C14。 | **正式 CLI 专用兼容 CI 待 C02 开发**；完整流程 C11、三平台 C12。 |
| Codex Desktop | 已有真实 Desktop owner 收件和双向回信证据；26.1021.3705.0 的只读改名端点核对不等于该版本完整桌面 CI 通过。 | 可复用 `.codex/skills` 机制，桌面实际加载与默认/自定义配置需独立留证；不能用 installer 文件存在代替。 | 通用 TUI 与基础成员链可复用；缺 Desktop 专项 doctor，完整类型隔离待 C14；当前协同端点不支持原生改名。 | **正式 Desktop 独立兼容 CI 待 C03 开发**；完整流程 C11、平台 C12。 |
| OpenCode CLI | V2 2.1.3 / Windows：原生服务 8/8、ConPTY 6/6；发现、精确投递、busy queue/steer、shell 身份和回信已验。 | 原生兼容读取 `.claude/skills`，现有安装可复用；统一目录/配置目标和更新移除归属仍缺。原生无需额外 bridge。 | 基础列表/筛选/详情/复制/指引已有真实终端证据；无专项 doctor；尚无可靠 CLI/Desktop 类型限定。 | Windows/Linux probe 已配置，O06c 托管首轮待验；C11 完整流程、C12 三平台待开发。 |
| OpenCode Desktop | 正式 2.1.3 / Windows 默认本机 sidecar、GUI、shell/回信 11/11；首次引导、额外 HTTP/WSL/SSH server 等不在已验范围。 | 同样复用兼容 skill 目录，桌面原生启动；不要求额外 CLI 或插件。维护缺口同 CLI。 | 复用 reader 与中性桌面指引，不能把 CLI 终端成绩算桌面完整 TUI 使用链；专项 doctor 和类型限定缺失。 | 独立 Windows 桌面工装已有；O06c 完整串行安装/卸载及托管首轮未验，C11/C12 待开发。 |
| Harness npm/Web Host | 官方 npm 0.2.1-rc.2 / Windows Web Host 普通 Agent 已实测；只路由已有 live roots。浏览器 UI、子 Agent、冷历史不在通过范围。 | skill 手工复制；官方插件 add、disable/enable 有真实证据；缺 crosschat 统一 skill 与 bridge 生命周期。 | reader/基础 TUI/收编已有代码及受控测试；缺真实 Harness 来源＋完整终端验收、专项 doctor、Web/Desktop/profile 类型寻址。 | Windows 工装及本地基线→候选已有，C05 托管未验；C11/C12 待开发。 |
| Harness 正式 Desktop | **未完成正式安装、实际桌面 owner/profile、UI 与卸载独立验收**。不能借 npm/Web 的成绩。 | 官方说明要求独立 `desktop` profile，由内置 runtime/Plugins 管理；skill 与 bridge 的实际安装维护待验。 | 可研究复用已有桥与通用页面，但不称真实桌面发现、身份、收发或成员操作已通过。 | C04 生命周期工装与独立 runner；**C11 桌面 workflow/首轮、C12 平台覆盖待开发**。 |

## 共用接入面核对

| 规范项 | 当前可复用实现／缺口 | 可追溯依据 | 后续归属 |
| --- | --- | --- | --- |
| INT-01 / INT-02 入口和发布包 | 包已包含 dist、完整 skills 和 Harness bundle；`dsh-bridge-path` 只读定位。不同原生入口仍需各自版本/owner 证据。 | [package.json](../../package.json#L17)、[CLI](../../src/cli.ts#L697)、[原生指南](../deepseek-harness.md) | C04/C10/C11/C12 |
| INT-03 / INT-04 默认与自定义技能目标 | `skillDestinations()` 固定 `.claude/.codex`；`--dir` 是二者的根目录，不是 skill 目录。发现支持的 `CLAUDE_CONFIG_DIR`/`CODEX_HOME` 不等于 installer/doctor 已跟随。 | [技能目标](../../src/application/maintenance/skills.ts#L8)、[Claude 登记](../../src/claude/registry.ts#L31)、[Codex home](../../src/codex/rollout-meta.ts#L22) | C08/C10 |
| INT-04 更新与移除 | 安装/更新是递归复制并覆盖匹配文件，不清除源已删而目标仍有的文件；没有目标安装清单。自定义 `--dir` 不会自动成为默认卸载目标；卸载实现只取两个技能目标。更新/额外文件处理语义仍须明确，不能在本次擅自决定删除。 | [安装复制](../../src/application/maintenance/skills.ts#L14)、[卸载目标](../../src/application/maintenance/uninstall.ts#L32)、[CLI 注入](../../src/cli.ts#L824) | C08、C11 |
| INT-05 插件与技能分离 | 仅 Harness 依赖 Host 插件；已有桥能撤自己 HTTP/登记，不销毁借用 Agent。skill 能加载不等于桥已装；桥能收发也不等于 skill 已装。 | [Harness 合同](dsh-integration-contract.md)、[bridge 生命周期](../../integrations/dsh/bridge.js#L120) | C13、C04/C11 |
| INT-06 发现组合 | 默认组合已有四家 reader；可选未安装来源不阻断旧工具，已配置失败保留来源错误。分页、完整性、取消及匿名会话已有共用模型。 | [默认组合](../../src/application/discovery/local.ts#L11)、[模型](../../src/application/sessions/model.ts#L1) | 保留复用，C09/C11/C12 按入口验收 |
| INT-07 类型与引用 | 当前 identity/ref/resolve 主要区分四家 Provider；SessionRef 内部键含上下文/Provider/原生 ID，不含独立入口类型。Codex 部分端点区分已有，但投递仍有 Desktop 优先路径；OpenCode/Harness 无完整类型限定。 | [SessionRef](../../src/application/sessions/model.ts#L4)、[resolve](../../src/resolve.ts#L40)、[ref](../../src/ref.ts#L16)、[Codex 投递](../../src/codex/deliver.ts#L70) | C14；不能只新增一个标签或参数 |
| INT-08 / INT-09 / INT-10 身份与完整通信 | identity 已注册四家，OpenCode 原生/显式 ID 不一致及跨家族冲突会拒绝；两种新工具的本机原生 shell 收发/回信已有历史验收。远端 origin/wire 有接线及受控测试，不冒充各新工具真实远端验收。 | [identity](../../src/identity.ts#L38)、[send](../../src/application/send/index.ts#L398)、[federation](../../src/federation.ts#L100)、各工具验收记录 | C14、C11/C12；跨机范围待 C00 |
| INT-09 不明回执与发送预算 | OpenCode 的已发请求遇网络/响应异常或 admission receipt 不符返回待核实，不重试；Harness 同样保留写入不明边界。默认正文、轮次预算、wrapper 环境传递及各 Adapter 上限已有合同，新增入口需核对继承，不在本次调整数值。 | [OpenCode 投递](../../src/opencode/deliver.ts#L16)、[服务写入](../../src/opencode/service.ts#L165)、[Harness 服务](../../src/dsh/service.ts#L75)、[wrapper](../../src/commands/opencode-wrapper.ts#L30)、[预算](../../src/limits.ts#L21)、[send](../../src/application/send/index.ts#L176) | C11/C12；类型扩展仍保留既有预算 |
| INT-11 TUI 与本机维护 | 会话页已有四家指引与地址生成，筛选/详情/精确收编已有；技能维护使用同一两目录函数，文案仍明确两目标。维护资源目前只支持本机，不因能远端查询就变成远端安装/卸载。 | [会话资源](../../src/tui/resources/sessions.ts#L28)、[维护资源](../../src/tui/resources/maintenance.ts#L22)、[维护模型](../../src/application/maintenance/model.ts#L5)、[维护操作](../../src/application/maintenance/operations.ts#L171) | C08/C09/C10、C11 |
| INT-12 doctor | 有 Claude/Codex CLI/app-server 和两目录 skill 检查；缺 OpenCode、Harness、Codex Desktop 专项，身份冲突诊断仍只认两家。四个 reader 都是 `diagnostics:false`；来源错误展示不等于 doctor 专项。自定义配置目录也未形成一致检查。 | [checks](../../src/application/diagnostics/checks.ts#L35)、[诊断依赖](../../src/application/diagnostics/deps.ts#L129)、[OpenCode reader](../../src/application/sessions/opencode-reader.ts#L8)、[Harness reader](../../src/application/sessions/dsh-reader.ts#L8) | C10；扩展结构化采集/解析/文本/JSON/TUI，不只改一条输出 |
| INT-12 教学和元数据 | 主 skill 已列四家，但 remote reference 仍只列两家；SSH 名字/id8 示例不适合直接套给新工具。包描述仍只写 Claude/Codex CLI；architecture 仍有“TUI 未实施”“OpenCode 未真实接入”的旧说法。 | [remote reference](../../skills/crosschat/references/remote.md#L12)、[package 描述](../../package.json#L5)、[architecture](../architecture.md#L4) | C10；保留用户已有 README 修改 |
| INT-12 历史与当前规则 | stars reference 仍有裸 resume 自动归队教学；现批准规则已取消。OpenCode Desktop 指南仍有旧残留待清说法，最新清理复核已关闭。两者应区分历史证据与当前教学。 | [stars reference](../../skills/crosschat/references/stars.md#L19)、[最终恢复规则](session-selection-membership-design-20261026.md)、[桌面指南](../opencode-desktop.md)、[清理复核](evidence/tool-integration-cleanup-20261023.json) | C10 核对当前教学；C23 只增补未来增强 |
| INT-13 成员与统一操作 | 四家基础成员 Provider 已存在；默认原生操作组合复用它们。统一 describe/apply 当前为 adopt/rename，精确删册走独立管理通道。共享定向 node、刷新和属性保护已验收，不重新列成待开发。 | [成员 Provider](../../src/application/session-membership/providers.ts#L5)、[默认组合](../../src/application/native-operation-providers.ts#L8)、[操作接口](../../src/application/session-operations.ts#L11)、[精确删册](../../src/application/tcp/management.ts#L397)、[共享验收](session-selection-membership-validation-20261026.md) | 基础 C09/C11 复用；专属增强 C17/C18/C24 |
| INT-14 生命周期 | TUI 预览/指纹确认/逐项结果已存在；`crosschat uninstall` 清数据/指定技能并提示另行 npm 卸载，不卸载原生工具。Harness bundle 的原生引用和自定义技能位置不在目前统一移除范围。 | [维护操作](../../src/application/maintenance/operations.ts#L156)、[uninstall](../../src/commands/uninstall.ts#L30)、[Harness 指南](../deepseek-harness.md) | C08/C13、C04/O06c/C11 |
| INT-15 CI 层次 | 现有通信工装不覆盖统一安装/实际加载 skill、完整维护/诊断/类型闭环。普通三平台 check 与原生兼容 probe 不同，托管配置与首轮通过不同。 | 下方 CI 表与[全量待办](tool-compatibility-ci-tasks.md) | C02/C03/C04/O06c/C05/C06/C11/C12 |
| INT-16 增强 | 共享监督、能力重核与 TUI 已有验收；OpenCode 仍走新增 ID 差分，Harness 桥没有当前窗口选择或 rename 接口。不能拿共享通过当专属工具通过。 | 下方增强边界 | 后置 C15—C24 |

## OpenCode 的专属事实

- CLI 有[原生 wrapper](../../src/commands/opencode-wrapper.ts#L27)，Desktop 直接运行正式应用；两者共用 V2 HTTP 服务、Basic 鉴权、owner/version 核对及完整 ID，但这不能证明某会话已具备可验证的 CLI/Desktop 类型。
- [服务定位](../../src/opencode/service.ts#L45)使用 `XDG_STATE_HOME/opencode/service.json`，否则为 HOME 下 `.local/state/opencode/service.json`；显式 service file/URL/token 也有入口。跨平台路径规则与用户技能根分别记录，不因同一个 HOME 就认为两者已统一维护。
- 原生兼容读取 `.claude/skills/crosschat`，因此现有 installer 有复用路径；不把 OpenCode 误列为技能完全不可用，也不在规范阶段决定新增 `.opencode` 副本。
- [原生 client](../../src/opencode/client.ts#L25)读取 title、cwd、完整 ID 和运行状态；`/api/session/active` 不能证明某窗口当前选中会话。CLI [仍直接建立 StarJoiner](../../src/commands/opencode-wrapper.ts#L39)，[启动快照和新增 ID 差分](../../src/commands/session-star.ts#L298)未接可靠选择事件。C16 需替换该判定，C15/C16 仍后置。
- 已有基础入星 Provider；尚无 OpenCode 原生 rename adapter。源码 `Session.rename` 的研究线索不证明公开 HTTP/client、实际 owner 与活 CLI/Desktop 名称同步已通过，留 C19/C24 条件核实。
- [CLI 原生/终端验收](opencode-cli-validation-20261023.md)与[桌面正式包验收](opencode-desktop-validation-20261023.md)分别保留。旧清理段落为历史，以最新[清理复核](evidence/tool-integration-cleanup-20261023.json)为准；本次没有检查当前机器的全部新临时文件。

## Harness 的专属事实

- 入口为 [Host bundle](../../integrations/dsh/index.js#L8) → `mountDshBridge`，没有 `crosschat dsh` wrapper；不为形式统一增加启动器。桥只提供 info/list/detail/messages，只有已有 live root 可路由，子 Agent 和未打开历史不在支持范围。
- [登记](../../src/dsh/registry.ts#L48)与[服务核验](../../src/dsh/service.ts#L101)绑定 instance/PID/runtimeVersion/protocol；[client](../../src/dsh/client.ts#L42)对跨实例同 ID 拒绝歧义。登记未提供 Web/Desktop/profile 类型限定，不能把歧义拒绝当作 C14 已完成。
- skill 可手工复制到 `<Harness home>/skills/crosschat` 或项目 `.agents/skills/crosschat`；`DSH_HOME` 影响原生配置。bridge 登记默认在 OS HOME 的 `.crosschat/dsh/instances`，与 `DSH_HOME` 不等价；隔离测试有显式 home/instancesDir 接缝。
- npm/Web profile 与正式 Desktop 的 `desktop` profile 分别管理；后者只能沿实际内置 runtime/Plugins 核实，不能用系统 npm dsh 代管。本机不新增难清理的 `dsh` 协议注册，C04 在独立干净 runner 验证。
- 原生 `DSH_SESSION_ID`、idle 唤醒、busy followup/steer、shell 回信、插件 disable/enable 及自身资源释放有[Windows npm/Web 验收](dsh-validation-20261023.md)。浏览器 UI 和 Desktop UI 不在该成绩内。
- 已有基础成员 Provider，但无专属 rename/端点能力扩展。`ctx.agents.roots()` 不代表当前前端选择；`ctx.sessionTitle.rename` 仅是公开能力研究线索，留 C15/C18/C20/C24 核实。

## CI 与平台事实及待开发项目

| 工具／检查 | 当前原生 probe 配置 | 已保留的运行证据 | 尚待开发或验收 |
| --- | --- | --- | --- |
| 仓库普通 check | Windows、Ubuntu、macOS；macOS 非阻断 | 历史受控开发验收，不计原生工具矩阵 | 不能替代 C12 |
| OpenCode CLI | Windows、Ubuntu | Windows 2.1.3 原生及终端；本次未查 Actions | O06c 托管/Linux 首轮；C11 完整接入、C12 三平台开发 |
| OpenCode Desktop | Windows 独立桌面 job | Windows 正式 GUI 11/11 | O06c 完整串行生命周期/托管首轮；C11/C12 增补开发 |
| Harness npm/Web | Windows | 本地正式基线→同版本候选序列通过 | C05 托管首轮；C11/C12 开发 |
| Harness Desktop | 无正式 Desktop probe | 无独立正式包/UI 验收 | C04 专用生命周期工装与验收，C11 独立 workflow/首轮、C12 平台开发 |
| Claude Code CLI | Windows | 2.1.309 本地正式序列通过 | C06 托管首轮；C11/C12 开发 |
| Codex CLI | 无专用官方工具兼容 workflow | 原生通信/选择/改名有各自证据，不能替代持续兼容 CI | **C02 专用 CI 待开发**，C11/C12 开发 |
| Codex Desktop | 无专用官方桌面兼容 workflow | 历史真实收发，不是桌面 CI 序列 | **C03 专用 CI 待开发**，C11/C12 开发 |

配置依据：[普通 CI](../../.github/workflows/ci.yml)、[OpenCode](../../.github/workflows/opencode-compat.yml)、[Harness](../../.github/workflows/dsh-compat.yml)、[Claude](../../.github/workflows/claude-compat.yml)。后三者的 Ubuntu report job 不运行相应原生工具；现有配置没有构成完整 macOS 原生验证。

所有新 CI 继续使用正式工具＋同机 mock，不需要用户模型 key。C11 覆盖从零安装、实际加载 skill/bridge、发现/身份/收发、TUI/诊断和更新/移除；C12 消费 C00 的平台范围/频率方案。增强回归 C21 与增强 CI C22 仍待开发，不能因为有基础工作流而消失，也不反向阻塞基础阶段。

## 增强与分工边界

共享的[选择/成员管理验收](session-selection-membership-validation-20261026.md)及[原生改名补验](native-rename-validation-20261027.md)不重新开工：默认操作已有四家入星 Provider，实际统一操作为 adopt/rename，删册另走精确管理路径；有界 fresh probe/revision 已接通，不存在本文可以宣称的独立通用能力缓存服务。

OpenCode/Harness 的 C24 应扩展既有 Provider，而非重新登记一套成员制；C17/C18 补专属原生核验/实时效果与入口验收。C16 核实可靠选择事件；C19/C20 只在可靠公开接口与活前端同步成立时支持真实改名。最终统一规则仍是启动器跟随选择、直接原生/Desktop/Web 通过 TUI、取消所有工具裸 resume 自动归队、保留永久册位；无启动器的手动成员在 node 进程重启后由 TUI/显式 adopt 恢复。

本会话负责 OpenCode/Harness 及后续工具；Claude/Codex CLI/Desktop 和共享基础模块由交接会话维护。本文仅登记其事实及共用缺口，不领取或重复实现他方工作。默认写入范围、C14 类型名/语法及 C00 平台组合方案尚未确定，不把完成 C07 视为这些决策已经批准。

## 本次验收与操作边界

本批仅新增永久规范和审计记录，同步剩余活动任务及依赖。检查规范覆盖、源码链接、矩阵完整性、后续任务映射和基础/增强依赖；独立审阅结果与文件校验见本文收尾记录。没有修改产品代码、安装/启动原生工具、运行新产品测试、连接生产远端、触发 Actions、创建 Issue、推送或发送会话回执。

规范制定完成不代表七类入口都已完整接入；上述缺失功能、待开发 CI 和未运行验收继续保留在总表。历史测试数字均引自已有记录，本次不重新计为通过。

收尾结果：共用入口与 OpenCode 事实经独立交叉审阅；补齐基础投递不明回执零自动重发、既有发送预算继承两项检查，没有新增行为决策。文档核验覆盖 5 个相关文件、137 个相对链接及引用行号边界；16 项规范均在审计有对应记录。活动索引核对为 25 项，11 项 CI 相关规划/开发/验收均保留；完成的规范制定已移出活动表且依赖改为永久规范，历史记录不删。文档无尾随空白，`git diff --check` 通过。本次未运行 npm/Vitest 产品检查，未将历史原生证据当成本轮测试。
