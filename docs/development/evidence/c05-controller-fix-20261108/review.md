# C05/C11/C12 原生测试控制器适配

2026-11-08。官方 `0.2.2-rc.1` 移除了测试驱动此前调用的 `sessionController.inspect`；真实schedule因此没有完成新版序列。本次只修测试快照读取：旧版本继续inspect，新版本使用公开 `sessionQuery.observeSession`，要求同一live Agent、完整原生ID、完整header/events，并在复制快照后释放观察lease。生产Adapter、用户命令、版本能力资格、crosschat配置和workflow均未修改。

## 代码与普通检查

- RED `977751c`：[首次1失败/1通过](snapshot-red.txt)，精确复现缺少inspect。
- GREEN `c4d5ce4`：19项新测试覆盖完整300事件日志、错误来源/ID/owner、复制异常、取消后迟到lease和listener/timer清理；[62项定向通过](targeted-root-green.txt)。
- 首轮完整检查的[3项旧dataURL加载失败](first-full-check-failure.txt)保留。`c3c115b`将旧测试驱动与新helper复制到同一个自有临时目录后使用file URL加载，原断言保持；[48项相关检查通过](driver-loader-green.txt)。
- [最终npm run check](final-full-check.txt)在Node22.23.4退出0：2928通过/11原有跳过，248文件通过/3跳过，lint/build通过，206模块/699边无环无越界。[进程与source绑定](final-full-check-process.json)为 `c3c115bd42e8d1b7a964034c1759103337bf85b7`。

取消会向原生观察传递AbortSignal；为释放迟到lease，helper仍等待原生Promise settle。30秒是发出取消的时点，不宣称任何失去响应的上游都会在30秒返回。官方live观察目前立即取得lease。

## 正式新版的本地开发验证

仅在自有临时根安装固定官方Harness `0.2.2-rc.1`、pnpm11.28.5，使用官方Node24.9.0 Windows x64发行物，SHA256与官方SHASUMS核对。npm固定SRI与实际lock一致，见[native setup](native-setup/official-artifacts.json)、[Node摘要](native-setup/node-runtime.json)。不使用个人模型key，仅连接loopback模型桩。

| 序列 | 独立UUID | 完整结果 |
| --- | --- | --- |
| 通信 | fa2731ba-74de-448c-a8f4-bc4665bc15a8 | 8/8 |
| 从零 | 041b71a3-1a61-4b15-85d2-3d160986dd06 | 6/6 |

[最终原生结果](native-path-corrected/results.json)与[审计总证据](validation.json)核对完整检查、source/版本/OS/arch/scope、两个UUID、进程0且无超时；技能实际加载、原生来源、双向回信、诊断、真实ConPTY、更新/官方插件移除、聊天与profile保留均沿既有原始断言通过。各轮Host/登记和原生run目录由owner正常释放，forced=false。

这证明本机Windows、最低Node24.9.0与该固定新版的两个基础序列；24.22.2、其它平台和新版托管尚未验收。rc.5增强四目标结果是另一证据；没有扩大rc.1原生改名、Desktop、浏览器或跨机资格。四次历史schedule失败保持原状，未追加Actions/定时或Issue写入。

## 临时启动错误与诊断

[首轮新版本地失败](native-new-first/results.json)已越过inspect缺口，但通信身份bootstrap与从零来源检查失败。后者已通过完整技能正文断言，不能归为技能未加载。

原因是主代理的临时启动脚本按大小写读取 `env.PATH`，实际Windows过滤环境保留的是 `env.Path`，拼接后PATH变为Node目录加`undefined`。工具回退旧PowerShell，原Node `-e`命令中的引号被剥离而报SyntaxError。这里没有生产兼容回归，也没有放宽验收断言。

[完整PATH正对照](native-diagnosis/report.json)身份verified；[损坏PATH负对照](native-diagnosis-launch/report.json)复现相同bootstrap失败，并保留真实tool_result。最初诊断子进程也因同一PATH找不到git，见[原始诊断进程](diagnostic-launch-process.json)；随后从外层传入已核实source，使[负对照进入真实工具路径](diagnostic-path-process.json)。归档仅含相关工具广告/结果，有界脱敏，不保存headers/system或整份模型messages。

临时启动脚本改为按不区分大小写取出原path、移除重复键、单键前置本次Node目录后，原完整序列通过。可审阅的[开发脚本文本](development-drivers/run-native.mjs.txt)及诊断脚本保留；它们不增加用户操作或配置。

## 复核和清理边界

独立subagent对 `098ce87...c4d5ce4` 的规范/规格复核均无可行动发现，未代替执行测试。对包含后续旧loader修复的最终独立复核遇429中断，未记为完成；主代理已逐文件复核该小改动，并完成上述全量与原生验证。

[清理状态](cleanup.json)区分已正常释放并删除的各原生run根与仍保留的外层安装根。外层 `D:/workspace/CC/cc-c05-tEWvDv` 的删除被自动审批以 `blocked by policy` 拒绝；只读核实owner匹配、safe=true、无关联进程，未通过其它工具重试删除。用户日用DSH及此前保留工具依赖均未触碰。

下一决定是两份专用probe是否由Node22改为固定24.22.2。配置未改；等待用户按已准备的两行patch选择后，才做对应候选及四目标基线/新版托管验证。
