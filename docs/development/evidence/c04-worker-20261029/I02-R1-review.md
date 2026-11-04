# C04-I02-R1 双轴复审

2026-10-30（UTC+8）。固定比较 `bb40ce93322fe70175e4305df9379f92eb13006b...7e4e9b0`；RED a5e707e、GREEN4476f33、证据7e4e9b0。规格I02-R1-task.md。首轮短写、假值清理、SHA字符串先验及早拒body取消问题已修，当前仍不验收。

## Standards

独立审查仍有3项P2，依据代码规范§4/§5/§9：

- scripts/dsh-compat-ci.mjs:188–193：close另用新预算，未遵守已有取消/总截止。close内取消，仍返回可安装路径。
- 同文件156–159/221–222：冻结/非对象异常放弃附加字段。文件实际保留却无partialFile/releaseUnclear，应以保留原因的包装报告。
- test/dsh-compat-ci.test.ts:787–802：实例句柄释放放在断言之后，finally仅恢复原型；断言失败会跳过实例close恢复与释放。必须在finally收尾已捕获句柄。

## Spec

独立审查仍有3项P2：

- 保证3，188行：首次close另开完整timeout且未与已有expired竞争；总截止已过或close期间取消仍成功。open停滞也无界，不能把整次deadline的例外仅列为未测。
- 保证3，162行：请求超时后只吸收拒绝，迟到Response的body无人取消；受控实证bodyCancelled=false。
- 保证4，158行：冻结异常静默丢弃保留报告，违反必须报告partialFile与未核实原因。原始异常或cause应保留，不要求对象引用相等。

两轴分别计数：Standards3项、最高P2；Spec3项、最高P2。元数据、短写与普通假值清理已关闭，不扩大到原生下载/安装。

## Root验证

root定向43/43、语法与代码diff空白检查通过；已核对worker完整日志2573通过/11原有跳过、退出0，未重复全量。旧原始日志不改。

独占mkdtemp根、真实文件句柄与进程内依赖注入复现：close内同步caller.abort后仍success；冻结close错误原样抛出，文件保留但路径/原因字段缺失；头部超时后响应到达，body未取消。补丁已finally恢复，真实句柄已关闭，根按绝对路径及父目录/前缀核实后删除。两轴另以无文件IO的内存注入验证总截止和open停滞。无外网或用户状态写入。

## 收口决定

继续同一任务内 [I02-R2](I02-R2-task.md)。建议把现有函数收敛为“记录结果→有界资源收尾→最终裁决”，避免try提前return和静默附加失败；这是修正当前控制流，不新增公共框架或功能文件。
