# C14-W05：Codex Hook 与普通 shell 的原生调用关联验证

2026-10-29。root 分发与审计，本机 Claude `cworker1` 执行。本单只回答：**已有正式 Codex CLI 中，一次原生命令工具触发的 Hook `tool_use_id`，能否与该命令普通 shell 中的 `CODEX_TOOL_CALL_ID` 精确对应；对应记录能否绑定本次实际执行进程。** 这是 C14 后续研究，不是 C02/C03 CI 开发，不直接实现来源 Provider。

## Git 与范围

- 仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；正式派单给基线 SHA。核对一致直接开工，不一致先报告，不 checkout/pull/reset/clean/stash。
- worker 领取后独占本单写入与 Git index；只 stage 自己白名单文件、独立本地 commit，禁止全仓 stage、amend、push。HEAD/branch 意外变化即保存检查点并报告，不自行解决他方变更。
- 原未跟踪 `docs/代码消息投递.md` 保持原样；已验收的 W01/W03/W04、root 审计、调度/总表与其他工具文件不修改。

## 必读与可复用入口

1. AGENTS.md、代码规范、核心进度；`W01-final-review.md` 与 `docs/research/c14-codex-source-feasibility-20261029.md`，尤其客户端 env 与共享执行端 env 的区别。
2. `docs/research/c14-codex-claude-caller-identity-20261028.md` 的固定源码/Hook 支持范围；核实实际已安装运行体版本，源码版本与运行版本分开留证。
3. `test/helpers/codex-selection-native-validation.mjs` 已有 loopback Responses/SSE 模型与独占 profile/原生 app-server 的方向；可复用协议片段，不直接复制其不属于本单的改名/TUI/星网络流程。新脚本自行保证有界读取和完整生命周期。
4. `src/codex/session-events.ts`、`transport.ts`、`launcher-owner.ts` 和 caller-source 的现有消费合同，只读研究，不能改产品。

## 实施步骤

1. **核实实际工具和原生 Hook 合同。** 只使用已安装的正式 CLI/已有原生二进制，记录精确版本与来源。若没有可用工具，不安装补齐；给实际不可用证据。对照对应版本的文档/固定源码核实 Hook 的启用、配置和事件字段，不能把配置错误直接写成“不支持”。
2. **准备独占运行环境。** 在本单独占 D 盘缓存目录下建立 ownership、空 HOME/USERPROFILE/CODEX_HOME 和合成 workspace。环境使用必要 OS 字段白名单，不带用户模型钥、认证文件、真实会话变量或个人配置。只在这个 profile 配最小 Hook。模型只访问 `127.0.0.1` 脚本服务，关闭真实供应商鉴权和重试；不安装包/运行时或下载原生工具。
3. **先跑最小真实命令。** 以原生 CLI 执行流程消费本机 mock 的一次工具请求，让普通 shell 输出原生 thread/session/call 标识的允许字段；Hook 只记录本次允许的 session/turn/tool-use 字段和自身/近端执行进程事实。模型返回的工具名、参数和 SSE 必须符合该运行体实际 schema；记录这是真实工具处理请求，不把手填身份环境或直接调用 Hook 脚本冒充原生触发。
4. **在独占状态内精确对账。** 内部用完整原生值逐字比较，报告只保留散列/存在性及相等结果，不能靠截断摘要证明相等。至少有两个独立命令调用，说明哪些 ID 稳定、哪些变化；对原生子 agent/root-session 差异不作未测推论。Hook 与 shell 记录必须来自同一次实际执行，进程与 owner 的关系明确区分事实、候选、未核实。
5. **验证边界，控制任务大小。** 普通原生正样本完成后，有条件再观察同一长驻命令的 write_stdin/重复调用行为；未做就保留未测。真正共享 daemon、CLI/Desktop 同 thread 双开、Desktop Hook/IPC owner 对账不要求本单实现，也不因 CLI 结果声称覆盖。若原生路径受配置/版本限制，记录断点、实际错误及下一步；不启动/停止用户 daemon，不连接用户现有 thread。
6. **给出可执行的研究结论。** 相等、不同或不可核实均可以是有效研究结果，但要有实际输入来源与故障分类。解释“调用 ID 对应”解决了哪一环，仍缺哪些入口/owner 关联；不凭 ID 相等就自动返回来源类型，也不设立永久全局分类。提出下一单最窄采证或实现条件。

## 文件白名单

- `docs/research/c14-codex-call-correlation-20261029.md`：执行检查点、报告、精确命令与下一步。
- `docs/research/evidence/c14-codex-call-20261029/`：有界脱敏证据、版本与清理记录。
- 必要时 `scripts/codex-call-correlation-probe.mjs`、`test/codex-call-correlation-probe.test.ts`、`test/helpers/codex-call-correlation-fixture.mjs`、`test/helpers/codex-call-correlation-hook.mjs`。

只添加任务必需的最小工装，优先复用原库；不新建大框架或增加依赖。确需其他文件先给 root 文件/原因，不先写后报。研究证据目录与临时运行目录分开；原生输出正文只允许本单合成内容，不读取/保存用户聊天、完整环境、无关进程参数或认证信息。

## 验收与资源收束

- 原生采证通过与普通隔离单测分开；普通测试只用受控输入/自有子进程。对证据对账失败、Hook 未到/迟到、子进程非零/超时、取消、输出上限和自有资源清理做必要行为验证；不能把工装故障算作原生“不支持”或“未复现”。有意义 RED/GREEN 证明错误 ID/缺记录不会被接受。
- 自有 HTTP/WS、timer、listener、文件、PTY 和子进程都有 owner、截止时间、close/退出收束与 finally。输出和日志有界，初始化失败也清理；测试/探针子进程清 CROSSCHAT_LIVE，不调用产品真实发现/补投/发送。
- 新增可执行代码执行对应 Vitest、ESLint、node 语法检查及最终 npm run check；只有纯研究无执行代码变化时不重复全量。不得修改/跳过旧断言掩盖失败。
- 所有正常/异常路径先停止自己的进程并等退出，再核对解析后绝对路径、ownership 与任务前缀后删除本单临时根。此前已被自动审批拒绝的其他目录不触碰，不换机制重试删除；沿用用户 D 盘统一清理约定。
- 不安装/卸载或终止用户既有软件，不改全局/用户配置，不连生产远端，不在远端 Linux 安装 Codex。临时 Hook 只存在于本单独占 profile，结束随自有 profile 清理。

## 回报与停写

报告任务完成/部分完成、仓库/branch/起止 SHA、每个文件和 commit、真实版本/证据层级、逐调用对账结果、实际检查与 RED/GREEN、未测与下一单建议、清理/残留归属。完成即停写，不自行领取其他单。

root 采样若确实必需，发 NEED_ROOT_PROBE 给具体问题、待审脚本、允许输出和副作用；本单优先完成不依赖 Desktop 的 CLI 最小验证。不要向用户其他会话发测试请求。报告用正式派单的完整 typed ref、仓库 CLI、`--tool codex-desktop --delivery steer`；结果不明不重发，发送后继续独立工作或结束当前轮，不轮询/空等，不互发纯确认。
