# 1.13.0 发布记录

2026-10-27。用户明确要求“只提交你修改的代码 + 发布新版本”。本版使用既有 GitHub Release → Windows/Node 24 完整检查 → npm Trusted Publisher/OIDC 流程。

## 来源与范围

- 最新公开版本为 1.12.0，npm gitHead 与 `origin/main` 均为 `6c23c2da765a3fc7ba768c2877e6d4b5055ba8e3`。原开发分支仍为 1.10.0，且包含其他聊天未发布的工具适配，不能整体合入。
- 原工作区精确提交为 `ce0737b`：本聊天的源码、测试、批准设计与验收文档。README 仅取入星/恢复/改名相关块，TUI 续接记录仅取本聊天两条验收记录；其他聊天改动保留未暂存。
- 独立工作树 `D:/workspace/CC/multichat-release-1.13.0`，分支 `codex/release-1.13.0`，从上述 main 基线移入该提交为 `34e2486`。三处冲突保留本聊天选择/声明规则和 main 的 macOS 短 socket 路径及 joiner finally 清理；POSIX 进程组回收等主线修复保持。
- 本次没有合入 OpenCode、DSH、Claude 兼容性或其他聊天的工具适配、研究与清理工作。原生验收工装所需的 profile/command/loopback mock 函数单独归集到 `native-claude-fixture.mjs`，不依赖未发布的兼容性工装；函数与已验收实现按 AST 核对一致。
- package 与 lock 仅改本项目版本到 1.13.0，依赖版本及 `package.files` 保持。原工作区 83 个原始工作文件逐一 SHA256 核对未变，其他聊天内容仍留原处。

## 功能与升级

完整变更见 [CHANGELOG](../../CHANGELOG.md)。本版修复同目录并发匿名 Claude 归属、入星诊断和 `--rm`，统一启动器首条输入及 `/resume` 选择入星，支持 TUI 精确成员管理和 Codex CLI 原生改名。

原生工具、桌面/Web 统一由 TUI 选择入星，不自动把裸 `/resume` 识别为在线声明；永久册位仍保留。Codex CLI 改名核对同一服务、profile、owner 及已加载会话，协议基线 0.163.0。Claude 活窗口改名同步尚未核实，Desktop 协同端点无改名入口，TUI 禁用并说明原因，不能把仅改持久标题当作实时成功。

Node.js 仍要求 >=22。升级相关 broker/node 后重启常驻服务；本轮成员选择/管理要求相关端使用新版，不增加旧端降级。无需在仅运行 Claude 的远端安装 Codex。

## 独立发布检查

本发布工作树重新执行 `npm ci` 和 `npm run check`，退出 0：

| 检查 | 结果 |
|---|---|
| ESLint / TypeScript | 通过 |
| runtime import 图 | 184 模块、571 边，无循环或边界违规 |
| Vitest | 176 文件通过、3 文件原有跳过；1814 项通过、11 项原有跳过、0 失败 |
| 补齐的原生工装 | 三文件语法、ESLint、相对依赖与抽取函数 AST 核对通过 |
| 已构建 CLI | `--version` 返回 1.13.0 |
| npm pack | 380 文件，709861 字节；新会话/原生操作入口齐全，无其他工具适配、test、node_modules、日志或私有配置 |

打包证据保存在 `C:/Users/yangsheng/.codex/artifacts/crosschat/release-1.13.0/pack.json`；本机 tgz SHA256 为 `f7fc9ad32f06414ac49a32b2d1c462bf00d4080f63f3f20c93d17d38bdb3a7a9`。原开发分支的 2137 项是组合开发证据，不能代替本发布工作树的 1814 项。

发布复核发现新增测试 label 在目录和 socket 文件名重复，使最长路径超过 macOS/Linux Unix socket 预算。仅将成员启动/聚合器测试的目录前缀缩为 `base-` / `nd-`，聚合器及 TCP 操作测试使用 macOS canonical `/tmp` 短根并增加路径上限断言，不改变产品 IPC 路径；修正后的三组共 81 项目标测试另行通过，跨平台结果由线上 CI 核实。

真实受控原生会话与终端证据见[选择/成员验收](session-selection-membership-validation-20261026.md)、[原生改名验收](native-rename-validation-20261027.md)。本轮移植没有重新调用用户原生聊天、生产 SSH/TCP 或安装远端 Codex。安全与项目目录权限按用户决定排除，其他工具适配仍归已交接聊天。

正式发布结果以 [GitHub v1.13.0](https://github.com/Oatelauser/crosschat/releases/tag/v1.13.0)、相应 Actions 发布运行及 npm 版本/完整性回执为准；执行回执保存在上述仓库外证据目录。
