# TUI本机操作与SSH验收

2026-10-22。用户授权T09/T10，要求正常开发、不赶时间、既有功能变化先确认。分支`codex/core-refactor-pre-tui`，基线`35f0ba2`（1447通过/11既有跳过），最终产品`21a1dae`、测试预算`84fb8da`、终端工装`6f597c0`。合同见[本机操作与SSH规格](tui-local-operations-ssh-spec.md)，使用见[终端界面](../tui.md)。

## 交付与批准

- 本机services列表提供启动、精确停止、日志与只读详情；进程状态和实际就绪分列，所有修改从列表确认。files仅元数据与路径，m进入维护任务。
- maintenance提供原规则清理、强制清理、技能安装/更新、本机数据卸载。Enter先预览完整目标，默认取消，提交重算指纹，结果显示实际成功/失败/跳过。npm卸载不运行；卸载发出或结果不明后退出不重新写偏好。
- SSH列已有明确Host别名，无批量连接或新增持久清单。支持所选目标检测、完整会话发现（含匿名/分页）、原生指引与远端逐项体检。原生聊天、消息正文和会话生命周期仍由原生工具负责。
- 用户明确批准新增`crosschat doctor --json`，复用当前诊断结果及运行时校验；无参doctor文本、检查、级别与退出码保持。退出1且有效结构表示检查完成但存在错误，接口/认证失败不冒充体检结果，不做旧文本降级或本机回落。
- composition按明确连接种类选择sessions/doctor Adapter；ctx选择、指引与单目标检测由资源声明。Provider与传输业务不进入通用controller/UI，后续TCP资源仍等待指令。

## 自动检查

Windows，Node25.0.0、npm11.6.2、PowerShell7.6.5。普通检查清除`CROSSCHAT_LIVE`，使用临时HOME、受控文件/子进程、注入业务effects/SSH进程，不访问真实原生会话、用户钥匙和剪贴板，不连接真实SSH对端，不起停用户服务、不安装用户skills、不运行npm卸载。

最终`npm run check`于2026-10-22 14:55:37（UTC+8）进入Vitest，完整命令退出0：

- ESLint与TypeScript构建通过。
- 实际运行时依赖图149模块、455边，无循环或跨层违规。
- Vitest **1546通过、11既有跳过**；131文件通过、3文件跳过。包含构建后doctor JSON CLI两个进程用例。
- 输出：`%TEMP%/crosschat-t09-t10-check-20261022-final2.txt`。

首轮检查仅`maintenance-boundaries`目录预算case在全仓并发下约7.34秒超过默认5秒；该fixture提供虚拟目录项，但仍反复核验真实临时文件元数据/句柄，不是创建一万个文件。仅为该项设置15秒预算，边界数量与关闭断言保持，随后完整检查通过。首轮输出保留在`...-final.txt`，没有跳过失败测试。

一次定向命令未指定`--dir test`，还匹配到`docs/embassy-main/test/tui-ssh.test.ts`，其Node测试不是本仓Vitest套件；本仓三文件16项已通过，仍按正确目录重跑确认16项通过，未修改外部副本。全仓npm命令原已限定test目录。

## 行为与失效边界

