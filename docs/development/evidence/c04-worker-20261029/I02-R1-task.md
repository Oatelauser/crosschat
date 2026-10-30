# C04-I02-R1：下载边界、完整落盘与异常收口

2026-10-30（UTC+8）。执行者Claude cworker1，root为Codex Desktop「多工具适配」。这是I02同一任务的返修，不是下一功能单；收到root含完整基线SHA的消息后直接执行，不依赖旧聊天记忆。

## 续接与范围

仓库 D:/workspace/CC/multichat，branch codex/core-refactor-pre-tui；真实派单基线由root消息给出。I02首轮产品c2a2e2f、证据7741cf3，root定向40/40；全量2570通过/11原有跳过。原未跟踪docs/代码消息投递.md不动不stage。

先读AGENTS.md、code-standards.md、本目录I02-task.md及I02-review.md、相关代码/测试；无需读其它历史。用户普通开发授权继续，新增非skill功能文件/必需用户操作仍需决定，本单不触发。只修下面原规格缺口，不新增依赖、功能文件、命令、状态格式或用户步骤，不做真实下载/安装/UI/外网/模型调用，不改Web main/workflow/reporter或I01合同，不重开旧报告文件替换研究。

白名单：既有scripts/dsh-compat-ci.mjs、test/dsh-compat-ci.test.ts、本目录I02-review-input.md；可新增I02-R1-check.txt。baseline固定元数据已正确，不改；I02-check.txt及其它旧日志、root审查/任务/总表/调度不改。开工/结束核对branch/HEAD/dirty；共享无关提交核对祖先及白名单后继续。禁止checkout/pull/reset/clean/stash/amend/push、回退共享文件归责或全仓stage；显式路径提交，不夹带他方index。

## 必须同时闭合的保证

1. **元数据精确且无隐式类型认可。** feed限固定官方nightly地址；安装包URL/filename必须对应已校验版本的精确 `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-<version>-win-x64.exe`。拒绝版本子串伪装、额外子目录/其它后缀、非默认端口及原规格禁止的凭据/query/fragment/异主机；sha512必须先验字符串再规范base64。parser与公开download边界都不能绕过，保留窗口/大小/Windows x64及现有正常元数据。不新建第二套漂移规则或通用框架。
2. **完整落盘后才交付。** 处理bytesWritten，逐块写全后才推进，零进展/异常不伪装成功；输入流摘要相等不能代替落盘完整性。用受控FileHandle短写的实际字节反例证明最终文件完整或明确拒绝，不能只断言调用次数。只有写入/正常关闭确认且摘要/字节数一致才返回可安装路径，关闭失败不能吞掉后仍返回成功。
3. **截止/取消和清理都不能无界阻塞。** 覆盖写盘等待以及响应头/body等待；不因finally先清timer再无界await cancel/close而永久挂住。失败时中止本次请求并收束body；HTTP/错长度/EEXIST发生在reader取得前也不能漏掉响应body。释放reader锁、文件句柄、timer及外部signal监听，迟到响应/IO不得转成成功或任意删文件。某个收口失败不跳过其余可做的收口。若不能确认自己未完成IO/句柄已释放，不声称已清、不要在仍可能写入时强删；有界报错并明确partialFile/未核实原因，不扩成进程/杀树/宿主扫描框架。
4. **失败与错误保真不按真伪判断。** reader/fetch等抛出null/undefined/0/false/空字符串仍是失败，已确认能清的本次partial必须清；EEXIST外来文件原字节不变。清理失败记录本次路径及原因，保留原始异常或cause；不能假定原始抛出值是可修改Error对象，不可写/冻结Error也不能被替代TypeError顶掉。成功与失败状态显式区分，不用failure真值作为归属/删除判据。

## 验收

先实际业务RED，再最小实现同组GREEN，各本地checkpoint；保留原40项回归。至少有精确URL/类型在两个公开边界的反例、真实短写完整性与零进展、写入停滞及cancel停滞仍有界返回、早期拒绝body取消/reader锁释放、假值读取失败partial清理、close/清理失败错误保真。用现有Vitest能力局部注入，不为测试增加生产框架；故障注入与fixture自身必须在finally恢复/清理。

优先使用小型受控流/句柄，必要loopback仅本次owner；无正式网络或官方二进制。不会结束的受控IO应设计为最后能由fixture解锁并收尾，不把测试进程强退当清理证据；未确认资源关闭不能把临时根删了并称清理成功。

完成定向、语法、对应ESLint/build和一次完整npm run check（forks/threads max2/min1）。完整stdout/stderr及真实退出码落新I02-R1-check.txt，保留首败，不过滤/重跑抹掉/加skip/放宽语义。代码diff空白检查与旧原始日志尾空格分开报告，旧日志不改。交付记录订正原过宽保证，追加R1证据与未测边界。

完成按typed hint经约定仓库node dist/cli.js send、正文stdin、--delivery steer回报基线/RED/GREEN、保证→反例/结果、检查/首败、文件/未测/清理；不使用Claude ListAgents/SendMessage联系root，不轮询或盲重发，不自行关闭C04或领下一功能单。完成停写等双轴复审。
