# TUI 工作区实施进度

2026-10-23。分支 `codex/tui-workspaces`，独立工作树 `D:/workspace/CC/multichat-tui-workspaces`，基线 `4239960`。原工作区有其他会话正在进行 DSH/README 修改，本轮不触碰。root 唯一 stage/commit。

批准范围见 [工作区规格](tui-workspace-spec.md)。用户已授权全部实施，正常开发、不赶时间；范围外功能变化先确认。不发布、不部署、不访问真实用户会话/秘密、不恢复远端验收。

## 活动任务

| 顺序 | 任务 | Owner | 验收与依赖 | 状态 |
|---|---|---|---|---|
| W01 | 当前星整机原子删除、在线远程按星节点改名 | tui_broker_facts | 协议合同、权限/并发/失联/落盘/断连隔离测试 | 进行中：合同/RED |
| W02 | ctx 看板与 local/ssh/tcp 独立工作区、资源补全/返回/定位 | root | 框架无关 controller 测试，身份不随工作区误变 | 进行中：RED |
| W03 | TCP 三视图、列表直接动作、连接配置 CRUD、按星名称展示 | tui_layout_facts | 依赖 W01 接口；目标固定、预览变化、配置与运行态分离 | 进行中：合同/RED |
| W04 | SSH 受管连接 CRUD、临时认证、主机指纹确认 | tui_ssh_implementation | 结构化 challenge 接缝、秘密清除、进程取消/主机变更拒绝 | 进行中：合同/RED |
| W05 | k9s 风格布局、CC、关键按键、资源标签与角色核验显示 | root | 依赖 W02/W03/W04；有界布局、完整帮助、各模式隔离 | 待 W02 合同 |
| W06 | 统一接线、独立审查、全量与终端验收、使用文档 | root + 独立复核 | W01–W05；保留证据并逐项删除已验收活动行 | 待前项 |

## 共享接缝

- root：`src/tui/model.ts`、`app/*`、`resources/registry.ts`、`ui/*`、`composition.ts`、`main.ts` 与统一集成。
- tui_broker_facts：TCP 协议/broker/node/事务与 TCP 管理应用；不改 TUI/配置 CRUD/命令入口。
- tui_layout_facts：`resources/tcp.ts`、`resources/connections.ts`、TCP configuration 与按星命令展示；不改共享模型/controller/UI。
- tui_ssh_implementation：SSH/contexts/discovery SSH/SSH 资源与认证合同；不改共享模型/controller/UI。
- 先报告已执行 RED，root 保存 RED 检查点后再改生产；互相提前发送接口合同。代理不能 stage/commit 或改原工作区。

## 验证与下一步

当前仅已保存规格/任务和建立独立工作树，生产变更尚未开始。依赖使用原工作树 node_modules 只读目录连接，版本锁不变。各 owner 开始保存 RED；root 补工作区导航测试。
