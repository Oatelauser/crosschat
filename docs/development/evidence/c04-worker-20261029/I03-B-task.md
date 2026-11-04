# C04-I03 阶段B：文件完整性与签名准入

2026-11-02（UTC+8）。同一I03内的最小实现阶段，执行者Claude cworker1；收到root给出的完整新基线后执行。用户已启动I03，非新增下一任务。阶段A事实与未知清单可作为输入，先读I03-A-review.md并在本轮修正文档方案问题；不要求旧聊天记忆。

仓库D:/workspace/CC/multichat，branch codex/core-refactor-pre-tui。阶段A交付942f981。读AGENTS.md、code-standards.md、本单、I03-A-review.md、I03-task.md的授权/被拒边界和I02最终验收；相关现有代码按需读。原未跟踪docs/代码消息投递.md不动不stage。

## 本轮结果与白名单

在现有scripts/dsh-compat-ci.mjs提供一个可直接调用的只读安装包准入入口，例如admitDshDesktopInstaller({ path, artifact, policy, readSignature?, signal?, timeoutMs? })；用现有test/dsh-compat-ci.test.ts验收。内部校验helper不必另造公开API。报告表示本次核验结果，不是可传入任意执行器的不可伪造安装授权。

仅可修改：

- scripts/dsh-compat-ci.mjs
- test/dsh-compat-ci.test.ts
- docs/research/c04-windows-installer-contract-20261102.md
- 本目录I03-review-input.md
- 可新增I03-B-check.txt（完整原始输出）

不新增功能文件、依赖、用户命令/参数、安装要求或持久状态；不改baseline、main/workflow/reporter、Web默认路径、I01/I02合同或runDshProcess。现有helper差距如实列为未来执行层前置，本轮不借机重写共享进程框架。

## 保证

1. **独立策略缺省拒绝。** root选择严格的内部CI策略publisher{subject,thumbprint}：两者均字符串、非空、有明确长度/格式约束，与签名读取结果进行明确比较；不从待核文件/报告生成期望值，无内置猜测publisher/证书。不提供策略时在文件读取和子进程前拒绝。策略值来源由未来runner提供独立可信材料，当前没有真实默认值；不新增终端用户手工配置步骤。
2. **同一文件的完整性核验。** 复用I02的artifact边界规则，验证固定URL/版本/filename/size/SRI；绝对路径的普通文件，拒绝链接/非普通文件和大小不符。流式重算SHA-512，按预期大小有界，不整包Buffer.concat，不信任I02返回对象的成功字段而跳过读盘。校验与签名应针对同一调用方独占文件，前后文件状态不一致拒绝；不声称可消除校验结束后到未来执行之间的文件替换窗口。未来执行层须重新核实实际执行文件，本轮不执行它。
3. **签名读取与判定分开。** 支持小型readSignature注入，并在既有模块内提供Windows默认只读签名适配器（可用系统PowerShell Get-AuthenticodeSignature，无profile、隐藏窗口）。路径通过独立参数或环境字段传递，不拼进可执行脚本文本，不经shell执行安装包。输出先按unknown解析，拒绝非对象/数组/错类型/缺字段/坏JSON/截断/非正常退出；只有明确Valid且subject/thumbprint均与策略相符才通过。Valid本身不证明预期发布者，结果不证明安装或UI通过。
4. **取消与资源有界。** 单次截止覆盖文件读取、签名读取及最后成功裁决，调用方预先取消或执行中取消/截止不返回成功。文件reader/句柄、timer/listener及本次只读签名子进程都有owner和finally；签名适配器有明确输出字节上限及完成/取消边界。不得拿目前runDshProcess的超时返回当close证明，也不为此新造通用杀树/进程框架。默认适配器测试用受控注入/自有子进程，不读取用户证书/真实签名环境来决定普通测试成败。
5. **零安装写入。** 本入口不创建安装目录/修改原文件，不启动安装器/卸载器，不写注册表/协议/用户配置/证书库。返回值只含必要已核信息。异常保留实际stage和原始cause，清理问题如实附加，不伪造成功/回滚。待核实的静默参数、目录选择、卸载器名、注册表键和发布者实际值继续标未知。

## 文档订正

按I03-A-review.md逐条改研究和review-input：准确说明runDshProcess保留尾部128000字符但无truncated/signal/close确认；把“未退出零卸载”的真实守卫放在未来卸载spawn前，不再用最终cleanup作保证；撤回arguments+绝对root即安全的执行方案；把资料核实与真正用户决策分开。记录本轮只实现准入，安装/卸载执行层仍缺哪些具体证据和接线；不关闭I03整体或C04。

## 验证与证据

先业务RED再最小GREEN，一条保证一条反例，不把missing export当RED。独占小型TEMP fixture、注入签名结果；至少证明：合法策略/文件/签名通过；缺策略/错误字段、错误digest或size、签名状态/subject/thumbprint不符均拒绝且零安装执行；链接/非普通文件拒绝；校验期间文件替换拒绝；签名等待超时/外部取消无成功；默认签名适配器的有界/JSON/进程错误路径；fixture断言失败也finally释放gate/句柄/补丁。

定向本套件、node --check、对应ESLint/build及代码diff后一次完整npm run check（四个VITEST_MAX/MIN_FORKS/THREADS设2/1）；raw开头只打印这些设置及真实命令，保留完整stdout/stderr/真实退出码和首败，不用人工摘要冒充raw，不筛全量、不增skip/放宽语义。成功后不无理由重复全量。旧日志、root记录不改。

5个被拒上游资源及I02/W05被拒清理沿I03-task.md原边界，不重试/委托/换机制。本轮无真实官方EXE下载、外网/模型/试发/原生Desktop安装或启停、Actions/push。仅清理本轮独占fixture，核对归属与关闭后再删；受阻如实保留。

起止核对HEAD/branch/dirty，共享无关提交核对祖先/白名单后继续。只显式路径本地checkpoint，无全仓stage、切分支/拉取/reset/clean/stash/amend/push、回退共享文件归责。完成按最新typed hint、仓库node dist/cli.js send、stdin、显式steer回传保证→反例、基线/提交、完整检查与未测、清理；停写等双轴复审，不轮询、不自行进入安装执行阶段或下一任务。
