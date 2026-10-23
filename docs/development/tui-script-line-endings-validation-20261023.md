# TUI 隔离工作树脚本导入检查

2026-10-23。本轮 TUI 全量检查发现两个既有 suite 无法导入 `scripts/dsh-compat-ci.mjs` 与 `scripts/opencode-desktop-compat-ci.mjs`，报 `SyntaxError: Invalid or unexpected token`。原生 Node 语法检查和动态 import 均通过。

## 确定原因

当前锁文件与实际依赖一致：Vite 7.3.6、vite-node 3.2.4、Vitest 3.2.7。工作树启用 `core.autocrlf=true`，这两个脚本由 Git 中的 LF 检出为 CRLF。

Vite SSR 的 `hashbangRE = /^#!.*\n/` 中 `.` 不匹配 CR，所以 CRLF hashbang 未被计入首行偏移，导出辅助代码被插到 hashbang 前面。vite-node 仅当转换结果以 `#` 开头时移除 hashbang；此时 hashbang 已在第二行，VM 因而拒绝解析。

同一 Vite server 的内存差分复现，不修改脚本或依赖：

```text
输入 LF:    #!/usr/bin/env node\nexport const value = 42;\n
转换开头:   #!/usr/bin/env node\n__vite_ssr_exportName__(...);
VM:         parse-ok

输入 CRLF:  #!/usr/bin/env node\r\nexport const value = 42;\r\n
转换开头:   __vite_ssr_exportName__(...);\n#!/usr/bin/env node\r\n
VM:         Invalid or unexpected token

无 hashbang 的 CRLF 对照: parse-ok
```

这排除了脚本业务、脚本依赖和 node_modules junction。最小差分使用实际 `server.ssrTransform` 输出，再按 vite-node 当前逻辑移除首行 hashbang 并交给 Node VM，命中与真实 suite 相同的失效路径。

## 最小修复与结果

- 新增 `.gitattributes`：`scripts/*.mjs text eol=lf`，使后续检出保留可执行 ESM 脚本的 LF。
- 仅将两个失败脚本在当前隔离工作树中的 CRLF 字节转为 LF：DSH 292 行、OpenCode Desktop 319 行。转换前后除 CRLF→LF 外的内容完全一致，没有修改脚本业务。
- 标准仓库命令 `npm test -- test/opencode-desktop-ci.test.ts`：13 项通过，退出 0。未加入临时 Vite 插件、依赖补丁或 skip。
- 原 DSH 基线 `4239960` 是独立 cache 功能的 RED 检查点：移除导入阻断后，14 项中 13 通过、1 项因 `resolveDshNpmCache` 的既有 stub 失败。该业务由原会话完成，root 负责纳入其已提交 GREEN；本修复未代做该功能，也不把此结果记作 TUI 回归。

仅改隔离工作树；原工作区与其他会话工作未改动。最终全量结果以 root 合并已完成基线后的统一验收为准。

## 合并后标准复验

root 保存换行修复 `2c9c959` 并合并独立 DSH GREEN `e928f82` 后，以 `30b8a6d` 为本轮复验基点：

- `npm test -- test/dsh-compat-ci.test.ts test/opencode-desktop-ci.test.ts`：2 个文件、27 项全部通过，退出 0。原 DSH stub 失败随其独立已完成实现消除；未使用内存转换插件或 skip。
- `npm run build`：退出 0。随后使用该次最新构建执行 `node test/helpers/tui-ssh-native-validation.mjs`：8 项实际 Windows OpenSSH → 本机已有 WSL sshd 检查全部通过，含受管连接标识与实际目标参数、活动连接凭据归属和子进程生命周期。
- 原生探针仅启动自有 loopback 临时 sshd，最终自有 SSH 服务停止、Windows 与 WSL 已验证临时根全部移除。未安装软件、未访问生产远端；此项范围不扩展为 macOS/Linux 真实终端或真实密码服务端认证证明。
