# TUI整体最终验收

2026-10-22（UTC+8）。用户授权T14，正常流程、不赶时间，现有功能变化先确认。分支`codex/core-refactor-pre-tui`，本轮基线`5184862`，TUI实现起点`f03a4ac`。**本轮整体开发验收通过，活动队列已清空并删除。** 最终产品及终端工装`862f9c1`；后续文档提交不改产品。使用及完整按键见[终端界面](../tui.md)，分批规格/批准与历史证据见[续接记录](tui-progress.md)。

## 范围与独立核对

以用户确认的v6交互和已批准的各批长期规格为准，核对入口、资源列表、只读详情、管理确认、权限、来源身份、失联、取消、部分结果、宽字符及resize。需求与代码规范由两个独立代理核对，root验证具体复现并集中提交；第三代理补跨资源终端主链。未发现未解决的可证P1/P2或新增待批准功能。

| 资源 | 验收内容 | 自动/终端证据入口 |
|---|---|---|
| ctx / connect | 默认入口零探测、配置刷新、指引/单目标检测、已有SSH选择、私密TCP导入及权威新行选择 | tui-contexts/context-source/context-actions/connections/composition；跨资源ConPTY |
| 本机sessions | 全部分页/匿名/第三Provider、原始状态、完整引用、精确收编/删册、只读原生指引 | tui-sessions/main-sessions；session-membership/exact/ipv6；会话ConPTY |
| SSH / 远端sessions | 已有Host、检测、完整发现/匿名、同用户指引、失联和配置变化拒绝续读，不回落本机 | tui-ssh/composition、ssh-application；操作/SSH及跨资源ConPTY |
| stars | 本机托管星/远端仅本星、进入机器列表、列表增删改/准确影响、精确审计 | tui-tcp/star-audit、tcp-management/exact；TCP ConPTY |
| machines | 完整机器身份、在线与册位分开、两秒快照保留选择、全星/机器会话跳转、接入/撤钥/本机显示名 | tcp-application/transport、tui-tcp；TCP及跨资源ConPTY |
| TCP sessions | 册内与完整发现范围分开，最大三并发/全分页、失败节点册位保留、工具/机器/进程身份不混同 | tcp-application、tui-tcp/composition；TCP ConPTY |
| members / keys | 成员分组/接任、凭证与机器分表、权限逐动作、册位精确操作、发钥秘密结果与撤权 | tcp-management/exact、tcp-exact-transport、tui-sensitive-result；TCP及跨资源ConPTY |
| status / doctor | 只读组合、按需诊断及原级别/下一步、SSH结构化doctor/取消，不自动修复 | tui-overview/main-observations、doctor-json-cli；观察/操作/SSH/跨资源ConPTY |
| deliveries / outbox | 通信对/暂存安全摘要、完整关联、复制与日志，不发送/补投 | tui-communications/observation-navigation；观察ConPTY |
| logs | 有界尾窗/轮转/重复行、来源及稳定starId筛选、跟随暂停/恢复、秘密脱敏 | tui-logs/star-audit、observation-logs；观察ConPTY |
| services | 实际进程与ready分列、完整目标起停、日志、预检变化拒绝、取消回收 | tui-services/composition、local-services/local-service-*；操作/SSH ConPTY |
| files / maintenance | 元数据只读、清理/技能/卸载预览、默认取消、指纹/链接边界、实际结果、退出不复活数据 | tui-maintenance、maintenance-*；操作/SSH及跨资源ConPTY |
| 共享交互 | 命令补全同时筛选、模式隔离、帮助同源、列表修改/详情只读、完整值、Unicode限宽、窄窗禁止隐藏提交、退出恢复 | tui-input/controller/form/filters/table/text/view/terminal/cli等；全部ConPTY |

表中测试名为`test/`下的对应测试文件或前缀；它是能力到证据的索引，不能解读为每个实际外部写动作都已在真实机器执行。Provider扩展继续通过应用Adapter与能力声明，TUI不接管原生聊天或会话生命周期。

## 本轮修复与RED/GREEN

| 问题 | 原行为与修复 | 证据 |
|---|---|---|
| 发现范围丢持久册位（P2） | 原聚合只保留成功原生发现。现追加未精确命中的持久册位，按完整机器限制范围；只由真实原生成员匹配去重，第三工具/临时进程不冒充册位；保留discovered=false、rawStatus=null及原错误/partial | tcp-application 11项；RED四处缺册位断言，`311d1d7`→`5cdd32c` |
| TCP失败空页读取信息不可达（P2） | 原默认sessions登记指向本机read-summary，错误页仅提供TCP info。现错误页声明所属TCP只读动作；零行/取消/partial仍可按i。补查带starId的失败路径：无star不冒称“其他星”，保留具体错误/下一步；实际其他星结果仍拒绝 | composition三种失败状态+已选星失联；tui-tcp两种其他星响应。`311d1d7`→`5cdd32c`，`9ba675f`→`862f9c1` |
| 精确成员管理IPv6地址无效（P2） | 原新应用入口直接拼host:port。现沿用TCP地址规则给未括号IPv6加[]，已有括号保留；不改旧CLI | session-membership-ipv6两项，RED一失败/一通过；`311d1d7`→`5cdd32c` |

