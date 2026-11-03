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
