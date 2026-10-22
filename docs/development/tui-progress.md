# TUI 续接记录

2026-10-22。分支`codex/core-refactor-pre-tui`。T06起点`f03a4ac`，核心基线1114通过/11跳过。

## 当前授权与下一步

- 用户已明确“开始实现T06”，并要求正常开发流程，不赶时间/进度。此前一小时估时不作为开发截止。
- 本轮只实施T06；真实资源/远端管理功能按活动队列的后续任务接入。
- 读取顺序：本记录 → [活动任务](../wayfinder/tui-implementation-tasks.md)的当前项 → [代码规范](code-standards.md) → [T06规格](tui-t06-spec.md)。
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
- ConPTY工装自测已通过80×24→40×12、UTF8输入与自有进程回收。完整TUI首轮真实终端发现合并输入`:s`被吞，正在输入层补回归修复；帮助窄屏长说明同步改为共享换行坐标。
- 尚无T06验收。剩余：输入/帮助GREEN → 真实终端键盘/resize/正常/Ctrl+C/异常恢复 → 独立审查收口 → 全量check → 记录证据并删除活动项。

## 检查点

- `78bf202`授权/规格与首组RED；`2e62941`文本GREEN；`44c89f8`上下文/依赖GREEN。
- `f8d5d19`导航/自适应表格；`e681fd0`固定owner表单/完整详情；`4fbb58c`状态登记。
- `429c78b`ConPTY工装；`96e5b2c`展示/动态入口；`09c04cb`生命周期/偏好；`81049c7`中断/新行选择/窄表单；`bd068bd`Windows复制Unicode。
- 每组新失效路径先保存RED再实施GREEN；尚未跑本轮全量check，不将定向通过视为总验收。

## 设计来源

仓库外原稿：`C:/Users/yangsheng/.codex/visualizations/2026/10/21/01a15d5d-6d04-7b11-9ccb-39611d84b68b/crosschat-tui-v6-requirements.txt`、`crosschat-tui-v6-keys.txt`和49屏评审册。本轮可执行范围已提炼到T06规格；无需每次重载历史稿。
