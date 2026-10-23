# OpenCode Desktop 开发验证记录

2026-10-23。Windows x64 官方 Desktop 2.1.3 的默认本机服务接入与功能验证已通过；最终真实桌面探针 11/11，全仓检查 1782 项通过。官方应用已卸载且无测试进程。外层下载/测试目录删除被自动审批拒绝，完整 CI 串行安装循环及 GitHub Actions 实跑尚未完成，不能将本批称为全部交付事项已关闭。

## 授权、交付与边界

用户在 CLI 清理后指示“开始下一个”，本批按既定顺序实施桌面正式包，继续使用本地脚本模型、完成后卸载清理、由用户自行重装验证。用户追加的 Claude Code、Codex CLI/桌面维护 CI，以及工具 × Linux/Windows/macOS 的覆盖和组合成本讨论，已独立记入[后续任务](tool-compatibility-ci-tasks.md)，本批没有安装这些工具或扩大平台范围。

- 桌面复用现有 `opencode` Provider、公开 HTTP 服务、完整原生会话 ID、原生 shell 身份及 conversation ref，无需新增桌面插件、读取数据库或依赖私有 IPC。产品改动限原生操作指引和未运行提示，明确 CLI 启动器与原生桌面的使用方式。
- [安装与使用指南](../opencode-desktop.md)覆盖用户从零安装、配置自己的模型、技能安装、发现、精确投递和原生 shell 双向回信。技能只改仓库源文件，未部署到个人技能目录。
- 工装使用未修改的正式安装包及其捆绑 runtime，模型端为同机 loopback HTTP/SSE 固定响应和可控工具调用，无真实模型 key。不能据此判断模型智能、云登录或个人权限设置。
- GUI 操作为真实 Home 会话行的 DOM 点击、原生事件处理与画面读取。没有写私有路由状态，也没有测试鼠标命中、遮罩或完整人工交互。预置官方“已完成首次引导”设置，首次引导不计入验收。
- 仅默认本机 sidecar；桌面另加的 HTTP/WSL/SSH server、凭据轮换、服务端口变化、数据库损坏和其他系统桌面未验收。未恢复真实 SSH/TCP 远端测试。

## 实际验证

| 验证 | 结果 | 证据与含义 |
| --- | --- | --- |
| Windows 正式桌面探针 | 11/11，整体 passed | [最终报告](evidence/opencode-desktop-20261023/desktop-probe.json)。最终 GUI 正常退出，服务 stop 退出 0，owned run 无进程且已删除，未使用强制关闭。 |
| 全仓检查 | 1782 通过、11 既有跳过；163 文件通过、3 跳过 | [检查记录](evidence/opencode-desktop-20261023/repository-check.json)及[完整日志](evidence/opencode-desktop-20261023/repository-check.log)。ESLint、TypeScript build、运行时依赖图均通过；169 模块/539 边，无循环或越界。本机 Node v25.0.0，工作流配置 Node 22，后者尚未实跑。 |
| 桌面隔离、健康检查与日志失败路径 | 13/13 | 真实受控 HTTP 验证鉴权/路由/schema 变化分类、readiness 与响应体中断；真实 Windows 文件锁和大日志验证读取失败不阻断清理、只读取尾部至多 64KiB；实际进程验证目录清理前的归属检查。 |
| 本轮回复与错误报告 | 9/9 | 真实本地模型请求验证最后一条 user 对应独有 ACK；旧回复、user 引用、tool 输出不能替代本轮 assistant 文本，transcript 和当前 UI 必须同时成立。 |
| CI 编排与报告 | 桌面 13/13；与 CLI 联跑 20/20 | 官方清单/签名、独立报告位置、进程退出与报告一致性、未知释放状态停止卸载/重装、基线和候选分类、真实 workflow 报告 JS 的去重入口校验。GitHub/fs 在报告测试中受控，没有实际创建 issue。 |
| scripts/helpers 与 workflow | 通过 | 新增 JS 另跑 ESLint/语法检查；workflow 实际 YAML 解析通过。常规 npm test 不下载或启动正式软件。 |

11 项实测覆盖：正式桌面启动；GUI/native/CDP 进程、端口与摘要归属；真实 Home 选择已有会话；脚本模型与原生 shell；认证发现与分页；闲时来信及独有模型回复；真实 shell 身份与完整 conversation ref 双向回信；busy queue/steer 的执行边界；服务更替后原 GUI/原会话继续收件；桌面重开恢复原生路由与会话；目标不存在时不创建替代会话。[重开后的实际画面](evidence/opencode-desktop-20261023/ui/desktop-reopened.png)已检查，可见服务重启与桌面重开两轮不同 ACK。

