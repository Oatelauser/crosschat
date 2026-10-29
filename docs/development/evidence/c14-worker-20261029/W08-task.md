# C14-W08：Desktop 本机连接的 OS 进程锚点

2026-10-29（UTC+8）。用户要求结束通信问题的绕行、开始下一任务。**短柄恢复暂不继续，保留“不新增运行状态文件”决定；本单回到 C14 来源识别主线。** root 分发/原生采样/独立验收，本机 Claude `cworker1` 完成单个有限任务，不开启另一轮全景研究。

## 目标与验收结果

W01 已观察 Desktop shell 的祖先链，W05 已验证受控 CLI 的 Hook/call ID 对应，但仍缺独立的 Desktop OS 实例锚点。本单取得 **Windows 内核返回的本机管道服务 PID**，对照当前普通 shell 的最近执行实例及逻辑 IPC owner，明确相同、仅共同祖先、不同或不可核实。无需结果必然相同，也不能拿 hub PID 冒充逻辑 owner PID。

交付必须是：可运行的最小只读 peer-PID 探针、必要受控验证、一次 root 真实 Desktop 采样（若宿主拒绝则保存明确错误）、一份简洁结论。**不新增产品接线，不配置 Hook，不另造通用进程框架。** 完成此 OS 锚点即报告；有剩余缺口写清，不自动扩大至多窗口/daemon/三平台。

## Git、所有权和白名单

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；正式派单给 root 新提交 SHA。核对一致直接执行。worker 独占白名单/index，仅提交自己的本地新 commit，禁止 checkout/pull/reset/clean/stash/amend/push。原未跟踪 `docs/代码消息投递.md` 不动、不 stage。

允许新增：

- `docs/research/c14-desktop-os-source-anchor-20261029.md`：问题、实际结果、边界、精确复现和下一步。
- `docs/development/evidence/c14-worker-20261029/W08-probe.mjs`：小型只读探针，可导出必要纯函数供受控检查，不进入产品路径。
- 同目录 `W08-probe-check.mjs`、`W08-review-input.md`、`W08-result.json`：按实际需要添加，原始输出只允许 `wx` 新建，不覆写。

root 后续独立留存 `W08-root-probe.json` 与审计记录，worker 不写它们。`src/**`、`test/**`、skills、package、既有 W01/W03/W05/W07、总表/调度/本任务书不修改。未获本单的其他文件不 stage。

必读 AGENTS、代码规范、W01/W05 最终验收；只查当前问题相关实现：`src/codex/desktop-ipc.ts`、`src/application/caller-source/providers.ts`/`service.ts`、`scripts/codex-caller-source-probe.mjs`。优先复用现有祖先链/解析代码，不改已验收工装。

## 实施步骤

1. **读取已知本机管道的服务实例。** Windows 可用 `NamedPipeClientStream` + `GetNamedPipeServerProcessId`（只向本机连接，不发送业务请求），取得 PID 后读取创建时间和可执行路径摘要。每次连接有明确截止/关闭；不存在、拒绝访问、进程消失、PID 代次不符分别记录，不能当空结果或同实例。无安装、提权、下载或新依赖。若 Win32 调用需临时编译，只在本次自有 TEMP 内执行，确保有界与清理，不引入持久原生组件。
2. **只读 IPC 对账。** 可以复用当前 dist 的 `openDesktopThread` 完成 `initialize` 与 `thread-owner-discovery`，获得逻辑 ownerId；不用 `snapshot` 拉正文、不 subscribe、不调用 start/steer/rename/resume。连接只对本次原生 `CODEX_THREAD_ID`，收尾 `close`。如果选手写最小协议，必须复用已核实帧格式/超时，只支持上述两方法，不扩成新客户端库。
3. **root 现场输出。** 同一普通 Desktop shell 中取自身祖先链、`codex-ipc` OS 服务实例与逻辑 ownerId；可取当前 `CODEX_APP_TOOLS_PIPE_PATH` 的 OS peer，但此管道**只连接取 PID，不发送工具请求**。路径只在内存用，输出摘要/形状，不输出真实绝对路径、会话/owner完整值、环境全量或正文。实例关系用完整 PID/创建时间/路径值在内存比较，落盘布尔/允许元数据，不靠截断散列证明相等。
4. **受控验证。** 用本次自有本机管道证明能取得预期 server PID，并覆盖不存在/连接超时与关闭；实例比较覆盖同 PID 不同创建时间、只共享祖先及元数据不全。普通验证不读用户进程表/聊天，不安装原生工具，不启模型。只验证有意义行为，不复制 W05 的大运行器、后代回收或整个失效矩阵。
5. **有限结论。** 明确区别 OS pipe server、逻辑 ownerId、最近执行实例和当前 call。server PID 是独立 OS 证据，但若 pipe 是共享 hub，仍不能直接等同 owner；工具 pipe 路径继承也不证明本次调用实际用过它。保持生产 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED`，不以候选事实升级 `identified`/`association`，不启用人工确认。

## root 协作和停止条件

探针先就绪并完成必要检查后发 `NEED_ROOT_PROBE`，明确一条命令、允许输出、实际读请求/副作用和截止。root 在当前真实 Desktop shell 执行，不要求用户去其他会话采样。worker 可继续整理本单检查，不能轮询/空等；root 回传证据后据实收口。

若连只读 peer PID 都因宿主/权限不可用，给实际错误与最窄缺口即可，不安装补齐、不改用户 Hook/config、不起停 Desktop/daemon、不再开三平台研究。若独立 OS 证据仍不能闭合逻辑 owner，明确这一具体缺口，本单不把所有潜在后续变成完成要求。

## 验证、资源与交付

新增脚本做 `node --check`、必要受控检查及对应差异检查。纯研究探针不改 src/test，不重复产品全量 `npm run check`；最近产品基线仍为 2503 通过/11 原有跳过。不以测试数量/覆盖率替代观察，不做文案字符串测试。

所有本单 timer/socket/子进程/临时根有 owner、截止与 finally。只清理本次明确创建的资源，删除前核对解析后绝对路径、父目录、前缀及 ownership；被拒删除保留报告，不换机制。不要触碰既有被拒 cache/其他 D 盘目录。原生配置、auth、聊天、注册与真实生产远端均不改；无真实试发。

完成报告 branch/起止 SHA/文件/commit、实际运行体与检查、原生/合成范围、独立 OS 锚点结果和剩余缺口、清理/残留。仅本地新 commit；按正式派单 hint、约定仓库 `node dist/cli.js`、`--tool codex-desktop --delivery steer` 报告。完成停写，不自行接下一单、不轮询、不等回执。
