# TUI 续接记录

2026-10-22。分支`codex/core-refactor-pre-tui`。T06起点`f03a4ac`，核心基线1114通过/11跳过。

## 当前授权与下一步

- 用户已明确“开始实现T06”，并要求正常开发流程，不赶时间/进度。此前一小时估时不作为开发截止。
- 本轮只实施T06；真实资源/远端管理功能按活动队列的后续任务接入。
- 读取顺序：本记录 → [活动任务](../wayfinder/tui-implementation-tasks.md)的当前项 → [代码规范](code-standards.md) → [T06规格](tui-t06-spec.md)。
- 暂停时停止派单、收齐所有代理状态/文件/检查，保存检查点与待办；未验收任务继续保留。

## 分工与接缝

- root：唯一stage/commit；共享`src/tui/model.ts`、Ink/React展示、CLI动态入口、终端资源owner、依赖/构建、统一验证与文档。
- tui_controller：`src/tui/app/*`、`resources/*`及controller/registry测试。框架无关snapshot store，登记统一路由/帮助/动作/列。
- tui_text：`src/tui/ui/text.ts`及文本测试。Unicode显示格、字素编辑、控制序列清理、详情换行。
- tui_contexts：`src/application/contexts/*`及上下文测试。配置只读列表与独立UI选中偏好，不探测或认证远端。
- 共享模型在`src/tui/model.ts`；UI通过snapshot/handleKey订阅controller，业务通过注入的read/checkAction/mutate接缝。新Provider不进入通用页面分支。

## 当前状态

- 已读v6规格及按键表；源码位置/布局按该稿，旧稿中的底层能力缺口以已验收核心接口为准。
- 文本/上下文新测试已验证缺实现RED，等待集中检查点。controller合同已冻结，待首批RED。
- 尚无T06验收。完成顺序：登记/交互 → 展示/入口/资源释放 → 隔离集成 → 真实终端键盘/resize/恢复 → 全量check → 验收后删除活动项。

## 设计来源

仓库外原稿：`C:/Users/yangsheng/.codex/visualizations/2026/10/21/01a15d5d-6d04-7b11-9ccb-39611d84b68b/crosschat-tui-v6-requirements.txt`、`crosschat-tui-v6-keys.txt`和49屏评审册。本轮可执行范围已提炼到T06规格；无需每次重载历史稿。
