# C14-W06：两处既有隔离测试的等待稳定性

2026-10-29（UTC+8）。root 分发/审计，本机 Claude `cworker1` 执行。W05 研究工装已经独立验收；本单只修全量检查暴露的两处测试时序，不改产品行为，不做新的来源研究/原生运行。

## Git 与白名单

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，新基线由正式派单给出。核对一致直接执行，不重复握手；不一致报告，不切分支/pull/reset/clean/stash。worker 独占本单写入和 index，只 stage 白名单，独立本地新提交，不 amend/push。原 `docs/代码消息投递.md` 保持原样。

必读 AGENTS.md、代码规范、TUI进度、[W05验收](W05-final-review.md)。仅允许：

- `test/tui-main-observations.test.ts`
- `test/core-diagnostics.test.ts`
- `docs/development/evidence/c14-worker-20261029/W06-review-input.md`（新增汇报/检查证据；若需完整日志可同前缀另存证据，不写用户数据）

禁止修改 src、其它测试、包依赖/Vitest 全局配置、W05 代码/历史证据/任务、skill、调度总表、用户配置或真实状态。无需安装软件/访问远端/真实模型/原生用户会话。不接短柄恢复实现。

## 已证事实

1. TUI 测试在 `vi.waitFor(render CalledOnce)` 的默认 1000ms 超时，尚未到 home/discovery 断言。root/独立诊断通过样本约 650–945ms；render 前动态加载 contexts、Ink/UI、composition。W05 未改这些 blob。不是“路径值错误”的证据。
2. 诊断测试拿取消结果与固定 500ms race；产品 finally 等 taskkill /T /F 回调和进程退出后才抛 AbortError，API 没有 500ms 保证。root 全量实际复现该失败，2502 pass/1 fail/11 skip。受控延迟回调复现 500ms 时 probe 已死亡，但取消结果约 1025ms 后才交付。当前证据支持测试等待不合理，不支持改产品取消语义。

## 最小修改计划

1. TUI 仅该首次 render waitFor 用显式 `{ timeout: 5000 }`，该 case 总预算 10000ms。保留 mocks.discovery、overview/home/nativeEnvironment 全部断言，保留 signals/finally 清理。其它 waitFor 和产品入口不改，不以 sleep 代替事件/条件。
2. 诊断真实隔离子进程取消用例删除 500ms Promise.race 和对应固定字符串，直接等待已建立的 settled，仍断言结果为 AbortError、probe PID 实际已消失。该 case 用 10000ms 总预算阻止无界挂起；marker 就绪的有界等待、finally 自有进程清理保持。若发现测试本身清理无法保证，先报告最小修法，不顺手改产品。
3. 不新增“timeout 数字等于某值”的镜像断言，不加覆盖率要求。已有失败输出就是修复动机；用有意义负控制验证没有弱化语义：可在隔离副本/自身未提交变更中将受控返回改为 resolved，或取消动作不触发（须仍有有界清理），确认现有语义断言失败，再还原字节。不修改实际生产探测路径或用户进程；不为 RED 造成长驻残留。若只做最小测试调整，不要求制造不必要的多轮 RED。
4. 定向运行这两个测试文件，ESLint，再跑一次最终 `npm run check`，保存完整日志或失败原文及汇总。不得通过跳过、删除真实死亡断言、vi.retry 或整包串行化掩盖；若出现新失败，准确保留、报告，不扩大白名单。通过后不要继续反复全量跑。

## 验收、清理与回报

两项行为断言原样有效，等待是有界的；全量 check 退出0，或明确报告外部/新阻塞而不冒称通过。所有自有受控子进程等待退出，fixture 临时根按绝对路径/归属核验后清理；被拒删除不重试换手段，沿用 D 盘约定。root 那份被拒删除的 W05 cache 日志不属本单，不触碰。

回报 branch/起止 SHA、独立 commit/文件、精确改动与保留断言、定向/全量结果、必要负控制、退出进程和临时目录归属、未决项。完成停写，不领取新单、不等待确认/轮询。使用正式派单的完整 typed ref、仓库 `node dist/cli.js send`、收件 `--tool codex-desktop --delivery steer`；结果不明不自动重发。
