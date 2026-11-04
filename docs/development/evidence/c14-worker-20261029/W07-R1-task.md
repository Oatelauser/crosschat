# C14-W07-R1：收窄恢复结论并保护证据

2026-10-29（UTC+8）。root 派单给本机 Claude `cworker1`。**单次小范围研究返修，不实施产品，不展开新研究工装。** 开始 SHA 以正式派单为准；核对仓库 `D:/workspace/CC/multichat`、branch `codex/core-refactor-pre-tui` 一致后直接开工。worker 独占本单白名单/index，禁止 checkout/pull/reset/clean/stash/amend/push。

必读 [首轮审计](W07-review.md)、[原任务](W07-task.md)、AGENTS 与代码规范。原未跟踪 `docs/代码消息投递.md` 不改、不 stage。

## 白名单

- `docs/research/c14-short-hint-recovery-20261029.md`
- `docs/development/evidence/c14-worker-20261029/W07-review-input.md`
- `docs/development/evidence/c14-worker-20261029/W07-probe.mjs`
- 可新增同目录 `W07-R1-checks.md`、`W07-R1-result.json`，非必需不加文件。

**原 `W07-result.json` 精确字节及其余历史证据/root记录/总表/任务书不动。** 不改 src/test/skill/package，不触碰用户状态或试发。无全局部署、安装或原生工具调用。

## 必须修正

1. 撤回“别名式恢复 + 不改 LRU8/触碰顺序 + 恢复不删任何旧号”已闭环的结论。写清满槽立即淘汰的反例，包括“保住当前 c14 却淘汰另一组撞号柄”同样不安全。区分恢复当刻与以后普通淘汰/清理。
2. 给明确条件：无持久变化的较小方案仅在有空槽时可追加，满槽返回 undefined；它仍改变别名槽位/刷新并且没有持续拒绝旧歧义的保证，尚未批准。机器级冲突账本是另一项需用户决定的具体提案，参考 root 审计的写序/清理/失败边界；不进一步扩成任意历史柄永久安全的证明。不得宣布 W08 可以不经决定推进。无需自行创建 W08。
3. 改正任一安全柄即可复用、四个公开写 API 与只读 `continueConversation` 的分类。收窄 E5 为本次 Windows 只读目标失败；CAS 首写也可能冲突，不声称残留天然安全。刷新别名与旧 LRU 触碰/槽位不同须明说。删去要求旧版兼容/降级支持的实施范围；本轮用户要求直接升级。
4. 探针在任何临时实验根创建之前校验 `--out`，已存在必须非零拒绝，最终写入用 `flag:'wx'`。不要覆盖原证据。整体状态根放入 try/finally，读只目标的权限恢复也走 finally；只删除本次成功独占创建、父路径/前缀已核实的根。保持 Windows 小型探针，不新增跨平台框架/子进程/复杂注入。
5. 可加一个小型 E6：按 root 反例，用真实 API 给满 8 槽加入第九个**不同 nonce** 的柄，观察原冲突 c14 立即唯一。必须明确它证明当前 LRU 规则、不是尚未实现的别名分配器。若只在报告引用 root 已复放结果也足够，不要求为凑数量加测试。

## 验证与回报

- `node --check`；默认 stdout 探针一次，原 E1–E5 局部结果保持成立。新增结果只能 `wx` 写新路径。
- 用自有临时输出验证“已存在输出→实验前拒绝且字节不变”“新输出→合法 JSON”“默认→不改留存证据”；确认自有实验根无残留即可，不建新的测试框架。
- 核对原结果 SHA256 仍为 `e256133b503b2fba4507fb5f1fdb5934af98e04be24f01c571f20081d3aee302`，运行差异/链接检查。不跑全量 npm check、不做文案字符串测试。
- 独立本地新 commit，仅 stage 白名单，使用当前实际 shell 正确的提交消息写法；不要修改上一提交。报告起止 SHA、文件、实际检查、清理和未决，明确仍未实施产品。
- 完成后按正式派单 ref，约定仓库入口、`--tool codex-desktop --delivery steer` 汇报；停写，不等回执、不轮询、不接 W08。
