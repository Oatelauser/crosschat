# DeepSeek Harness 接入计划

2026-10-23。用户在 OpenCode 开发验证后指示“那你接着往下做，我自己会验证”，按原顺序开始 Harness。用户自行进行真实模型/从零安装使用验证；代理继续正常开发、脚本模型验收与本次测试软件清理。此前 OpenCode 剩余 CI 实跑和被自动审批拒绝的清理记录保持独立，不把用户继续开发视为接受残留。

## 实施范围

- Provider ID 固定 `dsh`，展示 DeepSeek Harness。使用官方同进程 Host 插件桥，crosschat 只依赖自有 protocol=1；上游依赖集中在插件入口。
- 插件只登记并操作已有 live root Agent，支持精确 ID、queue/steer 与原生 `DSH_SESSION_ID` 回信。子 Agent、冷历史会话不对外路由；没有目标就报错，不创建或恢复替代会话。
- 薄插件在 `integrations/dsh`，由官方 Plugins 页面或 `dsh plugin ... add <绝对目录>` 安装到指定 profile。新增只读 `crosschat dsh-bridge-path` 输出随包目录；不扩大现有 install-skills 的自动写入范围，不自动改用户 Harness 配置。
- 使用 mc2 现有 extended-provider 编码槽登记 dsh，原有字节、wire 布局、册位持久键与三工具行为保持。追加身份、解析、发送、status/discovery/TUI、精确收编与验活；涉及 dsh 的跨工具 ID 冲突拒绝误路由，不顺带迁移全仓存储。
- 默认正文预算仍为 16KiB，dsh Adapter 自有策略上限 1MiB，不称其为官方硬限制。不明写入不重发，不使用 Codex outbox。

## 官方合同与验证窗口

研究固定 `dsh-v0.2.1-rc.2` / `687f282e8625c6b8d11ff58211a90524be2e4317`，见[原生合同](../research/deepseek-harness-native-contract-20261023.md)、[运行验证入口](../research/deepseek-harness-runtime-probe-20261023.md)和[仓库接缝](../research/deepseek-harness-repo-seams-20261023.md)。本批使用官方 npm 正式发行物，模型通过本机 Messages HTTP/SSE 脚本，不需要真实 key。

插件实验宿主窗口为 `>=0.2.1-rc.2 <0.3.0-0`，client 核对实际 runtime 与自有桥协议；只将实际验证的构建记为通过。新 0.2 构建由行为 CI 检查，不需要只为 patch 数字逐次改精确 engine；0.3 及以上不在窗口内。上游仍处预发布，窗口不是对其中所有构建的兼容保证。

当前机器已实际发生同类协议/目录删除被自动审批拒绝，且正式 Desktop 无条件注册全局 `dsh` 协议。本批先验证 npm/Web composition 与桥；Desktop 正式发布包的安装、UI 和退出生命周期保留独立 runner 验证，不在本机继续增加不可收口的系统注册。公开 Agent loop、Web runtime、Web UI、Desktop UI 的结果分别记录，不相互冒充。

## 桥与所有权

loopback 随机端口、32-byte 随机 Bearer token；登记于 `~/.crosschat/dsh/instances/<uuid>.json`，schema/protocol=1，绑定 PID/instance/runtimeVersion，info 响应核对同一 owner。Unix 私有目录/文件权限；Windows不声称chmod等价于完整ACL隔离。拒绝 Origin、外部URL、重定向、不受控输入和超限，不输出token。

`GET /v1/info`、`GET /v1/sessions`、`GET /v1/sessions/{id}` 只读；`POST /v1/sessions/{id}/messages` 携带 text/mode，回执确认 sessionId/messageId/mode。`followup/steer` 接收消息不代表模型已经理解或回答。桥卸载仅回收自身HTTP/登记，不销毁借用的Agent；dead PID记录只读忽略、不在发现时删除，活owner失联/损坏保持来源错误。

## 活动任务

| 任务 | 内容与出口 | Owner |
| --- | --- | --- |
| H06 交付与清理 | 文档、包检查、1941项回归和正常测试安装卸载已完成；两个精确测试目录删除被自动审批复核拒绝，待用户按清理记录手动删除后只读核对。 | root/用户 |

H01–H05 的桥、公共链路、发现/TUI、真实 npm/Web runtime 与本地完整兼容编排已通过开发验收并从活动列表移除，证据见[验收记录](dsh-validation-20261023.md)。GitHub 托管 runner 首轮/定时和实际 issue 权限转入后续 C05，Desktop 转入 C04；没有以本地结果冒充这些验收。root唯一stage/commit。旧README、2026-10-22未跟踪研究与其他会话草稿不纳入本批提交；真实远端验证不恢复，不在远端Linux安装Codex。已接受任务从活动列表移除，合同、授权、RED/GREEN与验收事实另档保留。
