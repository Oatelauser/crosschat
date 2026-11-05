# POSIX PTY工装开发

2026-11-05（UTC+8）。独立分支codex/dsh-posix-onboarding-20261105，基线main a1e6464；root独立开发。仅开发工装，不改用户命令/必需步骤、产品持久数据或DSH安装，没有新推送/Actions。

首先增加真实终端行为自测，覆盖isatty、初始尺寸/resize、Unicode输入和拆字节输出、原样argv、非零退出、Ctrl+C字节、正常dispose/抗TERM的有界升级及失败启动。Windows ConPTY与POSIX分别留证；受控进程组不扩大为任意逃逸子孙或正式Desktop自然退出证明。

首个真实Linux RED：[原始输出](pty-red.txt)、[报告](pty-red-report.json)。本机WSL Ubuntu-22.04已有Node22.14.0（未安装/更改），Python3.10.12。执行原launchPty，在真实Linux因“ConPTY fixtures require Windows.”停止，未启动子进程或DSH。该输出是有意义的平台能力缺口，非导入/语法错误；exit=1，由外层记录器核实预期非零。现有self-test接口只要求内部开发证据目录。

实现使用单线程Python host、[openpty](https://docs.python.org/3.10/library/pty.html)和[Popen参数列表](https://docs.python.org/3.10/library/subprocess.html)，固定JSON协议继承原driver，子进程在自己的session/controlling terminal运行，不经shell。输入/尺寸/输出有界，控制EOF或请求会回收自己的进程组，TERM无效时在有界窗口升级KILL并如实标记forced；host正常退出前wait自己的直接child并关闭selector/PTY。该preexec_fn只在单线程fixture host使用，不迁移到多线程产品进程。

首轮七项真实Linux检查通过，见[报告](pty-linux-report.json)与逐项JSONL；覆盖真实TTY、Unicode输入/逐字节UTF-8输出、resize、原样argv、code7、Ctrl+C恢复、dispose幂等/抗TERM升级和启动失败。加入显式console导入修复[首次lint错误](lint-first.txt)后，仅一次最终源码复核也七项通过，见[最终报告](pty-linux-final-report.json)，两轮原始输出分别保留。Window ConPTY真实回归通过：[结果](windows-conpty.txt)、[事件](windows-conpty.jsonl)，Node22.23.4，尺寸/中文/恢复/child0/host0通过。

最终单次[完整check](pty-check.txt)退出0：2803通过/11原有跳过、238文件通过/3跳过，lint/build/204模块689边通过；未启用CROSSCHAT_LIVE，未运行正式DSH。该终端工装切片验收后不重复重开；macOS实际运行、六阶段报告/原生shell与DSH从零仍待下一步。此次本地绿不追认main的Ubuntu来源确认失败已修复。

下一批目标合同已按独立RED/GREEN推进：c0c56e7新增15项，其中14项因既有报告/attempt/sequence/回归marker固定Windows而失败、1项Windows默认/非法轴通过，[RED](platform-red.txt)保留。现目标参数复用四目标登记并在异步执行前快照；fresh报告、process、错误和summary绑定期望OS/架构，错目标不承认释放，不移除/开始下一安装，POSIX marker分架构，Windows旧marker保持。[定向GREEN](platform-green.txt)69/69（新增15＋原从零28＋原平台26）通过。正式onboarding脚本和主入口的POSIX阻断尚未接线/解除，未冒充原生六阶段通过；全量等待完整接线后再验，不将前一批2803项追认为本批完整检查。

3ebf6ca完成原生Bash/实际OS与PTY释放接线，176项定向通过后，使用该固定源码TAR（[SHA/版本](linux-first-source.json)）在独立WSL根、官方SHA核验Node22.23.4、固定rc.2/官方候选及loopback模型运行。首次基线npm正常安装，前三阶段PASS；第四阶段createDshOwnedNode的Broker admin Unix socket报EADDRINUSE并触发未处理error，probe退出1，未产生最终report，候选未执行。整轮infrastructure/retained/notify=false，不承认释放；[原始TAR](linux-first-evidence.tgz)、[运行日志](linux-first-run.txt)、[summary/process](linux-first-inspection/index.json)保留。

日志中socket路径较长。受控Node22.14实验复现两个过长路径共享前缀时，第一bind成功、第二EADDRINUSE，短路径成功；额外的“指定目录前缀也应冲突”假设未复现，实验以非零结束，[全部观察](socket-repro-partial.txt)保留，不把它叫整组通过或直接证明原故障同因。此前尝试复用首轮便携Node时外层/tmp根已不存在，未由代理删除；首次较短后缀的对照也未达到预期，分别留[缺失运行时](socket-repro-missing-runtime.txt)与[首个假设](socket-repro-initial-hypothesis.txt)。首轮retained记录不因后来根不存在而改写，未运行删除命令。

下一次只改变runner临时根选择到短/tmp，沿同一3ebf6ca源码、版本窗口、安装预算、清理和完整断言做一次新隔离验证；这是待验证的环境修正，不连续重跑旧布局，也不修改生产Broker/IPC命名或其错误处理。该异步error路径供原通信负责人消费，不能用本单后续通过宣称生产问题修复。

工作流/报告另经5c04859的9项行为测试RED（6失败/3既有边界通过），增加四目标手动矩阵、独立POSIX周更和实际YAML逐目标报告。首次pnpm SRI抄写遗漏导致6项合法报告被拒，已恢复原固定值并保留[首次结果](workflow-first-pin-typo.txt)；随后只有旧“全工作流仅一个周更”的断言失败，[旧策略结果](workflow-old-policy.txt)保留。按A的分平台周更合同改为两个各每周一次的计划后，[78项定向GREEN](workflow-green.txt)通过；既有Windows周五13:07保持，POSIX拟周五14:07，只在原生首验和后续明确合入批准后生效。actions/setup-python@v6及x64/arm64输入已从[官方v6 README](https://github.com/actions/setup-python/tree/v6)核实（README blob 7cf695cfa2af3584a3aca271954dabb254b012b7、当时tag commit ece7cb06caefa5fff74198d8649806c4678c61a1）；仅CI工装依赖，不新增产品用户安装步骤。当前没有推送/外部运行。

上述短根复核现已完成：[独立核验](linux-short-verification.json)通过，rc.2/rc.5各六阶段、原生skill/来源、诊断/真实PTY、维护/聊天保留和释放均核对；同一WSL内退出前安装根/默认缓存已移除、匹配自有根进程0。候选9个原生相关源码blob与实际执行3ebf6ca相同，后续工作流变更不算托管通过。最终[完整check](check-final.txt)退出0，2827通过/11原有跳过、240文件通过/3跳过，未启用CROSSCHAT_LIVE。源初期PTY索引把持续追加的本文列入文件摘要；[修复后的路径索引](pty-validation-resolved.json)将原25项中的说明字节冻结为d408b0f时的pty-stage-development.md，原索引与原始字节均保留，不覆盖为后续说明内容。
