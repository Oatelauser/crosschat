# C14 显式工具类型整改与续接记录

2026-10-28，Windows、Node v25.0.0。用户在全量任务重排后要求“开始下一个任务”，本轮恢复首项C14。实施合同见[收敛稿](c14-explicit-tool-design-20261028.md)，用户决定见[批准记录](c14-user-command-review.md)。本页记录新合同的实现和证据；此前[类型技术验证](tool-type-validation-20261028.md)作为历史保留。

## 实施范围

| 部分 | 本轮实现及验证对象 |
| --- | --- |
| 参数与选择 | 本机、SSH、TCP及conversation回信均必填收件tool；旧工具前缀不再选型，斜杠按原值；完整原生ID不被其他会话的同名值遮蔽 |
| 精确路由 | 指定端点不跨CLI/Desktop回落；TCP检查broker/node类型能力；SSH透传tool；固定ref与tool冲突拒绝；同原生ID且同CLI类型跨机器时，主发送、自动选路与机器盖章共用方向判定 |
| 引用与轮次 | 同原生ID的不同端点独立；未知类型补齐保留cN、nonce、连续轮次和机器信息；历史nonce的柄同样可迁移；迁移失败在投递前拒绝、兼容副本仍可读、显式重试收口，保持8柄LRU；Q8允许原生ID匹配但来源类型未知的正常回信 |
| 信封与TUI | 来源from-tool与回信收件tool分别生成；来源未知如实pending；TUI y复制完整命令和原生完整ID，Y保留结构化引用；PowerShell特殊参数实测保真 |
| 来源探测 | 独立Provider观察结果；Claude和OpenCode已知类型不虚构稳定来源域；Harness通过逐次shell贡献核对精确桥实例、profile、原生ID和认证info；Codex未核实的CLI/Desktop调用关联保持待验证 |
| 共享确认机制 | 已核实来源可跨会话复用分类；同源并发一问；原生owner明确退出后按claim接续同一context；暂离线的原询问会话可保存待核验答案；恢复自动重核；冲突及旧context拒绝 |
| 崩溃及迟到处理 | 短生命周期本机OS互斥由进程死亡自动释放，不遗留永久锁文件；原生owner探测有界，迟到探测/释放不能抢占新owner；待确认状态不能覆盖已确认结果 |
| 已有兼容探针 | OpenCode CLI/Desktop、Harness及Claude的既有probe迁移到显式tool；从实际信封解析完整回信提示；Harness原生bootstrap增加只读identity观察，不手填身份变量 |

文件与控制帧保持各自协议，不把send的tool约束扩成改写文件通道。未新增全局工具分类缓存、from-tool命令参数、后台身份服务或自动升级安装规则。常驻软件、用户配置、已安装skill及生产远端没有部署更新。

## 来源能力与剩余事项

| 入口 | 已实现的程序结论 | 仍须完成的原生证据或决策 |
| --- | --- | --- |
| Claude CLI | 原生messaging socket匹配当前登记，来源类型claude；不需要询问 | 本轮没有重跑正式Claude来源多轮/重启；专属CI及平台增量仍由相应任务负责 |
| Codex CLI/Desktop | 读取真实原生会话ID；当前Provider对实际执行入口返回unresolved，不按活owner、祖先或历史标签猜类型；Q8仍可向固定收件目标回信 | 精确call与实际入口关联仍待接线/原生验证。Hook/受控连接有研究路线，未验证不记为不支持；若最终需要额外配置或受限人工绑定，列具体证据交用户拍板 |
| OpenCode CLI/Desktop | 共用opencode/shared类型；保留服务登记id作metadata，明确它并非当前shell来源证明 | 多服务精确执行来源仍待核实；必要插件/Hook必须明确安装生命周期，不能暗中新增依赖 |
| Harness npm/Web | 既有bridge通过公开shellEnv贡献，核对精确实例/profile/live root；晚注册/卸载/替换跟随原生子生命周期；正式npm/Web＋本机mock两轮来源、收发和回信通过 | 已补实际启动晚注册故障；Host重启、多个独立Host及正式平台增量继续纳入C13/C11，不用本次同PID插件重启代替 |
| Harness正式Desktop | 沿用独立profile/端点及来源接口，隔离fixture通过 | 正式Desktop原生shell及UI、安装卸载仍归C04，不能用npm/Web成绩替代 |

