# 核心改造续接记录

更新：2026-10-21。工作分支：`codex/core-refactor-pre-tui`。起点：`dfd2362`。

## 当前授权

- 用户要求按排期先完成核心改造：T01、T02、T05、T03、T04、T13。
- T06—T12、T14中的TUI实现/交互验收等待核心完成后用户另行确认。
- 既有功能变更先给具体方案，等待用户同意；D01/D02当前只准备提案，不实施。
- 验收通过后从活动队列删除任务及所有引用；保留验收事实。

## 读取顺序

1. 本记录：当前状态和下一步。
2. `docs/wayfinder/tui-implementation-tasks.md`：仅加载当前任务细节。
3. `docs/development/code-standards.md`：涉及代码时。
4. `docs/research/pre-tui-architecture-audit-20261021.md`：需要背景证据时。

## 契约与验证

- 保留旧CLI文本/JSON/退出码、默认扫描量、status补投、wire/ref、权限、册位及管理冷热和清理规则。
- npm + Vitest；`scripts/setup-package-manager.js`不存在，直接以package.json和package-lock识别。
- 上次基线：lint/build通过；778测试通过、11跳过。真实会话live测试未启用。
- 有意义的新接口/回归先RED再GREEN；root集中提交，子任务禁止提交，避免共享工作区交叉stage。
- 普通测试运行的子进程清除CROSSCHAT_LIVE；不调用真实发送/发现/管理或修改用户配置。

## 任务状态

- T02：core_config负责配置/选择器、迁移相关import、AST图工具和测试；root负责package门禁集成。
- T05：core_sessions负责application/sessions、Codex新分页API和相关测试；UI资源/快捷键仍在T06。
- T03/T04：core_diagnostics_cleanup负责doctor/clean及application/diagnostics、cleanup；root负责status helper、其余只读查询及管理/服务接口。
- T13：root待T02/T05接口就绪，负责typed发送结果和NodeClient成员能力委派。
- 子任务生产修改已过RED checkpoint：bb03ef6（T02/T05）；e5ecf5c（诊断/清理）。生产实现均未验收。

## 已验收事实

- T01已验收：architecture.md按源码更新本机/SSH/TCP/持久状态/权限，§10固定兼容契约；规范和渐进检查策略已记录。使用本轮未改源码前的lint/build及778通过/11跳过基线。本任务为文档，无新增产品行为。

## 下一步

- root先完成新只读查询RED及status-files helper，等待各agent GREEN后按明确文件提交并集成。
- 每次分派记录文件owner与接口，完成目标测试后再做集成check。
- 在上下文压缩前，将确切测试结果、未提交文件、待决点与下一命令更新到本记录。
