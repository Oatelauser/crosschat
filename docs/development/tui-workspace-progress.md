# TUI 工作区改造记录

2026-10-23。本轮已完成开发验收，活动任务及依赖引用已删除。分支 `codex/tui-workspaces`，独立工作树 `D:/workspace/CC/multichat-tui-workspaces`，基线 `4239960`。原工作区其他会话的未提交 README/research 修改保留；root 唯一 stage/commit。

批准范围见 [工作区规格](tui-workspace-spec.md)。用户已授权全部实施，正常开发、不赶时间；范围外功能变化先确认。不发布、不部署、不访问真实用户会话/秘密、不恢复远端验收。

后续授权：用户于 2026-10-23 明确要求发布新版本、只提交自身改动，并清理任务垃圾/临时文件。按此整理独立 1.12.0 发布分支，见[发布记录](release-1.12.0.md)；原开发阶段“不发布”的范围在此被用户更新，生产远端验收不恢复。

## 当前状态

已批准范围全部实施并通过验收，无待拍板事项。完整交付、独立复核、失效回归和证据边界见[本轮验收](tui-workspace-validation-20261023.md)。使用入口见[终端界面](../tui.md)，各资源操作见[完整按键表](tui-workspace-keys.md)。没有新活动任务，不恢复生产远端测试，不发布。

## 实施时的共享接缝

- root：`src/tui/model.ts`、`app/*`、`resources/registry.ts`、`ui/*`、`composition.ts`、`main.ts` 与统一集成。
- tui_broker_facts：TCP 协议/broker/node/事务与 TCP 管理应用；不改 TUI/配置 CRUD/命令入口。
- tui_layout_facts：`resources/tcp.ts`、`resources/connections.ts`、TCP configuration 与按星命令展示；不改共享模型/controller/UI。
- tui_ssh_implementation：SSH/contexts/discovery SSH/SSH 资源与认证合同；不改共享模型/controller/UI。
- 先报告已执行 RED，root 保存 RED 检查点后再改生产；互相提前发送接口合同。代理不能 stage/commit 或改原工作区。

## 最终验证

标准 `npm run check` 通过：2041 项通过、11 项原有跳过；lint/build 通过；184 模块/584 边无循环或边界违规。Windows ConPTY 六组16场通过，最终权限返回修正后受影响4场再次通过；最新构建的本机原生 SSH 8项通过。原工作区已提交的独立 DSH GREEN 通过合并纳入，未复制其他会话未提交文件；没有依赖版本或测试跳过变更。
