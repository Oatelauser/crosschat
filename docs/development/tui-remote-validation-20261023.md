# TUI真实SSH/TCP远端验收

2026-10-22—23（Asia/Shanghai）。用户先授权、暂停，后明确恢复；恢复前读取[暂停点](tui-remote-validation-checkpoint-20261022.md)。**本轮列明的真实远端检查均通过；远端临时环境和隧道已清除。本机临时测试凭证的删除被自动审批阻断，仍保留在私有目录，见清理一节。** 本轮没有产品代码或现有功能变更，无新增功能待拍板。

## 版本、来源与隔离

- 产品基点`862f9c1`，恢复时HEAD为`f0bc3c9`。本机332个dist文件与原保留包逐一SHA256比对，零差异；src/test/package及锁文件无变化。未因纯live工装/文档修改重跑已通过的全量检查，原1657通过/11既有跳过见[整体开发验收](tui-final-validation-20261022.md)。
- 包版本1.10.0，SHA256 `198a6bbae425bcc7fd36742cd0208ef6411e46d427d48e4722b2996b25d889e4`。远端Linux、Node22.22.0；生产crosschat1.9.0与Claude Code2.1.304保持，**未安装Codex**。
- 连接指定Linux的原22端口；正式TUI的BatchMode读取通过独立loopback临时sshd和公钥完成。原authorized_keys/config不变；限定forced commands将discover/doctor映射至私有当前包的真实CLI，使用真实/root原生来源。未升级生产、调整防火墙或启动原生Claude会话。
- TCP使用当前真实runServe、Linux内挂NodeClient/VirtualSocket和跨机真实WS，真实发现读/root。业务状态使用私有baseDir，两颗随机测试星；工装明确拒绝原生消息投递。测试密钥仅在私有临时配置内，原登录密码未写文件或日志。
- 次日从旧私有runtime复制至全新远端根/state，重核旧基线、包hash、版本及无Codex；没有在已撤销凭证上重放管理写入。旧root及结果保持至最终取证完成。

## 通过的检查

| 检查 | 实际结果与证据边界 |
|---|---|
| 同包15项应用/协议探针（2026-10-22） | SSH检测、当前发现分页穷尽、doctor JSON和预取消；TCP成员/星管权限、完整机器身份、普通DTO不泄密、快照不刷审计、普通成员拒绝管理、跨星拒绝；过期expected撤节点拒绝、正确版本撤节点立即断对应连接且邻星保留；owner精确吊测试管理钥后断连/拒重连；应用预览发一把测试钥并明确秘密回执、精确清理。`live-probes.json`全部15项通过 |
| Linux默认TUI SSH PTY（2026-10-22） | ctx→TCP机器→完整MID只读详情→全星会话→发现范围→读取信息→返回→resize→q；真实默认composition，child/host退出0。远端stty/raw/监听/resize退出前后相同；没有业务adapter或数据响应注入 |
| Windows默认TUI完整只读链（2026-10-23） | 9个记录步骤覆盖ctx配置及指引/检测、SSH发现与来源、逐项doctor/详情、ctx筛选恢复与显式替换、TCP机器完整身份页、全星发现与来源、成员/凭证只读页、140×36→90×28→140×36、q退出。child=0、ConPTY host=0；raw/信号/异常/resize监听回Ink暖机基线，主屏/光标/括号粘贴恢复；已知接入钥和管理钥未出终端 |
| 实际SSH子进程取消（2026-10-23） | 真实spawn后才abort，应用返回cancelled，owned进程close(SIGKILL)并回收。它证明本机SSH子进程已启动及回收，不证明取消前远端命令已经开始 |
| 实际broker停服后的读取（2026-10-23） | 通过限定控制命令正常停止自有broker，实际readStar为unavailable、star=null且带错误；不是用伪响应模拟 |
| 失联页默认组装（2026-10-23） | 真实停服后的新查询进入machines和sessions，保留完整TCP context及unavailable，空会话表仍可按i打开TCP读取信息。controller最终dispose；不扩大成读取中途断线或写后回执丢失 |

Windows主链证明页面和操作路线真实可达；完整MID值、权限与doctor退出码的具体正确性同时参考应用/协议探针，不只依据页面标题。

SSH真实发现为0会话、partial；Codex desktop/cli来源明确unavailable，符合未安装Codex的环境。远端doctor有效JSON、exit0、6通过/5警告/0错误，包含Claude空、Codex缺失、技能不一致及生产常驻版本不一致；没有自动修复。

## 工装修正与独立复核

