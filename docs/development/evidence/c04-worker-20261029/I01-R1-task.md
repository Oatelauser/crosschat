# C04-I01-R1：绑定、读取预算与部分安装归属

2026-10-29（UTC+8）。执行 cworker1，root 为 Codex Desktop **多工具适配**。本单独立续接，不要求旧聊天记忆；完成报告后停写，由 root 双轴复审再派下一单。

## 事实、授权与白名单

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`。真实派单基线以 root 消息的完整 SHA 为准；I01交付到 `5d4ba3b`，产品 `1125c90`。用户已授权连续开发，允许新增skill；其它新增功能文件/必需用户操作仍须拍板。本单是原合同缺口修复，不新增功能文件、参数、依赖或用户操作，不进入真实 Desktop 安装/runner。

先读 AGENTS.md、代码规范、本单、[独立审查](I01-review.md)、相关源码/测试；需要原始合同再读 [I01-task](I01-task.md)。原始完整check为2553通过/11原有跳过，root定向23通过，但未覆盖审查反例。

仅可改既有 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts`、本目录 `I01-review-input.md`；可新增 `I01-R1-check.txt` 开发证据。根任务/总表/调度/审查/旧原始日志不动，其它功能文件/helper/workflow/package/通信产品不动。原未跟踪 `docs/代码消息投递.md` 不动不stage。

开始/结束核对branch/HEAD/dirty；无关共享提交只核对祖先/白名单后继续。不 checkout/pull/reset/clean/stash/amend/push，不回退他方文件归责，不全仓stage；只提交显式白名单，新证据逐项add，使用实际shell的正确引号。

## 必须收口的保证

1. **独立调用方上下文绑定。** Desktop attempt 的运行、安装/owner、实例、具体会话，均须与调用方已确定的本次期望逐字匹配，不只验证格式，不从报告反抄成期望。上下文可由受控安装/启动准备步骤产生；若启动后才知道会话，明确可信回传边界，不让同一个未校验报告自证。缺失期望不能降为“任意合法值”。sequence 必须把它使用的 attempt 与本次上下文接通，不能绕过新鲜校验直接认可 operations.probe 给的旧报告；基线/候选（允许同版本同发行物）/重试不复用运行或安装实例身份。不要造通用身份框架或借机实现C14。
2. **完整必需值。** 比较发行物版本/完整性身份前先验证内部记录及报告的存在、类型和值形状；两个 undefined 相等不构成绑定。保留内部SRI合同即可，不提前做官方元数据/下载器。Desktop attempt 的 PASS 必须包含完整且肯定的 cleanup；缺失/未知/强杀不得 PASS或供后续删除。失败报告可保留真实原因，但不能伪装释放已证实。
3. **读取与截断。** 给新 Desktop 报告明确字节预算，在整文件解析/返回前有界读取；超限或不可读、非普通文件/链接等无法核验载荷返回基础设施失败并保留释放未知。注意大小预检与读取间增长不能突破预算，不用读完整文件后才查length。Desktop执行器结果明示输出截断时拒绝，约定并保留必要的完整性字段；未知不得当作已证明完整。不要为此放宽旧Web接口或批改无关helper；测试使用真实临时文件与明确的截断元数据。
4. **安装中途失败的归属。** 安装操作发生前预先建立本次归属，或定义可校验的结构化部分安装失败合同，保留已知 root/安装身份/owner及原因；不能只有错误字符串。释放未知不盲probe/remove/卸载，也不开始下一安装。完全尚未建立归属的失败如实记未知，不凭错误文本伪造目录。验收至少覆盖“本次owned根/marker已创建，install随后抛错”的实际fixture，并确认根/marker未删、归属出现在summary、后续操作零调用。
5. **回归与证据。** 保留原Web默认入口/报告/分类/reporter/调用顺序，不把Desktop放进Web reporter。六类Desktop必要check和自然退出/官方卸载/两类注册清理要求保持。订正review-input首轮“错实例/会话已覆盖”“绑定同一实例”等过宽表述，追加R1实际保证与调用方法；保留原日志及未实现列表。不要借本单做下载/安装/UI/注册的真实执行。

## 验证与回报

先补有意义业务RED并保存checkpoint，再最小实现同组GREEN保存checkpoint。反例必须包含**格式合法但不同**的实例/会话、旧run与同版本串行复用、双方缺失发行物身份、缺cleanup、完整合法但超预算JSON、明确truncated执行结果、部分安装抛错保留已知归属。现有Web和Desktop回归继续通过，不以missing export/类型迁移崩溃代替业务RED，不加skip/放宽行为断言或固定覆盖率指标。

定向Vitest、语法、对应lint/build通过后，一次完整 `npm run check`，forks/threads均max2/min1；完整stdout/stderr与真实退出码落新 `I01-R1-check.txt`，不tail/过滤/覆盖首败，不以隔离通过追认根因。fixture仅独占临时根，删除前核绝对路径/归属，测试自身负责收口；不扫描或杀用户进程。若新的真实失败阻断，先报告可证事实。

不下载/安装/升级/卸载工具，不启停Desktop/Host/daemon，不碰注册表/协议/用户技能/config/auth，不调用模型/远端或试发，不push/触发Actions。通信与来源产品属于Bug修复2，本单只修离线工装。

报告基线/父提交/RED/GREEN、每项保证→反例/结果、字段与后续接线方法、完整检查/首败、文件、未测/清理。固定用约定仓库 `node dist/cli.js send`，保留本条typed hint conversation/tool，正文stdin，显式 `--delivery steer`。不要用Claude ListAgents/SendMessage联系Codex；仅明确引用失败后按repo skill核实原root **多工具适配**/codex-desktop恢复，不猜短柄，不因queued/parked/unconfirmed重发。无需纯确认消息，不轮询，不自行领下一单或关闭C04。
