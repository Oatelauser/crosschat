# 联邦 B1/B2 localhost 真机验证报告

日期：2026-10-07 · 环境：Windows 11 本机 · sshd（OpenSSH Server）+ 本机 ed25519 密钥 + Machine PATH 含 npm 全局目录 · 全局 crosschat 临时换装本地构建（含 B6/B7），验证后还原 1.3.2

## 首验三项

| 项 | 结果 | 证据 |
|---|---|---|
| a PATH | ✅ | `ssh -o BatchMode=yes localhost crosschat --version` → 1.3.2 |
| b 引号 | ✅ | 空格/中文 `--to` 值被白名单拒绝且文案正确（"请改用 id8 或 --conversation"）；安全字符集值经 ssh 抵达远端解析无损 |
| c stdin | ✅ | 三行中英混排（含引号/逗号/&）纯 stdin 投递，rollout 逐字完整 |

## 全链路（codex 线程为靶机）

| 项 | 结果 |
|---|---|
| 本地构建 usage 含 `--via` | ✅（已还原 1.3.2 并自证） |
| mc2_ ref 实测 | ✅ 83 字符，rollout 前缀正确 |
| turn 1→2→3 接续（B15 经 ssh） | ✅ 递增，ref 仅轮次字节变 |
| 信封 reply-hint 同机无 `--via` | ✅（正确预期：m 相等） |
| 同码错误透传 | ✅ NAME_NOT_FOUND 带 `[via localhost]` 且回显远端可用名清单 |
| SSH_TRANSPORT_FAILED 快速失败 | ✅ **1.6 秒**（BatchMode 生效，未挂 120s） |
| `--json` 透传 via 字段（真机） | ⚠️ 未覆盖（被发现①阻塞；mock 已覆盖），跨机联调补 |

## 真机发现（两条）

1. **Windows AF_UNIX 跨登录会话隔离**：codex daemon control socket 为 AF_UNIX，sshd 每个连接是新登录会话 → sshd 会话内的 codex 投递报 `os error 10061`（连接拒绝），对交互会话里的 daemon 不可达。**部署含义：win 作为收件腿时 codex 侧是 v1 已知约束——linux/mac 接收端无此问题（AF_UNIX 无会话隔离）。B3 部署文档必须写明。**
2. 验证中途 daemon 进程死亡（陈旧 socket 残留）暴露：`codex exec` 不依赖 daemon 故此前无感；按 README 自纠指引 `daemon start` 恢复——自纠闭环有效。

## 实测 vs 设计差异

无代码级差异。`--body -` 不支持（`-` 为字面量）系验证方命令构造错误，非工具问题。

## 清理勾对

验证线程已删（status 零残留）✅ · 全局还原 1.3.2 ✅ · cc-elevate 脚本/日志、cc-fedverify 目录已删 ✅ · `git status` 空 ✅ · 系统侧（sshd/密钥/Machine PATH）未动，待用户定夺保留或还原
