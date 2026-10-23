# TUI 工作区改造验收

2026-10-23。用户完成界面与能力访谈并明确批准实施，范围以[工作区规格](tui-workspace-spec.md)为准。本轮开发验收完成，无待拍板事项。已验收活动任务及依赖引用删除；长期规格、协议合同和验证证据保留。

发布范围补充：本记录的 2041 项是原开发分支的组合验收，该分支同时包含其他会话的工具接入。用户随后要求只发布自身改动，因此 1.12.0 从已发布 1.11.0 与已验收 macOS 修复重新整理本轮 TUI，未纳入其他工具工作；正式发布版本的独立检查以[1.12.0 发布记录](release-1.12.0.md)为准。

## 已交付行为

| 范围 | 验收结果 |
|---|---|
| 入口与资源导航 | ctx 全局只读看板；local、ssh、tcp 独立工作区。TCP 可选本机 broker 或远程星连接，不改变真实执行身份；再次输入 :tcp 回上次有效目标的星列表。命令补全兼列表筛选，历史返回保留选择、筛选及位置。 |
| 星与列表操作 | 进入星默认成员；1/2/3 切换成员、机器节点、完整发现会话。会话标机器来源；节点 Enter 限定完整机器 ID。增删改、发钥、撤销、日志与详情入口归所属资源列表；详情只读，弹层固定完整目标。 |
| TCP 管理与连接 | 整机删除原子核对全部绑定节点凭证并断开对应连接，保留永久册位、原生会话及其他星。在线远程改名写对端当前星 brokers[].showName，保存与运行采用均确认后才成功；全局默认和其他星保持。星列表可精确起停所属整个 broker。保存连接支持导入、编辑、移除，最后一项写 brokers:[]，配置与运行状态分开。 |
| SSH | 外部 Host 只读；TUI 受管连接可增删改。密码/私钥口令遮蔽，经独立 ASKPASS IPC 传递，只在活动连接内存复用；配置变化、切换、关闭与退出清除。首次身份展示原生完整指纹并明确确认，已知指纹变化拒绝。 |
| 显示与权限 | CC 标识、单张主表、当前资源关键键及 ? 全部帮助、独立筛选行、限宽列、中文原生状态。星页固定角色及核验状态；历史返回重新核验，失败/取消标上次结果，旧身份不能开始写操作。 |
| 扩展与维护 | 通用 controller 不访问配置、网络或原生工具；工作区登记、Context/Provider Adapter 与应用管理接口分层。SSH challenge 经通用 prompt 接线；子进程、IPC、轮询和等待均有 owner。详见[应用接口](core-api.md)、[TCP 合同](tui-workspace-tcp-contract.md)、[SSH 合同](tui-workspace-ssh-contract.md)。 |

界面不代理原生 Claude Code/Codex 等聊天；没有新增自动重发、离线改名队列、旧端降级或远端安装步骤。使用说明见[终端界面](../tui.md)，逐资源与逐模式操作见[完整按键表](tui-workspace-keys.md)。

## 开发与独立复核

- 隔离工作树 `D:/workspace/CC/multichat-tui-workspaces`，分支 `codex/tui-workspaces`，起点 `4239960`；root 唯一 stage/commit。先保存行为 RED，再实施 GREEN，没有放宽权限、精确身份、失败结果或秘密断言。
- 代表性 RED：`463288c`、`41a1851`、`f401696`、`e1dc079`、`176f857`、`ab911ef`、`63b5868`、`2fca164`、`7c23345`、`2204f4f`；最终历史身份回归 `e402b6f`、`37938eb`，进程快照边界 `8dfffc8`。本轮最后生产修正 `f9519f2`。
- TCP 独立审查实际复跑 6 文件 41 项：整机集合版本、热/冷提交、权限、撤权断连隔离、精确改名回执和严格持久化未发现阻断。
- SSH 独立审查发现并修复跳板机身份提示、受管 ID 与外部 Host 别名碰撞，以及取消/退出过早报告子进程已释放。相应 10 文件 66 项通过；实际子进程 close 与有界清理失败分别报告。
- TUI 规格复核实际复跑 8 文件 85 项，发现跨星历史返回仍把旧身份标已核验。补成功、失败、取消与界面标记回归后，相关 6 文件 81 项通过，独立复核 2 文件 18 项通过。没有后端权限绕过；现已在返回时重新读取，核验期间禁写，失败/取消标上次身份并禁写。
- 全量检查暴露既有可执行 ESM 脚本的 Windows CRLF 导入问题，最小修复仅 `.gitattributes` 的 `scripts/*.mjs text eol=lf`，没有脚本业务改动、插件、依赖补丁或 skip；见[换行证据](tui-script-line-endings-validation-20261023.md)。
- 独立工作树起点含另一会话 DSH 功能的 RED stub；通过 `30b8a6d` 合并原仓库已提交 `e928f82` 纳入该会话 GREEN，没有代做 DSH 或复制未提交文件。DSH/OpenCode 两套标准检查 27 项通过。
- 原组合开发分支还复现并修复其他会话桌面测试工装的 CIM 快照竞态；原真实 occupied/clear 断言保持，新增 3 边界及原 suite 共 16 项通过（检查点 `8dfffc8`、`f9519f2`）。该他人工装与对应修复不属于干净 1.12.0 发布范围。原首次失败日志未保留 unknown.error，不追认其唯一原因。

