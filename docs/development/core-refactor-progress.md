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

- T02：提取/纯parser/解环已GREEN，133目标回归通过。AST门禁与渐进typed lint已接npm check；等集成check后验收。
- T05：模型、Claude/Codex读取、分页/取消/部分结果已GREEN；core_sessions正修复新接口的目录变化游标和临时PID引用碰撞。UI登记仍在T06。
- T03：doctor/clean拆分已提交，诊断真实受控子进程取消与迟到丢弃64测试通过；root查询8测试及旧status回归通过。core_diagnostics_cleanup独占queries目录+core-queries测试，正补queryStars组合/未知state/空凭证。
- T04：core_config独占management/services和commands/serve.ts，typed local/remote+服务实现已落地，正在跑新旧管理回归；root不改这些文件。
- T13：typed发送+成员Provider委派已提交72f4519，发送167/成员会话82项通过；新增TCP typed queued证据修复37项通过，尚未提交。members段由core_sessions完成；root拥有send/federation/via-tcp。
- 所有生产实现均有RED/GREEN checkpoint，尚待最终整合验收，未删除未验收任务。

## 已验收事实

- T01已验收：architecture.md按源码更新本机/SSH/TCP/持久状态/权限，§10固定兼容契约；规范和渐进检查策略已记录。使用本轮未改源码前的lint/build及778通过/11跳过基线。本任务为文档，无新增产品行为。

## 下一步

- root补application依赖方向门禁，提交各补丁GREEN；等待T03/T04/T05最终GREEN，再跑npm run check并逐项删除已验收核心任务。
- 每次分派记录文件owner与接口，完成目标测试后再做集成check。
- 在上下文压缩前，将确切测试结果、未提交文件、待决点与下一命令更新到本记录。

## 测试隔离与限制

- 一次新增Codex分页测试最初只stub channel而漏stub spawn，曾启动真实proxy；RPC仅进入fake channel，测试session均已close。已补FakeProxyChild/spawnProxy并重跑相关40项全部通过；以后不得把此前情况描述为“从未启动真实工具”。
- 旧serve-sessions测试helper也已补临时codexHome。普通验收不启用CROSSCHAT_LIVE，不发送真实消息或修改用户配置。
- 新诊断进程取消及构建入口在Windows、临时HOME/空PATH受控子进程实测通过；POSIX组终止分支仅代码检查，未在本机实测。
