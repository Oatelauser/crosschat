# C04-I02-R3 双轴复审与定向补充

2026-11-02（UTC+8）。固定比较 `2548c08f5ef66f89d478f50ec5760bb9d5fcb796...6af60f2774df7ba187f84949ab8e1a36cc2988d8`。worker提交54a6796、3c15675、6e4d77a、9b72442、6af60f2；ffe7440仅为root停止边界文档，不归worker。规格继续为I02/R1/R2及[I02-R3-task.md](I02-R3-task.md)。

## Standards

独立审查1项P2：`scripts/dsh-compat-ci.mjs:240–248/274–281`的迟到句柄存在两个删除owner。ownHandle已关闭并成功删除本次文件，主收尾仍因failed且created再次rm同一路径，违反代码规范§5及只清本次wx文件的边界。

确定性探针以模块内存副本重绑open/rm、真实独占TEMP文件验证：正常迟到关闭时rmCalls=2，文件已不存在却报告partialFile与ENOENT；首次删除后由另一attempt以wx创建替换内容时，第二次删除会删掉替换文件。两个自有根均在finally核对父目录和名称前缀后删除，未改共享产品。没有另报smell。

## Spec

独立审查1项P2：同文件262行只在responseOwnerStarted为false时记录返回时保守报告，遗漏“迟到响应已到、cancel仍未落定”。ownResponse另起完整timeoutMs，其结果可能晚于公共收尾预算才落定；函数会返回无undecidedResources的普通超时，违反R3第二组的未核实资源报告要求。

纯内存探针：timeoutMs=100，fetch在150ms返回真实ReadableStream，cancel门控挂起；Spec审查219ms返回、root独立211ms返回，二者错误字段均为空，cancelStarted=true、body.locked=true，undecidedResources缺失。释放gate后locked=false；无外网、文件或子进程残留。

两轴分别计数：Standards 1项、最高P2；Spec 1项、最高P2。cleanup期间取消/总截止的原第一组已闭合；I02尚未验收。

## Root检查

- 独立定向51/51通过；node --check及产品/测试diff空白检查通过。
- 核对worker I02-R3-check.txt：完整npm run check退出0，2581通过/11原有跳过，231文件通过/3跳过，lint、203模块/682边及build通过；没有重复全量。
- 工作树仅原未跟踪docs/代码消息投递.md；不动不stage。旧任务、原始日志及失败证据保留。

## 本轮同单补充范围

不是下一功能任务，仅闭合上述两条现有保证：

1. 迟到句柄的close/remove由一个owner承担。主收尾只能消费真实结果，不得再次删除已释放路径；成功清理不虚报partialFile/ENOENT，清理失败或未落定仍如实保留路径和原因。新增反例同时验证只删一次，以及第一次删除后wx创建的另一attempt文件字节不变。未核实close的文件不得强删。
2. 分开记录“响应未到”“响应已到但cancel未落定”“cancel已落定”。公共预算耗尽返回时，所有仍未决资源都有立即可读的保守报告；不能把owner已经启动等同于资源已释放。新增gate反例覆盖response在transfer截止后、cleanup返回前到达且cancel挂起；冻结或假值错误仍沿既有cause包装带报告，late reader仍finally releaseLock。

保持既有最终取消裁决、有限共享收尾预算、wx边界、精确元数据/短写/Web回归，不扩框架/接口/功能文件/依赖/用户步骤，不做真实网络或原生执行。不要扩展到其它未证实竞态。

worker白名单仍是scripts/dsh-compat-ci.mjs、test/dsh-compat-ci.test.ts、I02-review-input.md；可新增I02-R3-supplement-check.txt，其余历史日志/root记录不改。先业务RED再最小GREEN，注入与真实句柄finally恢复、独占根清理；定向/语法/lint/build/代码diff后一次完整check（forks/threads max2/min1），首败原样保留。显式路径本地提交，不push/amend/切分支/回退共享文件。起止核对HEAD/branch/dirty，root在本次派单前仅提交这份复审及两份活动记录。

按最新typed hint和约定仓库node dist/cli.js send、stdin、显式steer回报。完成停写等复审；验收与资源收尾完成后root和worker都等待用户，不派下一功能任务，不关闭C04父项。
