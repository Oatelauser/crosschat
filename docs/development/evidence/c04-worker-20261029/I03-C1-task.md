# C04-I03-C1：Desktop 受控进程执行组件

用户在阶段B收口、状态说明后再次明确“开始下一个任务”。本单推进I03安装/卸载执行层的必要进程基础，不启动真实安装，不把阶段B的准入结果当执行授权。执行者Claude cworker1；root负责范围与双轴复审。无需保留旧聊天上下文。

## 续接与基线

- 仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`。root准备本单时HEAD为 `c5e5f227b654005a380f819dc340be3374fe13f7`；开工基线以派单消息给出的完整SHA为准，该基线包含本任务书和调度记录。
- 开工和结束核对真实branch/HEAD/dirty。用户原未跟踪 `docs/代码消息投递.md` 不动、不stage。共享无关提交核对祖先及白名单后继续；本单白名单有外来改动则停写向root报告，不回退共享文件。
- 最小读取：AGENTS.md、`docs/development/code-standards.md`、本任务书、`I03-B-review-closure.md`、研究文档 `docs/research/c04-windows-installer-contract-20261102.md` 的四/五节，以及现有进程、报告、fixture代码。按需读repo crosschat skill；不要求重载历轮返修聊天。
- 阶段B代码两轴0项未决，root77/77；最后全量17失败/2590通过/11跳过仍未解决，不冒称整仓通过。会话状态/通信线归Bug修复2，由用户对接，本单不修改其代码或测试，不逐条断言历史失败同因。

## 结果与白名单

在现有 `scripts/dsh-compat-ci.mjs` 增加一个Desktop专用、小型可直接调用的受控进程入口，例如 `runDshDesktopProcess(binary, args, options)`。它只返回直接子进程的执行及释放观测，供未来安装/卸载操作消费。实现前在交付说明记录简短接口与结果字段约定，按下面行为直接实施，无需为常规内部命名重复询问。

仅可改：

- `scripts/dsh-compat-ci.mjs`
- `test/dsh-compat-ci.test.ts`
- 本目录 `I03-review-input.md`（追加本单接口、证据和未测边界）
- 可新增本目录 `I03-C1-check.txt`（完整原始输出）

任务书、队列及root复审记录由root维护，worker不改。不新增功能文件、依赖、用户命令/参数、持久记录或配置步骤。不要把其它职责硬塞入既有模块以规避文件决定；如现有模块确实无法合理承担该小组件，先提交具体拆分必要性与影响，不自行扩白名单。

## 行为合同

1. **隔离旧路径。** 不改变现有 `runDshProcess`、Web默认main、workflow/reporter、I01报告/串行合同、I02下载器、阶段B准入/签名适配器。新入口本单不接入main/installer/uninstaller；不新造通用进程框架、杀树工具或第二套资源管理框架。未来调用方需另行核实实际安装参数、执行字节、目的地、既有安装和卸载前Host退出，本组件不替它证明。
2. **明确执行输入。** binary为绝对路径字符串，args为字符串数组，拒绝NUL和非法类型；timeoutMs为有限正整数且在Node定时器有效范围内，预先取消在spawn前拒绝/返回取消且零spawn。cwd如提供须为绝对路径。参数不拼接成shell代码；固定 `shell:false`、`windowsHide:true`、stdin ignore和有界stdout/stderr。允许一个小型spawn注入用于受控测试；不新增只为测试存在的状态开关/回调。
3. **退出事实。** 返回至少区分code、signal、pid、stdout/stderr、timedOut、cancelled、truncated、closed，以及启动/运行/收尾失败的实际原因。只有本次child的 `close` 事件令closed为true；`exit`、kill返回true、destroy/unref、超时返回均不构成close证明。code非零/信号退出如实报告，不伪造code0。取消/截止/超限/错误一旦成立，即使之后close(0)也不返回正常成功。这里closed只表示直接子进程关闭，不证明子孙进程或Host自然退出，更不等于安装成功/回滚/卸载完成。
4. **单一执行截止与输出上限。** timeoutMs覆盖spawn尝试至最终执行裁决，不因输出/exit重开。外部signal在正常裁决前保持有效，注册时复查已取消以覆盖竞态。stdout/stderr按实际字节共享明确的固定输出预算（可沿128000字节量级）；超限记录truncated并停止正常执行，不能无标记截尾。缓冲总量有界；只采集预算内字节，不先累积整块巨大内容再裁切，不将超限结果当完整JSON/报告。正常code0+无信号也须未取消、未超时、未截断、无运行失败且closed才能被解释为正常进程完成。
5. **错误、取消和有限收口。** spawn同步抛错保留原因；拿到child后发生error、pipe error、取消、超限或截止，都进入唯一有限收尾路径，只向本次自有child请求停止，不触及宿主其它进程。第一次主因保留（包括假值或冻结错误），后续kill/pipe/收尾问题可观察但不顶替它。运行deadline不重新开始；从首次失败起另给固定1s总close等待预算，后续error/abort不重开。及时close记录closed；预算耗尽记录closed:false与releaseUnclear/未决原因，destroy父侧管道、unref子引用、移除data与abort监听、清timer，保留最小迟到close/error owner避免未处理异常。kill失败不提前当已退出，也不自动重试非幂等安装。返回后迟到close不修改已返回快照或恢复成功。
6. **唯一owner与清理。** 正常、失败、断言失败都有明确timer/listener/pipe/child owner；产品返回未确认时fixture独立负责释放受控fake gate并等待真实自有child关闭。不得靠测试进程退出/GC代替收尾，不扫描或结束用户进程，不把pid数值当跨进程身份认证。

## 必须用行为反例验证

- 正常受控Node子进程的stdout/stderr、code及closed；非零和signal退出保持事实。
- 非法输入与预先取消零spawn。
- exit已发但close未发不会完成正常成功；最终只凭close确认。
- 活动期间取消、超时、输出超限后close(0)仍为相应失败；两路输出合计预算和字节上限准确，truncated可见。
- child error/pipe error但无close进入有限收口；kill抛错或返回false仍等待并报告未确认；后续error不顶替先前超限/取消主因、不重开等待。
- error后及时close和无close分别有正确释放结论；返回后迟到close/error无未处理异常，返回快照不变。
- 总执行deadline不能由连续输出/exit推迟。预先取消、error/取消/close的关键顺序尽量用显式gate或受控事件验证，不以边缘sleep/重复跑到绿替代。
- 原77条回归和Web旧进程/报告路径仍通过。仅少量真实自有Node子进程；其余用小型注入child/pipe精确驱动事件。fixture不伪造close来替产品作退出证明，真实child由fixture在finally等待实际close。

先业务RED再最小GREEN；不存在导出时可用明显不可工作的临时占位保证失败是行为断言，交付前删除。不要为了补数量写镜像实现的测试，不设机械覆盖率门槛。

## 检查、提交与回传

定向 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`，`node --check scripts/dsh-compat-ci.mjs`，对应ESLint、build、代码diff检查；变更稳定后只做一次完整 `npm run check`。四个 `VITEST_MAX_FORKS/VITEST_MIN_FORKS/VITEST_MAX_THREADS/VITEST_MIN_THREADS` 设2/1/2/1，`CROSSCHAT_LIVE`不启用。完整保留命令/env、stdout/stderr、真实退出码与首败到raw，不能只写人工摘要。全量若失败如实归类白名单内外，不连跑全量到绿、不修改通信线、不放宽断言或加skip；有本单失败则修后按新变更进行必要检查。

仅显式路径本地checkpoint/commit，不push/amend/切分支/fetch/pull/reset/clean/stash、不全仓stage、不回退共享文件作归因。RED测试、GREEN实现和证据可独立commit。本轮由worker唯一写产品白名单，root不并发编辑它们。

不得下载/执行真实官方EXE，安装/卸载/启停Desktop/Host/daemon，写注册表/协议/用户配置/证书/真实skill，调用模型、真实业务试发或触发Actions。跨会话派单/交付通信是已授权协调行为。I03-task.md列的5个被拒上游URL不重试/换机制/委托绕行；历史TEMP/cache和旧证据不清理。仅清理本单独占fixture，删除前确认绝对路径与归属、child/句柄已释放；受阻如实保留。

交付用仓库 `node dist/cli.js send`、stdin、显式 `--tool`，保留本轮程序typed hint的conversation/tool；本次root要求显式 `--delivery steer`。不用Claude内部ListAgents/SendMessage判断Codex可达性，queued/parked/unconfirmed不盲重发、不轮询。报告真实起止SHA/branch/dirty、接口与保证→反例、首次RED/GREEN/全量退出码、首败和未测、临时资源收尾。完成停写等root双轴复审，不启动安装/卸载接线或下一单，不关闭I03/C04。
