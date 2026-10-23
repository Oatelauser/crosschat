# 1.12.0 发布记录

2026-10-23。用户明确授权发布新版本，只提交自身修改，并清理任务垃圾和临时文件。本版版本号 `1.12.0`，沿用 GitHub Release → Windows/Node 24 全量检查 → npm Trusted Publisher/OIDC 的现有发布流程。

## 来源与边界

- 已发布 npm 1.11.0 的 `gitHead` 为 `06eb77b40e4832897d8bae7c6d885dce434fb476`。以其后已验收 macOS 修复分支 `56b4b02` 为基线，保留 1.11.0 版本记录、4 文件发布可移植性修复、POSIX 自有进程组回收及短 Unix socket 修复。
- 独立工作树 `D:/workspace/CC/multichat-release-1.12.0`，分支 `codex/release-1.12.0`。从本轮 26 个自有 TUI 提交归集 94 个路径，只应用 `4239960..c923a85` 在这些路径的差异，三方应用无冲突；随后仅修改本版号、发布文档及测试夹具。
- 没有合入原工作区同期 OpenCode、DSH、Claude 兼容性工作。原开发分支的桌面工装竞态修复依赖其他会话组件，也未纳入。README 来自干净的已发布基线，不暂存或打包用户未提交内容。
- 独立范围复核确认新增源码/测试未夹带上述第三工具或兼容性代码，`package.files` 没有新增 integrations/dsh。依赖版本保持，package 与 lock 中仅更新本项目版本。
- 源提交、文件清单及原始差异保存在仓库外 `C:/Users/yangsheng/.codex/artifacts/crosschat/release-1.12.0/source-manifest.json` 与 `tui-only.patch`。原开发分支的 2041 项是组合开发证据，本版以以下独立检查为准。

## 功能与检查

完整变更见[CHANGELOG](../../CHANGELOG.md)，使用说明见[终端界面](../tui.md)，资源与操作见[完整按键表](tui-workspace-keys.md)。新增独立工作区、星三视图与列表动作、整机原子移除、按星远程改名、TCP 配置管理和 SSH 受管连接/临时认证/指纹确认，均来自用户已批准规格。

标准 `npm run check` 退出 0：

| 检查 | 结果 |
|---|---|
| ESLint / TypeScript | 通过 |
| runtime import 图 | 174 模块、544 边，无循环或边界违规 |
| Vitest | 168 文件通过、3 文件原有跳过；1761 项通过、11 项原有跳过、0 失败 |
| npm pack --dry-run --json | 360 文件，681159 字节；所需 CLI、TUI、SSH helper、命名协议产物齐全，无第三工具代码、日志、测试目录、依赖目录或私有配置 |

首次完整检查遇到既有维护边界夹具的 15 秒超时：虚拟目录重复返回同一真实文件，约 50000 次元数据/句柄访问在并发下耗时过长。该测试及产品实现与 1.11.0 基线无差异；单独原夹具 5 项通过耗时 2552ms。只把拥挤目录条目改成内存 stat/open/fstat/close，其他真实权限、链接和硬链接场景保持；增强为准确 10001 次枚举、10000 次 open/close、0 遗留句柄和一次目录关闭，5 项 184ms。产品逻辑、15 秒预算、跳过规则保持；随后全量通过。

本机日志在上述仓库外 release 目录的 `check.log`（首次失败）、`check-final.log`（最终通过）和 `pack.json`。终端与原生 SSH 独立证据另行保留，不以单元测试代替生产远端验证。本版没有连接生产 Linux 或安装 Codex。

正式发布工作树的最新构建另复跑六组 Windows ConPTY，共 16 场全部通过并恢复终端，故障注入退出码符合预期；本机原生 OpenSSH → 临时 loopback sshd 的 8 项探针全部通过。自有 SSH 服务及其已核验 Windows/WSL 认证根由既有探针 finally 收口，六组终端原始证据及 native 结果日志归档到仓库外 release 目录，不冒充生产远端或跨平台终端验收。

终端归档 `terminal-evidence.zip` 为 146955 字节，SHA256 `4be77e524715032843a425ab3609f6cd860276e43a7fc16d0deec4a8d6c48a8f`，58 项逐项校验长度/SHA256/CRC 通过；原始 57 文件保留，映射与摘要在同目录的 terminal-evidence-manifest.json、terminal-validation-summary.json、terminal-evidence-validation.json 和 native-ssh-validation.json。

首次线上 CI `39919295732` 的 Windows/Ubuntu 全量通过，macOS 仅新 TCP 配置夹具 7 项失败，均因读取不到目标而非业务断言差异。安全读明确拒绝任意链接祖先；夹具原先直接使用 macOS 经过系统链接的临时路径，现只把已创建测试 home 用 realpath 转为真实路径，产品链接拒绝规则及原 7 项断言保持。完整失败日志保存在仓库外 macos-ci-first.log；修正后重新执行同一全量检查。

## 清理与证据保留

- 本轮开发的 23 个终端临时目录与 6 份日志，共 180 文件、5866867 原始字节，已完整压缩至 `C:/Users/yangsheng/.codex/artifacts/crosschat/tui-workspaces-20261023/validation-evidence.zip`，归档 560758 字节。
- 同目录 `manifest.json` 逐文件记录绝对原路径、ZIP entry、长度及 SHA256。逐文件解压校验与归档后源文件二次校验通过，无重解析链接，档案位于待删树外。
- ZIP SHA256 为 `ae6035e8d4676595160a8109d1ceb1d82c50dddda04502243bacdb46a2a51531`，manifest SHA256 为 `657bb9e3c0b5886feb1efb0be526dc01e198b1c6e97cb829bc69eb420cccff73`。
- 自动审批拒绝了已校验范围的批量递归删除，以及单个明确日志路径的删除，均只返回 `blocked by policy`。没有更换工具绕过限制；这些原临时文件及闲置工作树保留，不能记为清理完成。已验收活动任务条目在此前开发验收时删除，长期规格、审批和证据保留。
- 原工作区其他会话的 README、研究稿、代码和兼容性测试均未纳入清理或本版新增提交。

发布结果以 [GitHub v1.12.0](https://github.com/Oatelauser/crosschat/releases/tag/v1.12.0)、相应自动发布运行及 npm 的版本/完整性回执为准，执行回执另存仓库外 release 证据目录。
