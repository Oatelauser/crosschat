# C04-I03-C1 首轮双轴复审与R1范围

固定基线 `f2cab7fb8c60c9c9dba2aa43ad1c9d4ce5884411`，交付 `36ac3851b505ad93d2edb2adccfc245a06422f51`，独立比较命令 `git diff f2cab7fb8c60c9c9dba2aa43ad1c9d4ce5884411...36ac3851b505ad93d2edb2adccfc245a06422f51`。单一交付commit，仅原四个白名单文件；未push，工作树仅用户原未跟踪文档。以下行号指该固定交付。

结论：本次不验收，继续同单R1；不启动实际安装/卸载或其它任务。两轴独立审查，Standards 3项、Spec 4项，均P2；不是整仓全量失败的归因报告。

## Standards

1. **S1 / P2：迟到pipe错误没有owner。** `scripts/dsh-compat-ci.mjs:394` 移除两路pipe的error监听，随后400–407收尾只给child补error sink。受控反例：child error、kill=false、close预算耗尽返回后，stdout的error监听数为0，迟到stdout error直接抛出。违反code-standards §5的listener/pipe所有权和任务§5。保留到pipe释放的最小错误owner；`I03-review-input.md:144`的无未处理迟到错误保证目前过宽。
2. **S2 / P2：真实child fixture无独立finally收尾。** `test/dsh-compat-ci.test.ts:149–154`只经产品入口创建两次真实Node进程，没有fixture持有child引用或finally。若产品合法返回closed:false，断言失败后20秒child缺独立清理owner。违反规范§5及任务§6。用小型spawn注入捕获本次真实child，finally确认它实际close，不能靠产品断言/GC/测试进程退出代替。
3. **S3 / P2：原始RED证据缺失。** `I03-C1-check.txt:6–8`只有RED标题、计数、退出码摘要，无命令/env/失败输出/首条业务断言。任务检查要求完整raw且禁止摘要替代，规范§9要求验证及文档完整。取回原始输出（如存在）；否则明确限制，不补造原始RED、不能把重演称为最初RED。GREEN/完整check的原输出继续保留。未见另报的judgement-call smell。

## Spec

1. **F1 / P2：总截止不含spawn且未在裁决复查。** 任务§4：“timeoutMs覆盖spawn尝试至最终执行裁决”。`scripts/dsh-compat-ci.mjs:373`先spawn，424才设timer，428的close也不检查实际截止。root受控反例：timeout10ms，spawn内等待70ms后排close(0)，73ms后仍code0/closed:true/timedOut:false/无failure；另在spawn后阻塞70ms、timer未调度前close，78ms后同样误报正常。需要从spawn尝试前固定截止、返回后和最终裁决核实；不要求抢占同步spawn，但过期不能成功。
2. **F2 / P2：截取view仍保留超预算底层Buffer。** 任务§4：“缓冲总量有界；只采集预算内字节”。`scripts/dsh-compat-ci.mjs:386`存subarray。root注入8MiB chunk并在concat处观察，128000字节view背后仍引用8388608字节。输出长度限额正确，保留内存不受该限额约束；只保留实际允许字节的独立有界副本。
3. **F3 / P2：假值失败不能与正常结果区分。** 任务§3/5要求错误发生后close0不恢复成功、首因包括假值。`scripts/dsh-compat-ci.mjs:413`内部failing不在397–399快照中。error(undefined)随后close(0)，返回failure:undefined且所有失败标志false、releaseUnclear空，与正常成功完全同形。保留原始抛值，另提供明确失败判别，不用truthiness判断是否失败。
4. **F4 / P2：后续错误和清理失败不可观察。** 任务§5：“后续kill/pipe/收尾问题可观察但不顶替它”。`scripts/dsh-compat-ci.mjs:412`丢弃首因之后的pipe/child错误，405–407吞destroy/unref异常。反例：首个child error、后续stderr error、再close，只有首因且releaseUnclear为空。保留主因，分别记录返回前观察到的后续运行/清理问题；迟到返回后的事件保持owner但不改返回快照。未发现范围扩大。

## root验证及证据边界

- 独立定向 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`：85/85，退出0；四个VITEST forks/threads为2/1，未启用CROSSCHAT_LIVE，无GC错误。
- `node --check`与固定比较的代码 `git diff --check`退出0。root没有重跑整仓。
- root截止/Buffer探针只用内存fake、PassThrough与短暂同步等待，没有共享产品改写、原生安装或用户状态访问；pipe已显式销毁，涉及Buffer/timer替换的探针在finally恢复并收尾。Spec/Standards的错误探针也仅用独占内存fixture。
- worker完整检查保留为退出1：11失败/2604通过/11跳过，8失败文件/223通过/3跳过，完整输出在I03-C1-check.txt；失败文件本轮零diff，不逐条断言同因，不扩大通信所有权。初始RED只有摘要，不能声称已审核其原始失败原因。

## R1实施范围与验收

原I03-C1-task.md六项行为合同继续有效，只修上述已证问题及对应fixture/证据，不新建执行框架、不改旧runDshProcess/Web/签名准入/下载器/main/workflow/reporter，不接真实installer/uninstaller。新增明确失败判别/次级问题字段属于本次未接线内部接口的必要收口，不新增用户命令/配置/步骤。

worker白名单仍为 `scripts/dsh-compat-ci.mjs`、`test/dsh-compat-ci.test.ts`、本目录 `I03-review-input.md`，本轮可新增 `I03-C1-R1-check.txt`；旧I03-C1-check.txt不覆盖不改写。本文件/任务书/root队列只由root维护。开工基线以派单消息完整SHA为准。

- 分别以业务反例闭合F1–F4/S1；F1用确定性过期/close顺序证明不只靠timer调度，F2验证保留片段不依附超限底层分配，F3覆盖undefined/0/false/空串/null原因和明确失败状态，F4覆盖后续pipe/error及destroy/unref失败仍保留首因。
- S1使用真实受控stream的迟到错误/销毁错误验证无未处理事件；返回后的结论快照不能变化。记录返回前已观察的问题，返回后仅保留最小owner，不要求无法实现的事后更新快照。
- S2中fixture须持有本次child完成promise、finally请求本次进程结束并等actual close；可用受控产品返回未确认/断言失败反证验证fixture兜底，但不能发出伪close冒充真实退出，也不能扫描/终止其它进程。
- S3先查原始RED是否仍有独立留存。没有就诚实标注首次原输出缺失/业务失败未由raw审计，本轮另留全新的真实RED/GREEN原始输出。不得伪装成原始记录；没有新证据也不能继续宣称原始RED全部为业务断言已核实。
- 新增反例先RED，再最小GREEN；定向、syntax、对应ESLint/build/diff通过后，仅一次最终完整check，四个VITEST 2/1，不启用live，完整raw保留全部命令/env/stdout/stderr/退出码。原全量首败不覆盖，不连续重跑到绿，不改通信状态模块。检查新增变化后的必要复跑按原合同。
- 假child/pipe/timer及真实child的fixture自身finally都能独立收口。无真实Desktop/Host/官方EXE/网络/模型/Actions/注册表操作，不动历史TEMP/cache和被拒5资源。只显式路径本地提交，完成回传后停写等复审，不自行进入下一单。
