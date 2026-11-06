# DSH增强验收：C21/C22暂停断点

2026-11-06恢复：用户明确继续并允许按任务使用subagent。本地C21/C22新增broker最终回执丢失、真实多端表单与选择保持组合，正式11项通过；明确成员恢复须显式adopt，不改生产。见[增量验收](dsh-enhancement-validation-20261106.md)。第五轮临时目录删除被自动审批拒绝，缺口保留；最终第七轮资源正常回收。下一项准备增强托管工装/平台候选，尚无新推送/PR/Actions授权；其它平台/Desktop/跨机及原负责人保持。


2026-11-05。按用户“这个小任务完成就准备暂停任务”，已完成当前原生丢回执验证并暂停，不启动下一项。工作区D:/workspace/CC/cc-dsh-enhancement-20261105，分支codex/dsh-enhancement-validation-20261105；代码检查点439c54a0145ffa0134e1073fba6644704de1eabe，后续本地提交仅归档/文档，接续须重新核实实际HEAD与dirty，不回切旧代码。root独立，无worker。

## 已验收本地切片

正式npm Harness 0.2.1-rc.5、固定pnpm11.28.5、Node22.23.4及loopback模型，两个隔离Host、两个独立node进程各连接两星、两个独占home的真实ConPTY操作端。四条attach管道通过已有测试label接缝隔离同机命名空间；这是同机逻辑node，不是两个物理机器或跨机R1/R2/R3证据。没有打开浏览器、日用Desktop或原生文件夹选择器。

九项检查覆盖：完整远端目标与另一node隔离；两操作端成员页无键盘刷新；显式入星及另一星隔离；永久成员叠加两临时窗口后erase释放不降级/删册；另一星临时成员保留至最后声明释放；公开原生改名同步两操作端且不改另一Agent；原生写成功后丢回执返回uncertain、只读恢复零重放；断桥局部失效/恢复撤销旧确认；精确删册不改另一node或原生聊天。

丢回执工装只在自有profile临时重定向已有登记URL，转发并确认一次原生标题写后丢弃响应。实际title POST=1、accepted=1、dropped=1；两操作端恢复只读后仍为1，原生只追加对应一条title事件，另一个Agent事件不变，模型调用均为0。登记内容已恢复，代理关闭，两个Host/两个node/两个终端正常退出，桥登记和全部五轮运行根均已删除，无强停或遗留待清理。

已有相同完整ID的独立来源确认隔离及并发取消17项回归通过；本次最终单次完整npm run check退出0：2873通过/11原有跳过、242文件通过/3跳过，lint、206模块/699边导入图和build通过。[九项原生/完整检查及所有失败索引](evidence/c22-dsh-native-20261105/validation.json)保留。首次静态lint及工装失败均按可得原始记录归档；正式失败和八项先行GREEN不被最终GREEN覆盖。

## 仍待继续，当前不执行

本切片从活动实施移出，C21/C22父项仍开放。下一项为broker→操作端关联回执丢失、跨操作端确认/选择保持的更完整受控组合，再准备增强托管工装；其它版本/正式Desktop/其它平台与C00跨机决定保留。本轮没有新增工作流、推送、PR或原生Actions，不复用PR #5合入授权。产品src/integrations和工作流均未改，用户命令/必需步骤及crosschat持久数据文件未新增。

此前[PR #5](https://github.com/Oatelauser/crosschat/pull/5)已获批准合入main 7229efb17cb047205eb79b9df15f27edd71f4231，[main普通三平台42047933261](https://github.com/Oatelauser/crosschat/actions/runs/42047933261)逐job全绿；本地新增2873/11不是托管增强验收。25个父项/11个CI索引及原通信/工具负责人保持。

仅用户再次明确“继续”才恢复开发。开发worktree、证据及后续复用的官方npm工具依赖保留；D:/soft/DeepSeek Harness与用户未跟踪文档保持。下一轮先读本文件、总表及DSH优先计划，不重跑已验收基础/原生切片，不重问已经履行的PR #5决定。
