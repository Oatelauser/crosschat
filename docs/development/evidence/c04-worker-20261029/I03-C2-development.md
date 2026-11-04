# C04-I03-C2：卸载前Host退出守卫

2026-11-03（UTC+8）。用户要求开始下一任务，由root独立开发，暂不交worker；随后追加openbot第一方研究。起点c034f19e00993577f00fb4b264b365f55fd11cca，branch codex/core-refactor-pre-tui，原未跟踪docs/代码消息投递.md保留。worker继续停写，本轮不启动子代理，规范/合同由root自行审查并注明非独立双轴。

本单只实现既有I03研究明确的“Host退出未确认零卸载”接缝。现有最终cleanup校验只能挡sequence.remove，不能挡probe内部提前卸载，因此新增内部生命周期入口 `runDshDesktopUninstall(options, operations)`，仍位于scripts/dsh-compat-ci.mjs，测试在现有test/dsh-compat-ci.test.ts。不新增功能文件、依赖、用户命令/配置步骤；研究与证据文档不参与功能实现。

## 预定接口与验收合同

options包含installation{绝对root,installationId,owner}、launch{instanceId,sessionId}、本次runId、timeoutMs及可选signal。复用I01字符串身份约束，调用开始即固定本次期望。operations为两个可信runner回调：observeHostExit(context)与uninstall(context)。没有默认命令/参数，没有执行器从报告回抄身份的路径。

1. 先且仅调用一次observeHostExit；它须返回与调用方root/runId/installationId/owner/instanceId/sessionId相等的观测，forced:false、以及完整的C1正常直接子进程关闭记录（closed:true/failed:false/code0/signal:null/无timeout、cancel、truncated、未决或次级问题）。缺失、外来、强制退出、不完整记录一律零uninstall。
2. 此处回调是runner可信观测边界，字段相等只证明与调用方绑定；不抗伪造、不自行证明原生Host退出。C1 closed只证明直接child关闭，runner还须独立确认它确为Host且没有强制终止，不能把任意helper的close当Host。
3. 观测有效后、调用uninstall之前再次核实取消和同一总截止。uninstall只调用一次，不重试。返回的也必须为完整C1正常关闭记录；退出码0本身不意味着官方卸载或注册已清，不生成uninstalled/registrationRemoved/systemRegistrationRemoved=true。
4. 同一截止覆盖观测、回调执行和最后裁决；预取消零回调。所有等待可取消且有界，迟到观测绝不启动卸载，迟到结果/拒绝不形成未处理Promise或改返回结论。runner回调须自行拥有其资源并遵循传入signal；取消只停止等待/请求收尾，不能声称已回滚或进程已退出。
5. 错误携带stage、固定installation归属、uninstallStarted、取消/截止状态及原始cause（含假值/冻结错误）。开始卸载后的未知收尾如实报告，不把“已发出操作”误写成零执行。timer/外部监听finally释放；不扫描/结束用户进程、不删安装目录。

先通过该入口写业务RED，再最小GREEN，逐个增加身份/失败/取消反例。用注入回调和小型C1记录验证执行顺序、零调用、deadline、归属和错误；其余原93项回归保留。此接缝验证的是编排，未装真实Desktop、未实现Windows observer/卸载器定位/系统注册探测，不替代原生验收。

代码白名单：既有scripts/dsh-compat-ci.mjs、test/dsh-compat-ci.test.ts；研究/证据为本文件、I03-C2-check.txt、既有安装合同研究、总表/调度说明及openbot研究记录。旧raw不覆盖；原全仓14失败/2609通过/11跳过保持历史事实，通信线不认领。

验证依次定向、syntax、ESLint、导入图/build、一次npm run check（四个VITEST forks/threads 2/1、不开CROSSCHAT_LIVE），完整raw与退出值即时保存，不追绿。只显式路径本地checkpoint，不push/amend/切分支或回退共享文件。无真实安装、卸载、Desktop/Host/模型/试发/Actions/注册表操作；历史被拒5资源和TEMP/cache不重试、不代删。openbot只读固定提交源码，遵从当前许可证，仅提炼思路，未运行它的代码/安装脚本。

## 完成与证据

C2组件开发验收通过。root本人完成实现、验证与规范/合同自审，**不是两位独立审查者的双轴复审**。worker没有收到派单，没有启动任何子代理。I03整体与C04父项仍未完成，真实Host观察、官方卸载和系统注册清理均未接线。

