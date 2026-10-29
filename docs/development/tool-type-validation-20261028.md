# 工具类型与精确寻址开发验收

> 本页保留讨论前的技术验证快照及当时审批状态。用户随后完成逐项讨论并恢复C14，新合同及本轮实施状态以[收敛稿](c14-explicit-tool-design-20261028.md)和[批准记录](c14-user-command-review.md)为准；下文旧命令、来源owner门槛和2281项检查不作为新合同的实现或验收说明。

2026-10-28（用户端 UTC+8）。**C14 技术验证通过，用户面变更待确认**。用户要求同工具的不同入口有差异时区分工具类型，并以类型＋会话名称/ID 定位；随后同意按实际通信端点划分。2026-10-27 按用户要求暂停并保存工作区；恢复后完成技术验证。用户最新明确命令及已有功能变化须先告知、等其拍板；此前同意区分目标不等于批准全部具体行为，见[待确认清单](c14-user-command-review.md)。C14恢复活动项，不继续后续开发。

## 当前实现和环境（用户面合同待确认）

- 命令：`crosschat send --tool <类型> --to <名称或完整ID>`；已有 `--conversation` 可以按收件端选择类型。CLI/help、随包 skill、README、架构/应用接口和[使用说明](../tool-types.md)已同步。
- 六类端点：`claude`、`codex-cli`、`codex-desktop`、`opencode`（shared）、`dsh`（host，严格地址 `dsh-host/`）、`dsh-desktop`。OpenCode 的 CLI/Desktop 共用服务，不臆造窗口归属；Harness 类型须由原生 profile、登记与响应 owner 一致核实。缺少类型的来源保持未知。
- 指定端点后发现、投递、ref/origin、成员、队列、限流、回执和 TUI 不跨类型回落。旧家族地址保持其范围；完整 Codex ID 在多个端点存在时明确拒绝。增加类型选择不会改变既有名称/ID 优先规则。
- 原生 shell 只有 ID 时不自动赋予发信类型。继续 typed ref 前，只在源机检查完整候选有无歧义/类型矛盾；SSH/TCP 发送前同样检查，远端接收腿不查询目标机来推断发送方。候选无歧义不构成原生 owner 证明，未知类型仍不写入 origin。歧义/无法核实用 `CALLER_IDENTITY_UNRESOLVED` 拒绝；`--tool` 只选择收件端。
- 本机 Windows、Node `v25.0.0`，npm/Vitest；分支 `codex/core-refactor-pre-tui`，HEAD `0a45bb9d9eaea961d5c2e2ad11f53f1fcb4ce3e5`。本次改动保留在工作区，未 stage/commit、发布或全局安装；工作区还包含其他聊天修改，不能全部归入本任务或整仓回退。

## 行为、修复与证据映射

| 保证 | 实现/测试入口 | 实际结果 |
| --- | --- | --- |
| 同 ID CLI/Desktop 分别发现、精确投递；缺 owner 不回落 | `tool-types.ts`、Codex/OpenCode/Harness adapters；`native-endpoint-types.test.ts`、`c14-tool-addressing.test.ts`、适配器回归 | 全量检查通过；已包含来源、版本、分页与失败隔离 |
| 完整 Codex UUID 多端点时拒绝；加类型仅缩小候选 | `resolve.ts`、`resolve.test.ts` | 完整 ID 歧义新增 2 条先失败；名称优先回归新增 1 条先失败，修后全部通过 |
| typed ref/origin 和严格地址不向缺能力 peer 写入 | `serve/endpoint-identity.ts`、`via-tcp.ts`、`broker.ts`；`endpoint-protocol.test.ts`、`serve-broker.test.ts` | 6 条遗漏能力检查先失败；支持端透传和拒绝端均通过 |
| 详情响应必须对应所请求的端点 | discovery/catalog/node/broker 边界；`tool-type-discovery-state.test.ts`、`endpoint-protocol.test.ts` | broker 错端点/缺端点 2 条先失败，修后通过；完整目标代次仍隔离 |
| TCP broker 本机桥保留工具类型 | `commands/serve.ts`、`serve-tool-type-bridge.test.ts` | 新桥回归先失败；真实受控 TCP＋runServe 验同 ID 分别投递 |
| typed adopt 保留端点、完整分页且隔离无关来源故障 | `commands/serve.ts`、`commands/session-star.ts`、`serve-tool-type-bridge.test.ts` | 桥初轮 4 条失败，后续指定端点/可选源故障回归也先失败；最终 6 条桥回归通过，相关命令回归保持 |
| typed 成员核验不受默认20条限制，来源失败不误删成员 | `application/members/native-providers.ts`、`core-members.test.ts` | 新增完整候选/失败回归先失败；按端点复用独立完整快照，失败为 unknown |
| 同 ID 入星/删册不覆盖另一端的永久/临时资格 | `session-membership.test.ts`、`session-membership-exact.test.ts`、`serve-broker.test.ts` | 真实受控 broker/node 与隔离星册通过；通用删册 6 条新增回归修前5失败/1通过，修后全部通过，完整ID/前缀/名称均先限定类型 |
| typed 会话不被未知 native caller 串用；不伪造发信类型 | `application/send/index.ts`、`c14-native-send-seams.test.ts` | 主检查初轮6条失败，修后通过；本机/SSH/TCP、源失败、远端origin、Harness及无类型origin均覆盖 |
| 可复制的 Harness Host 发信地址仍是严格类型 | `application/send/index.ts`、`c14-native-send-seams.test.ts` | `from-addr` 从家族前缀改为 `dsh-host/`；新增回归先失败后通过 |
| ref、短柄、状态分片、队列、速率和回执按端点隔离 | `tool-type-routing-state.test.ts`、`tool-type-observations.test.ts`、`c14-discovery-tui.test.ts` | 同 ID 多类型不互覆盖；不明写入不自动重发；非法类型/引用拒绝 |
| TUI 键盘、筛选、复制、刷新、resize 与退出恢复 | `test/helpers/c14-tui-fixture.mjs`、`c14-tui-pty-validation.mjs` | Windows 真实 ConPTY 3场全部通过，见下节 |