| 范围 | 证据 |
|---|---|
| 服务目标 | 配置和实际PID/revision变化拒绝原确认；停机同次扫描核对完整PID集合，禁止扩大到全部节点；回执核对对应kind/PID |
| 就绪与只读 | spawn不算ready；匹配实际活进程、PID、新快照/状态；broker进程与可用性分开，内挂节点不冒称独立就绪；读取不启动/修复 |
| 服务owner | 真实受控helper→同步扫描子进程，在取消与硬超时后均验证父子死亡；返回前完成清理；实际stop-process→原stop-worker IPC用临时stub业务验证，不扫描真OS或kill服务 |
| 有界读取 | inspector在独立进程内读常规broker文件，2MiB/fatal UTF8/结构限制，拒绝链接/特殊文件；坏registry不丢独立节点进程证据 |
| 维护安全 | 原清理保留规则和CLI计数保持；指纹变化、坏/不可读服务状态、父链/子树junction、目的硬链接和超限遍历阻止TUI执行，已确认后插入junction也拒绝 |
| 维护结果 | 技能安装前项失败停止后续，卸载逐项继续沿用原CLI；TUI显示实际结果，新的未知尝试不显示旧成功；卸载不执行npm、不重建偏好目录 |
| SSH身份 | 每次重新核对明确Host别名；移除/不安全目标不启动SSH；会话完整引用带连接上下文，本机专有写动作禁用 |
| SSH分页 | 游标绑定当前SSH配置内容hash，变化拒绝续页；手动刷新重读；不声称固定UID或追踪Include等间接配置 |
| SSH失败 | 固定argv/BatchMode、2MiB输出、fatal UTF8、超时/取消；认证/主机身份/PATH/接口提供安全下一步，不显示原始秘密错误、不回落本机 |
| doctor JSON | 默认报告与JSON结果渲染一致，退出严重度保持；坏node配置退出1有效JSON；多余参数拒绝；伪造级别/损坏/超限结果不采信 |
| 默认组装 | ctx启动零业务读写；按context分派、本机与SSH不串源；显式HOME绑定原生目录/子环境以及SSH绝对-F配置；默认SSH语义保持 |

独立审查发现并修复的关键问题包括：Worker不能终止同步OS扫描子树、停机目标确认后的PID变化、维护坏状态与skill复制子树，以及卸载后偏好复活。最后只读复核未发现新增可确认的P1/P2。RED/GREEN检查点见[续接记录](tui-progress.md)。旧CLI和原`stopServicesInBackground`不可取消合同保持；TUI owner取消不能撤销已向外部服务发出的信号，剩余步骤不承诺继续，结果需核实。

## Windows真实终端

最终产品构建后四组ConPTY共十二场通过。每组正常/取消退出0，受控异常退出1，ConPTY host退出0；验证raw、resize/信号监听回到Ink暖机基线，主屏、光标、括号粘贴恢复，不删除其他owner监听。

| 工装 | 最终证据目录 |
|---|---|
| 本机操作/SSH | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-operations-ssh-validation-I8G7uo/` |
| 外壳 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-validation-YkVcBj/` |
| 本机会话 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-sessions-validation-TOqqtv/` |
| 观察资源 | `C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-tui-observations-validation-T7Y0XC/` |

新增主链覆盖ctx指引/检测→SSH选择→含匿名会话/完整引用→doctor失败详情/取消/重跑→认证失败→本机服务只读/默认取消/极小窗禁止提交/固定目标起停/日志→文件路径→维护预览/取消/确认/实际结果→帮助/退出。记录100×28、24×12、48×16三档resize；effects严格只有确认的start、stop和单次cleanup，原临时文件字节仍在。

本机操作/SSH首轮`...-bAP0v1/`基于较早构建，仅预跑。最终构建首次`...-retILu/`在最后退出时卡住：工装等待公共“全部按键”页脚，误判帮助模式已打开，后续q被帮助吞掉。root核对脚本PID后回收该受控工装树；改为等待独有列表表头/帮助标题，并给退出12秒上限，最终`...-I8G7uo/`三场通过。产品未因此改动，最终九场旧链同样基于最终产品；工装运行期间无并发build改写dist。

ConPTY使用真实终端、构建产物资源/controller/Ink和临时真实文件，但应用数据、剪贴板与写动作是fixture，不能据此声称生产服务或真实SSH对端已经live验证。POSIX进程组回收仅代码核对，本轮没有macOS/Linux实际终端验收。

## 任务清理

T09/T10活动行、说明和已满足依赖已删除，临时任务规格转长期规格；AGENTS、map、API、使用与续接记录同步。代理全部停写，由root统一保存。仅T11/T12/T14等待用户指令。其他会话README修改和四份研究草稿保持原状。
