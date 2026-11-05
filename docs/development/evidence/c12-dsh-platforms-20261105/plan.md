# C12 DSH本机平台合同：实施与验证

用户2026-11-05明确选择C00策略A：全工具三平台、DSH优先、既有通信频率保持、新增完整首验后每周一次。跨机范围仍待回答；本单不依赖其答案，不改工作流或新增外部Actions，不接管公共通信/短柄故障。

基线main c1040a5，独立worktree codex/dsh-platforms-20261105。沿已约定的CI接口逐片RED→GREEN：官方npm元数据/摘要、带明确预期OS与架构的原生报告、串行执行/未知释放守卫及回归身份。允许的本机目标为win32/x64、linux/x64、darwin/x64与darwin/arm64；正式Desktop签名/安装/卸载仍保持原Windows合同，不能因npm目标扩展而放宽。

报告/fixture/原生运行分别验收。Windows ConPTY不会用于冒充POSIX真实终端；在POSIX终端接线与六阶段验证完成前，不开放POSIX onboarding入口。通信probe已按平台选择原生shell，先核对其Linux真实执行。所有默认Windows调用保持原语义、固定包/摘要、20分钟npm限、75分钟job限、原有清理/不明零重发不变；macOS无本机runner，纯合同通过不记为原生已验。

无新增用户命令或crosschat持久存储。测试仅使用隔离fixture；用户D:/soft/DeepSeek Harness与未跟踪文档保持。
