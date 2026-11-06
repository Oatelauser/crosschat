# C21/C22 2026-11-06 增量验收

已完成 Windows rc.5 npm/Web 本地 broker 回执丢失与多操作端真实键盘组合，共11项通过。原九项为前置回归，不重复登记为新增完成。主会话负责集成，两名 subagent 分别开发故障代理、终端场景并提供只读审查。

- 独立 fault operator 的 loopback WS 代理精确核对完整星/node/Provider/原生ID/endpointType及 caller `id`，实际 rename 请求1、broker applied回执1、丢弃1。生产管理接口返回 uncertain；另两个操作端观察新名。恢复只读后请求及原生title事件不增加。
- 真实ConPTY A以完整原生ID筛选，打开表单；B改名，A无输入不自动提交原生改名。桥禁用时A确认被预览拒绝；恢复不自动提交，取消后显式恢复成员声明、重开表单成功改名。在native-ID筛选场景中，固定row与完整目标及复制命令保持；未独立观察筛选值或滚动位置；另一node/Agent不变，模型请求0。
- 恢复桥不等于重新声明成员。第五/六轮实际写后uncertain及原生事件保留；节点活性检查会释放声明，`renamed`要求当前成员。场景补显式adopt前置，不改生产行为或把uncertain当成功。
- 最终运行两个Host/node/ConPTY、代理及登记正常释放，unsafe=false、outerRemoved=true。第五轮表单内q导致exit125，dispose后Host0；该轮root仍保留，后续删除被自动审批blocked by policy拒绝，不换工具重试。路径见validation.json。

证据：[总索引](evidence/c22-dsh-enhancement-20261106/validation.json)、[最终正式报告](evidence/c22-dsh-enhancement-20261106/native-seventh/report.json)。七轮报告与终端raw均保留；前两轮静态编辑/lint问题也在本次会话记录，不冒充产品RED。

本次仅测试工装；没有src/integrations/workflow修改、用户命令变化、推送/PR/Actions。仍为同机两个独立逻辑node，不作物理跨机、Desktop或其它平台通过。后续准备可审阅的增强托管工装/平台候选，外部执行另按具体授权；其它工具与25父项/11CI索引归属保持。用户2026-11-06已解除暂停并允许按任务使用subagent。

最终固定Node22.23.4下npm run check退出0：2873通过/11原有跳过，242文件通过/3跳过；lint、imports和build通过。此前全量也通过，最终检查覆盖后续工装修正。

清理关闭补记：用户明确已删除第五轮目录，代理只读Test-Path核实D:/workspace/CC/cc-c22-LMNEd3不存在。删除由用户完成；原unsafe运行、exit125与自动审批拒绝证据保留，不再作为活动清理缺口。
