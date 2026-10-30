# C04-I01-R2：UUID 类型与失败归属收口

2026-10-30（UTC+8）。执行者 Claude `cworker1`，root 为 Codex Desktop **多工具适配**。用户已明确“继续任务”，恢复先前停止的派单与复审流程。本单独立可读，不要求旧聊天记忆；只执行本单，交付后停写等root复审。

## 基线与授权

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`。派单真实基线以root消息给出的完整SHA为准；恢复前HEAD为 `9b3af230ff94b073a0d8f5bd707f73722c03e4af`，R1产品 `d406392`、证据 `ea51da9`。工作区仅原未跟踪 `docs/代码消息投递.md`，不动、不stage。

用户继续授权既定普通开发，但新增非skill功能文件、必需用户操作变化仍须拍板。本单只收口 [R1复审与暂停检查点](I01-R1-review.md) 的两项P2，不新增功能文件/参数/依赖，不安装真实Desktop，不触发托管，不扩大通信产品（归Bug修复2）。暂停时保存的事实与首轮/R1原始日志均保留。

最小读取顺序：AGENTS.md、`docs/development/code-standards.md`、本单、R1复审、相关两个源码/测试文件；需要上下文再读交付记录 §九。不重载整批历史。开工/结束核对branch/HEAD/dirty；共享无关提交核对祖先和白名单后继续。不checkout/pull/reset/clean/stash/amend/push，不回退他方文件归责，只提交显式路径，新证据逐项add，不夹带他方index；使用实际shell正确引号。

## 两项保证

1. **UUID先验证字符串类型。** 新Desktop内部需要UUID的调用方/报告字段（runId、installationId、launch/report的instanceId，以及部分安装失败记录的安装ID）不得靠正则隐式转字符串；包含合法UUID的数组或其它非字符串均不接受。修复报告入口与调用方边界，不能仅改Set、stringify或强转后认可。两个分别新建但装着同一UUID的数组不能通过sequence并绕过去重；合法字符串UUID仍可通过，同一字符串实例重复仍须拒绝。限制在Desktop，不改变既有Web载荷合同。
2. **所有已知失败归属保留完整。** 正常install已返回完整本次记录后，probe抛错、报告被拒/释放未知、remove抛错的retainedInstallation都保存root、installationId、owner、label/version和真实reason。结构化部分install失败已通过的路径保持。释放未知时不remove，不继续下一安装；remove失败也停止后续。没有已知身份时不从错误文本或报告伪造归属。不要让共享循环给原Web的retainedInstallation增加字段或改变其既有形状；可复用很小的Desktop归属投影，勿造框架。

本单不把先前未动态复现的报告文件替换风险扩为第三轮研究/整改，也不做正式发行物下载、安装器、UI driver或runner；保留1MiB读取预算、完整性/cleanup/上下文绑定、六类check、Web默认入口/阶段/分类/reporter/串行顺序。

## 白名单与验证

仅既有 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts`、本目录 `I01-review-input.md`；可新增本目录 `I01-R2-check.txt` 留开发证据。其余功能文件/helper/workflow/package/skill/指南/root任务与总表/调度/审查、旧原始日志不动。确需其它路径先报必要性，不先实施。

先新增并执行有意义业务RED，再最小实现同组GREEN，各保存本单checkpoint。不以导出缺失/接口迁移崩溃为RED，不加skip、放宽语义或设覆盖率数值门槛。至少有：

- 数组UUID报告在sequence被拒，零remove/后续安装；调用方UUID非字符串也拒绝。合法字符串正常序列、重复字符串实例拒绝保持。
- 正常install已知完整归属，分别覆盖probe抛错/释放未知、remove抛错，断言完整retainedInstallation与停止调用顺序；使用独占临时根及marker，确认未知释放时字节/路径未被工装删除。纯合成路径不替代必要的实际临时根反例。
- 既有Web与Desktop回归保持，Web原有返回结构不变。

定向 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`、`node --check scripts/dsh-compat-ci.mjs`、对应ESLint/build后，一次完整 `npm run check`（forks/threads均max2/min1）。完整stdout/stderr与真实退出码落新日志，不tail/过滤/覆写首败；失败只按已证据事实归因，不以随后隔离通过证明根因。fixture均独占临时目录，清理前核绝对路径/归属，不扫描或杀用户进程。

不下载/安装/升级/卸载原生或全局工具，不启停Desktop/Host/daemon，不碰注册表/协议/用户skill/config/auth，不调用模型、远端或真实试发，不push/触发Actions。

## 回报与通信

报告真实基线/父提交/RED/GREEN、两项保证→反例/结果、字段及Web边界、检查/首败、修改文件、未测/清理；订正交付记录过宽处并追加R2，不改旧日志。不自行关闭C04、领下一单或轮询。

固定仓库 `node dist/cli.js send`，保留本条程序typed hint的conversation与tool，正文stdin，显式 `--delivery steer`。不要用Claude `ListAgents/SendMessage`联系Codex；只有明确引用失败后，按repo crosschat skill核实原root **多工具适配**/`codex-desktop`再恢复，不猜短柄，不因queued/parked/unconfirmed盲重发。收到本单直接执行，无需纯确认回信。
