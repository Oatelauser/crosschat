# C14：自身工具类型识别与多轮核验调研结论

> 本文主体保留研究时点的事实。用户随后恢复C14，Provider观察、Harness桥贡献、共享确认和identity入口已实施；实际能力与未完成验证以[本轮实施记录](../development/c14-explicit-tool-validation-20261028.md)为准。下文“尚未接线／当前没有确认入口”不再描述当前源码；研究路线也不因此自动升级为原生验收通过。

2026-10-28，用户端UTC+8。本轮只读研究，未实施身份接线、修改产品代码/技能/模型配置、安装或启动测试软件、连接生产远端、执行crosschat发送。Q17已批准所有send明示收件 `--tool`；Q18用户要求先研究自动识别，不足时询问用户自身类型，再由程序持续核验。

## 结论

**有可实施的原生接缝，应按工具接线后让程序逐次核验，不能仅靠模型记忆、历史列表或裸会话ID永久保存类型。** Claude已有较直接的原生socket/会话上下文；Harness有公开的每次shell执行环境接口；Codex有原生逐调用ID、Hook及执行实例依据。OpenCode按已批准的共享服务域归为opencode，不按CLI/Desktop窗口强行拆类型。

这不是“全部工具已自动识别并验收通过”：Codex的本次调用到入口/owner关联、Harness的桥实例贡献、OpenCode多服务来源关联都仍需接线或受控验证。研究结果不能替代正式Desktop和Windows/Linux/macOS兼容CI。

## 逐工具统计

| 工具范围 | 程序识别路线 | 本轮证据 | 待完成 |
| --- | --- | --- | --- |
| Claude Code | 每次读取原生session、宿主PID、会话messaging socket，与原生登记精确核对；当前接入为CLI通道 | 官方环境变量/Hook文档；crosschat已有socket精确匹配实现 | 加强PID出生信息、会话/登记一致性和生命周期核验；按实际版本及shell验证 |
| Codex CLI | 原生thread/root-session/tool-call上下文，关联受控CLI连接/原生执行记录与当前runtime实例 | 官方0.163.0固定源码；已有真实窗口选择证据 | 验证Hook/执行事件与本次call的关联；普通CLI、受控wrapper及共享daemon分别处理 |
| Codex Desktop | 原生调用ID＋当前runtime实例/进程来源，必要时关联原生Hook及IPC owner | 当前Windows两次独立exec实际具备稳定会话指纹、变化call指纹；桌面进程链可读 | Hook不直接提供cli/desktop字段；尚未证明shell-call到IPC owner映射；多轮/重启/nested CLI需实测 |
| OpenCode CLI/Desktop | 原生每次覆盖session ID；按本批共享服务合同明确为opencode/shared | 官方CLI/Desktop固定提交；既有两入口原生shell证据 | 保留服务实例ID并核验登记/运行代次；多服务精确来源不能仅凭同ID推断。若需公开shell hook补强，其插件依赖须另行明确 |
| Harness npm/Web | 原生每次收集session/profile/home；既有桥可用公开shellEnv贡献把自己的实例标识传到本次shell | 官方固定提交证明 `ctx.shellEnv.register`、逐执行collect及实例关联方案；既有Web原生字段证据 | 扩展现有桥并实际验证原生bash/pwsh读取、精确实例核验与重启失效 |
| Harness正式Desktop | 官方以desktop profile启动，沿用相同每次shell环境机制 | 固定上游源码支持；现有类型/隔离接线 | 正式Desktop原生shell、桥贡献与实际UI须独立验收，不能用Web结果替代 |

固定版本、源码行链接及证据细节见[Codex/Claude研究](c14-codex-claude-caller-identity-20261028.md)和[OpenCode/Harness研究](c14-opencode-harness-caller-identity-20261028.md)。

## 当前Windows正向探针

在当前已运行的Codex Desktop上下文做只读采样，没有为研究启动软件：

- [进程链](evidence/c14-caller-identity-20261028/current-desktop-process-chain.json)：当前pwsh到Codex原生runtime再到桌面应用，记录PID、父PID、创建时间及脱敏路径。
- [调用一](evidence/c14-caller-identity-20261028/current-desktop-native-context-1.json)、[调用二](evidence/c14-caller-identity-20261028/current-desktop-native-context-2.json)：thread/session指纹稳定，`CODEX_TOOL_CALL_ID`指纹变化；`CODEX_TURN_ID`未提供。只保存键存在性与SHA-256前缀，不保存变量原值。

两次调用在同一个agent turn中，证明的是当前原生字段可用，**未证明多模型轮次、Hook精确匹配、CLI、重启或三平台通过**。本机桌面祖先也不能单独排除桌面中再启动的nested CLI。

