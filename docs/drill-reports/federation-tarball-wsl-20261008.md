# npm 发布物干净安装 + sshd PATH 联测报告（1B'）

日期：2026-10-08 · 环境：WSL2 Ubuntu-22.04（Node v22.14.0，前缀 /opt/node；registry=npmmirror）· 目的：v1.3.4 发版前消除"发布物从未被干净装过"风险（真机腿 1A/1C 未排期）

## 结果

| 项 | 结果 | 证据 |
|---|---|---|
| registry 安装 | ✅ | `npm i -g @oatelauser/crosschat@1.3.3` 9s，装于 /opt/node/lib/node_modules |
| tarball 清单完整 | ✅ | dist/ skills/ README.md CHANGELOG.md LICENSE package.json 齐全 |
| ssh 收件腿全链 | ✅ | 修复 PATH 后 `send --via ssh:self --to nonexistent99` → `NAME_NOT_FOUND: [via self] …可用名清单`，0.727s |
| 错误三层码透传（真机） | ✅ 顺带 | 修复前远端 127 → `REMOTE_FAILED: [via self] 远端异常退出(127): … command not found`，0.8s 捕获带回 |

## 发现（两条实锤）

1. **PATH 坑（真机部署首障，预判 #2 实证）**：Node 装在非标准前缀（/opt/node、nvm 同理）时，npm 全局 bin 不在 sshd 非交互 shell 默认 PATH（实测 `/usr/local/sbin:/usr/local/bin:…:/snap/bin`）→ 收件腿 command not found。此前 win↔WSL 演练通，是 `/usr/local/bin` 手工软链**恰好**落在 sshd PATH 里掩盖了它。修复（已验证）：`ln -s "$(npm prefix -g)/bin/crosschat" /usr/local/bin/crosschat`（npm 10 已删 `npm bin -g`，用 `npm prefix -g`）。**建议 docs/federation.md 部署手册补此条**（待拍板是否随 1.3.4）。
2. **WSL 互操作掩盖本地 which**：删除软链后本地 `which crosschat` 命中 Windows 侧 `/mnt/c/.../npm/crosschat` interop shim（仍报 1.3.3，具欺骗性）；纯 Linux 服务器无此层，直接 command not found，反而更诚实。

## 未覆盖（留真机腿 1A/1C）

成功回执下 `--json` 透传 `via` 字段的真机用例（需对端活会话；当前仅 mock 覆盖）。

## 清理勾对

npm 链接注册还原（npm i -g /mnt/d 仓库）✅ · /usr/local/bin 软链还原 → dist/cli.js ✅ · `which`/`readlink`/`--version` 自证 1.3.3 ✅ · win 侧零改动 ✅
