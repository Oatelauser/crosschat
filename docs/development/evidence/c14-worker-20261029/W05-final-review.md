# C14-W05 研究与限定工装验收

2026-10-29（UTC+8）。branch `codex/core-refactor-pre-tui`。初始基线 `df76413568fe3a764b804533fcdf712abf638beb`；worker 首轮 `eec1209`、R1 `48d9752`、R2 `4c391e3`、最终 R3 `6a8c1a4123f4f42d3a0ab37c3c608a7bc2fa7617`。原任务及逐轮问题/修复要求保留在 [W05-task.md](W05-task.md) 与 [W05-review.md](W05-review.md)，实际研究结论见 [报告](../../../research/c14-codex-call-correlation-20261029.md)。

## Spec

R3 固定范围 `decf49b...6a8c1a4` 的独立 Spec 复审剩余确定问题 0。计划调用完整性、一一绑定、最近 Codex 执行实例与共同祖先区分、ID 类型与缺失优先、祖先链连接/代次/环及证据预检均按反例收口。原生正样本只证明本机已有 CLI 0.163.0 非交互 exec 下，两次 Hook tool_use_id 与普通 shell CODEX_TOOL_CALL_ID 的完整值对应；不因模型提供 call ID 就视为防伪证据。

W05 的研究边界已明确：本次调用与该受控 CLI 执行实例有局部原生证据，执行实例与任意 CLI/Desktop 入口的独立关联仍未完成；未接 identified/生产 Provider。Desktop、daemon、双开、IPC owner、write_stdin、子 agent 和三平台不属于此次通过范围。

## Standards

R3 独立规范复审阻断问题 0。P1 旧目录误删已修：只有本次成功 claim、目标根与完整 marker 字节相符才能获删除权。未知后代不靠启动器 close 推定退出，一律保留根并记录路径；请求有明确截止，服务关闭 timer 收束有受控回归。原始证据三份哈希与前轮保持一致，R2/R3 未新增原生运行、安装/升级或改用户配置。

该运行器**当前不能直接当作 CI 成功门禁**：没有后代全部退出的核实路径，所以默认正常运行也保留根、整体 incomplete/退出 3；逐调用观察仍写入证据。这是 root 在 R3 明确选定的保守研究范围，后续 CI 完整生命周期由原工具/平台任务验收，不允许硬填 descendantsVerified=true。

## root 独立检查与全量失败保留

- R3 定向 `npx vitest run test/codex-call-correlation-probe.test.ts` **56/56**；差异检查通过；原证据三份 SHA256 与首轮/R1记录一致。
- root 在最终 `6a8c1a4` 实际执行 `npm run check`：lint、202 模块/678 边依赖图、TypeScript build 通过；测试 **2502 通过/1 失败/11 跳过，229 文件通过/1 失败/3 跳过，退出 1**。完整输出保留于 [W05-root-check-20261029.log](W05-root-check-20261029.log)。没有声称全量通过。
- 唯一失败是既有 core-diagnostics 的 500ms 取消 race；TUI 的首次 render 1 秒等待本次通过（约 945ms），worker 此前有失败。两处测试及相关产品 blob 未被 W05 修改。独立诊断确认取消 API 在抛 AbortError 前等待 taskkill/进程退出；受控延迟回调重放表明 500ms race 可以先输，但 probe 已死亡、稍后仍正确得到 AbortError，不能据此判杀树失效。两处时序脆弱性由独立 W06 修复并重新完整检查，不修改产品取消合同。
- root 本轮未启动原生 Codex、未读用户配置/聊天/进程全表，普通验证使用受控 fixture。软件无新增安装或卸载。
- 本次 D 盘缓存日志 `node_modules/.cache/crosschat-w05-root-check-20261029-1793262269226.log` 的删除命令被自动审批复核以 `blocked by policy` 拒绝；原日志保留，另复制证据文件。按用户 D 盘统一清理约定，不换机制重试或要求立即手删。
- Git 全部仅本地，无 push；原未跟踪 `docs/代码消息投递.md` 保持原样。

结论：**W05 的研究结果与按 R3 限定的工装验收通过，从活动子单移除；仓库全量检查尚未通过，转 W06 独立收口。** C14 生产来源识别、短信封恢复、全量 25 项及 11 个 CI 索引继续保留，不把本单当成工具完整接入或 CI 已实现。
