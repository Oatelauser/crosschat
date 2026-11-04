# C13-P01-R1：草案事实和复现有效性最小收口

2026-10-29。仅返修方案/隔离工具，不实施产品。原任务范围继续适用，审查见 [P01-review.md](P01-review.md)。正式派单给出 root 此提交后的基线；核对 branch/HEAD 一致即开工，不切分支、不 amend/push。worker 独占本单白名单/index，root 不并行写这些文件。

仅允许修改 `docs/development/c13-harness-lifecycle-design-20261029.md`、本目录 `P01-repro.mjs`、`P01-review-input.md`（追加返修节）；可新增 `P01-R1-result.json`，必须独占新建。原 `P01-result.json`、root 任务/审查、src/integrations/test/skills/package/指南/总表/调度及原未跟踪文档均不改。

1. 按审查更正路径变化条件、skill 手工流程、同PID禁用/子scope撤销/Host进程退出的区别，区分现有证据与正式Desktop未测。没有固定依据的 remove 语法/更新顺序降为待核验，不声称跨两套 CLI 可靠管理不可能。
2. 删除下一单的关闭失败重试要求。保留当前同一 closing Promise 的合同：首次关闭独立尝试每项清理，再报告错误；重复调用不重复释放。明确释放失败与 scope 销毁/Host 重启不同，新增命令和默认目标仍待用户讨论。正常基线不是新增测试后数字必须不变。
3. 复现每场只接受正常退出、未超时、未截断、有效 RESULT 且场景/必要观察字段符合本次预期的采证。缺少 URL 或未探测不得算“确认关闭”；关闭观测仅 ECONNREFUSED 算已确认，超时/其它网络错误保留未核实。工装失败输出 problems、退出1；无复现与采证失败区分。`--out` 保护不变，既有证据字节不变。
4. 对本次直接子进程按字节封顶输出并记录超限；error 只记录，最终以 close 收束。超时/超限 kill 后给有限 close 截止；若未确认 close，停止后续场景、保留本次根，失败报告 retained/path，父 finally 不删根。只管理这个自己启动且不生后代的 node 进程，不做宿主扫描/杀树/新框架。保持清 CROSSCHAT_LIVE。普通正常子进程退出后的端口/登记观测保留。
5. 检查仅语法、默认正常复现、一个受控采证失败反例（例如自有副本中让子进程 import 缺失，证明异常退出/无RESULT不能报成功）、原证据哈希及 diff。不建通用测试矩阵、不改现有 Vitest 文件、不跑全量产品 check。若验证需要副本/临时根，仍限自有目录/路径归属且有界回收。无需为此添加几十条工装断言。

独立本地新 commit，报告事实修订、实际运行/退出码、资源清理及尚未批准的产品范围。完成停写；按正式派单 typed ref 用约定仓库入口、收件 codex-desktop、delivery steer 回报，不自行开始实现、不轮询。root 可同时把收窄后的具体产品方案交用户讨论。
