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
