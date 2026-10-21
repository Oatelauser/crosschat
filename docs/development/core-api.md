# 核心应用接口

2026-10-21。与旧 CLI 共用当前 npm 单包；没有引入 TUI 框架或 `tui` 命令。新增展示入口从应用接口取数据，不解析 CLI 输出。

## 模块入口

| 需求 | 入口 | 契约 |
|---|---|---|
| 连接配置与选择 | `src/serve/node-config.ts`、`connect-selector.ts` | 纯解析、旧新形状归一、选择器；读取不修复，写回仍用原子同步函数 |
| 会话列表和详情 | `src/application/sessions/index.ts` | `SessionCatalog` 聚合 Provider，提供匿名名、raw 状态、完整引用、分页、采样和来源错误 |
| 星、服务、文件和日志读取 | `src/application/queries/index.ts` | 脱敏台账、权威 roster 组合、快照加 PID 证据、文件元数据、有界日志；不补投、不备份或修复 |
| 诊断 | `src/application/diagnostics/index.ts` | 检查/判定/formatter 分离；异步查询在独立进程执行，取消回收整棵探测进程树 |
| 本机与远程管理 | `src/application/management/local.ts`、`remote.ts` | 稳定 starId；热/冷/拒绝/失败有结构结果，热失败不冷写；远程保留现有挑战应答与权限 |
| 服务起停 | `src/application/services/local.ts`、`background.ts` | spawn 仅代表 starting，需匹配进程与状态文件才 ready；后台停止隔离阻塞进程扫描，保留原身份与端口闸门 |
| 清理 | `src/application/cleanup/index.ts` | `planCleanup` 只读，`executeCleanup` 执行既定目标，保留原规则和 CLI 计数语义 |
| 发送 | `src/application/send/index.ts`、`types.ts` | `sendMessage` 返回 typed 结果；`format.ts` 负责旧文本/JSON，TCP 本机桥直接使用结果 |
| 成员对账 | `src/application/members/index.ts` | 有序 Provider 能力委派，保留现有活性/查名策略；unknown 不当成 absent |

## 读取与生命周期

`SessionRef` 包含 contextId、providerId、nativeId；旧登记没有原生会话 ID 时，referenceKind 为 process，其他默认 native。内部键包含引用种类，显示短值不参与寻址。详情传完整 ref，不能拿截断值或名字作唯一键。

分页结果的 complete 表示当前来源声明完整；partial/unavailable/cancelled 均不能显示成“没有会话”。Claude 目录清单变化会令游标失效并要求刷新；Codex 透传原生游标。新查询保持原始未知状态；旧 CLI 的20条默认和状态校验保持。当前发现范围仍是各原生来源可发现的非归档会话，未新增历史归档扫描。

取消读取后丢弃迟到结果，Adapter 负责释放自己的连接、监听器和子进程。诊断查询在 finally 回收 owner 后再次检查取消。服务启动、管理和清理是写操作；停止等待不能表示回滚，超时应核实结果后再重试。旧 CLI 继续使用原同步 doctor/stop 边界；展示入口应使用异步应用接缝。

`stopServicesInBackground` 在专属 Worker 中完成原有停机操作并回收 owner，不提供中断写操作的取消参数。调用方可丢弃迟到结果，停机仍会执行至完成。

`queryStars` 默认只读本机脱敏台账。Context 注入现有 roster 读取能力后才能判断在线数；未注入时明确 unknown/partial，不能据静态台账推断下线。旧端没有 sessions 字段时保留机器信息并标部分结果。详见 [查询模块说明](../../src/application/queries/README.md)。

日志每次重新打开文件，以文件标识及大小识别替换/截断；载荷窗口默认64KiB、最高2MiB，额外窥读一个边界字节避免误丢完整行。文件页仅列元数据，普通结果不含 key、adminKey 或管理插座地址。

## 扩展与兼容边界

第三工具的读取接入实现 SessionReader，注册进 SessionCatalog；ContextReader 提供连接描述。工具能力声明与实现分开，第三测试 Provider 已验证通用筛选/详情/成员委派无需添加工具分支。

真实 OpenCode/zcode 尚未接入。原有身份/ref/origin/wire/成员持久键仍保留两家兼容格式；新增真实投递或迁移这些格式须另给兼容方案并获批。完整 SSH/TCP 远端发现和删节点立即断连仍在活动清单等待决定，不能以本次接口提取声称已经实现。

`npm run check` 包含现有 lint、AST 导入图、构建与测试。应用模块禁止运行时依赖 commands/TUI，配置模块禁止依赖命令/NodeClient；新增应用模块自动继承门禁。迁移模块启用类型导入、未处理 Promise 和异步回调检查，合法与违规 fixture 均验证规则生效。实施与验收证据见 [核心改造记录](core-refactor-progress.md)。
