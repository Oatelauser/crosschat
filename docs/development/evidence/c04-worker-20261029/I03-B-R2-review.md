# C04-I03 阶段B R2双轴复审

2026-11-02（UTC+8）。固定比较 `23584f753a967daea24199ce4fcbc9408143d5ab...915ba9f9a33287d1f722d90db3170c81b83c6dc4`，唯一交付915ba9f。规格为I03-B-R2-task.md及原阶段B/R1保证。结论：R2两个签名child/错误传递缺口已闭合；实际首败揭示文件一致性和fixture收尾仍不可靠，准入组件未验收。以下行号对应915ba9f。

## Standards

独立审查1组P2测试资源收尾缺口，无另报smell。`test/dsh-compat-ci.test.ts:659–668` 的lateOpen只提供release，没有实际open落定/句柄登记完成的promise；1037–1040、1065–1068行finally仅清空当时的cleanup数组。产品允许open未决时先返回，真实句柄可能在fixture finally之后才到达并登记，因此漏关。违反规范§5/§9及本单fixture独立收口要求。

动态门控验证使用真实自有句柄：产品已返回，fixture finally时cleanup数为0；随后open实际到达，cleanup数变1，真实FileHandle仍打开。机制与首GREEN迟到close断言失败及FileHandle GC错误一致；没有把GC错误出现时Vitest所列的最近测试名称当作创建句柄的归属证明。需fixture等待本次实际已启动open/登记落定，finally恢复并await真实close后再删根，不改I02产品的未决返回合同。

## Spec

独立审查1项P2：原R1第1组文件一致性尚未闭合。`scripts/dsh-compat-ci.mjs:578–581/764–769` 仅比较数值状态指纹；同长内容变化时Windows可给出完全相同指纹。违反原保证“签名读取器同长改写……后返回合法签名必须拒绝”，发生于本次核验内部，不是未来执行窗口的新研究。

动态反例仅用真实文件、真实准入入口及readSignature中的writeFile：每次先写25字节原内容，签名读取器确实同长改为C并返回合法签名；前27次拒绝，第28次准入成功，实际SHA-512不等于返回integrity。该次签名前后dev/ino/nlink/size/mtimeMs/ctimeMs/birthtimeMs全部相等，其中mtimeMs=ctimeMs=1793592277320.6255。说明首GREEN fulfilled不是注入未生效，不能靠增加sleep或重跑消除。需签名后内容核对独立于指纹唯一性，并用相同指纹、不同真实内容的确定性反例验收。

两轴分别计数：Standards 1组P2；Spec 1项P2。两轴均确认R2原两项child error统一有限收口和截止分支错误传递已修正，无新增范围扩张。

## root验证与证据口径

- root独立定向74/74，退出0，未出现GC错误；四个VITEST fork/thread上下限2/1，测试环境未启用CROSSCHAT_LIVE。syntax和代码范围diff检查通过。
- worker原始I03-B-R2-check.txt：RED 4失败/70通过，RED_EXIT=1；首次GREEN实际2失败/72通过，另1个FileHandle GC错误，GREEN_EXIT=1；后续重跑74/74，GREEN_RERUN_EXIT=0。不能把后续结果写成首GREEN通过。
- 首次GREEN两条失败分别为I02的late close failure用例未取得partialFile，以及I03的签名期间改写用例意外成功。旧I02产品本轮未改；本轮允许修fixture自己的收尾，不能借机重开下载产品。
- worker一次完整check退出1：13失败/2591通过/11原有跳过，8文件失败。首败c14-conversation-refinement，其余包括c14-explicit-send、caller-source-service、conversation-handle-ring、conversation-state-concurrency、conversations、send-command、send-handle。全量失败文件本轮零diff；前轮探针只证明独立锁路径存在失败，尚不能据此断言本次13条逐条同因，不做全量通过或逐条归责结论。不扩准入worker白名单到通信产品。
- 两轴探针使用独占TEMP及内存注入；真实句柄均由探针外层finally实际close，根核验归属后删除。无真实PowerShell/用户证书/官方EXE/原生安装卸载/网络。历史被拒读取和I02/W05保留未触碰，用户原未跟踪文档未动未stage。

## 同单决定

前轮将文件一致性判为已修正不充分，此处按反例订正。按 [I03-B-R3-task.md](I03-B-R3-task.md)仅补签名后内容复核和fixture迟到资源的独立收口；已闭合的签名child行为不重开。新日志保留原始首败，研究/review-input订正“R1时序敏感”等尚未证实的归责。I03整体与C04均未完成，不进入安装/卸载执行或下一任务。
