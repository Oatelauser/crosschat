# C04-I03 阶段B R3：内容复核与fixture迟到句柄

2026-11-02（UTC+8）。同一I03返修；执行者cworker1，以root消息中的完整新基线核对HEAD/branch/dirty。仓库D:/workspace/CC/multichat，分支codex/core-refactor-pre-tui；交付915ba9f。读AGENTS.md、code-standards.md、[I03-B-R2-review.md](I03-B-R2-review.md)、本单和原I03-B-task.md保证2/4/5；I03-task.md的授权/被拒边界继续有效，不依赖旧聊天。

R2两个child/错误传递缺口已经闭合，不再重开。前轮禁止重开文件一致性是基于不充分验收；新真实反例明确本次内容校验仍有漏洞，因此只对以下两组返修，不新增功能范围。

## 必需结果

1. **同指纹、不同内容不得通过。** 签名前后的stat指纹不是内容身份证明。签名读取后、成功裁决前，在本次同一句柄上重新进行有界流式内容摘要核对（从正确起始位置读取），并保留路径/句柄状态一致性检查、总截止与取消、唯一close等已修保证。内容不等于固定SHA-512则stage=file拒绝；不能用sleep、延长时间戳间隔、只换高精度stat或重试到绿替代内容核对；不整包缓冲、不写删输入、不声称解决本次核验后到未来执行的窗口。
   - 先业务RED：使用真实小文件、真实readSignature同长改写，观测元数据固定为同一有效指纹，证明当前实现仍会通过。可在现有小型注入接缝把lstat/handle.stat投影固定到第一次有效状态，实际读写/内容摘要必须真实，未改文件仍可通过。
   - GREEN必须拒绝此确定性反例，同时确认签名后第二次内容读取的停滞/取消仍有界且句柄收口，不新增用户参数或通用读取框架。
2. **fixture独立等待本次迟到open，失败也实际关句柄。** 修test/dsh-compat-ci.test.ts的lateOpen helper及相关用例，使fixture拥有其实际调用的open/句柄登记完成promise，finally先释放本次gate、等待已启动操作落定、恢复并await实际close后再清根。不能只清空当前callback数组，不能只await允许提前返回的被测attempt，也不能把“已启动owner”当“fixture已释放”。未启动的操作不凭空无限等待；fixture自己的额外门控/补丁也必须finally解除。
   - late close failure用例应明确进入“迟到句柄已到、close拒绝”目标阶段后验证路径/原因，或另立未到达分支验证保守未决；不能让任意时序分支都算命中目标反例，不能放宽原行为断言逃避问题。
   - 受控反证覆盖：让真实open在产品已返回、当前cleanup队列本为空之后才到达，或在断言故意失败的受控运行中释放；证明fixture finally仍等到登记并真实关闭，无GC依赖、无未处理错误。临时翻转断言仅作采证，恢复后交付。

第二组只修既有测试fixture，不改I02下载器产品/合同。扫描同一helper的其它用例收尾并修相同owner缺口，限实际相关位置，不整理整套测试。首GREEN的GC来源只按已证机制说明，不以Vitest最近测试名猜句柄归属。

## 白名单、验证与停止

仅既有scripts/dsh-compat-ci.mjs、test/dsh-compat-ci.test.ts、docs/research/c04-windows-installer-contract-20261102.md、本目录I03-review-input.md，可新增I03-B-R3-check.txt完整原始证据。旧raw、root任务/复审/总表/调度和用户原未跟踪docs/代码消息投递.md均不改不stage；无新功能文件/依赖/用户命令或操作步骤/持久状态。订正研究与review-input：R2首GREEN失败、重跑通过分别记录，文件内容漏检为已证产品问题，lateOpen为已证fixture owner缺口，不统称“R1时序敏感”。

先业务RED再最小GREEN；定向、node --check、对应ESLint/build与代码diff后一次完整npm run check，四个VITEST_MAX/MIN_FORKS/THREADS设2/1，不启用CROSSCHAT_LIVE。raw记录真实命令/设置、完整stdout/stderr/真实退出码和首败；旧日志不覆盖。全量若仍有白名单外失败，原样保留，不连续重跑、不扩通信/会话锁产品及测试，不凭前轮锁探针把本轮所有失败断言为同因。

无外网/官方EXE/真实PowerShell签名环境/安装卸载启停/用户状态/注册表/模型/试发/Actions；五个被拒URL和I02/W05历史TEMP/cache不碰不重试。只清本轮独占fixture，先确认绝对归属和真实句柄关闭。只显式路径本地commit，无全仓stage、push/amend/切分支/拉取/reset/clean/stash或共享回退。

完成按本轮typed hint、仓库node dist/cli.js send、stdin、显式steer报告：真实基线/提交、两组保证→确定性反例、RED/GREEN/一次全量、受控fixture反证、未测/清理。停写等双轴复审，不轮询、不关闭I03/C04、不进入安装执行或下一任务。
