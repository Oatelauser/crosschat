# C04-I02-R2：最终裁决与保留归属

2026-10-30（UTC+8）。Claude cworker1执行，root为Codex Desktop「多工具适配」。本单是I02内部返修，不是新功能单；收到完整基线派单后直接执行，不依赖旧聊天。

仓库D:/workspace/CC/multichat，branch codex/core-refactor-pre-tui。R1产品4476f33、证据7e4e9b0；root43/43，worker全量2573/11，但I02-R1-review.md列出的保证尚未闭合。当前仅原未跟踪docs/代码消息投递.md，不动不stage。先读AGENTS.md、code-standards.md、本单、I02-R1-review.md及相关实现/测试；原I02/I02-R1规格继续有效，无需重读无关历史。

## 仅收口以下原保证

1. **同一次deadline/取消直到最终交付。** 首次close与open等操作不能绕过已有截止；close中取消或总预算耗尽时不得返回路径。成功仅在传输完整、文件关闭确认及清理完成后，最终复核没有取消/超时。不要用新timeout允许交付在总截止之后成功。open若截止后才取得本次句柄，仍有owner收尾，不从迟到IO恢复成功。
2. **迟到资源不丢owner。** 请求失败/放弃要中止本次请求，fetch在截止后迟到的Response也必须有body收尾。清理等待有有限总预算，不能每项无限续期；某项失败不阻断其它可做收口。首次close只启动一次并保存其状态，不能为等待重复启动同一close。未确认本次IO/close完成就保留partial，不强删，报告真实路径和原因。
3. **必需保留信息不能因Error形态丢失。** 原始抛值可为undefined/null/0/false/空字符串、冻结Error。无额外清理问题且文件已收妥时可原样抛出；有保留路径/清理错误时允许并应使用含原始cause的可写包装错误，保存partialFile、未核实/清理原因。冻结Error引用相等不是原合同，不能为了toBe(original)牺牲必需字段；修正相应测试，保留cause链，不能出现替代TypeError。禁止通过打印stderr代替可读取的失败信息。
4. **fixture的异常路径同样收尾。** 捕获到的实例句柄close恢复/await与原型恢复均放finally，断言抛错也执行；测试不能依靠通过分支提前释放。不会settle的受控IO最后由fixture解锁，确认真实句柄关闭后才删自己的根。

建议在现有函数内采用“记录结果→有界收尾→最终裁决”，移除try内提前return；区分已捕获异常/未发生异常，不再靠truthiness。小型辅助函数可复用，不造下载框架、不新增对外API/状态文件。原已通过的精确URL、短写拒绝、假值清理、普通取消与Web/I01合同不回退。

## 白名单、验证与边界

仅scripts/dsh-compat-ci.mjs、test/dsh-compat-ci.test.ts、本目录I02-review-input.md；可新增I02-R2-check.txt。baseline/旧日志/root审查/任务/调度/总表/其它代码不动，不增功能文件、依赖、命令或用户步骤。无官方二进制下载、真实网络/模型/原生执行/注册表/用户配置写入，不触发Actions。

先业务RED后最小GREEN，本地checkpoint，至少实际覆盖：close中取消/总截止已过零成功路径；open停滞与迟到句柄收口；截止后fetch返回的body实际取消；冻结/假值错误叠加清理失败仍有cause+partialFile/原因；fixture断言失败的finally资源恢复。使用可控小型IO与独占根，注入必在finally恢复；不加skip、sleep碰运气或仅镜像内部状态。无需扩大无关控制矩阵。

定向回归、语法、ESLint/build后一次完整npm run check（forks/threads max2/min1），原始stdout/stderr及真实退出码留新R2日志，不过滤或覆盖首败。代码diff空白检查单独报告，旧原始日志尾空格保留。更新交付说明订正R1过宽处，记录最终实现及未测，不宣称C04或真实Desktop通过。

开工/结束核对branch/HEAD/dirty；共享无关提交核对祖先及白名单后继续。禁止checkout/pull/reset/clean/stash/amend/push、回退共享文件归责、全仓stage或夹带他方index；显式路径提交。完成按本条typed hint、仓库node dist/cli.js send、stdin、--delivery steer回传完整基线/RED/GREEN、保证→反例、检查/首败、文件/未测/清理；不使用Claude ListAgents/SendMessage联系root，不轮询、不盲重发、不自行领下一单。交付后停写等双轴复审。