| 保证 | 接口反例/验证 | 结果 |
| --- | --- | --- |
| 缺退出/强杀/未关闭记录零卸载 | never calls uninstall without a complete natural exit observation for this Host | RED1业务断言失败，最小GREEN通过 |
| 本次六字段身份绑定、顺序和无cleanup冒称 | binds every identity to the caller and returns process facts without claiming cleanup | 通过；逐字段外来记录拒绝，合法路径observe→uninstall各一次 |
| 预取消零操作、总截止不能依赖timer先调度 | refuses pre-cancellation and a Host observation that consumes the total deadline | RED2业务失败，GREEN通过；同步40ms超过10ms时零卸载 |
| 运行异常保留首因及安装归属 | preserves a runner failure and installation ownership even for falsy causes | RED2业务失败，GREEN通过；undefined/null/false/0/空串/冻结Error保留cause |
| 迟到观测不调用卸载、监听释放 | ignores a late Host observation after cancellation and releases its abort listener | 通过；显式gate在拒绝后释放，零卸载 |
| 观测/卸载各自挂起均受同一总截止控制 | bounds both runner waits and records when uninstall was already invoked | 通过；分别0/1次卸载，错误标记uninstallStarted正确 |
| 非正常卸载、次级/未决问题、执行器错误不重试 | rejects abnormal uninstall records and preserves executor causes without retrying | 通过；code、signal、failed、closed、timeout、cancel、truncated与问题列表均拒绝 |
| 非法输入零回调、await期间输入变更不换绑 | validates caller identities before either operation and keeps the captured binding | 通过；调用方记录副本固定 |
| 缺PID/输出类型错误不能冒充完整C1记录 | refuses an incomplete process observation before invoking uninstall | RED3业务失败，GREEN通过 |

原始命令/env/stdout/stderr/即时捕获的退出值见[I03-C2-check.txt](I03-C2-check.txt)：RED1为1失败/93过滤未运行、退出1；RED2为2失败/2通过/93过滤未运行、退出1；RED3为1失败/101过滤未运行、退出1。三轮均为目标行为AssertionError，没有把missing export/编译错误当RED。第一轮含明确的不可工作临时入口以观察拒绝行为，随GREEN删除。过滤未运行不等于新增skip。

最终目标文件**102/102、退出0**（原93项+本单9项）；syntax、两文件ESLint、build、代码diff检查通过。单次最终完整 `npm run check` **退出0：2632通过/11原有跳过（总2643）；231文件通过/3跳过**。四个VITEST forks/threads为2/1，CROSSCHAT_LIVE未启用；导入图203模块/682边无环或边界违规。未重复全量追绿。初始语法/ESLint与最终完整检查的输出分别留存，原始日志未以摘要替代。

本轮完整绿覆盖了包含C1的当前整仓，补上其此前的整合验证保留项；**不证明历史会话锁/通信失败根因已修复**。本单只改CI模块和对应测试，未修改通信状态产品/测试；C1历史11/7/14条失败与原RED缺失说明保持不动。

TDD本地checkpoint顺序：范围e0dd6be；RED1 711dd32→GREEN1 7bcf6b8；RED2 9e629dc→GREEN2 a9877c1；RED3 3a4586a→最终GREEN `3b3f05bf9bfd576267e52acd6e42b2c65cd526b7`。不amend或重写这些记录。

## 规范与合同自审

- 规范：本轮未发现未决项。新增83行集中在现有Desktop生命周期模块，旧Web/下载/签名/main/workflow/reporter无diff；没有通用资源框架、依赖或用户配置。timer/内部abort监听/外部监听在finally释放；等待回调时同时拥有成功/拒绝分支，取消后迟到结果不能触发后续动作。新用例不创建磁盘安装根，gate在finally释放，监听spy复原；既有真实child/文件fixture沿原finally收口。
- 合同：本轮未发现未决项。退出观测绑定调用开始捕获的root/runId/installationId/owner/instanceId/sessionId；只有明确forced:false及完整正常C1关闭记录通过。卸载调用前和最终返回均复查总截止/取消，uninstallStarted只在实际调用前置真；已开始后的异常仍保留归属，不自动重试，不生成uninstalled或注册清理证明。
- 验证限制：本轮没有独立审查代理、真实Windows Host观察器或官方卸载执行；受控回调能证明编排守卫，不能抗可信runner伪造观测或把任意helper当Host。未运行覆盖率采集/原生E2E，按仓库规范以接口行为和失效路径验收，不以固定百分比替代证据。

## 研究与收尾

用户追加的openbot研究已完成于[单一研究记录](../../../research/openbot-integration-study-20261103.md)，固定21369e1；driver/ACP能力、投递未确认与去重/执行前复核、消息回信合同和上下文交接均有第一方引用。其DeepSeek API不等于Harness，托管session不等于附着已有Desktop；仅借鉴设计，不复制代码或改变现有协议/状态/用户操作。

没有新增手工临时根、官方EXE/软件安装或后台服务，没有扫描/结束用户进程；只使用既有隔离fixture。历史TEMP/cache和被拒5资源未触碰。用户未跟踪docs/代码消息投递.md不动未stage。当前停止在C2组件完成与研究交付，不自动进入真实安装/卸载/原生通信或下一功能任务。
