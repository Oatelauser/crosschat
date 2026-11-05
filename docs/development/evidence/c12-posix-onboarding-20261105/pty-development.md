# POSIX PTY工装开发

2026-11-05（UTC+8）。独立分支codex/dsh-posix-onboarding-20261105，基线main a1e6464；root独立开发。仅开发工装，不改用户命令/必需步骤、产品持久数据或DSH安装，没有新推送/Actions。

首先增加真实终端行为自测，覆盖isatty、初始尺寸/resize、Unicode输入和拆字节输出、原样argv、非零退出、Ctrl+C字节、正常dispose/抗TERM的有界升级及失败启动。Windows ConPTY与POSIX分别留证；受控进程组不扩大为任意逃逸子孙或正式Desktop自然退出证明。

首个真实Linux RED：[原始输出](pty-red.txt)、[报告](pty-red-report.json)。本机WSL Ubuntu-22.04已有Node22.14.0（未安装/更改），Python3.10.12。执行原launchPty，在真实Linux因“ConPTY fixtures require Windows.”停止，未启动子进程或DSH。该输出是有意义的平台能力缺口，非导入/语法错误；exit=1，由外层记录器核实预期非零。现有self-test接口只要求内部开发证据目录。

实现使用单线程Python host、[openpty](https://docs.python.org/3.10/library/pty.html)和[Popen参数列表](https://docs.python.org/3.10/library/subprocess.html)，固定JSON协议继承原driver，子进程在自己的session/controlling terminal运行，不经shell。输入/尺寸/输出有界，控制EOF或请求会回收自己的进程组，TERM无效时在有界窗口升级KILL并如实标记forced；host正常退出前wait自己的直接child并关闭selector/PTY。该preexec_fn只在单线程fixture host使用，不迁移到多线程产品进程。

首轮七项真实Linux检查通过，见[报告](pty-linux-report.json)与逐项JSONL；覆盖真实TTY、Unicode输入/逐字节UTF-8输出、resize、原样argv、code7、Ctrl+C恢复、dispose幂等/抗TERM升级和启动失败。加入显式console导入修复[首次lint错误](lint-first.txt)后，仅一次最终源码复核也七项通过，见[最终报告](pty-linux-final-report.json)，两轮原始输出分别保留。Window ConPTY真实回归通过：[结果](windows-conpty.txt)、[事件](windows-conpty.jsonl)，Node22.23.4，尺寸/中文/恢复/child0/host0通过。

最终单次[完整check](pty-check.txt)退出0：2803通过/11原有跳过、238文件通过/3跳过，lint/build/204模块689边通过；未启用CROSSCHAT_LIVE，未运行正式DSH。该终端工装切片验收后不重复重开；macOS实际运行、六阶段报告/原生shell与DSH从零仍待下一步。此次本地绿不追认main的Ubuntu来源确认失败已修复。
