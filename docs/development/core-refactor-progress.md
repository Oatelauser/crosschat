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
- 起点基线：lint/build通过；778测试通过、11跳过。真实会话live测试未启用。
- 有意义的新接口/回归先RED再GREEN；root集中提交，子任务禁止提交，避免共享工作区交叉stage。
- 普通测试运行的子进程清除CROSSCHAT_LIVE；不调用真实发送/发现/管理或修改用户配置。

## 当前状态

核心阶段完成；不再有进行中的核心代码owner或待提交实施补丁。剩余活动队列仅保留TUI和待决功能，TUI等待用户确认。应用接口总览见 `docs/development/core-api.md`。

## 已验收事实

- T01已验收：architecture.md按源码更新本机/SSH/TCP/持久状态/权限，§10固定兼容契约；规范和渐进检查策略已记录。使用本轮未改源码前的lint/build及778通过/11跳过基线。本任务为文档，无新增产品行为。
- T02已验收：配置/选择器独立、纯raw parser、旧导出兼容；实际两组SCC先检出再解除。AST门禁包括runtime re-export/字面dynamic、排除type-only，并自动保护所有application模块。
- T05已验收：Provider/Context模型与两家读取Adapter、第三测试Provider、匿名分页、原始状态、来源错误/采样/取消；临时process引用与native引用隔离，变化目录游标不冒充完整，originator保留。旧CLI默认20条及状态校验保持。
- T03已验收：只读脱敏台账/星/服务/文件/有界日志查询，无补投/.bak/修复；逐星权威能力注入、旧端partial、PID与服务kind就绪证据；doctor检查/判定/展示分离，独立进程取消回收子probe并丢弃迟到结果。
- T04已验收：本机/远程typed管理共享CLI，独立改名不启动服务；热失败/断开无回执不冷写，权限与错误教学保持；starting/ready/failed证据、后台stop隔离阻塞扫描并显式释放owner；清理plan/execute同规则，预览不删除。
- T13已验收：typed发送结果与formatter分离，TCP本机桥不反解析CLI；内部queued证据与旧wire/JSON区分，成员活性/工具/查名经Provider委派，保留旧策略、册位、生命周期与回执。

## 最终统一验证

- 提交 `32153be` 的产品代码上运行 `npm run check`，2026-10-21 22:01（Asia/Shanghai）退出0：lint、AST图、TypeScript build、全量Vitest均通过。
- 图为85个模块、238条运行时边，无环、无未解析本地依赖、无禁止的跨层依赖。
- 全量测试：64个文件通过/3跳过；**894通过、11跳过（总905）**。比起点增加116个通过用例。
- 最终检查覆盖上述五个代码任务；并行阶段另有定向回归、真实受控socket/Worker/probe取消及独立只读审查。真实用户会话live未启用。
- RED/GREEN保留在当前分支提交历史：初始RED `bb03ef6/e5ecf5c`，图/配置GREEN `98b326f/f45d11e`，会话及边界GREEN `32eb0e1`，发送/成员GREEN `72f4519/0e0023c`，诊断/查询GREEN `642764e/a7276ca/3757bf5/9f68a1e`，管理/服务GREEN `f2604e6/1c01fd2/7d1dc53/80f3c24/32153be`。后续文档验收提交不改产品代码。
- 已删除全部六项核心任务的活动行、说明和依赖引用；验收事实留在本记录，不在活动清单保留完成项。

## 下一步

- 等用户确认后再启动TUI；未批准的远端完整发现/节点立即断连继续留D01/D02，未扩协议、册位或真实第三工具接入。
- 无需重跑已通过检查，除非继续修改产品代码或出现新失败；续接先读本记录与剩余活动任务，避免重载历史设计讨论。

## 测试隔离与限制

- 一次新增Codex分页测试最初只stub channel而漏stub spawn，曾启动真实proxy；RPC仅进入fake channel，测试session均已close。已补FakeProxyChild/spawnProxy并重跑相关40项全部通过；以后不得把此前情况描述为“从未启动真实工具”。
- 旧serve-sessions测试helper也已补临时codexHome。普通验收不启用CROSSCHAT_LIVE，不发送真实消息或修改用户配置。
- 新诊断进程取消及构建入口在Windows、临时HOME/空PATH受控子进程实测通过；POSIX组终止分支仅代码检查，未在本机实测。
