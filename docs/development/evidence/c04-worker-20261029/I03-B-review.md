# C04-I03 阶段B双轴复审

2026-11-02（UTC+8）。结论：交付未验收，转同单R1。固定比较 `e1dbefda0e3f7785d6088f1cb7afded1390bc06b...87bb68079d2f226b90b08d7b3eab571dbcc68a4c`；RED `4c1e7c9`，实现与文档 `87bb680`。规格为 [I03-B-task.md](I03-B-task.md)，规范为 `docs/development/code-standards.md`。两名独立审查者分别审查 Standards 与 Spec，root核实代码、测试和补充反例；以下行号均对应固定交付87bb680。

## Standards

独立审查2项P2，未另报smell：

1. **文件等待不受总截止约束。** `scripts/dsh-compat-ci.mjs:599/604/607/627` 的 lstat/open/stat 直接await，没有与截止竞争。内存注入令open不落定，timeoutMs=30，160ms后入口仍未返回。违反规范§5的取消和资源收口要求。需有界等待，并为迟到句柄保留owner。
2. **签名子进程未确认释放且父侧引用未收口。** 同文件519–550行的finish只清timer/abort监听；输出超限kill后立即拒绝，未确认close。受控child令kill返回false且不发close：70KiB输出超限及30ms截止均返回错误，但destroy=0、unref=0、stdout/stderr data监听各保留1个，错误没有释放未确认信息。真实child若未退出，会继续持有父事件循环。违反规范§4/§5；应有限收尾，区分close已确认与未确认，并释放父侧引用。

## Spec

独立审查3项P2，未发现范围扩张：

1. **签名期间文件变化仍可通过。** 保证2要求“校验与签名应针对同一……文件，前后文件状态不一致拒绝”。同文件627–632行检查完文件状态，635行才读取签名，之后没有再次核对。实证：签名读取器将自有文件AA同长改写为BB，再返回合法签名，准入仍成功；结果integrity属于AA，实际文件摘要属于BB。需覆盖签名期间的同一文件一致性。
2. **open/元数据读取无界。** 保证4要求“单次截止覆盖文件读取”。同文件599/604/607/627直接await；独立探针timeoutMs=30，150ms后open已进入且准入仍pending，释放gate后才结束。需有界等待并收束迟到句柄。
3. **默认签名适配器提前放弃子进程收口。** 保证4要求本次子进程有owner/finally和明确完成/取消边界。530行取消等待到期、535–536行输出超限均可能未观察到close就finish，既不报告释放未确认，也不释放父侧管道/进程引用。kill调用不能当作close证明。

两轴分别计数：Standards 2项、最高P2；Spec 3项、最高P2。open有界与child收口为两轴共同发现，保留各自依据，不重复计算为新的独立功能。

## root补充复核

另1组P2，依据保证4/5及规范§4/§5：**清理失败信息丢失，close缺少唯一收口状态。** 同文件589–594行closeHandle失败后，652–656行finally再次调用close。用真实自有FileHandle注入close拒绝，观察closeCalls=2。另令readSignature抛出冻结的Error（stage=signature），同时close拒绝：返回保持原Error实例，但cleanupError和cause均未携带清理失败；656行catch直接吞掉不可附加问题。应保留主因及原有cause，同时如实报告close失败/未决；同一close操作用唯一owner保存结果，避免重复启动。此项为root独立反例，不冒充独立两轴原报告。

## 验证与边界

- root独立定向 `npx vitest run test/dsh-compat-ci.test.ts --maxWorkers=2 --minWorkers=1`：63/63、退出0；四个VITEST fork/thread上下限设2/1，移除测试子进程环境中的CROSSCHAT_LIVE。
- root `node --check scripts/dsh-compat-ci.mjs` 与代码范围 `git diff --check` 通过。未无理由重跑已通过的完整检查。
- worker原始 `I03-B-check.txt` 保留：RED 9失败/54通过，完整check 2593通过/11原有跳过、231文件通过/3跳过、FULL_CHECK_EXIT=0。这证明现有用例通过，不能覆盖上述新反例。
- 两轴探针只用内存注入/合成child和独占小TEMP；root使用真实FileHandle加实例级close注入，finally还原函数、等待真实close、核验绝对临时根范围后删除，输出FIXTURE_REMOVED=true。无真实PowerShell/签名/安装/卸载、网络或用户状态写入；没有新增产品文件。
- 已被拒上游读取与历史I02/W05清理未触碰。原未跟踪 `docs/代码消息投递.md` 未动未stage。

## 同单决定

按 [I03-B-R1-task.md](I03-B-R1-task.md)修复以上四组行为缺口，先RED后GREEN，保持只读准入范围。文件与签名组件通过前不进入安装执行；I03整体与C04均未完成。研究中“单一截止覆盖全部读盘/资源已关闭”等过宽表述须按本轮反例订正，旧原始检查日志不改。
