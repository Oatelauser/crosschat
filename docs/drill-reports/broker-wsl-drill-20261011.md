# 票B（tcp 转发器）drill a 实测报告——win broker + WSL 节点双机全链路

日期：2026-10-11 · 执行：主会话（用户授权"本机和 wsl 的验收直接真机测试"） · 形态一（两机，服务端放 win）

## 环境

- win：Windows 11，仓库工作树构建（B1→B3.1 全批次含修复，`dist/`），broker 前后台均可
- WSL：同机 WSL2（**镜像网络模式**，实测 `127.0.0.1` 双向可达、LAN IP 反而不通），node v22.14.0，`node /mnt/d/.../dist/cli.js` 直跑同一构建；codex daemon 0.160.0（beta6 测试线程，opt/test-crosschat）

## 实录腿与结果

| # | 腿 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | broker 启动+自登记 | ✅ | `serve --detach` → `--list` 即显 `self yang ec542c2c`，零管理员动作 |
| 2 | `--gen-key 1` 分发 | ✅ | 完整 node.json 打印（IP 核对声明+回滚缓冲提示）；**IP 声明当场应验**：自动探测 192.168.1.3 在 WSL 侧不通、人工核对后改 `127.0.0.1` 才对 |
| 3 | WSL 节点 `--connect` 上线 | ✅ | 注册表 `node-1 wsl-leg 4a0277c8`；WSL 侧 status 实时拉 roster 显示两机 |
| 4 | win→WSL 跨机投递 | ✅ | `delivered to beta6@4a0277c8 (turn 1)`；rollout 验尸：正文在+**reply-hint 盖 `--via tcp:ec542c2c`**（回程戳=win mid8） |
| 5 | 文件通道跨机 | ✅ | WSL inbox 收 `8aa6b8ef-drill-a-file.txt`（sha8 前缀+安全化名），内容逐字对 |
| 6 | WSL→win 反向投递（claude 管道） | ✅ | 发到本机 claude 会话"二期4"，消息真实注入会话上下文 |
| 7 | 节点离线拒绝 | ✅ | 杀 WSL 节点→win 发送即 `PEER_OFFLINE` exit=1，教学"对端离线，稍后重试；若两端另配了 ssh 也可走 ssh 形态" |
| 8 | 断线自愈 | ✅ | broker 停→节点 1s 退避重试（日志 ECONNREFUSED×1）→broker 起→**2 秒内自动回网** |
| 9 | broker 重启期 --stop 安全性 | ✅ | 命令行匹配但未持端口的 3 个进程正确跳过，仅杀端口持有者 |
| 10 | **跨机 agent 自主对话闭环** | ✅ | beta6（WSL codex）对 win 侧消息**自主回复**：回信经 tcp 抵达 win 的 claude 会话（本轮亲历），其信封 reply-hint 正确指 `--via tcp:4a0277c8`——win 发→WSL agent 醒→经 tcp 回→win 收，零人工全闭环 |

## 现场抓获并已修复（B3.1，285f9c2 后追加提交）

1. **--file 回执解析炸（bug1）**：`--json` 模式回执被中文注记污染，tcp 桥 `JSON.parse` 必炸——注记改仅进人类可读输出；复测 `delivered to beta6@4a0277c8 (turn 5)` exit=0
2. **远端来件署名错标（bug2）**：环境残留身份压过 `--origin`，from-name 落成本机会话名（"二期4"发给自己）——origin 在场即权威（ssh 接收腿同享修正）；复测信封 `from-name="human"` ✅
3. **--stop 误杀宿主（bug3，已修复 B3.2）**：裸 `--stop`（默认停双角色）按命令行匹配 node 进程，把命令行含 `serve --connect` 的 wsl.exe 宿主连带击杀（WSL 会话陪葬）；修复=可执行名+脚本路径+旗标三重校验（matchServeProcesses 纯函数化）；活体复测：broker 停止、宿主存活 ✅。语义注记：WSL 内的节点进程 Windows 侧 --stop 不可见（"未发现"=正确），由 WSL 内自管

## 其他记录

- WSL 一次性 `wsl -e bash -c '… &'` 的后台进程不存活（会话退出即清）——常驻节点须由 Windows 侧常驻任务以前台方式持有（`wsl -e bash -c "exec node …"`），已入 broker.md 经验注记候选
- Git Bash 传 `/mnt/...` 参数给 wsl.exe 会被 MSYS 路径转换改写——路径必须包在 `bash -c` 字符串内
- 形态二（云端堡垒+ssh 隧道包裹）**待用户确认后另行 drill**（broker.md 已留占位章）

## 结论

形态一双机全链路（投递/回信戳/文件/离线拒绝/自愈/安全停止）真机验证通过；三只真虫全部为 drill 独有发现（封闭测试未覆盖的跨进程/跨系统边界），印证"验收必须真机"的既定纪律。