## 用户确认如何跨多轮复用

以下按Q19条件批准及用户要求避免多会话重复询问更新；具体收敛稿见[统一设计](../development/c14-explicit-tool-design-20261028.md)，不是已实现功能：

1. 每次send先由当前Provider重新读取原生会话与本次调用上下文。能自动识别则不问用户；不能自动识别时返回明确原因和当前待确认上下文。
2. 用户确认补的是可核实工具来源的分类。程序保存机器/用户执行域、Provider和可重取的原生入口/Host域及分类依据；同来源多个会话共享。实例运行证据和各会话完整ID分别核验，不保存“某ID永久属于Desktop”这种全局推断。
3. 后续每次send重新获取当次原生字段并核对实际来源、实例与会话；有call-ID/执行回调时核对本次调用。调用ID每次更新，分类在来源范围共享，不依赖模型记忆，不因新建会话就再问一次。
4. 同域首次并发只创建一个待确认项、由一个会话展示询问；未回答不视为同意，首问会话退出时可由其他活会话接续。进程/owner、桥实例、版本或连接换代先使运行证据失效并自动重核，同一来源核验通过就沿用分类；暂不可达时已答选择保留待重核，恢复后自动核验。旧确认/迟到响应不能改绑新来源。
5. 原生证据与用户确认矛盾时报告冲突；短时不可读标暂不可核实，可有界只读恢复。不能静默把Desktop改成CLI，也不能自动重发结果不明的消息。
6. 用户确认与原生自动识别分开记录。只能核实实例时在该实例内共享；若连本次调用到实例的关联都取不到，一次回答也不能凭空带来跨会话核验能力。此时需补原生接线并如实说明入口缺口，不创建全局未知工具缓存，不用逐会话重复询问掩盖能力不足。

这套绑定不新增鉴权体系。工具类型用于路由分类，实例/执行信息用于核验对应关系。Q8继续保留：原生身份匹配且既有引用收件目标明确的回信，不额外引入发送方owner证明门槛。

确认如何进入程序已提出具体方案：程序生成待确认引用，agent得到用户回答后执行独立的identity确认操作，用户不手填引用；具体命令随统一设计做最后确认。单纯让模型口头记住选择不满足要求，不新增 `--from-tool` 或修改身份变量。当前仓库没有跨Provider的自身类型确认入口、共享分类及并发去重存储，不能宣称已交付。具体选项和必要回归见[持续核验研究](c14-caller-type-binding-options-20261028.md)。

## 跨平台可用依据

- Windows的 `Win32_Process` 提供父PID、路径和CreationDate；微软明确说明PID可重用，需结合创建时间核对，而非只查PID存活：[官方文档](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process)。
- Linux原生procfs提供ppid和start_time：[固定v6.12源码文档](https://github.com/torvalds/linux/blob/v6.12/Documentation/filesystems/proc.rst#L337)。
- macOS原生进程信息有父PID及启动时间，固定Apple源码与查询API见[Codex/Claude来源索引S9](c14-codex-claude-caller-identity-20261028.md)。

这些API证明能取得实例代次信息，不代表单一进程链足以对所有原生执行器分类。具体Provider应优先利用原生每次执行信息，OS进程关联只在其支持范围内补强；原生远端执行、namespace及进程信息不可读需如实记录。没有运行新的Linux/macOS验收。

## 后续实施和验收依赖

本研究把“自身类型识别/用户确认/每次调用重核”补入C14当前设计缺口，不增加一套独立成员制。Codex/Claude专属接线与共用接口继续遵循既定分工；本会话负责OpenCode/Harness。所有用户面命令、必要Hook/插件安装及配置写入范围，须先形成具体方案给用户拍板。

必要验收：真实原生shell＋本机脚本模型跨多轮；session切换、并发/同ID多入口、nested CLI、实例重启/resume、Hook/桥热重载、PID重用、旧探测迟到、能力失效恢复，以及Q8/Q17联合回归。不能用外部测试进程手填env代替原生注入。正式Desktop与各平台分别留证，身份增量进入既有C11/C12等CI任务，原全量CI待办保留。

目前只完成研究与当前Windows只读探针；没有开始产品修订、安装Hook/插件、运行真实模型或新增CI矩阵。

## 研究缓存归属与清理

Codex/Claude公开文本缓存位于 `D:\workspace\CC\multichat\node_modules\.cache\crosschat-c14-caller-research-20261028\codex-claude-b645a6`，ownership属于本研究代理。root核对44文件、10,717,263字节及无reparse/link后请求删除，但自动审批复核返回 `blocked by policy`，因此未删，不以其他机制重试。缓存暂留待用户统一清理；未安装测试软件，无需卸载。其余研究代理未创建缓存或系统Temp文件。
