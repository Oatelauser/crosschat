# C04-I03 阶段B代码复审收口与验证保留项

2026-11-02（UTC+8）。阶段B只读准入代码的两轴发现已收口，当前不再派代码返修。完整开发验收仍未完成：最终整仓检查未绿，原生签名与Desktop执行层未验证；不关闭I03整体或C04。

最终产品/测试/worker证据提交 `6fb9ac1b1c347566506ea4276f0f1e5c4c9e18bb`。最后一次固定比较 `5a0c981f6d130e2aa5427ba652a6e210ffc7ac1b...6fb9ac1b1c347566506ea4276f0f1e5c4c9e18bb`，规格I03-B-R3-task.md末节；此前范围与发现保留在I03-B-task.md及各轮review/原始日志中，不再作为待修派单引用。

## Standards

独立审查0项未决发现，无另报smell。最终句柄/path核对已移至第二遍摘要之后，仍复用有界读取、既有错误和唯一close；真实rename替换反例的fixture在finally恢复read、await真实close后清理自有文件，未发现所有权或范围扩大问题。

## Spec

独立审查0项未决发现，前轮路径一致性P2闭合。最终核对覆盖二次读取阶段；读取期间替换路径时旧句柄与新path状态不同，stage=file拒绝。偏移0的二次流式摘要、大小与固定摘要校验、取消与唯一close保持，无新增范围。结论限本次只读核验，不延伸到原子锁、未来执行、真实签名或安装。

两轴分别计数：Standards 0，Spec 0，均无未决代码发现。此结论不将完整检查失败记为通过。

## 最终实现与验证

- `admitDshDesktopInstaller`要求独立publisher subject/thumbprint策略，无可信默认值；复用固定artifact边界，读取普通单链接文件，签名前后流式核验SHA-512、最终核对路径/句柄状态。默认Windows签名适配器使用常量PowerShell脚本和独立路径环境字段，只接受Valid且发布者匹配。
- 文件等待受同一截止约束，迟到open有owner，close唯一；child失败/超限/取消共用有限收尾，只有观察close才确认退出，未确认时报告并释放父侧引用；冻结主错及清理失败保真。成功只返回本次观测，不执行文件，也不修改/删除调用方输入。
- 最终worker原始[I03-B-R3-supplement-check.txt](I03-B-R3-supplement-check.txt)：业务RED 1失败/76通过、RED_EXIT=1；GREEN 77/77、GREEN_EXIT=0；syntax/ESLint/build/代码diff通过。
- root独立 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`：77/77、退出0，无GC错误；四个VITEST_MAX/MIN_FORKS/THREADS为2/1，测试环境未启用CROSSCHAT_LIVE。root另核syntax和固定代码diff通过。没有无理由重复全量。
- worker最后一次完整 `npm run check` 退出1：17失败/2590通过/11原有跳过，8文件失败/223文件通过/3跳过。首败c14-conversation-refinement的CONVERSATION_STATE_BUSY；其余失败文件为caller-source-service、conversation-handle-ring、conversation-state-concurrency、conversation-summary、conversations、send-command、send-handle。本轮这些文件零diff。原始首败及每轮完整失败均保留，不能把定向通过冒充整仓通过，也未逐条归责为同一原因。

## 未完成事项与停止范围

1. **整合验证保留项。** 会话锁/状态/通信链路的完整检查失败仍待其所属通信线诊断和处理。本会话不认领通信子单、不修改其产品/测试；用户亲自对接Bug修复2的既定归属不变。前轮独立锁探针证明当前环境存在EADDRINUSE/acquired=false，但不证明本次17条首败逐条同因。
2. **I03执行层前置。** 仍缺可信发布者实际值的独立依据、正式包静默/目录参数与自启动行为、官方卸载入口及系统注册实际证据。安装目的地约束、执行字节重核、卸载spawn前Host自然退出守卫、部分安装归属和独立干净runner执行均未完成。不从候选文件回抄期望身份，不猜参数；资料缺证据不自动变为要求用户手工编造证书值。
3. **C04原生验收。** 未运行真实PowerShell/用户证书/官方EXE，未下载/安装/卸载/启停正式Desktop或Host，未做桌面UI收发、注册清理或托管首轮。组件测试不能替代这些证据。新增非skill功能文件、必需用户操作变化和真实安装执行仍沿既定决定边界。

worker保持停写，不再派返修或后续任务，等待新的明确续接。历史任务/批准规格/各轮失败与raw保留为证据；活动队列改为验证保留项和执行层待证据，不再指向已闭合代码发现。

## 工作区与清理

branch保持codex/core-refactor-pre-tui，最终worker只有五个白名单文件，无push/amend/切分支。用户原未跟踪docs/代码消息投递.md未动未stage。本轮root没有新增手工临时根；测试fixture按自身finally释放gate/注入、真实close后清理独占根。没有进行宿主进程扫描或历史TEMP清理。

五个被拒上游URL、I02保留的45字节合成fixture根与W05 cache日志均未触碰，不声称全部历史垃圾已清完；具体路径与被拒记录继续沿I03-task.md/I02最终记录。未新增网络、用户状态、模型/试发/Actions或安装执行。
