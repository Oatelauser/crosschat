# ZCode 接入决策检查点

2026-10-23，Asia/Shanghai。用户在完成 Harness npm/Web 开发后指示“开始下一个工作”，按原顺序开始智谱 / Z.ai ZCode。延续约束：单人维护、尽量少干预升级、真实工具配本机模型 mock、不使用真实 key、不改已有四工具行为。后续测试资料在用户指定 D盘总根下按工具隔离，正常测试软件卸载，总根最终由用户统一删除。

## 核查结论

当前正式产品为 3.16.2，官方源码 main 固定 `3c5b227649371507ddc4eb46ac5133afe6db1cab`。内部 Agent/运行描述版本另有分层，不能用单个数字代替发行物。以下是源码与官方文档核查，尚无 ZCode 实际运行验收。

| 原目标 | 当前已核实事实 | 决策影响 |
| --- | --- | --- |
| 接入用户已打开的 Desktop 会话 | 手机远控通过授权 relay 和 Main 内部 MessagePort 附着已有 Host；未确认公开本机 attach 或与 Harness 等价的 Node Host 插件入口 | 不能用新建 app-server 或 Web 服务冒充已连接桌面会话 |
| Agent 普通 shell 自动带身份回信 | Bash trace 有 session ID，但未自动注入子进程 env；自定义命令/技能的 shell 扩展有 ID，并附带 Claude 别名 | 尚不能承诺普通聊天工具调用直接识别当前 ZCode 会话，需另行设计和验证身份方式 |
| 连接已有 Web/server | 有认证 `/ws`，使用自有二进制 RPC + V4；未确认可直接依赖的正式稳定外部 client SDK | 可研究受限 Web 原型，但要承担私有传输、订阅/分片、认证及生命周期维护 |
| 严格 queue/steer | 单消息 queue/guide 存在；ACK 对 queued 的报告有歧义，Highspeed 有 guide→queue fallback | 需观测实际消费并按能力明确拒绝，不能凭 ACK 宣称成功 steer |
| 仅发现/投递现有 live 主会话 | sessions-index 混合持久事实，Host send 的 getClient 可能启动 owner | live/cold 边界和禁止隐式恢复尚待实证 |
| 真实模型端无 key 验证 | 官方支持自定义 provider 地址，且有上游本地 mock 记录 | 该项可行；不解决现有桌面 attach 与身份缺口 |
| 隔离正式发行物 | Desktop 正式下载/摘要已确认，但安装/启动会写全局协议与右键菜单；独立 CLI/Web 正式下载入口未确认 | 不为探索而安装 Desktop；不把源码构建称为正式发行包通过 |

依据：[原生合同核查](../research/zcode-native-contract-20261023.md)、[发行物与模型模拟核查](../research/zcode-runtime-probe-20261023.md)、[仓库接缝与 Web 传输成本](../research/zcode-repo-seams-20261023.md)。主要一手入口为[官方当前协议](https://github.com/zai-org/ZCode/blob/3c5b227649371507ddc4eb46ac5133afe6db1cab/docs/zcode-protocol.md)、[官方远控说明](https://zcode.z.ai/en/docs/remote-control)与研究报告内固定源码链接。

## 可选范围

| 选择 | 结果与代价 |
| --- | --- |
| 按低维护目标暂缓 ZCode（建议） | 保留上述核查和后续接缝，等待公开 attach/身份合同或上游明确支持；不增加第五个未能兑现完整能力的 Provider。下一项可推进既有工具兼容 CI。 |
| 继续限定 Web 原型 | 只连接显式运行的 Web/server，不含已有 Desktop；接受固定源码/构建验证和私有 RPC 的维护，先证明身份、live 边界和单消息投递，再决定是否进入产品。无法预先保证原型一定能满足所有门槛。 |

这是实际支持范围与维护成本的选择，不重复请求已有研究授权。原来的“开始接入”没有决定是否接受私有协议和较窄 Web 场景，因此先形成可审查结论，再请用户选择。

## 当前工作状态

- 三项研究已完成；未注册 zcode Provider，未更改产品代码、现有 wire/ref、身份识别或技能；未运行产品测试，也没有以旧四工具测试计作 ZCode 验收。
- 没有下载可执行发行物、安装/启动/登录 ZCode 或读取个人凭据。只读源码 clone、所有权和 baseline 留在 D盘 ZCode 独占目录；无需软件卸载。源 clone 的重复下载进程已停止，未通过清理研究目录绕过之前的自动审批拒绝。
- 安装前 baseline 已记录用户 `.zcode`、AppData 和 `zcode` protocol 均预先存在。只读安装元数据随后确认用户原有 ZCode 3.15.3（程序版本 3.15.3.8237）位于 `D:\soft\ZCode`；它不属于本轮测试安装，禁止将其原有配置、注册或程序纳入本批卸载清理。当前源码/官网 3.16.2 的研究不冒充对这个用户安装的实测。
- Postman API discovery 的 Orbit 查询未找到匹配的 ZCode endpoint，只返回无关服务，未采用；合同以官方文档与固定源码核查。没有发布共享 API 资料或创建外部 issue。
- 活动事项只有“确定支持范围”。用户选择后更新此检查点；未决定前不编写依赖假定原生身份或 Desktop attach 的生产适配。
