# DSH原生改名：C20续接

2026-11-05已恢复并完成Windows rc.5本地开发验收。工作区D:/workspace/CC/cc-dsh-rename-20261105，分支codex/dsh-native-rename-20261105；当前审阅候选680e391221179b3dbcce8b7cb49840c1410f72c2。原仓库仅同步文档/证据；源代码位于独立分支。main与PR #4合入基线仍为d26aa2b。尚未推送、建PR或新增Actions。root独立，无worker。

## Windows rc.5本地切片验收

DSH正式npm 0.2.1-rc.5、锁定pnpm11.28.5、Node22.23.4、loopback模型及现有独立Playwright Chromium1243。已有普通交互会话经原生workspaceRegistry注册并由sessionController.create(workspaceId)关联，完成首条mock消息后，在真正Web界面选中完整原生ID；不以界面自动空白会话替换目标，不调用原生文件夹选择框。

通过生产Node/Broker及既有ConPTY原生改名动作，先取消零写，再输入并确认：同一Agent、Web当前标题与侧边栏、node声明及权威星册同步。改名只追加一条session/title事件，既有事件前缀相同、没有新增模型调用。随后按新名称经真实TCP CLI投递到同一Agent，loopback桩另响应一次。终端缩放/退出、raw状态和监听恢复通过；Host与浏览器正常退出、浏览器余留进程0、桥登记和run根回收。见[正式端到端报告](evidence/c20-dsh-rename-20261105/integrated-second/report.json)。

服务代理RED7903634复现同一已加载服务每次ctx.get生成新代理导致旧确认失效。80ed53f改为公共ctx.inject加载/卸载scope绑定代次，活Agent变化继续撤销确认，迟到旧scope清理不影响新scope，释放失败仍关闭HTTP/撤登记。既有shellEnv故障fixture只向其原依赖注入故障，原断言保持，另补title scope释放失败检查。所有RED和首次扩大失败raw保留。

默认Provider已接通rc.5 Web；rc.2、Desktop和其它版本为needs-verification，入星独立可用。名称校验、四态、applied/rejected/uncertain、最终上下文核验与零盲重试沿用共享机制。不新增用户命令/参数、必需步骤、crosschat持久数据文件或外部Hook。服务/目标变化需新确认；只读恢复不重放写入。

完整npm run check在7f4443f退出0：2871通过/11原有跳过，242文件通过/3跳过，206模块/699边无环/无越界，lint/build通过。其后680e391只订正原生验收工装的就绪等待，相关ESLint及正式端到端通过，产品src/integrations无变化。[完整raw](evidence/c20-dsh-rename-20261105/full-check-qualified.txt)。

## 当前剩余与继续顺序

C18/C24的Windows入星切片已验收，C20 Windows rc.5本地切片移出活动开发；父项保留rc.2、正式Desktop及其它入口/平台。C21/C22继续保留两个独立node、两个操作端刷新、永久/临时多窗保护、受控丢回执/版本组合与增强托管CI；现有基础四目标验收不重开。C23已同步当前指南和skill reference，剩余入口随后更新。全量仍为25父项/11CI索引，不换算总体百分比。

下一步先提交当前本地审阅候选给用户决定推送/草稿PR及普通CI；旧PR #4授权已履行，不复用到新外部执行。候选合入、发布、追加原生Actions另按实际方案决定。C00跨机组合、C04干净runner/官方卸载和公共通信故障归属保持。

## 现场与历史

所有本轮Host、浏览器、TUI、Node/Broker进程均已回收。保留开发worktree、归档证据及C22后续可复用的独占npm安装/工具缓存。D:/soft/DeepSeek Harness与用户未跟踪文档保持。前两处失败浏览器根经用户删除后已核实不存在，不再追删；CFT下载助手已停止且没有执行下载包，直接复用现有测试Chromium。

曾触发原生文件夹选择并出现测试profile/Desktop不存在的系统窗口，用户截图及处理记录保留。后续工装采用公开工作区API及明确禁止选择/添加工作区按钮的导航，不再触发该窗口。暂停前真实改名rejected、浏览器启动失败、界面导航/表单等待工装失败及其正常回收均留原始证据。[阶段历史快照](evidence/c20-dsh-rename-20261105/development-history-before-local-acceptance.txt)。
