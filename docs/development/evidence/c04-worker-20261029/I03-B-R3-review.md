# C04-I03 阶段B R3双轴复审

2026-11-02（UTC+8）。固定比较 `f38458fd5385a04706b283d696f66bdbf324c345...c6b178212e515c647d41dbb993a3a6c8de14c82d`，唯一交付c6b1782；规格I03-B-R3-task.md及原B同一文件保证。fixture owner与同指纹内容复核已修，但最终路径核对没有覆盖新增读取阶段，暂不验收。

## Standards

独立审查0项未决发现，无另报smell。lateOpen同步登记每个已启动open的完成promise，在swap前保存真实close；相关finally先settle释放gate、等待登记、恢复并await真实close，再还原注入和删根。新增反例覆盖产品先返回、句柄后到达，收尾后stat报EBADF，不依赖GC。签名后的第二遍摘要从显式偏移0开始并复用bounded读取、大小限制、取消和唯一close。

## Spec

独立审查1项P2：`scripts/dsh-compat-ci.mjs:764–769` 最后一次路径/句柄状态核对早于776行的新增二次摘要读取；该读取期间路径被替换后，旧句柄仍可算出正确摘要，返回路径却指向另一文件。违反R3第1项保留的路径/句柄一致性及原B保证2，发生于本次核验内部，不是未来执行窗口。

确定性实证：内存副本只重绑open，在第二遍首次显式position=0的read前，把真实原文件AA重命名到自有retired路径，wx在原path写入BB，再从旧句柄真实读取。结果admitted=true、swapped=true，当前path内容BB的摘要与返回integrity不同。需让最终路径/句柄核对覆盖二次摘要之后，并加读取期间替换反例。

两轴分别计数：Standards 0；Spec 1项、最高P2。已闭合的fixture/同指纹内容反例不重开。

## root验证与边界

- root独立定向76/76、退出0，无GC错误；四个VITEST fork/thread上下限2/1、CROSSCHAT_LIVE未启用。syntax与代码diff检查通过。
- worker原始I03-B-R3-check.txt：业务RED 2失败/74通过，GREEN 76通过；一次完整check退出1，11失败/2595通过/11跳过，7文件失败。首败caller-source-service的SOURCE_STATE_BUSY；其余文件为conversation-handle-ring、conversation-state-concurrency、conversation-summary、conversations、tool-type-observations、tool-type-routing-state。失败文件本轮零diff；保留未绿记录，不用前轮锁探针把所有失败认定为同因。没有重复全量或扩大通信白名单。
- 独立路径替换探针仅用自有TEMP/真实小文件/内存注入，finally清理本次资源；无真实PowerShell/证书/官方EXE/安装/卸载/网络或用户状态。被拒5个URL、I02/W05历史保留及用户原未跟踪文档均未触碰。

## 同单补充

按I03-B-R3-task.md末节，仅将最终路径/句柄状态核对覆盖到新增摘要读取之后并加确定性反例。保持只读和观察结果的边界，不声称文件核验是原子锁或未来执行授权。原始日志保留；I03整体与C04均未完成，不进入安装执行或下一任务。