`crosschat identity` 与独立确认命令已经接入CLI。真实未知入口的人工fallback目前全部关闭：需要已核实的复用来源域、原生询问owner生命周期探测，以及该入口策略获批，三者缺一不可。隔离状态机通过不代表用户现在可以在任意Codex会话确认一次并永久复用。来源能力缺口没有被悄悄改成逐会话询问或禁止全部通信。

本轮在当前真实Codex Desktop普通shell执行`node dist/cli.js identity`，实际返回`unresolved / CODEX_SOURCE_ASSOCIATION_UNVERIFIED / shouldAsk:false`，没有输出原生ID或写入人工分类。这证明当前Adapter尚未交付该入口的自动类型关联，不是证明上游必然无法识别；也不能用“未提问”冒称已满足全部来源识别标准。

上述事项继续保留在C14，不用“通用层已完成”把全任务标成完成；插件及正式Desktop专属补验可随C13/C04/C11/C12留证，公共类型合同可供下游使用。完整[任务总表](tool-compatibility-ci-tasks.md)仍有25个活动索引、11个CI相关索引，未删除或跳过原CI开发任务，C15增强没有提前启动。

## 检查与终端证据

本轮有意义的行为回归覆盖send缺tool前置拒绝、斜杠原值、Q8、同ID双端点、来源/目标类型精化、并发确认、首问退出、离线旧context拒绝、人工分类冲突、迟到探测和真实持锁子进程被终止后的恢复。发送、模板及后续审查发现的问题均有实际行为RED→GREEN；最初root确认模块的RED仅为目标模块尚不存在导致import失败，不能将其描述为行为测试已经失败过。

收尾另复现同原生ID、同CLI类型在两台机器之间回信时方向颠倒和本机误投。修复使用权威来源mid/hostname仅在原生ID双匹配时消歧，精确mid优先；接收origin缺mid不能借用接收机mid。主发送、SSH自动选路和信封机器盖章复用结果；没有机器证据且固定收件端明确时仍保留Q8。11条新增用例覆盖双向、同hostname不同mid、仅hostname及无origin mid；相关7文件166项通过，行为RED证据与最终统一检查分开记录。

最后统一检查曾有两项失败：SSH大小教学快照未跟随已批准的必填tool合同；确认测试首次读取触发`SOURCE_STATE_BUSY`。前者仅迁移快照，保留原大小/传输语义断言。后者原临时目录已随测试清理，无法追溯当时占用者，不将外部端口冲突说成已确认的该次根因；受控真实listener精确重现同一错误，补齐fixture端口预检，并验证1秒有界报忙、状态零写入、他方listener不被关闭、释放后恢复，相关23项通过。预检仅选择新独占测试目录，不重试产品写操作，产品互斥语义未改。

公共确认机制的明确限制：本机锁按真实状态目录及来源key映射到20000—39999的loopback端口；相应端口被其他程序占用或系统拒绝时，有界返回`SOURCE_STATE_BUSY`，不会绕锁或占用对方监听。占用消失后可恢复；不能承诺任意端口冲突下仍即时可用，也不能将此公共机制的隔离通过冒充所有原生入口的确认复用已完成。

最终统一检查：`npm run check`退出0，ESLint、运行时依赖图202模块/677边、TypeScript构建通过；Vitest2416通过/11原有跳过，227文件通过/3文件跳过。此前阶段检查为2379通过；收尾修复与测试隔离补齐后已重新完整运行，没有跳过新增失败。当前本轮公共整改检查收口，C14整体仍因上表原生来源缺口保留。

Windows ConPTY运行`node test/helpers/c14-tui-pty-validation.mjs`，[摘要](evidence/c14-tui-20261028/run-KdJs9t/summary.json)及同目录JSONL保留。三场均恢复终端：本机/TCP完整命令复制与工具筛选、反序刷新选择保留、48×16及140×32 resize、正常退出；Ctrl+C；注入异常退出。使用最终构建TUI及合成应用输入，无真实原生会话或远端访问。最终完整构建后，摘要内TUI main、sessions、tcp及tool-types四个SHA256再次核对一致，无产品变化而不重复启动终端工装。工装临时根`C:\Users\YANGSH~1\AppData\Local\Temp\crosschat-c14-tui-33DkGy`由finally清理，最终只读复核仍不存在。

