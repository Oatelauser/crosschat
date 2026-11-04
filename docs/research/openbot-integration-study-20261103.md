# OpenBot 接入方式与 crosschat 可借鉴点

用户备注（2026-11-03）：本研究与[CodexHost研究](codex-host-integration-study-20261103.md)一并保留，供未来crosschat Desktop开发参考；Desktop具体需求由用户后续单独沟通，本备注不启动开发或确定功能范围。

2026-11-03（UTC+8）。用户要求研究nightly-labs/openbot，借鉴类似功能的实现。本次由root本人只读研究，无worker/子代理；未安装、运行、clone该项目或执行其README命令。通过GitHub第一方源码固定到提交 [21369e1eec420772a7db9f6bbfeae2ef9b3ab83a](https://github.com/nightly-labs/openbot/commit/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a)，不是对未来main的兼容保证。未进行产品原生实测，源码/文档描述与本仓库实测分开。

## 1. 先区分产品边界

OpenBot是自己托管Agent的桌面工作台：创建工作目录和会话、维护消息与队列、启动所选Provider的CLI/SDK，再提供统一UI及agent-to-agent工具。crosschat的既有合同主要是发现并准确投递到用户已经打开的CLI/Desktop会话；Harness桥只借用已有live root Agent，目标缺失时报错，不创建或恢复替代会话。

依据：[OpenBot README的架构和本地状态说明](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/README.md)、[AgentClient生命周期/能力接口](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/agent-client.ts#L15-L85)；crosschat对照为本仓库docs/development/dsh-integration-contract.md。由此推断：它的“托管新session”成功不能替代我们“命中现有Desktop UI session”的验收；不能因同样有多Agent通信就直接替换接入路线。

## 2. 它怎样对接各工具

| 工具 | 已核实入口 | 对crosschat的含义 |
| --- | --- | --- |
| Codex | driver创建CodexAppServerClient，使用本地CLI的App Server | 有专用原生客户端，并非所有工具统一经ACP |
| Claude | driver创建ClaudeAgentClient，README标为Claude Agent SDK流式会话 | 仍保留Claude原生会话/权限/压缩语义 |
| OpenCode | AcpAgentClient，argv为acp，配OPENCODE_ACP_FLAVOR | 共用协议客户端，上游差异集中配置，不散布在调度/UI中 |
| Cursor、Cline、Kimi、Hermes等 | ACP客户端与各自命令、环境、flavor | 同协议也不意味着完全相同能力或错误语义 |
| 其DeepSeek条目 | 通过Pi CLI的DeepSeek API key Provider | 这是模型API接入，不能记作DeepSeek Harness CLI/Desktop或Host插件接入 |

来源：[driver中的Codex/Claude工厂](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/provider-drivers.ts#L739-L800)、[OpenCode工厂](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/provider-drivers.ts#L878-L916)、[ACP进程与ndJsonStream连接](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/acp-connection.ts#L73-L124)、[DeepSeek说明](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/docs/architecture/providers.md#L1051-L1064)。

ACP在这里是真协议连接：使用@agentclientprotocol/sdk、stdio NDJSON、session创建/加载、prompt、cancel；同时对外适配成AgentClient的统一请求接口。[acp-client中的newSession/prompt/cancel](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/acp-client.ts#L889-L910)。这与crosschat现有Bearer loopback HTTP的Harness Host桥是不同链路，本研究没有实现或宣布crosschat支持ACP。

## 3. 最值得借鉴的五点

### 工具差异集中，能力明确声明

AgentClient显式声明压缩完成方式及可选releaseThread/releaseIdleThreads等；provider-drivers集中工厂、登录和模型规则。AcpFlavor集中缺失session、恢复失败、内容事件及MCP行为差异。尤其ACP客户端明确：没有steer扩展就拒绝turn/steer，不能用第二次prompt代替，因为第二次prompt可能取消当前turn。

来源：[能力接口](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/agent-client.ts#L15-L49)、[flavor差异](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/acp-flavor.ts#L18-L128)、[steer约束](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/acp-client.ts#L1090-L1108)。

可借鉴：保持crosschat Provider/Context分层，为每入口记录实际发现、queue、steer、身份、恢复等能力；未知能力不推导为支持。当前CLI明示模式和端点类型已获批，不能静默把steer改queue。若将来增加ACP，应作为明确的新Provider/入口方案先评估，不改现有活会话语义。

### 投递开始与确认分开，写入不明先核实

DrainScheduler对turn/start超时记录“可能已运行”，等待生命周期事件而非立即重新提交；确认turn已接受但mailbox落盘失败时，保留其关联并定向修复记账，避免重复执行。不是把所有timeout都当失败重试。[源码](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/agent/drain-scheduler.ts#L950-L989)。

可借鉴：crosschat继续明确delivered/queued/parked与confirmed/unconfirmed不同，不在写入不明时重发；未来验收加入“已接受但确认迟到/记账失败”的受控故障。OpenBot的5分钟等待是其调度策略，不能直接当作我们的超时规格。

### 幂等与异步等待后的再校验各有owner

tool-call-idempotency用thread/turn/call标识构造去重键，超长时摘要部分字段；MailboxDeliveryGate在准备开始和完成后校验Agent删除标记/代数，防止await期间目标已失效仍插入投递。短名称/显示ID不承担全部身份或幂等职责。[去重键](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/agent/tool-call-idempotency.ts)、[投递守卫](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/mailbox-delivery-gate.ts)。

可借鉴：在真正执行动作前再次核对捕获的身份/当前能力；C04-I03-C2已独立采用执行前身份与取消/截止核对的原则。没有复制实现，也没有据此修改crosschat短信封、账本或状态锁；这些仍归既定通信线和已批准合同。

### Agent消息带可执行回信合同，避免确认循环

delivery-content将发送方、messageId/replyToMessageId、是否期望回复写入消息；给出done/partial/blocked及证据的回信格式，并将正文标为协作输入。未要求回复的消息不继续确认。[源码](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/agent/delivery-content.ts#L202-L230)。

可借鉴：保持crosschat机器生成的typed hint、独立任务包、实际结果/证据/未测/归属回传；不要仅凭短柄或口头完成认领结果。我们已有的纯确认不再回执规则与此方向一致，无需新增消息格式或状态文件。

### 释放、线程替换与上下文预算分别负责

AgentClient的releaseThread专门回收被替代session及其MCP进程；ACP连接在close时读取完整stderr再形成结束诊断。架构文档将native/request/events/handoff压缩模式分开，替换session用有界历史交接，不把缺失上下文报告当零占用。

来源：[releaseThread说明](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/agent-client.ts#L29-L49)、[close诊断](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/acp-connection.ts#L139-L149)、[有界交接](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/docs/architecture/providers.md#L54-L83)、[压缩能力](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/docs/architecture/providers.md#L139-L158)。

可借鉴：给worker小任务包和文件索引，原生clear与新建session分别说明。OpenBot能轮换自己托管的session，并不证明crosschat可向Claude交互提示层执行/clear；不自动结束、恢复或替换用户原生会话。C04已区分直接child close、Host自然退出、官方卸载、两类登记清理，保持这一边界。

## 4. 不直接搬用的部分与落地顺序

| 建议 | 本轮处置 |
| --- | --- |
| 执行前核对身份、状态和取消；失败保留归属 | C2小型守卫在既有模块独立实现，受控回调测试；不复制OpenBot代码 |
| Provider能力矩阵与上游差异集中 | 记录为后续C10/C11及接入方案的研究输入，不借研究扩大当前白名单 |
| 超时写入不明、迟到确认、幂等回执的故障注入 | 提供给既定通信负责人参考，本轮不认领其产品/测试 |
| 新建/恢复/自动轮换session、统一SQLite账本、CLI自动下载更新 | 改变crosschat现有功能/文件/安装维护边界，不能因研究发现便实施 |
| Desktop正式包安装/UI/退出/卸载 | OpenBot托管CLI的事实不能替代Harness正式Desktop证据，C04原生缺口仍保留 |

当前固定版本[LICENSE](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/LICENSE)为PolyForm Noncommercial 1.0.0，README另述旧版许可。本次仅研究设计及必要事实引用，没有复制实现或引入其依赖；如将来拟复用代码，应单独核对所选版本与许可条件。

研究限制：只读了README、上述架构说明和相关adapter/driver/queue/去重源码；没有证明所有Provider实机可用、三平台CI通过或具体产品版本兼容。没有完整安全审计，也未把未阅读模块断言为不存在。结论针对固定提交，源码更新需重新核实。
