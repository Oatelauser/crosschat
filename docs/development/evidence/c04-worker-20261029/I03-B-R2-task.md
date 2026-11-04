# C04-I03 阶段B R2：签名child统一收口与错误传递

2026-11-02（UTC+8）。同单定向返修，不是下一任务。执行者cworker1，以root消息所给完整新基线核对HEAD/branch/dirty后开工。仓库D:/workspace/CC/multichat，分支codex/core-refactor-pre-tui；上次交付fe96cb7。先读AGENTS.md、code-standards.md、[I03-B-R1-review.md](I03-B-R1-review.md)与I03-B-R1-task.md；I03-task.md的授权/被拒边界继续适用，不依赖旧聊天。

## 仅两个未闭合行为

1. **已有child的error共用有限收口。** 同步spawn抛错而未产生child可以直接拒绝；spawn返回后error事件不能绕过已有child的owner。若超限/取消已开始收尾，后续error不能顶替首个主因或提前清掉close等待。观察close再确认退出；有限预算后仍无close，报告释放未确认并销毁本次父侧管道、移除data监听、unref本次child。迟到error/close保持有owner、无未处理错误，不加杀树/扫描/重试框架。反例覆盖：error且无close；70KiB超限后kill失败并触发error；正常spawn失败后close及正常退出不回退。
2. **总截止与先前签名失败叠加时信息保真。** signatureOutcome.stopped分支不能按late.error的stage选择性丢弃已取得的原签名失败、releaseUnclear或清理原因。总截止不返回成功，同时原始错误/cause及实际未确认退出信息仍可观察。反例：70KiB输出、kill=false、无close、timeoutMs=50，小于1s收尾预算；返回需保留超限主因与未close信息，父侧管道/引用仍被释放。仅取消、超限但close及时、既有冻结主错+文件close失败均继续通过。表示为保留原主因或取消包装由实现决定，明确stage/cause和清理字段，不以丢信息简化。

不重开已修的文件一致性/等待/迟到open/唯一close实现；只为必要组合回归触及相邻分支。入口只读，不删除或修改调用方输入，不进入安装/卸载执行，不改runDshProcess/main/workflow/reporter/I01/I02。

## 白名单与检查

仅既有scripts/dsh-compat-ci.mjs、test/dsh-compat-ci.test.ts、docs/research/c04-windows-installer-contract-20261102.md、本目录I03-review-input.md，可新增I03-B-R2-check.txt原始证据。不改root任务/复审/总表/调度、旧raw、通信/会话锁产品或测试。docs/代码消息投递.md原未跟踪文件不动不stage；不新增功能文件/依赖/用户步骤/持久状态。

先业务RED再最小GREEN。注入测试不能让fake kill永远成功；测试自己的child/gate/patch/timer均finally兜底，即使断言失败也释放。定向套件、node --check、对应ESLint/build、代码diff后一次完整npm run check，四个VITEST_MAX/MIN_FORKS/THREADS为2/1，不启用CROSSCHAT_LIVE；新raw保留设置、命令、完整stdout/stderr/真实退出码和首败。完整检查若仍在同一独立会话锁路径失败，原样记录，不连续重跑、不扩大白名单。R1旧全量失败和未核实端口来源保持事实，不追认为全部由单一原因证实。

同I03既定边界：无外网/官方EXE/真实PowerShell证书环境/原生安装卸载启停/注册表/用户配置/模型/试发/Actions；五个被拒URL及I02/W05历史TEMP/cache不触碰、不重试或换机制。只清本次独占fixture并先核对绝对归属/句柄关闭。只显式路径本地commit，无全仓stage、push/amend/切分支/拉取/reset/clean/stash或共享文件回退。

完成按本轮typed hint、仓库node dist/cli.js send、stdin、显式steer回报：基线/提交、两个保证→反例、RED/GREEN与一次全量真实结果、未测及清理。停写等双轴复审，不轮询、不关闭I03/C04、不自行进入后续任务。
