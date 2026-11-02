# C04-I03 阶段B R1：一致性、截止与只读资源收口

2026-11-02（UTC+8）。同一I03阶段B返修，不是下一任务。执行者Claude cworker1；以root回信给出的完整新基线核对HEAD/branch/dirty后开工。仓库 `D:/workspace/CC/multichat`，分支 `codex/core-refactor-pre-tui`。不依赖旧聊天；读AGENTS.md、code-standards.md、[I03-B-review.md](I03-B-review.md)、[I03-B-task.md](I03-B-task.md)，及I03-task.md的授权/被拒边界。旧交付87bb680，root已独立定向63/63；已有用例不足，先增加实际业务反例。

## 范围与白名单

仅修改既有：

- scripts/dsh-compat-ci.mjs
- test/dsh-compat-ci.test.ts
- docs/research/c04-windows-installer-contract-20261102.md
- 本目录I03-review-input.md
- 可新建本目录I03-B-R1-check.txt，保存完整原始输出与退出码。

不改root任务/复审/总表/调度、既有日志或I01/I02逻辑；不新增功能文件、依赖、用户操作/命令/参数、持久状态。不重写runDshProcess/main/workflow/reporter，不开始安装/卸载执行。本入口只读调用方文件，失败也不删除或修改该输入文件。原未跟踪docs/代码消息投递.md不动不stage。

## 四组必需行为

1. **签名期间文件一致性。** SHA-512与签名必须对应本次同一独占文件；签名结束到本次裁决前复核句柄及路径状态。签名读取器同长改写/替换输入文件后返回合法签名必须拒绝，未变文件照常通过。不宣称消除本次核验结束到未来执行的窗口，不引入可执行授权token或安装器。
2. **全部文件等待有界且迟到句柄有owner。** lstat/open/stat、已有read及最终状态复核均不能无界等待。总截止或外部取消后不继续启动签名/返回成功。不能取消的IO可以迟到，但必须在返回时如实记录未决；迟到open得到的本次句柄仍唯一close，不恢复成功、不写删输入。读取元数据本身无句柄，不要求为无资源操作制造清理框架。测试覆盖停滞/迟到open和至少一个元数据等待，以及迟到句柄最终实际关闭；fixture的gate、真实句柄和注入均在finally收束。
3. **默认签名child有限收尾。** 输出超限、spawn error、外部取消/总截止、异常退出与正常退出共用清晰的owner。只有观察到close才报告进程已退出；kill失败或无close时有限等待后如实报告释放未确认，清掉本次timer/监听并释放父侧管道及进程引用，不能让本次子进程句柄继续绑住父事件循环。迟到close/error保持有owner、无未处理错误。保留当前专用适配器的小边界，不加杀树/宿主扫描/重试/通用进程框架。用受控child证明kill无效/迟到close/无close，而非fake kill永远立刻close；无真实PowerShell/用户证书环境依赖。
4. **唯一close与错误保真。** 文件close只启动一次并保存落定/未决结果，主路径与finally不重复启动。close失败或迟迟未落定不能交付成功；原先文件/签名错误与清理失败同时存在时，主因、已有cause、清理失败/未决均可观察。原异常不可附加（冻结Error，必要时假值）可用明确包装并保留原始cause与stage，不能catch后吞掉清理信息。没有额外清理问题时不为包装而包装。反例至少包含真实句柄close拒绝时调用一次，以及冻结签名主错+close失败的信息保留；fixture最后恢复并await真实close。

单一截止约束成功裁决；必要收尾须有明确有限预算，预算耗尽按未确认报告，不能重新打开无限等待或把未决写成已释放。返回后才落定的操作如保留后台owner，文档区分返回时保守状态与之后实际收口；不把启动owner当完成证明。保持publisher策略缺省拒绝、artifact校验、零安装写入与现有成功返回字段。

## 验证与交付

一条保证对应有意义反例，先观察业务RED再最小GREEN；不以missing export、TypeError或放宽断言充RED。检查测试确实等待目标阶段，不复用已落定的gate假装进入第二次签名等待。所有patch/gate/句柄/合成child由fixture自己的finally兜底，不能靠被测close清理测试本身。

定向本套件、node --check、对应ESLint/build、代码diff后一次完整npm run check，四个VITEST_MAX/MIN_FORKS/THREADS设2/1、普通检查不启用CROSSCHAT_LIVE。新raw开头写这四项设置与真实命令，保留完整stdout/stderr/真实退出码和首败，不筛全量、不加skip、不用摘要替raw；通过后不无理由重复全量。订正研究/review-input的过宽保证，记录反例、实际保证和未测；旧raw不覆盖。

仅清理本轮独占fixture，核对绝对路径归属和句柄关闭后再删。I03-task.md的五个被拒HTTP资源、I02保留TEMP、W05 cache均不触碰，不重试/换机制/委托绕行。无外网/官方EXE/原生安装卸载启停/注册表/用户配置/模型/试发/Actions。只显式路径本地提交，无全仓stage、push/amend/切分支/拉取/reset/clean/stash或回退共享文件归责；无关共享提交核对祖先及白名单后继续。

完成按本轮typed hint，用仓库node dist/cli.js send、stdin、显式steer回报：真实基线/提交、四组保证→反例、RED/GREEN与完整检查、未测和清理。停写等root双轴复审，不轮询、不进入安装执行或下一任务、不关闭I03/C04。
