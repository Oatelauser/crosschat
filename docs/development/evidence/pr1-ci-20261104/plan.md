# PR #1 普通三平台CI首轮修复

2026-11-04，root独立处理。用户已授权推送并创建草稿PR，实际PR为https://github.com/Oatelauser/crosschat/pull/1，head=f3c71e5，base=874461a；run 41782073105。main合并、发布和DSH专用CI未获授权。本任务只修复普通仓库检查暴露的已有合同问题，不新增用户命令/交互/持久数据，不运行正式原生工具，不安装远端Codex，不派子代理。

三平台首轮全部失败，保留各job的完整raw，不把macOS的continue-on-error当通过：

| 平台 | job | 首败 |
| --- | --- | --- |
| Ubuntu | 126415684145 | Windows研究探针测试漏传platform；诊断取消后原生probe仍被signal0观测到 |
| Windows | 126415683727 | 下载关闭阶段100ms夹具未必已到关闭；OpenCode进程扫描unknown（原断言未输出error，不能追认原因） |
| macOS | 126415684063 | 同一研究探针；npm缓存夹具经过系统tmp symlink；同名提示夹具未看到既有成员 |

顺序：先补有意义的可控诊断POSIX回收RED，复用main已有的有界整组回收owner；研究探针固定注入win32，canonical fixture保持产品link拒绝；同名提示先核实原生/成员准备顺序；关闭阶段以可控门证明到达，再施加取消/超时；unknown扫描先补完整诊断上下文，不直接归因或放宽清理准入。每项保留RED/GREEN或原始平台反例。已有本机WSL只用于普通Node单元/进程夹具复现，无DSH/OpenCode/Codex安装，不作为C00/C12工具矩阵验收。

最终定向及必要完整检查通过后普通推送更新同一草稿PR，核实相应三平台CI；不force、不合main、不改定时/权限、不用skip/重发追绿。历史本地2761/11及首轮平台结果分别保留。

## 本地修复与验证

诊断取消的可控POSIX反例已先RED（d02f1e6），随后复用main已有的整组释放实现（b967103）；核心定向50项通过。研究探针只在测试中明确注入win32，生产仍只支持既定Windows研究范围。npm缓存fixture使用realpath，不放宽产品对链接的拒绝。

两处下载测试改为先确认close/cleanup阶段，再触发原deadline回调及相应时钟进度；真实文件写入、关闭、保留/删除断言保持，没有放大产品超时。成员fixture先发布真实原生存活数据，在只读broker声明可见后再发送或重启，解决ACK与上行sessions之间的竞争；没有增加生产重试或改变adopt/回执语义。

OpenCode首轮unknown仅有state，未记录error，不能追认唯一根因。5064ms耗时与5000ms扫描预算相符，只作为待核实线索。新增超时诊断RED（54b6881），明确区分CIM超时并仍返回unknown；真实用例失败时输出完整inspection，预算仍5000ms，无重试或清理准入放宽。Windows四文件定向164项通过。

WSL Node22.14只用于普通开发复现。首次副本放在node_modules下面导致Vite将部分被测模块外部化，mock失效，产生29个失败；另有PowerShell/WSL参数转递使shell包装退出2，Vitest自己的失败计数仍保留，不把这些当产品结论。移到独立D:/workspace/CC/cc-pr1-linux-20261104后，先暴露两个真实fixture前提问题及一次ACK传播竞争，原始输出分别保留；修正前提和只读就绪等待后，7文件199通过/3个既有平台跳过。没有新增永久skip，未安装原生工具或远端Codex。

最终Windows npm run check退出0：2763通过/11原有跳过、235文件通过/3跳过、204模块689边，lint/build通过；raw见windows-check.txt。Linux定向GREEN见linux-targeted-green.txt；各名称带final但曾失败的文件仍按实际结果保留，不追认为通过。此阶段尚待更新同一PR后的托管复核，未关闭C05/C11专用工具CI或C04正式生命周期。

## 托管复核41786206149与CIM阶段核对

8c41149的普通CI复核中，Ubuntu/macOS均2758通过、16个既有条件跳过；Windows为2762通过、1失败、11跳过，唯一失败已明确为CIM超过5000ms。三份followup raw保留；本次可确认超时，不能把此新证据倒填成首轮唯一原因证明。

检查隔离环境allowlist已排除继承的PSModulePath。本机同一隔离profile交替执行全属性/指定属性四次，均返回416行及相同长度JSON、无超时，耗时938/749/722/759ms；不能由这组本机数据推断托管速度或根因。初次基准脚本的相对import多写一层，启动前失败，没有执行查询；修正后才得到上述实测。

按[Get-CimInstance官方Property说明](https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance?view=powershell-5.1#-property)，明确只请求ProcessId/ExecutablePath/ParentProcessId，仍枚举全表并保留原Select投影，不改变字段与清理身份核对。stderr仅加入started/query-complete/output-complete三个阶段；超时仍unknown、原始JSON未消费，错误携带有界阶段上下文或“PowerShell未产出阶段信息”。预算保持5000ms，无重试。超时丢阶段信息先RED（40a69ae），17项定向及helper ESLint通过。

本次只有验收工装查询/诊断变化，完整新版检查交由同一PR的自动普通CI复核；先前本机2763/11按8c41149快照保留，不追认新版结果。没有运行专用DSH CI或改变普通三平台矩阵。
