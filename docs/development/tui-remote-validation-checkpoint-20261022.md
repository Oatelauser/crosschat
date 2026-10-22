# SSH/TCP真实远端验收暂停点

2026-10-22（UTC+8）。**用户明确要求暂停，等待下次恢复；本项未完成验收。** 当前产品`862f9c1`，整体隔离验收文档提交`9be4061`。本次没有产品代码修改，仅仓库外临时工装和进度文档。

## 授权与边界

- 用户授权指定Linux服务器的真实SSH/TCP验收，正常流程、不赶时间，现有功能变化先确认。**禁止安装Codex**；远端使用现有Claude Code。登录密码不写文件、日志或仓库，恢复时沿用会话授权。
- 保持生产crosschat1.9.0和现有服务；本轮将当前构建1.10.0装在私有临时目录，不全局升级，不改原SSH授权、配置或防火墙。
- 真实默认SSH应用要求BatchMode公钥认证。为不修改原authorized_keys，建立独立loopback临时sshd，只有自有测试key及限定forced commands；经原22端口密码SSH的隧道访问。固定discover/doctor命令映射至临时包真实只读CLI，保持真实/root原生来源。
- TCP是当前真实runServe、Linux内挂NodeClient/VirtualSocket及跨机真实WS；独立baseDir、两颗随机测试星，显式拒绝原生消息投递。没有发送、启动、收编或删除真实原生会话。

## 已验证事实

- 远端Linux内核6.8.0-55、Node22.22.0、Claude Code2.1.304、生产crosschat1.9.0；无Codex。真实`/root/.claude/sessions`当前0文件，不伪造非空会话或匿名条目。
- 当前包SHA256：`198a6bbae425bcc7fd36742cd0208ef6411e46d427d48e4722b2996b25d889e4`，私有安装成功。
- `live-probes.json`的15项真实检查通过：SSH检测/穷尽当前一页发现/结构化doctor/预取消；TCP成员和星管本星边界、完整LinuxMID、只读DTO不泄密、快照不刷审计；普通成员管理拒绝；过期expected删除拒绝并保持连接；新版本精确撤节点即时断连；邻星保留；本机owner精确吊测试管理钥后断连及拒重连；主管理员仍活；应用预览发一把测试钥匙、明确秘密回执、随后精确撤销清理。
- SSH发现为0会话、partial，明确Codex desktop/cli来源不可用。doctor有效结构、exit0、6通过/5警告/0错误；警告包括Claude空、Codex缺失、技能不一致和生产常驻版本不一致。未安装或自动修复。
- Linux原生SSH PTY中的真实默认TUI浏览及resize/正常退出通过；远端`stty -g`、raw状态、监听与resize计数在退出前后完全一致。不注入业务adapter、发现数据或假响应。
- 临时TCP公网高端口45837从本机4秒内未连通。因此当前跨机TCP证明经SSH隧道，不是公网直连通过；没有更改防火墙或安全组。

## 尚未完成

- Windows真实默认TUI完整只读主链未通过。首次工装误用跨列表/详情的共同notice，Esc未确认返回就发Enter；改成完整屏幕帧判定后，第二次已通过SSH发现与doctor段，停在返回ctx等待LIVE-REMOTE。恢复时先核对ctx保留的旧筛选及工装期待，不先判定产品有问题，不用盲等sleep掩盖。
- `live-failures.mjs`已写好/nodecheck，仅用于真实SSH子进程取消回收、停止自有broker后不可达及默认composition的TCP空页i指引；**尚未执行**。暂停收尾中的stop不算这些验收通过。
- 真实Claude会话详情、匿名行、册位操作和消息投递未测试；当前没有真实会话可供验证。不安装Codex，不以fixture替代这些真实场景。
- Windows端最终验收、失联/取消检查、最终报告与完整临时目录/密钥清理仍待恢复；本暂停点不宣布任务完成。

## 暂停收尾（已执行）

- 所有子代理已停写，无活跃本机验收Node/SSH进程；原22端口的隧道已关闭。
- 临时TCP PID616934经SIGTERM正常退出，停止回执code0；临时sshd PID616933已停止；测试状态目录Unix sockets剩余0。
- 原`/root/.ssh/authorized_keys`、`.ssh/config`、`.crosschat/tcp/broker.json`、`node.json`四文件hash与启动前一致。原常驻PID521514仍在；生产版本仍1.9.0；Codex仍不存在。
- 私有临时目录、工装、证据和惰性测试配置保留供续接，未写入仓库。原登录密码不在这些文件内。暂停期间不会自动启动服务或重跑测试。

## 续接入口

- 本机目录：`C:/Users/YANGSH~1/AppData/Local/Temp/crosschat-live-tui-82ee26d8ed/`。
- 远端目录：`/tmp/crosschat-live-tui-_3ffdd7j/`（私有目录，服务已停）。原临时sshd51395、隧道SSH61594、broker45837均只是本次旧端口，下次须重新核实可用性。
- 入口/环境：`transport.json`、`remote-environment.json`；包`oatelauser-crosschat-1.10.0.tgz`；工装`remote-setup.py`、`remote-dispatch.py`、`remote-tcp.mjs`、`remote-tui.mjs`、`live-probes.mjs`、`live-terminal.mjs`、`linux-terminal.mjs`、`live-failures.mjs`。
- 已通过证据：`live-probes.json`、`linux-terminal/summary.json`与`linux-ssh-pty.jsonl`。Windows未通过证据：`windows-terminal/`、`windows-terminal-final/`。首次probe仅工装取错manifest层级，修正后通过；失败记录另存`live-probes-bootstrap-failure.json`。
- 远端停止证据：保留目录内`tcp-stopped.json`、`pause-state.json`、`baseline.json`。私有连接材料与测试key仅在私有临时目录，不能展示或提交。

用户明确恢复后：先核对当前代码/包hash和原服务状态，再准备新的独立测试state或明确核验可复用环境。`remote-tcp.mjs`拒绝已有state；已撤销的测试凭证也不能当成未执行状态再次跑整套写探针。保留已通过证据，不盲重发写入；新环境端口映射保持本地TCP端口与远端一致，避免发钥回执端口校验受翻译影响。先完成Windows工装及剩余只读失联/取消检查，再做最终清理和报告；不在暂停中继续实施。
