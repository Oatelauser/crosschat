# C12 DSH本机通信平台候选：root自审与外部决定

2026-11-05（UTC+8）。用户已选择C00频率A，跨机范围仍待回答。root独立开发，没有worker；本记录为自审，不称双人独立复审。候选位于D:/workspace/CC/cc-dsh-platform-20261105，branch codex/dsh-platforms-20261105，基线main c1040a5。

## 候选行为

npm/Web通信入口接入win32/x64、linux/x64、darwin/x64及darwin/arm64。fresh report、summary和错误绑定预期target；跨平台/架构报告拒绝采纳，未知释放保持停止/保留。Windows默认及旧回归marker保持，POSIX通知按OS/架构隔离。产品CLI/TUI、公共锁、持久存储和Desktop合同未改。POSIX六阶段onboarding在下载与创建临时根前停止，尚待真实PTY。

既有C05候选分支手动运行改为四目标矩阵，先核对实际OS/架构；每个原生job限75分钟，artifact分目标。原生job只有contents read；报告job仅默认分支运行，只有它具备Issues write，不checkout或执行artifact代码。有界普通JSON、预期平台/架构、固定版本/SRI、独立runId、同项复现及清理都通过后才发去重Issue。实际YAML脚本已有隔离SDK测试，没有制造外部失败Issue。

原Windows通信每周二/五11:47保持。另在本地准备POSIX通信每周五12:17、已通过首验的Windows从零每周五13:07（UTC+8）。这些只在未来明确批准合入main后启用；三项POSIX候选分支首验必须先通过。C11 POSIX、正式Desktop及其它工具平台仍未完成。

## 验证与限制

26项平台/报告用例，CI相关定向161项通过；与CI一致的Windows Node22.23.4完整check2803通过/11原有跳过、238文件通过/3跳过，lint/build/204模块689边通过。各批RED、CRLF工装首败和旧仅手动断言与周更政策的冲突均保留；原断言按A更新为“保留手动入口且每周一次”，未skip或放宽原生清理条件。

此前Node25完整2799/11通过；之后一轮2802通过/1失败/11跳过，未改的Desktop观察器子进程退出0xC0000005。Node25与便携Node22的该套独立复核均19项通过，根因未确认；Node22全绿不追认旧崩溃已修复。便携Node按官方SHA-256校验，没有全局安装或修改用户PATH。

Linux执行源为d8ae0e0；后续是回归身份、测试和工作流增量，不在本机compatible路径调用。首轮基线八项/原生清理通过后候选fetch失败，整轮infrastructure/retained保留；原底层原因未记录。相同URL的WSL只读下载/SRI成功后，仅一次同源独立复核：rc.2、rc.5各八项通过，运行时/登记/安装/缓存清理通过、forced=false、无retry，raw与不同UUID/lock相关核对通过。两处/tmp根后来已不存在，未由代理删除，不改写首轮retained记录。

Mac两架构与新托管矩阵仍未原生执行。WSL、合同测试、Windows全量、GitHub和Desktop分别留证。main的Ubuntu公共短柄并发首败仍归原负责人处理。

## 待决定的外部步骤

[验收及原始证据索引](validation.json)已可本地审阅。下一步申请正常推送本分支、建草稿PR（触发普通三平台CI），并在该候选分支手动运行既有C05四目标首验。四个原生job合计上限300 runner分钟，另有普通CI；只用标准runner与loopback模型，无个人key。

这一步不包含main合入、release、付费runner、自托管注册或跨机验证。A原问题明确只确定计划、未授权新增外部执行，因此须取得具体决定再推送或dispatch。main合入另在实际首验/普通CI与风险可审阅后决定；R1/R2/R3仍等原问题的回答。
