# C04正式Desktop自然退出：只读调试观察方案

2026-11-04，接续C11本地验收17b9f45。root独立开发，不派worker。用户保留D:/soft/DeepSeek Harness，本轮只启动隔离profile并请求正常Quit，不执行安装、升级或官方卸载；不改公共命令、产品存储或用户配置。

只读核实安装包0.2.1-rc.2的app.asar/lib/main.js：516716字节，SHA-256=6f3d1ddd1106371452c2204be6dfb2e5460a8e8259cdd05cdccb5387b3f9a85a。真实Host由该Electron owner以Node模式spawn，私有IPC有shutdown-complete，stop等待10秒后可能SIGTERM，再等5秒可能SIGKILL。此前只观察操作系统句柄退出0，不足以证明没有升级停止。

本轮采用固定源码摘要绑定的Debugger断点观察，不修改安装文件、不替换函数、不注入Host插件或伪造IPC。在Host出生前设置只读断点；每次暂停只读必要局部变量并立即resume。记录真实child PID/启动参数/profile/parent、shutdown请求、对应Host的shutdown-complete、真实close事件及stop完成时graceful/exitCode/signalCode/流关闭事实，覆盖本类全部三处kill调用。另在出生时持有准确Host的Windows进程句柄，独立观察创建时间和退出码。

只有源码/所有者/profile一致，观察连续，事件顺序完整，无kill或观测错误，真实Host和主进程正常关闭，才报告本轮仪器化测试的自然退出已核实。源码不匹配、断点无法精确绑定、丢事件/连接、超时或任何升级停止均保持未知/未通过。记录调试暂停时间，不把一次带调试器的结果扩大为所有普通运行。

先做有意义的拒绝/顺序测试，再执行真实应用。真实observer结果和C2原直接child记录保持区别；本轮不生成假的C1 Host输出/closed记录，不调用C2卸载，不把自然退出结果扩大为安装/官方卸载或系统注册清理。后续接入C2如需调整内部观察合同，将单独保留规格、RED及新证据。

工装拟放test/helpers/dsh-desktop-exit-observer.mjs、dsh-desktop-exit-validation.mjs，测试放test/dsh-desktop-exit-observer.test.ts；代码文件按用户最新澄清直接推进。全量检查只在代码收口后运行一次；此前2732/11与C11证据不覆盖本次新代码。所有fixture位于本轮独占缓存根，归档后验证进程和owner再清理；若自动删除被拒，不换工具重试。C11总根的用户手动清理仍独立跟踪。

## 空闲冷启动切片及下一原生步骤

2026-11-04，baadff0：正式包的九个断点在Host出生前精确绑定，round-d2Mv8E已观察birth→shutdown→shutdown-complete→真实close0→stop graceful=true，Host进程句柄和主进程均退出0，无kill，观察连续、无错误；暂停累计536ms。dsh协议登记四个key的值与测试前相同，软件保留。当前workspace表为空，本轮没有创建/输入原生聊天，不能当作已绑定实际UI会话的C2观测。[空闲摘要](idle-validation.json)及完整check2745通过/11原有跳过（234文件/3跳过、204模块688边）保留。

前三轮失败保留：round-YQOg22在启动门释放前读Runtime.evaluate超时；round-uscelV在暂停中awaitPromise超时，早退又产生UI初始化错误；round-g3gNh3的Host正常收尾已观察，但调试连接保持主进程存活，最后C1超时强停，不能判通过。独立Node探针和实际回归复现awaitPromise死等；读取暂停帧、不等待Promise微任务，并在Host完成后断开调试器的收尾顺序修复后，第四轮3秒完成。13项合同/连接/脱敏回归先RED后GREEN。早期raw中的URL token只在私有fixture内，归档必须脱敏；最终工装仅记录origin并在写证据前脱敏嵌套日志。

下一步在同一个owned测试根内复用已完成初始化且已完全停止的native profile，以正式内置CLI安装生产桥，然后重新启动正式UI，执行唯一marker的原生pwsh身份调用，验证当前完整sessionId/desktop来源及精确Host，再观察同一Host的正常退出与桥撤登记。内置dsh.cmd已只读核实为Electron --expose-internals + app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js；可用同样固定参数直接执行，保持shell:false，不使用系统npm dsh替代。这个增量不执行官方卸载，不产生假的C1 Host输出/记录或绕过C2。

现场：独占根node_modules/.cache/crosschat-c04-natural-20261104-hu9W8P，owner=c04-native-natural-exit；尚未请求删除。C11根已由用户手动删除并只读核实，收口47e9b7e。没有活动worker、已完成所有四轮原生执行；后续仍由root独立推进。C05远端集成、外部Actions、C00平台范围及官方卸载所需独立环境继续按原边界。
