# TUI 续接记录

2026-10-22。分支`codex/core-refactor-pre-tui`。T06起点`f03a4ac`，核心基线1114通过/11跳过。

## 当前授权与下一步

- 用户已明确“开始实现T06”，并要求正常开发流程，不赶时间/进度。该项已于2026-10-22完成验收并删除。
- 当前没有实施中的任务。T07—T11依赖已满足，按排期优先本机资源；T12依赖T11，T14等待全部资源闭环。后续实施等待用户指令。
- 读取顺序：本记录 → [活动任务](../wayfinder/tui-implementation-tasks.md)的当前项 → [代码规范](code-standards.md) → [外壳规格](tui-shell-spec.md)及[验收证据](tui-shell-validation-20261022.md)。
- 暂停时停止派单、收齐所有代理状态/文件/检查，保存检查点与待办；未验收任务继续保留。

## 分工与接缝

- root：唯一stage/commit；共享模型、Ink/React展示、统一集成/终端验收与文档。
- tui_controller：`src/tui/app/*`、`resources/registry.ts`及对应测试。框架无关snapshot store、统一登记、固定owner弹层/确认、异步代际。
- tui_text：文本/输入、ConPTY工装、`main.ts`/CLI动态入口及对应测试。
- tui_contexts：只读上下文、偏好、状态登记；独立审查及终端/剪贴板生命周期修复。
- 共享模型在`src/tui/model.ts`；UI通过snapshot/handleKey订阅controller，业务通过注入的read/checkAction/mutate接缝。新Provider不进入通用页面分支。

## 当前状态

- 已读v6规格及按键表；源码位置/布局按该稿，旧稿中的底层能力缺口以已验收核心接口为准。
- 共享模型、文本、上下文/偏好、表格、controller、表单、中文状态、展示与lazy入口已落地。真实业务adapter尚未启用，属于后续任务。
- 已独立复核并修复：未决mount退出、复制子进程失败回收、Windows UTF8输入、偏好误写、未知/取消结果完整性、秘密回显、表单cursor与窄屏编辑。
- 合并快速输入与内嵌Enter已由真实Ink hook回归修复；完整帮助换行/滚动完成。完整ConPTY键盘/100×28↔48×16/正常/Ctrl+C/异常恢复首轮通过，增加24×12隐藏表单不得提交场景也通过。工装先建立Ink依赖的模块级restore-cursor退出guard基线，再验证每次TUI资源回归该基线，不删除其他owner监听。
- ctx配置可重新读取并保留partial来源/下一步到只读详情；独立审查修复动态选中偏好、失效context拒绝回落本机、新建结果被筛选隐藏，以及未知kind原型键。
- 完整表单影响/错误滚动、核验状态与错误后字段焦点均已收口。最终`npm run check`：1304通过/11跳过，97文件通过/3跳过；运行时图114模块/317边，无循环或越界。最终ConPTY三场全部通过。T06活动项、依赖与临时任务规格名已清理；无必需待验收项。
- 使用入口和当前可用范围见[终端界面](../tui.md)。真实会话/服务/SSH/TCP资源仍按后续任务启用；当前页面明确提示尚未启用。

## 检查点

- `78bf202`授权/规格与首组RED；`2e62941`文本GREEN；`44c89f8`上下文/依赖GREEN。
- `f8d5d19`导航/自适应表格；`e681fd0`固定owner表单/完整详情；`4fbb58c`状态登记。
- `429c78b`ConPTY工装；`96e5b2c`展示/动态入口；`09c04cb`生命周期/偏好；`81049c7`中断/新行选择/窄表单；`bd068bd`Windows复制Unicode。
- `3e86b72`输入/帮助；`89f7abb`合并控制键；`474e93d`动态配置；`00bbd13`renderer teardown/确认全文；`4f3d5c4`最后表单滚动/核验RED。
- `a1b8d19`完整表单；`ff2edde`错误后焦点RED；`266463e`最终产品GREEN及全量/ConPTY验收基点。
- 每组新失效路径先保存RED再实施GREEN；最终验证环境、隔离边界及证据路径保留在独立验收记录。

## 设计来源

仓库外原稿：`C:/Users/yangsheng/.codex/visualizations/2026/10/21/01a15d5d-6d04-7b11-9ccb-39611d84b68b/crosschat-tui-v6-requirements.txt`、`crosschat-tui-v6-keys.txt`和49屏评审册。本轮可执行范围已提炼到长期外壳规格；无需每次重载历史稿。