- 上次Windows第二次失败是工装`:ctx`后等待LIVE-REMOTE，但产品按规格恢复了`/live-linux`，TCP行被隐藏。恢复时先确认旧筛选，再显式替换为LIVE-REMOTE，实际链通过；未改产品或用sleep掩盖状态。
- 恢复复制测试私钥后的Windows ACL曾使OpenSSH拒用；在任何业务测试前收紧私有目录与测试钥权限，随后认证通过。不是产品问题，未修改用户原SSH配置。
- 成功后仅修正summary的firstAttemptEvidence索引，使其指向旧两次失败目录；原始PTY/lifecycle和实际结果未变，summary保留元数据修正说明。一次本机Python默认GBK读取中文工装失败，改为显式UTF8；不涉及产品或测试结果变更。
- 最终取证首次通过交互终端显示长JSON时遭ConPTY换行/重绘，未采信该字符串；改用非PTY SSH原始stdout保存并成功解析。没有因此重跑写操作。
- resume_terminal_audit独立定位工装状态等待并补秘密输出断言，resume_failure_audit审查真实取消/失联工装和新隔离setup；resume_acceptance_review在检查完成后复核代码、summary、lifecycle及范围，未发现阻断这些验收结论的问题。代理均已停写，root唯一提交。

## 清理与生产复核

- 两轮测试broker/临时sshd均已停止，停止回执为正常退出；Unix sockets剩余0；原22端口的本机隧道已关闭。本机owned验收Node/SSH/ConPTY进程扫描为空。
- 保存安全证据后，核对精确/tmp私有根、进程所有权及生产基线，删除`/tmp/crosschat-live-tui-_3ffdd7j`和`/tmp/crosschat-live-tui-f9hl2ty7`。两根均不存在，包含状态、测试凭证、host key和临时授权文件的远端工装已清除。
- 结束及远端删除后均确认原`/root/.ssh/authorized_keys`、`.ssh/config`、`.crosschat/tcp/broker.json`、`node.json`四份文件hash一致；生产仍1.9.0，原常驻PID521514仍活，Codex仍不存在。原文件未用旧副本覆盖还原。
- 本机42份工装/证据及解码PTY输出未检出已知测试钥。尝试删除12份本机私密配置/测试key时，自动审批先后拒绝已核验路径方案和固定LiteralPath方案，均仅返回**blocked by policy**，未提供更具体理由；不再换工具绕过。**本机凭证尚未删除**，两处目录均收紧为当前用户独占ACL；远端对应认证入口及凭证文件已不存在。`local-cleanup.json`记录blocked，`local-secret-scan.json`列精确文件路径。
- 本机清理阻断不是新增产品功能或功能审批事项；需要后续清理时先读上述回执，避免把脱敏证据一起删除。原活动任务队列不重建，已验收任务不重新挂回。

## 环境限制

- 新测试broker公网43205端口4秒内超时，本机经SSH转发的同端口1ms连通；上轮公网45837也未通。**TCP本轮通过的是经SSH隧道的真实WS链，未证明公网直连**，未打开端口或改安全组。
- 真实Claude登记目录当前0文件。因此非空分页、匿名会话行、真实会话详情/收编/删册和原生消息投递没有live验证，不用fixture填充冒充。既有隔离用例仍提供这些行为的开发证据。
- 实际Linux节点只有一台、两颗测试星；多节点并发/混合失败、读取中途断线、写后丢回执及macOS仍依赖已有隔离测试或其他专项验收。15项管理检查是应用/协议层真实写入，不全部视为TUI管理按键端到端通过。

## 证据入口

本机旧目录`C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-live-tui-82ee26d8ed/`保留15探针`live-probes.json`、Linux的`linux-terminal/summary.json`及PTY日志，以及旧两次Windows失败记录。新目录`C:/Users/yangsheng/AppData/Local/Temp/crosschat-live-tui-resume-0e02f667c3/`保留：

- `resume-identity.json`：代码/包字节对应、远端恢复前身份。
- `remote-environment.json`、`transport.json`：新私有服务及拓扑（服务已停，远端目录已删）。
- `windows-terminal/live-terminal-summary.json`、`live-terminal-pty.jsonl`、`live-terminal-lifecycle.jsonl`：成功终端链与退出事实；后两文件也在windows-terminal目录。
- `live-failures.json`：三组取消/失联检查及close/dispose回执。
- `connectivity.json`：公网直连超时与SSH转发连通分别记录。
- `remote-final-evidence.json`：删除前取回两轮安全基线、停止及Linux生命周期原始JSON，包含四文件hash；不包含秘密配置。
- `remote-cleanup.json`：两个远端根已删、生产基线/版本/原进程和无Codex最终复核。
- `local-secret-scan.json`、`local-cleanup.json`：证据秘密扫描和本机凭证清理阻断。私密材料不展示、不提交。

远端原始目录已删除；审查应使用上述本机保存的脱敏证据。保留包和一次性工装均在仓库外，仓库仅提交本记录及相关入口更新。
