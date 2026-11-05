# C12/C11 POSIX六阶段候选：root自审

2026-11-05（UTC+8）。基线main a1e6464，独立branch codex/dsh-posix-onboarding-20261105；root独立开发、自审，未派worker。本地代码、完整检查和Linux双版本从零已完成，候选可审阅；尚未执行新推送、PR、Actions、main合入或发布。候选最终SHA由权威进度入口与git核实，不在本文循环写自身提交。

## 行为与接口

从零入口原先固定Windows报告和pwsh，终端工装也只支持ConPTY。当前复用四目标登记，Linux/macOS接单线程Python真实PTY，原生shell按实际OS选Bash/pwsh；六阶段仍为官方安装/skill加载、原生身份与双向回信、同源诊断/真实终端、更新、官方插件移除与crosschat卸载/聊天保留。产品CLI/TUI交互、用户必需步骤、持久格式和共享通信实现未改，没有新增crosschat运行账本或home文件。

PTY保持原launchPty控制接口和JSON协议，Windows的pwsh/ConPTY参数保持。POSIX子进程参数列表直接exec，不经shell；Python host只有一个线程，单独session/controlling terminal和自己的进程组，控制输入/尺寸/输出有界。EOF、显式dispose和异常都回收自己启动的fixture；TERM无效时有界升级KILL并记录forced，等待直接child后关闭selector/PTY。受控进程组证明不扩大为任意逃逸子孙或DSH正式Desktop自然退出。六阶段要求POSIX终端normal child0/host0、groupReleased=true/forced=false，以及TUI模式/listener恢复。

报告、fresh UUID、子进程、summary与错误均绑定预期OS/架构，异步前快照target，错目标/释放不明不会移除或开始下一安装；复用原serial owner。POSIX回归marker按OS/架构分开，Windows旧marker不变。官方版本窗口、SRI、pnpm固定值与安装20分钟/探针预算/每job75分钟保持。

## 工作流候选

既有从零workflow手动覆盖Windows/Linux x64、macOS Intel/ARM，先验证实际Node OS/架构；POSIX明确安装Python3.12并做真实PTY预检，再下载/安装DSH。短TMPDIR=/tmp仅用于POSIX runner避免fixture Unix socket路径过长，不改生产IPC命名或错误处理。Python是验收工装依赖，不增加产品用户安装步骤。

原Windows从零每周五13:07保持，POSIX拟每周五14:07（UTC+8），只在对应原生分支首验通过并明确批准合入后生效；当前main的C05 POSIX周更和Windows从零周更来自已合入PR #3，未由此候选更改。四个原生job合计上限300 runner分钟，另有普通三平台CI；不注册自托管或购买付费runner。

分目标artifact供默认分支独立报告job读取。只有该job有Issues write，未checkout或执行artifact代码；有界普通JSON、精确目标、完整六阶段/顺序、独立runId、同项两次失败与释放事实核对后才去重写入。不完整Issue列表、基础设施/释放不明和未知schedule均不写入；SDK/文件边界用例执行的是实际YAML脚本，没有制造外部Issue。

## 当前验证与限制

真实PTY的RED/GREEN、七项Linux自测和Windows ConPTY回归已通过，原始记录及索引见[阶段记录](pty-development.md)。目标合同15项（RED14失败/1通过）与实际YAML9项（RED6失败/3通过）均保留，工作流相关78项定向通过。首次SRI抄写错误与旧单周更断言不匹配分别留raw，恢复原pin、按A扩到两个分平台每周计划，未skip或放宽完整验收断言。

最终本地Windows Node22.23.4完整check **2827通过/11原有跳过，240文件通过/3跳过，退出0**，lint/build/导入图通过。此前PTY阶段2803项是各自历史，不混为同一轮新增计数。本次本地绿不追认main41969350805的Ubuntu来源确认SOURCE_STATE_BUSY或旧六进程短柄失败已修复，公共通信归属保持。

Linux正式工具首次固定源码3ebf6ca的长根布局：基线前三阶段PASS，第四阶段Unix socket未处理EADDRINUSE、probe无最终report，整轮infrastructure/retained，候选未执行。[完整失败与诊断](pty-development.md)保留。受控长前缀碰撞实验支持环境路径假设，额外目录前缀假设未复现；不将实验非零写成全通过或认定与原故障/旧TCP锁失败同因。

仅一次新隔离复核沿同一3ebf6ca源码、官方SHA核对Node22.23.4和预算/完整断言，把TMPDIR改短/tmp；rc.2与rc.5均六阶段全部通过。原始report/process/install/lock、完整原生skill结果/来源、诊断、真实TUI操作/终端模式与监听恢复、官方维护进程及profile/聊天保留逐项核对通过。Host/登记/fixture/PTY全部正常释放，forced=false，无retry，整轮compatible/notify=false；同一WSL执行结束前已观察安装根、默认缓存均不存在、匹配自有根的进程0。[双版本原始核验](linux-short-verification.json)和[同轮清理观测](linux-short-disposition.json)保留。首轮与复核的基线依赖版本/SRI图完全一致；场景在短根下恢复不等于生产Broker异步错误处理或旧TCP锁问题已修复。

实际执行源码3ebf6ca与候选的9个原生路径相关blob逐一相同，[关联表](native-source-correlation.json)保留；后续工作流改动由实际YAML离线检查覆盖，不冒充已经托管运行。TAR共35条目，逐成员安全类型/路径/大小和内容SHA核对，27份原始JSON/JSONL提取核验，压缩包219297字节。两处外层/tmp根后来均已不存在，[后续只读观测](linux-later-disposition.json)保留；未由代理删除，不改写首轮retained。开发依赖、便携Node和审阅工作区保留；无本轮活动原生进程、worker或在途工具，用户DSH安装/PATH未动。

[最终95项原始文件与11个源码blob索引](validation.json)已逐项核对，内含的25项PTY检查点也按冻结快照单独复核；当前说明/审阅文档不混入不可变raw摘要。指南与本轮两份说明的37个本地相对链接存在，src、包版本和依赖文件相对基线未改。原始TUI JSONL含末尾空行，局部属性仅调整这两份文件的diff空行检查，原始字节/摘要保持。纯证据/教学更新不重复已经通过的产品全量。

macOS六阶段原生与新版四目标托管首验仍未验收；下一步请求具体批准推送本候选、建草稿PR并运行候选分支C11四目标首验（每个原生job75分钟上限，合计300原生runner分钟，另有普通CI）。PR #3的合入授权明确未追加手动首验，本次需要单独外部决定；不包含main合入、POSIX新周更启用或release。实际schedule/生产去重写入、浏览器UI、正式Desktop完整生命周期、其它工具及跨机不在本次已验证范围。跨机R1/R2/R3仍待原问题回答，25父项/11CI索引保持。旧Node25观察器崩溃和main普通Ubuntu来源锁/短柄失败未定因，本单不接管或宣称修复。