真实PowerShell参数往返另由`tui-send-command.test.ts`验证；特别补了以`@`开头的原生ID，防止被解释为splat。终端成绩仅证明Windows当前环境，不把Linux/macOS或正式工具GUI标为通过。

## 正式Harness来源验证与清理

首次运行既有`scripts/dsh-compat-ci.mjs`，正式npm产物`@deepseek-ai/dsh@0.2.1-rc.2`（baseline和当时候选相同）、pnpm11.28.5、隔离profile、真实普通shell、脚本模型仅监听runner本机，不使用用户模型key。两次均在`native-shell-caller-source`失败；原生shell的session/profile/home检查已通过，新来源关联未通过。首次report未保存足够细的来源结果，当前不能把失败归因于上游缺能力或用户环境；先补脱敏诊断再修接线。

[首次summary](evidence/c14-harness-source-20261028/summary.json)分类`baseline-failed`、`notify:false`，没有为自身适配失败创建外部Issue。两次runtime均正常停止、插件登记删除、测试profile删除；总安装根及内部npm缓存已清理，summary为`installationCleanup:removed`。测试仅使用`D:\workspace\CC\multichat\node_modules\.cache\crosschat-c14-native-dsh-20261028`下的独占子目录，没有全局安装。

[第二轮summary](evidence/c14-harness-source-20261028/attempt-2/summary.json)补齐白名单诊断，基线/候选均显示：原生身份匹配、shell标志/profile目录正常；实例标记和状态home未贡献，bridge未广告callerIdentity。根因是bridge启动时shellEnv尚未注册，一次`ctx.get()`不会跟随其后出现的服务。按固定官方Cordis契约新增两条实际行为RED：晚注册未贡献、卸载后旧贡献未撤。改为公开`ctx.inject(['shellEnv'])`子scope后两条GREEN；scope卸载和替换撤旧resolver，close防止迟到重绑，既有接收server/instance保持。

修复后的[第三轮summary](evidence/c14-harness-source-20261028/attempt-3/summary.json)为`compatible / notify:false`。baseline及candidate仍为同一正式`0.2.1-rc.2`，两轮各8项通过：正式插件安装及Web Host、4个普通会话创建、实际shell身份和来源识别、认证发现和分页、空闲唤醒、忙时queue/steer边界、原生shell发信及完整ID回信、缺失目标不新建替代会话。来源均为`identified / dsh / native / association:verified / scope:instance / shouldAsk:false`，不依赖人工环境注入或用户回答。

两轮还分别通过官方插件管理器禁用/重新启用：同一Host PID、原4个会话保留，旧port关闭、旧凭据拒绝、新instance注册、原会话收到新ACK。这是同PID的插件生命周期，不能写成Host进程重启或Desktop UI已验收。全部runtime正常退出、注册及profile移除、安装根移除，最终`installationCleanup:removed`。没有触发GitHub workflow、上传artifact或发送外部Issue；本地正式序列不替代C05托管首轮，也不证明不同未来版本都兼容。

为避免重复下载，第二/三轮使用任务独占的外部npm缓存；正式运行结束后已核对该父目录只剩`npm-cache`和`ownership.json`，但删除操作被自动审批复核以`blocked by policy`拒绝。未改用其他删除机制，按用户D盘最后统一清理的约定保留：`D:\workspace\CC\multichat\node_modules\.cache\crosschat-c14-native-dsh-20261028`。它没有已安装运行时；当前归属与终端临时根复核见[清理记录](evidence/c14-cleanup-20261028.json)。

本轮没有安装桌面应用或全局npm软件。研究公开文本缓存`node_modules/.cache/crosschat-c14-caller-research-20261028/codex-claude-b645a6`此前删除被自动审批复核以`blocked by policy`拒绝；没有改用其他机制重试，仍依用户D盘统一清理约定保留。普通测试报告缓存与必要验收证据分开记录，不将缓存说成已安装原生软件。
