# C04-I02 首轮双轴复审

2026-10-30（UTC+8）。固定比较 `dc983f7f3711a113bdb6d62b2777dafbb2e5ee2b...7741cf3`；RED f14d3f4、GREEN c2a2e2f、证据7741cf3。规格为本目录 `I02-task.md`。首轮尚未验收，继续同一任务内返修，不派下一功能单。

## Standards

独立审查未通过，依据代码规范§4/§5/§9，均在 `scripts/dsh-compat-ci.mjs`。

- P1，176行：忽略FileHandle.write的bytesWritten，摘要只校验输入流。root以真实文件句柄注入短写复现：声明22字节、实际落盘1字节，函数仍返回成功。
- P2，182–188行：按failure真值决定是否删除partial；stream.error(null)留下自建文件。清理错误附加亦不能假定原始抛出值可修改。
- P2，161–167/185行：HTTP/长度/EEXIST拒绝时尚未取得reader，响应body无取消路径；reader收口也未releaseLock。root复现错长度拒绝后body未取消。
- P2，122行：SHA-512正则隐式转换，数组装合法字符串仍通过，须先检查字符串类型。

未发现需要独立重构的结构问题；以上反例未被现有测试覆盖。

## Spec

独立审查仍有4项P2，均为原任务保证缺口，无越界扩展：

- 保证2：URL仅验证前缀与版本子串，接受非官方精确安装包名称（.zip/.txt）及非默认HTTPS端口；SHA-512数组也被强转接受。
- 保证3：忽略bytesWritten，受控短写仍返回成功，不能证明完整文件已落盘。
- 保证5：写入未受deadline约束，finally又无界等待reader.cancel。受控20ms截止、100ms观察后两条调用都仍pending，句柄关闭/文件收口未执行。
- 保证4：以异常值真伪判断失败，reader拒绝0时残留自建文件。

两轴分别保留分级：Standards 4项、最高P1；Spec 4项、最高P2。本轮不验收。

## Root验证与适用边界

- 独立定向40/40与语法通过；worker完整check退出0、2570通过/11原有跳过，核对原日志末尾汇总，未重复全量。旧package/packageManager内容与派单基线一致。
- 纯内存验证parser接受非安装包.txt、:8443、数组摘要；错Content-Length拒绝却未取消响应body，root随后自行取消自己创建的body。
- 两个独占mkdtemp根分别验证null读取错误留下partial、真实文件短写返回成功；进程内依赖替换已恢复，文件句柄关闭后按绝对路径与父目录/前缀校验删除本次根。无外网、原生执行或用户状态写入。
- `git diff --check`仅因原始I02-check.txt末尾 `CHECK_EXIT=0 ` 尾空格返回1。原始日志保留，不为通过空白检查重写证据；后续代码diff单独检查。
- 实际官方二进制下载/签名/安装/UI/runner仍无证据，C04未关闭。返修范围见 [I02-R1-task.md](I02-R1-task.md)。
