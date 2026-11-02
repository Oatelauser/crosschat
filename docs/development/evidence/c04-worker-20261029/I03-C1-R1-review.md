# C04-I03-C1 R1复审与R2最小范围

固定比较 `git diff ce73aefb9e7fd55fb9aa63051570578460edcfc1...d2df5120614ff51fc7a5fb50e1774d4a03a98bbb`，一个worker提交，仅四个白名单文件。分支codex/core-refactor-pre-tui，工作树仅用户原未跟踪docs/代码消息投递.md。原任务与I03-C1-review.md仍是合同，本文件只记录R1复审及必要的同单收尾。

## Standards

**1项P2：真实child fixture关闭后未清等待timer。** `test/dsh-compat-ci.test.ts:143–144`每次cleanup创建10秒timeout，但没有保存句柄/在actual close胜出时clear。违反code-standards §5的timer所有权及原S2的fixture独立收口要求。独立审查者把固定版本helper在内存转换执行，对已close受控child的cleanup正常返回后仍有1个10000ms timer；探针自身已清理。保存timer并在等待的finally清除即可。

原S1迟到pipe error已有最小owner；S2已捕获真实child并等待actual close，剩上述timer；S3已如实承认首次原始RED缺失，新R1 raw保存真实业务RED，并注明首次GREEN退出码捕获无效、另有正确捕获的GREEN。未另报judgement-call smell。无需补造旧RED或抹掉旧错误。

## Spec

**1项P2：F4仍遗漏清理过程中、返回前同步发生的pipe错误。** R1范围明确“分别记录返回前观察到的后续运行/清理问题；返回后保持owner但不改返回快照”。`scripts/dsh-compat-ci.mjs:414`在清理前将settled置真，417–419才destroy/unref；若这些操作同步发pipe error，435–436的later直接忽略，421返回的secondaryProblems不包含已观察到的错误。

root受控反例使用真实PassThrough并保存/恢复其destroy：destroy内同步emit error('synchronous pipe cleanup error')再调用原destroy。先发冻结child主错、kill=false、无close，等固定close预算后，返回failed:true/closed:false/主因不变，但secondaryProblems=[]。事件发生在resolve(snapshot)之前，不能按“返回后迟到事件不更新”豁免。所有自有pipe已在finally恢复并销毁，fake child收口，无共享产品修改或用户状态访问。

F1的spawn前截止与close复查、F2独立有界拷贝、F3显式failed及假值保留均已按本轮反例修正；F4的直接throw/早先pipe error记录已修，仅剩上面收尾阶段问题。没有扩大真实安装或其它入口范围。

## 验证与结论

root独立 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1` 为91/91、退出0；四个VITEST forks/threads为2/1，未启用CROSSCHAT_LIVE，无GC错误。syntax及固定代码diff检查退出0，未再次跑全量。

worker一次完整check退出1：7失败/2614通过/11跳过，4失败文件/227通过/3跳过；原始输出I03-C1-R1-check.txt保留。失败涉及c14-conversation-refinement、caller-source-service、conversations、send-command，本轮零diff；不把零diff或若干busy症状作为全部失败同因的证明。通信线仍由用户对接Bug修复2。

两轴当前分别Standards 1项P2、Spec 1项P2。**R1不验收，继续C1同单R2，仅上述两处及对应反例/报告；不下发其它功能任务。**

## R2执行包

- 开工基线见root派单消息的完整SHA。白名单仍只 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts`、本目录 `I03-review-input.md`，本轮可新增 `I03-C1-R2-check.txt`。旧raw、root记录/任务书/队列不改。
- 先业务RED：实际close后的fixture timer数归零；cleanup操作内同步pipe error确在返回前记录且首因不变。可在同组验证destroy/unref中的同步事件，返回后error仍安全、快照不变。探针/测试本身的timer、注入及pipe须finally还原，不留补丁或等待。
- 最小GREEN，不新增资源框架/公开参数，不改变已闭合F1–F3/S1的语义。区分正在收尾与已经返回，防重入同时保留返回前次级错误。timer在所有race结果的finally清除。不要扩大成事后更新已返回快照的方案。
- 交付说明订正F4保证与新证据，说明首轮RED原始输出仍缺失；全量失败只报告事实和证据边界，不统一断言根因。新raw完整保留命令/env/stdout/stderr/真实退出码，首个GREEN退出值立即捕获，不在其它命令后取值。
- 定向、syntax、对应ESLint/build/diff后一次最终完整check，四个VITEST 2/1、不开live；首败原样保留，不反复追绿、不改通信线。无真实installer/Desktop/Host/网络/模型/注册表操作；不碰历史TEMP/cache或被拒5资源。
- 只显式路径本地commit，不push/amend/切分支/共享回退；完成按最新typed hint、仓库node dist/cli.js send、stdin、显式tool及steer回传，停写等root两轴复审，不关闭I03/C04、不接线安装或领取下一单。