三项均恢复已批准的TUI/当前格式能力，未新增协议、权限、旧CLI参数/默认范围或副作用。本轮没有新增待审批功能。各片ESLint/noEmit及限定回归先通过，再统一检查；未跳过新失败。

## 统一检查与包入口

环境：Windows，Node25.0.0、npm11.6.2、PowerShell7.6.5。清除`CROSSCHAT_LIVE`；普通测试使用临时HOME/配置、注入effects、受控本机broker/WS/adminPipe与辅助进程。真实用户会话、钥匙、剪贴板、SSH远端和用户服务未用于本次验收。

最终`npm run check`在`862f9c1`退出0，2026-10-22 **16:39:46**进入Vitest：

- ESLint、TypeScript构建通过；运行时图**164模块/520边**，无循环或跨层违规。
- **1657通过、11既有跳过**，150文件通过、3文件跳过（共153文件/1668用例）。
- 完整输出`%TEMP%/crosschat-t14-check-20261022-final2.txt`。此前首轮在`71e525f`为1654通过/11跳过；因新增已选星失联复现和两项作用域拒绝回归后再次检查，最终如上。
- `npm pack --dry-run --json`退出0，包清单344项；CLI、TUI动态入口/展示/组装、TCP管理及服务inspect/stop辅助进程均包含。仅预览清单，不安装、发布或部署。普通CLI不加载终端框架、非TTY先拒绝的既有测试随全量通过。

## Windows真实终端

以下均基于最终`862f9c1`构建，期间无并发build。五组旧链各三场，加新跨资源一场，**共16场通过**。正常/取消child退出0，五个受控异常child预期退出1，全部ConPTY host退出0。raw及自有监听返回Ink暖机基线，主屏、光标、括号粘贴恢复，未删除其他owner监听。

| 组别 | 最终原始证据目录 |
|---|---|
| 外壳：键盘/三档resize/正常、Ctrl+C、异常 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-validation-qjNa4S/` |
| 本机会话：身份/确认/窄窗/读取取消/异常 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-sessions-validation-WRXWq2/` |
| 观察：关联/日志/取消/异常 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-observations-validation-0wOKui/` |
| 操作/SSH：服务/维护/SSH体检/取消/异常 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-operations-ssh-validation-3p19MW/` |
| TCP：视图/精确目标/权限/秘密/三档resize/取消/异常 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-tcp-validation-xpTEk1/` |
| 单进程跨资源及私密导入 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-final-validation-RyU3Hn/` |

新链使用实际main/controller/资源factory/Ink，临时真实SSH清单、TCP导入文件、元数据文件及ctx读取；业务及传输effects注入。实际按键经过ctx→本机会话补全/筛选/帮助→status/doctor→服务/文件只读及维护默认取消→已有SSH选择/匿名会话/doctor→私密TCP输入/两阶段影响确认/真实保存→ctx重新读取并选中实际新行→TCP机器/全星/机器会话/成员/凭证→回本机恢复原筛选/选择→ctx退出。

断言导入前后不自动认证/启动TCP；输入、预览及普通页面均不回显导入秘密；只有一次实际临时配置保存；只读详情及默认取消没有服务/维护effect；本机/SSH/TCP来源context不串线；原元数据文件未变。root另核对最终exit的raw/监听相等、contextIds包含真实新连接、fileUnchanged=true。默认composition的真实分派由Vitest组合回归单独验证。

新工装首两次`...-7VQPsy/`、`...-pzjinU/`失败均因工装预期：需确认后才生成影响，再明确确认才保存；回本机应恢复先前筛选而非全部列表。只修工装预期，未因此改产品。`...-kyqnoB/`在较早构建已通过，但最终证据以RyU3Hn为准；最终五组旧链均重新运行。

## 边界与任务清理

本结论是获批范围在Windows隔离/受控环境下的整体开发验收，**不等于生产服务、真实SSH/TCP远端或macOS/Linux终端已live验收**。真实协议由受控本机socket覆盖；原生实际投递的先前独立记录不拿来冒充本轮TUI远端验证。未安装、升级、重启生产服务，也未接入真实第三工具。

秘密仅能清本次owner/当前终端画面，不能擦外部录像或已复制OS剪贴板；导入rename前复核不承诺与无锁旧writer实现跨进程绝对CAS。写后取消和丢回执仍待核实，不声称回滚或自动重试。

已删除最后的活动清单及AGENTS/map/当前续接入口引用；长期规格、批准及分批/最终验收事实保留。全部代理停写，root统一提交。README修改及四份其他会话研究草稿保持原状。后续真实远端联验、跨平台实测、部署或新增功能不在本次完成声明内，按用户下一步指令开展。
