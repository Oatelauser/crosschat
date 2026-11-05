# C11/C12：DSH四目标从零接入托管终验

当前补记：2026-11-05后续：ef8ef98文档提交的普通41981774584为Windows/Ubuntu成功、macOS一项迟到响应测试失败；macOS既有continue-on-error使run总体success，不等于三job全绿。[托管RED与受控时序复现](late-response-red-validation.json)保留。0ad2d1e保存RED，现只把该测试的150ms猜测改为返回后显式释放响应，finally等待真实取消/锁释放；正常及父线程停顿200ms两例都通过，30ms产品截止/未决记录/清理断言不放宽。[126项定向、完整2828通过/11原有跳过](late-response-green-validation.json)及原生10个blob相同已核验。最新修复推送后的普通CI按新head逐job确认，不能用e1旧绿或ef总体success追认；四目标原生通过保持，不追加原生dispatch，main合入/新周更仍未授权。

2026-11-05（UTC+8）。用户明确批准推送0d0f91a、创建草稿PR与候选分支四目标C11；已履行，见[启动回执](launch-validation.json)和[PR #4](https://github.com/Oatelauser/crosschat/pull/4)。main合入、新POSIX从零周更和发布不在本次授权内。root独立开发、自审，未派worker，用户保留的DSH软件/PATH未动。

## 原生结果

[41978059319](https://github.com/Oatelauser/crosschat/actions/runs/41978059319)，head **0d0f91a81bbb7264cd2bca830013d64b40fa2c0a**，attempt1；只dispatch一次，没有手动rerun。Windows/Linux x64、macOS Intel/ARM四个probe均success，report按候选分支守卫skipped，无Issue写入。每个job上限75分钟，本轮四job实际约21分51秒、2分43秒、9分24秒、3分30秒；设置上限不是实际消耗。

每目标官方npm rc.2→rc.5各六阶段通过：官方profile/plugin/skill安装、原生skill加载与来源、精确发现/双向回信、同源doctor与真实TTY、技能更新/保留profile退出、官方插件与crosschat移除/聊天保留。八个fresh UUID互不重复，报告scope/version/目标/process与原始子报告对应；所有运行、桥登记、隔离安装及默认npm缓存正常移除，forced=false，无兼容性retry，compatible/notify=false。三个POSIX目标安装DSH前的真实PTY七项均通过；实际终端child/host退出0，TUI模式及listeners恢复。Windows安装两次npm总耗时577724/496775ms，未超过原15分钟；不据此追认历史安装超时根因已消除。

[四份ZIP与23项原生取证索引](native-validation.json)、[逐目标/源码核验](native-verification.json)保留。ZIP大小及SHA256逐一匹配GitHub artifact元数据，共156个成员：路径、类型、逐文件4MiB/总32MiB预算、CRC与内容摘要均核验，未执行artifact代码。原始包锁、安装输出、skill完整加载正文、身份、doctor、TTY录制、维护回执及聊天摘要均在ZIP内；分目标inspection索引记录每个成员摘要。安装先核验官方SRI再使用本地tarball，包锁resolved应为file:../sha256(integrity).tgz，独立检查时最初误期望官方URL，已订正检查，未改原始文件。清理证明限于受控fixture及其owner，不扩大为任意逃逸子孙。

## 普通CI与测试工装修复

首轮普通[41977889894](https://github.com/Oatelauser/crosschat/actions/runs/41977889894)真实失败：[原始输出/索引](red-validation.json)。Windows2826通过/1失败/11跳过，真实PowerShell签名测试超过外层5000ms；macOS2821通过/1失败/16跳过，查询线程实际回收输给250ms等待；Ubuntu2822通过/16跳过。未将首败改写为通过。

f83a54d保存RED；e1f4d00只改两个测试fixture：真实PowerShell的测试内操作预算20秒、外层25秒，未签名拒绝及影子模块零执行断言保持；查询测试先等fixture发ready，再执行原20ms截止、250ms等待和threadId=-1断言，并在finally清除timer/终止fixture。生产查询、签名截止时间、默认策略和清理代码均未改。原真实签名测试本机327ms通过，订正后的12样本线程探针冷/热均通过，因此不声称已经重现或证明每个托管延迟的底层原因；初始探针控制组错误地发送ready消息，原始结果及限制也保留。

[125项定向及完整检查](timing-green-validation.json)：官方便携Node22.23.4完整2827通过/11原有跳过、240文件通过/3跳过，lint/build与204模块689边导入图通过。[修复后普通41980572627](https://github.com/Oatelauser/crosschat/actions/runs/41980572627)三job实际success，[三份raw与摘要](fixed-validation.json)保留。执行原生head0d0f91a与测试修复head e1f4d00的9个原生路径及工作流共10个blob相同；src、package.json与package-lock.json相对main a1e6464不变。本次不追加原生dispatch。

## 自审与剩余边界

按仓库规范核对：工具/传输差异未进入新产品分支；未改用户命令、必需步骤、持久数据格式或新增home账本；只读报告有界校验，进程、timer和清理owner保持。已有本地TDD/真实Linux首败与短TMPDIR复核见[本地审阅](../c12-posix-onboarding-20261105/review.md)。最终证据/指南提交只含文档，最终SHA及其普通CI另按PR实际状态核实，不把e1f4d00的结果写成未知后续head的检查。

DSH npm/Web本批四目标六阶段托管切片移出活动实施，C11/C12父项及其它工具/正式Desktop入口继续保留。真实schedule事件、生产Issue去重写入、浏览器UI、模型智能、跨机R1/R2/R3和Desktop完整安装/官方卸载不计通过。main a1e6464既有Ubuntu来源锁失败仍归原负责人，未改公共实现/断言，也不追认修复。PR #4若另获明确合入批准，将保持Windows从零周五13:07，启用POSIX从零周五14:07（UTC+8）；C05既有计划保持，不发布包。

所有本轮原生job与本地检查已结束，测试修复CI已结束；最终文档提交普通CI按PR核实。开发worktree、依赖、便携Node与可审计的操作缓存保留，不将开发工具删除当作原生清理前提，也不扩大为全机TEMP清理。
