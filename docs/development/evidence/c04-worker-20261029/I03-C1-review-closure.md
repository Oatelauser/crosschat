# C04-I03-C1 代码复审收口与整合验证保留项

最终worker产品/测试/证据提交 `e13e04f6f0206fb0c1c54a60e5c09716faf53669`。最后固定比较为 `git diff 097048029d09cf52ef2aa9ec17870705b0ff4af0...e13e04f6f0206fb0c1c54a60e5c09716faf53669`，规格为原I03-C1任务书及I03-C1-R1-review.md的R2范围。原首交、R1发现与各轮raw继续作为历史证据，不再作为待修派单引用。

**结论：C1的代码两轴复审已收口，无待修代码派单。完整开发验收仍未完成，不能据定向绿称整仓通过；I03整体与C04父项未关闭。** worker停写，未启动真实安装/卸载或下一单。

## Standards

独立复审 **0项未决发现，0项另报judgement-call smell**。真实child fixture保存等待timer，并在race所有结果的finally清除；独立内存重放对已关闭受控child的cleanup返回后为0个live timer。原S1的迟到pipe错误owner已修；S2的真实child独立归属、actual close等待与timer收尾已闭合。S3已如实说明首次RED原输出未保存，本轮未补造；R1/R2新raw与首次GREEN错误捕获的订正保留。

## Spec

独立复审 **0项未决发现**。独立自有内存probe确认：returned区分正在收尾/已经返回，destroy/unref期间同步pipe错误在最终快照前被记录，冻结首因保持；返回后的迟到错误安全收口且不改变已返回快照。此前F1截止覆盖spawn并在close裁决核对、F2独立有界字节副本、F3显式failed及假值首因、F4次级错误保真已闭合，无范围扩大。

两轴分别为Standards 0、Spec 0，不把全量检查失败掩盖到任一轴中。

## 本次实现与独立验证

- `runDshDesktopProcess(binary,args,{timeoutMs,cwd?,env?,signal?,spawnImpl?})`位于原CI模块，验证显式进程输入，固定shell:false/windowsHide，stdout/stderr共享128000字节预算；截止从spawn前起算且最终复核。
- 返回直接child的code/signal/pid/output及timedOut/cancelled/truncated/closed/failed/failure/releaseUnclear/secondaryProblems。首错含假值仍可判别；只有child close令closed为true，取消/超限/失败之后close0也不恢复正常。失败收尾固定1s，未确认时释放父侧引用并保留迟到错误owner，快照不追写。
- 该组件尚未接入installer/uninstaller/main，不构成实际执行字节或目的地的授权，不证明子孙退出、Host自然退出、安装成功、回滚或卸载完成。未改旧runDshProcess、Web默认入口、阶段B准入、I01/I02、workflow/reporter，没有新增功能文件/依赖/用户步骤。
- root独立 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`：**93/93、退出0**，四个VITEST_MAX/MIN_FORKS/THREADS为2/1，未启用CROSSCHAT_LIVE，无GC错误；node --check与固定比较代码diff检查退出0。root未无理由重跑全量。
- worker的[I03-C1-R2-check.txt](I03-C1-R2-check.txt)保留新反例业务RED **2失败/91过滤跳过、退出1**；这是-t筛选未运行的旧用例，不是新加skip。GREEN为完整目标文件93/93、退出0。R1及首交raw均未覆盖，首轮RED缺失的限制永久保留。

## 整合验证与后续前置

worker最终一次完整npm run check仍**退出1：14失败/2609通过/11原有跳过（总2634）；9失败文件/222通过/3跳过**。lint、203模块/682边导入图与build通过，dsh-compat目标文件在该次全量93通过。首败c14-explicit-send的TARGET_REQUIRED，另涉及caller-source-service、conversation-handle-ring、conversation-state-concurrency、conversation-summary、conversations、send-command、send-handle、via-send。上述文件对R2基线零diff；原始失败保留，不以零diff/若干busy症状推定逐条同因。

整仓会话状态/通信失败仍交既定通信线处理，用户亲自对接Bug修复2，本会话不认领、不改其白名单。C1首交11失败、R1的7失败、R2实际14失败均保留，不以其中较少的一轮代表最终全量结果。

I03安装/卸载接线仍缺可信实际publisher策略的独立来源、正式静默/目录参数和自启动行为、官方卸载入口及实际系统注册证据；需要目的地/已有安装约束、执行字节重核、卸载spawn前Host自然退出守卫、部分安装归属和独立干净Windows runner。资料缺失不转成要求用户编造证书值。真实安装执行、新增非skill功能文件或必需用户操作变化沿既定决定边界，未授权本机原生安装。

## 工作区与资源

最终分支codex/core-refactor-pre-tui，worker仅四个白名单文件；root仅复审/调度文档，无push/amend/切分支或共享回退。用户原未跟踪docs/代码消息投递.md未动未stage。fixture的真实child由本次记录及finally等待actual close，等待timer归零；独立审查仅用受控内存probe并已收尾。root没有新增手工临时根或历史垃圾清理。

未执行官方EXE下载/安装/卸载、Desktop/Host启停、真实签名/证书验证、UI收发、注册表/协议/用户状态写入、网络/模型/Actions。五个历史被拒上游资源与历史TEMP/cache未重试未代清理。worker保持停写，无新任务下发，不轮询，等待用户下一次明确指令。
