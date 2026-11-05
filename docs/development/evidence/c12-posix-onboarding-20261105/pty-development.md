# POSIX PTY工装开发

2026-11-05（UTC+8）。独立分支codex/dsh-posix-onboarding-20261105，基线main a1e6464；root独立开发。仅开发工装，不改用户命令/必需步骤、产品持久数据或DSH安装，没有新推送/Actions。

首先增加真实终端行为自测，覆盖isatty、初始尺寸/resize、Unicode输入和拆字节输出、原样argv、非零退出、Ctrl+C字节、正常dispose/抗TERM的有界升级及失败启动。Windows ConPTY与POSIX分别留证；受控进程组不扩大为任意逃逸子孙或正式Desktop自然退出证明。

首个真实Linux RED：[原始输出](pty-red.txt)、[报告](pty-red-report.json)。本机WSL Ubuntu-22.04已有Node22.14.0（未安装/更改），Python3.10.12。执行原launchPty，在真实Linux因“ConPTY fixtures require Windows.”停止，未启动子进程或DSH。该输出是有意义的平台能力缺口，非导入/语法错误；exit=1，由外层记录器核实预期非零。现有self-test接口只要求内部开发证据目录。
