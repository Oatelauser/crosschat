# C04-I02-R3：收尾取消与迟到资源报告

2026-10-30（UTC+8）。Claude cworker1执行，root为Codex Desktop「多工具适配」。同一I02任务内部返修，收到含完整基线SHA的root消息后直接执行，不要求旧聊天记忆。

仓库D:/workspace/CC/multichat、branch codex/core-refactor-pre-tui。R2产品9699354、证据f944581；root46/46、worker完整2576/11，但I02-R2-review.md两组保证尚未闭合。工作区仅原未跟踪docs/代码消息投递.md，不动不stage。最小读取AGENTS.md、code-standards.md、本单、I02-R2-review.md及相关实现/测试；原I02/R1/R2规格继续有效，不读无关历史。

## 两组收口

1. **计时器和取消监听保持到最终交付裁决。** 不能在finally顶部stop后再等待cleanup，并用停止更新的signal证明未取消。清理期间外部取消或总截止到达也必须拒绝零路径交付，已关闭本次文件能清则清，不能确认清理则报告路径与原因。成功/失败裁决、失败时收口和timer/listener释放应有清晰顺序；无论抛错值为何，各出口都释放监听。沿用有限总清理预算，不在最后补删时重开完整预算。请确定性覆盖“cancel已开始但尚未完成时caller.abort”和“响应/写入/close均完成但cleanup跨越总截止”，不要再把这个分支声明为不可命中的时序窗口。可用gate而非碰运气sleep。
2. **迟到资源收口有可读结果及完整锁释放。** 不再丢弃settleWithin的done/failed或迟到close/rm结果；late reader cancel后也必须finally releaseLock。截止返回时若open/request未决，不必无限等它，应该立即在失败报告记录尚未核实的资源/可能partial路径（区分可能存在与已确认创建），并给后续到达的本次资源保留收口owner。close/rm失败或未落定如实记录，不能返回只有普通timeout、无任何可定位信息的错误。普通原始值/冻结Error同样通过已有cause包装携带报告；不得从迟到IO恢复成功，也不删非本次wx取得的文件。不声称异步fs.open“真实不可能迟到”。

没有新增公开接口/功能文件需求；可在既有函数内收敛这两条控制流，不引入通用框架，不重做已关闭的URL/短写/普通假值/冻结cause/fixture finally逻辑。

## 白名单与验证

仅scripts/dsh-compat-ci.mjs、test/dsh-compat-ci.test.ts、本目录I02-review-input.md；可新增I02-R3-check.txt。baseline、旧日志、root任务/复审/调度/总表及其它文件不改。无新源码文件/依赖/命令/用户步骤/持久状态，无实际官方二进制/外网/模型/原生执行/注册表/用户配置写入。

先业务RED再最小GREEN，各本地checkpoint；保留现有46项。至少确定性证明：cleanup期间abort和总截止不成功；late open→close失败/停滞、late remove失败均有可读取路径/未核实原因，最初超时返回时已有保守未决报告；late response cancel后reader不再locked。注入及fixture真实句柄均在finally恢复/关闭，确认关闭后才删独占根，不以进程强退当收口。

定向、语法、对应ESLint/build、代码diff检查后一次完整npm run check（forks/threads max2/min1），完整stdout/stderr及真实退出码留新R3日志，保留首败，不加skip/放宽语义。交付说明订正R2过宽处、追加当前结果及未测，旧原始日志不改。通过后不无理由再跑全量。

开工/结束核对branch/HEAD/dirty；共享无关提交核对祖先/白名单后继续，不checkout/pull/reset/clean/stash/amend/push，不回退共享文件归责或全仓stage，显式路径提交。完成按typed hint、仓库node dist/cli.js send、正文stdin、--delivery steer回报，不用Claude ListAgents/SendMessage，不轮询/盲重发；停写等双轴复审，不关闭C04或领下一功能单。