暂停时记录的 send 构建错误在恢复首轮构建已不能复现；本次最终构建再次通过。TCP桥、typed ref/origin能力检查、成员完整核验、adopt丢类型及合同/文档六组暂停技术事项均已处理。具体命令、歧义/回信等已有行为影响仍待用户批准；若批准范围有调整，须再按其决定修改和验证，不能宣称任务全部完成。

## 最终统一检查

清除 `CROSSCHAT_LIVE` 后执行仓库 `npm run check`，最终退出码 **0**：

- ESLint 通过。
- 运行时依赖图 **196 模块、656 边**，无环、无跨层违规。
- TypeScript 构建通过。
- Vitest **2281 通过、11 原有跳过，共2292条**；**217文件通过、3文件跳过**。未启用真实用户会话 live 测试。

首轮完整检查为2274通过/11跳过；随后审查发现通用删册遗漏类型过滤及发信地址家族前缀，补回归修复后重跑，以上为最后结果。定向RED/GREEN、ESLint及diff检查另有实际执行记录；不以固定覆盖率或用例数量替代行为判断。没有为本轮TDD单独提交，因为共享工作区保留其他聊天改动；本记录保存行为与验证证据。

## 真实终端与清理

执行 `node test/helpers/c14-tui-pty-validation.mjs`，使用最终构建的真实 TUI 和 Windows ConPTY，应用输入为合成数据，无原生工具或生产远端访问：

1. 本机/TCP列表：同 Provider＋同 native ID 的 CLI/Desktop 分别展示、复制完整类型地址和引用，工具筛选正确，反序刷新保持完整选择；48×16与140×32切换，正常q退出。
2. typed 会话页 Ctrl+C：退出正常、资源恢复。
3. 注入异常：预期退出1，恢复 raw mode、光标、主屏、括号粘贴及监听器，无遗留owner。

三场 `terminalRestored=true`。证据为[终端摘要](evidence/c14-tui-20261028/run-Iastf6/summary.json)，同目录保留JSONL和终端记录。摘要中4个TUI/类型模块的SHA-256与最终重新构建产物再次比对均一致；代码后续只改send/broker等相关模块，未重复无必要的终端场次。

自有运行根 `C:\Users\YANGSH~1\AppData\Local\Temp\crosschat-c14-tui-2RGLtx` 已由工装finally删除，随后只读 `Test-Path=False`。本轮未安装原生软件，未修改用户模型/工具配置，未部署到远端；无需另行卸载测试软件。

## 后续范围

本项保留类型寻址的技术验证，用户面变更批准尚未完成。Harness 正式 Desktop 的安装/UI、原生工具从零完整接入、GitHub托管首轮和Windows/Linux/macOS原生兼容矩阵仍按[全量待办](tool-compatibility-ci-tasks.md)跟踪；本机合成fixture、ConPTY和协议测试不将其变为通过。没有启动后续任务。

此前过早移除C14活动项的状态已纠正：C14恢复为用户面变更待确认，[类型说明](../tool-types.md)暂不作为最终用户合同；原始C07审计快照保留为历史，不用旧快照描述当前能力。C00、C02/C03/C04/O06c/C05/C06/C11/C12及增强C21/C22等CI事项均保留。

原技术收尾核对：14份相关文档、230个本地链接均可解析，彼时活动表24项、11项CI相关索引；此为历史结果。按最新用户要求恢复C14后活动表为25项，所有原CI待办保留。此次仅修正文档及审批状态，未修改产品代码或重复全量测试；技术证据继续有效，不能替代待完成的用户批准。