原始报告中的绝对路径保留当次执行位置；最终 UI JSON/PNG 副本归档在同级 `ui/`，不依赖临时目录继续存在。

## 发现并修正的问题

- 首次完整探针在桌面重开时，Windows 尚未释放旧 CDP 端口；保留[失败证据](evidence/opencode-desktop-20261023/reopen-cdp-port-red.json)，每次 GUI 生命周期分配新调试端口，原生服务端口不变。
- 独立审查发现旧报告可误用、探针超时后仍卸载/重装、startup 协议错误被归为基础设施、日志读取异常提前中断 teardown、历史 ACK 可满足新轮断言。均先执行失败测试并保存 RED，再修正。
- 加强 ACK 后真实复验 11 个功能项通过，但正常退出超过原 1.5 秒预算；[该失败](evidence/opencode-desktop-20261023/graceful-close-budget-red.json)保留。外层预算与既有 CDP 命令不一致，改为回调 12 秒、随后等待主进程 3 秒；超限仍精确强制停止并判失败。最终完整重跑正常收口，不放宽通过标准。
- UIA/WPF 备用路径仅做过自有窗口研究。正式包 CDP 可用后移除未使用工装，保留[研究与证据](../research/opencode-desktop-windows-uia-20261023.md)，不维护两套 GUI 控制路线。

RED 检查点：`80c7489` 隔离、`009e945` 首启种子、`1c7b468` 中性原生指引、`86c4713` CI、`56200e6` owned process、`66ad38c` CDP 端口、`5a6a27a` stale/teardown/report、`e044d88` startup/log/ACK、`911132e` 响应体中断及真实关闭失败。此前 CLI 已完成的证据不代替本批桌面证据。

## CI 实现与尚未验证的范围

[工作流](../../.github/workflows/opencode-compat.yml)新增独立 Windows 桌面 job，固定良好桌面清单，对最新官方同类构建做基线/候选串行安装和实际 GUI 探针；候选失败时重装同一构建复现。下载大小、SHA-256 与 Authenticode 发布组织均核对；不固定证书指纹，以允许正常证书轮换。

每轮报告和 UI 使用新目录；超时、信号、退出码与报告矛盾、缺报告或缺完整运行时释放证明均归基础设施，并保留现场、停止后续卸载/重装。确定协议失败且清理完整，才可参与兼容回归判断。只有基线成功、候选两次同一兼容失败才进入去重 issue；探针 job 仅 contents read，issues write 留在不执行上游软件的报告 job。不会自动升级支持基线。

本机实际验证了官方安装、GUI 和官方卸载，但**未执行 CI 主程序的整套串行安装/卸载循环**：它包含本机已被拒绝的协议/目录清理动作，未将该脚本用作绕过。GitHub 工作流未推送或运行，实际 issue 创建、GitHub Windows GUI 环境与 Node 22 仍待工作流实跑；不以逻辑测试宣称这些已通过。

## 安装归属与清理状态

[安装记录](evidence/opencode-desktop-20261023/installation.json)固定 Desktop 2.1.3 源码 `37d973754ba6cc31732f93421c0c18b675841573`、官方不可变 URL、250321424 字节与 SHA-256 `18ed79327878bd373a65e9ce96020439bd7618661a11d62046aeab53422f6912`。签名有效，发布组织为 Anomaly Innovations。app.asar 最终摘要与安装时相同，发布包未改动。CLI 同版本的构建源码与桌面分开记录。

本次复验后官方卸载器退出 0，应用与卸载器文件、安装/卸载 key 已消失；无 owned 进程，默认个人 OpenCode config/state/share 目录仍不存在。[清理记录](evidence/opencode-desktop-20261023/cleanup.json)与[最终归属收据](evidence/opencode-desktop-20261023/final-owner-receipt.json)保留。

尚未关闭的清理事项见[准确残留与手动清理](opencode-desktop-cleanup-20261023.md)。自动审批分别拒绝协议 key、四个 UIA 临时目录及外层下载目录删除，原因均仅为 `blocked by policy`，未提供进一步说明；没有换执行方式绕过。用户外部 PowerShell 已报告协议 key 不存在，但工具视图仍存在且只指向本次已卸载路径，原因尚不能确认。用户侧不存在的项无需重复删除；不据此宣称工具视图的全部残留已清空。
