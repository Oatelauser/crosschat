# win↔WSL ssh 联通性测试报告（联邦前置）

日期：2026-10-07 · 环境：Windows 11（sshd @22）+ WSL2 Ubuntu-22.04（**镜像网络模式**，与 Windows 共享 192.168.1.2；crosschat 1.3.0 无 --via；sshd 原未装，测试中装于 2222）

## 两腿结果

| 腿 | 结果 | 证据 |
|---|---|---|
| win→WSL 连通 | ✅ | `ssh wsl crosschat --version` → 1.3.0（密钥认证通） |
| win→WSL 全链探针 | ✅ | `send --via ssh:wsl --to nonexistent99` → `NAME_NOT_FOUND: [via wsl] …` + 远端可用名清单回显，**0.51s** |
| WSL→win 连通 | ✅ | `ssh yangsheng@localhost crosschat --version` → 1.3.2（镜像回环可达） |

## 真机发现（四条）

1. **镜像网络模式 22 端口共享冲突**：Windows sshd 占 22，WSL sshd 只能走 2222；`--via` 值不带端口，**靠 `~/.ssh/config` 别名携带 Port 2222 解决——实证 D1 设计**（连接细节归 ssh config，crosschat 零自有配置层的正确性）。
2. **版本偏斜真实验证**：WSL 1.3.0 首次探针报 `USAGE: [via wsl] unknown option: --origin`（0.47s 透传回）——正是设计预判的偏斜场景（008 决策点 13），错误透传链路顺便实证。临时换装本地构建后全链通过（已还原 1.3.0）。
3. **WSL 默认用户是 root**：反向 ssh 必须显式 `yangsheng@`，否则以 root 连 Windows 被拒——B3 部署文档素材。
4. 双腿时延亚秒级，无感。

## 清理勾对

WSL 侧私钥副本已删 ✅ · authorized_keys 还原 ✅ · 双端 known_hosts 本次条目已清 ✅ · Windows ssh config 临时别名还原 ✅ · 换装 tgz 删 ✅ · WSL crosschat 还原 1.3.0 自证 ✅ · `git status` 0 变更 ✅ · WSL sshd 留运行（2222，WSL 空闲自回收）

## 给 B3 的输入

双向全链闭环（含 --origin 消费）需两端都升到联邦版本——届时 Win↔WSL 即现成的跨机联调矩阵第一条腿（部署清单补：镜像网络 WSL 用非 22 端口 + ssh config 别名、WSL 反向显式用户名）。