## 最终仓库检查

最终生产代码及工装修复后执行标准 `npm run check`，退出 0：

| 检查 | 结果 |
|---|---|
| ESLint | 通过 |
| 运行时 import 图 | 184 模块、584 边，无循环或边界违规 |
| TypeScript build | 通过 |
| Vitest | 196 文件通过、3 文件原有跳过；2041 项通过、11 项原有跳过、0 失败 |

完整本机输出保留在隔离工作树 `tui-workspace-check-accepted-20261023.log`（Git 忽略日志）。前两轮失败日志保留作诊断，不替代最终结果。没有新增测试跳过或依赖版本变更。

## 真实 Windows 终端

六组 ConPTY 共 16 场全部通过，覆盖真实键盘输入、资源操作、宽窄屏 resize、秘密隐藏、正常退出、Ctrl+C、故障注入及终端恢复。全部 `terminalRestored:true`；故障注入的退出 1 为预期断言，其余退出 0。业务为隔离应用注入，不冒充真实远端网络验证。

以下目录均位于 `C:/Users/YANGSH~1/AppData/Local/Temp/`，含业务 JSONL 与 PTY 原始记录：

用户要求清理后，23 个本轮终端临时目录及 6 份日志已完整归档至 `C:/Users/yangsheng/.codex/artifacts/crosschat/tui-workspaces-20261023/validation-evidence.zip`，同目录 `manifest.json` 记录全部 180 文件的长度与 SHA256；逐文件解压验证通过。归档 SHA256：`ae6035e8d4676595160a8109d1ceb1d82c50dddda04502243bacdb46a2a51531`。下表保留原始证据位置作为档案索引；自动审批拒绝了批量递归删除及单个日志删除（均为 blocked by policy），原临时文件尚未删除。

| 组别 | 场景数 | 完整首轮证据目录 |
|---|---:|---|
| 外壳 | 3 | crosschat-tui-validation-Cp2AT7 |
| 会话 | 3 | crosschat-tui-sessions-validation-s7mkIV |
| 观察资源 | 3 | crosschat-tui-observations-validation-vs7qqk |
| 操作/SSH | 3 | crosschat-tui-operations-ssh-validation-KYO6cu |
| TCP | 3 | crosschat-tui-tcp-validation-M11PoC |
| 跨资源 | 1 | crosschat-tui-final-validation-WPYYyD |

最终历史角色修正后，对受影响 TCP 与跨资源额外复跑 4 场，全部通过并恢复终端；新证据为 `crosschat-tui-tcp-validation-NlBU4s` 和 `crosschat-tui-final-validation-rSXrwM`。其余布局与业务代码未再变化。

## 原生 SSH 与验证边界

- 构建最新代码后执行 `node test/helpers/tui-ssh-native-validation.mjs`：8 项通过。Windows 原生 OpenSSH 实际连接本机已有 WSL sshd 的隔离 loopback 服务，验证完整真实指纹、确认后 known_hosts 落盘、加密私钥口令、刷新复用、受管连接实际参数、切换后重问及已知指纹变化拒绝。自有临时服务和两侧目录已清理；不安装软件、不改系统账户或放宽 StrictModes。
- 密码的分类、遮蔽、真实 ASKPASS IPC、缓存与取消由受控测试证明；本项实际服务器探针采用加密私钥，未证明实际服务器密码认证。Windows 终端证据不替代 macOS/Linux 真实终端。
- 本轮没有恢复生产 SSH/TCP 远端验收、部署或发布，也未在远端安装 Codex。历史[真实远端验收](tui-remote-validation-20261023.md)的范围、限制和清理记录保持原样，不扩大为本轮新能力的生产证明。
- 配置写入核对新鲜文件身份并原子替换，但不声称对不持同一锁的旧 writer 提供绝对跨进程 CAS。SSH 外部配置 Include 等间接文件的变化不属于受管文件版本保证。身份和作用域边界详见各合同。

## 集成与收尾

本轮实现、规范检查、独立复核、隔离真实协议、原生 SSH 和终端验收已完成，活动任务清单删除。集成至原工作区时保留其他会话的 README 未提交修改及 research 文档，不暂存、不覆盖；只集成本轮提交并重新构建。工作区改造不触发 npm 发布或远端部署。
