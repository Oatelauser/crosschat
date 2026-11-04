# C04正式Desktop自然退出：只读调试观察方案

2026-11-04，接续C11本地验收17b9f45。root独立开发，不派worker。用户保留D:/soft/DeepSeek Harness，本轮只启动隔离profile并请求正常Quit，不执行安装、升级或官方卸载；不改公共命令、产品存储或用户配置。

只读核实安装包0.2.1-rc.2的app.asar/lib/main.js：516716字节，SHA-256=6f3d1ddd1106371452c2204be6dfb2e5460a8e8259cdd05cdccb5387b3f9a85a。真实Host由该Electron owner以Node模式spawn，私有IPC有shutdown-complete，stop等待10秒后可能SIGTERM，再等5秒可能SIGKILL。此前只观察操作系统句柄退出0，不足以证明没有升级停止。

本轮采用固定源码摘要绑定的Debugger断点观察，不修改安装文件、不替换函数、不注入用于伪造观察的测试插件或IPC。空闲首轮不加载生产桥，后续真实UI增量按既有Harness接入合同安装生产桥。在Host出生前设置只读断点；每次暂停只读必要局部变量并立即resume。记录真实child PID/启动参数/profile/parent、shutdown请求、对应Host的shutdown-complete、真实close事件及stop完成时graceful/exitCode/signalCode/流关闭事实，覆盖本类全部三处kill调用。另在出生时持有准确Host的Windows进程句柄，独立观察创建时间和退出码。

只有源码/所有者/profile一致，观察连续，事件顺序完整，无kill或观测错误，真实Host和主进程正常关闭，才报告本轮仪器化测试的自然退出已核实。源码不匹配、断点无法精确绑定、丢事件/连接、超时或任何升级停止均保持未知/未通过。记录调试暂停时间，不把一次带调试器的结果扩大为所有普通运行。

先做有意义的拒绝/顺序测试，再执行真实应用。真实observer结果和C2原直接child记录保持区别；本轮不生成假的C1 Host输出/closed记录，不调用C2卸载，不把自然退出结果扩大为安装/官方卸载或系统注册清理。后续接入C2如需调整内部观察合同，将单独保留规格、RED及新证据。

工装拟放test/helpers/dsh-desktop-exit-observer.mjs、dsh-desktop-exit-validation.mjs，测试放test/dsh-desktop-exit-observer.test.ts；代码文件按用户最新澄清直接推进。全量检查只在代码收口后运行一次；此前2732/11与C11证据不覆盖本次新代码。所有fixture位于本轮独占缓存根，归档后验证进程和owner再清理；若自动删除被拒，不换工具重试。C11总根的用户手动清理仍独立跟踪。

## 空闲冷启动切片及下一原生步骤

2026-11-04，baadff0：正式包的九个断点在Host出生前精确绑定，round-d2Mv8E已观察birth→shutdown→shutdown-complete→真实close0→stop graceful=true，Host进程句柄和主进程均退出0，无kill，观察连续、无错误；暂停累计536ms。dsh协议登记四个key的值与测试前相同，软件保留。当前workspace表为空，本轮没有创建/输入原生聊天，不能当作已绑定实际UI会话的C2观测。[空闲摘要](idle-validation.json)及完整check2745通过/11原有跳过（234文件/3跳过、204模块688边）保留。

前三轮失败保留：round-YQOg22在启动门释放前读Runtime.evaluate超时；round-uscelV在暂停中awaitPromise超时，早退又产生UI初始化错误；round-g3gNh3的Host正常收尾已观察，但调试连接保持主进程存活，最后C1超时强停，不能判通过。独立Node探针和实际回归复现awaitPromise死等；读取暂停帧、不等待Promise微任务，并在Host完成后断开调试器的收尾顺序修复后，第四轮3秒完成。13项合同/连接/脱敏回归先RED后GREEN。早期raw中的URL token只在私有fixture内，归档必须脱敏；最终工装仅记录origin并在写证据前脱敏嵌套日志。

真实UI增量的推进合同（现已完成）：在同一个owned测试根内复用已完成初始化且已完全停止的native profile，以正式内置CLI安装生产桥，然后重新启动正式UI，执行唯一marker的原生pwsh身份调用，验证当前完整sessionId/desktop来源及精确Host，再观察同一Host的正常退出与桥撤登记。内置dsh.cmd已只读核实为Electron --expose-internals + app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js；已用同样固定参数直接执行，保持shell:false。这个增量未执行官方卸载，未产生假的C1 Host输出/记录或绕过C2。

现场：独占根node_modules/.cache/crosschat-c04-natural-20261104-hu9W8P，owner=c04-native-natural-exit；八轮执行均已结束，相关进程0，最终85项脱敏证据已归档并核验。自动删除被拒（仅blocked by policy），没有换工具重试；用户随后手动删除，2026-11-04只读核实该根不存在且用户DSH安装保留，清理关闭，见[摘要](validation.json)。C11根也已由用户手动删除并只读核实，收口47e9b7e。没有活动worker，后续仍由root独立推进。C05本地集成由用户后续明确移交，外部Actions、C00平台范围及官方卸载所需独立环境继续按各自边界。

## 真实UI切片收口

最终代码be4e743，采用round-QW7oaI：正式Desktop实际UI输入→原生pwsh返回identified/dsh-desktop/native/instance/verified与完整ID→生产reader确认同一Host→原生Quit检查无进行中/计划任务→shutdown/ack/close0/graceful=true→主进程0。准确实例f3d5c457-29e0-4b67-888d-91aa5f8afa2c的登记已撤销，测试前旧登记的内容逐字节哈希不变；本轮聊天存储及唯一marker存在，workspace实际路径位于隔离profile内。累计调试暂停407ms，dsh协议登记四个key的值保持，用户软件保留。[最终摘要](validation.json)记录边界，ZIP 85项、88744字节、SHA-256=8de146c1865def90ab4f7fc3ba71b99455140cb58953437209c01f6d992d33cf，CRC/逐项SHA核验通过。完整check2753通过/11原有跳过（234文件/3跳过、204模块688边），定向45/45，显式helper ESLint通过。

全部失败保留：第五轮复用profile后cwd未同步，主进程未spawn；第六轮真实Desktop输出正确，但Web-only测试校验器误拒，退出链未完成，Host句柄monitor预算到期，主进程随后C1超时；monitor退出1不表示Host退出1。之后只读核实进程均已退出，无额外强杀。第七轮UI、存储、Host和主进程自然退出均完成，但工装错误要求所有登记为空，把第六轮旧登记算为本次残留。最终以原生鉴权登记给出的准确instanceId证明本次文件存在过且已移除，并严格要求其它文件集合/内容与baseline相同，未清空旧记录来追绿。复用目录的真实junction用例初次在Windows已绿，追加“校验前不得尝试写入重定向目标”的有意义反例后RED/GREEN；Web默认与显式Desktop来源隔离、登记归属反例均留raw。

本切片移出活动实施。后续仍需C2可信runner原生观察合同接线、独立干净Windows安装/官方卸载/全量注册对账、可信publisher默认策略和托管验收；忙时停止等其它条件/版本不由本轮推定。观察器仍在测试工装中，未改变公共CLI/TUI或新增crosschat持久数据格式。
