# 原生会话改名验证

2026-10-27。续接[已批准设计](session-selection-membership-design-20261026.md)。此前完成了通用操作接口，却没有把三家原生改名接入并验证就宣布收尾，这个结论过早；本记录补充实际能力与限制。入星、临时成员及恢复选择的既有验证仍见[基础验收](session-selection-membership-validation-20261026.md)。

## 实际结果

| 来源 | TUI 原生改名 | 证据与限制 |
|---|---|---|
| Codex CLI | 已接入 | 已加载会话、同一原生服务及 profile、当前 owner 可核实时开放。已有 0.163.0 通过真实 TUI、原生窗口、星册和按新名称寻址验证；生产适配以该协议版本为最低基线，旧服务或身份未知时禁用并重新核验，不自动升级。 |
| Claude Code | 禁用，待核实 | 官方 SDK 0.3.310 的 `renameSession` 成功改变持久标题，但 Claude 2.1.310 活窗口与通信登记仍是旧名，继续输入后也未同步。不能把持久标题成功冒充实时改名成功。回原生 `/rename` 操作，登记更新后沿现有机制跟随。 |
| Codex Desktop | 当前协同端点不支持 | 只读核对已安装 26.1021.3705.0。桌面内部有 `setThreadName` / `updateThreadTitle`，后者另行广播窗口标题；对外 owner/follower 协同协议没有改名入口。不能调用另一个 CLI daemon 修改存储来冒充同一桌面 owner 和窗口同步。使用原生 GUI 改名。 |

三者都使用原生会话名称，不设星内别名。未知工具或来源按各项实际能力禁用，查看、入星、删除星籍各自判断；未获得可靠写入口不妨碍其他成员管理操作。

## 产品实现

- `createNativeOperationProviders` 集中组合工具适配器；通用 TUI 没有新增工具名称分支。默认 node 真实接线使用该组合，隔离接缝仍允许注入其他 Provider。
- Codex 客户端保留 initialize 返回的版本/profile，增加不读正文的 `readThreadMetadata` 和原生 `renameThread`，只发送 `thread/name/set`。发现明确区分 CLI/Desktop，不能跨端点套用能力。
- 确认 revision 绑定当前 daemon 的 PID、启动标识和二进制身份；身份文件仅有界只读。真正写入前，重新核对同 profile、原生完整 ID、loaded 状态、当前名称及 owner；切换来源后旧确认无效。
- contextKey 支持有界异步读取，写后用提交前保存的 context 对比，避免把两次实时查询的当前值互相比对。native setter 明确拒绝或发送前目标失效返回 rejected；发出后丢回执返回 uncertain，刷新不自动重发。
- 写后重新发现名称并核对 owner，node 更新声明，broker 核对在线声明、权威星册和持久化，之后才确认完成。匿名改名输入框留空，不把“匿名”展示文字作为原生名称提交。
- 来源断开、原生身份缺失或旧版服务时只禁用改名；恢复后只读重核，不启动、安装、升级或修复原生服务。

## 原生与终端证据

所有目标均由本轮隔离夹具创建，模型使用 loopback，不访问用户原生聊天或生产远端。

Codex 最终证据根：`C:\Users\yangsheng\AppData\Local\Temp\crosschat-codex-selection-OrOv8i`。

- `test/helpers/codex-selection-native-validation.mjs --rename` 使用现有 0.163.0、独立 profile、实际 owned app-server、真实 ConPTY。
- `codex-rename-native-fixture.mjs` 连接相同 native owner，调用产品客户端、默认 Provider 组合、发现、TCP 应用操作与实际 broker/node。owned WS 入口和 owner 身份由夹具注入；未用生产 daemon 或直接修改其 PID 文件。
- TUI 使用默认资源组合，按 `:stars → 成员 → a 可发现会话 → e 原生改名`，输入 `CROSSCHAT_NATIVE_RENAME_A` 并确认。原生 ID 保持 `01a17c00-5414-7fb0-a50b-a06a911a5d53`，node/broker 声明及持久册位更新。
- 按新名称通过实际 broker 路由，再通过同一原生服务 `turn/start` 投递到该 ID；返回 delivered。原生 `/resume` 选择器显示新名称，A→B→A 与取消选择仍通过，严格五个选择事件。
- TUI 100×28 ↔ 48×16 resize、正常退出均通过；raw mode、信号和 resize listener 回到预热基线。`evidence.json`、`all-evidence.json`、两份 PTY 记录及 `tui-evidence.json` 保留；finally 关闭 PTY、node、broker、WS 与模型服务。

Claude 证据根：`C:\Users\yangsheng\AppData\Local\Temp\crosschat-claude-rename-Qz5rvJ`。

- 临时下载官方 SDK 到独立目录，不改项目依赖、不全局安装；使用现有 Claude 2.1.310、独立 profile 和真实 ConPTY。
- 会话 `2e6c4339-634d-4d79-97fe-ad7e053e23b9`：官方 `renameSession` 返回成功，`getSessionInfo.customTitle` 为 `CROSSCHAT_AFTER_RENAME`；活登记仍为 `CROSSCHAT_BEFORE_RENAME`，下条输入后仍旧，窗口未显示新名。`liveNameSynchronized:false`，不能开放完整实时修改。
- 第一轮指定项目 dir 遇 Windows 短/长路径定位差异；改用隔离 profile 内官方会话搜索，等待落盘后成功，未用文件写入绕过 SDK。

Desktop 只读核对 Windows Appx `OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0/app/resources/app.asar` 的 `src-Dl21kCYQ.js` / `main-BPBEjAxi.js`。现有 follower 方法包括启动/转向、权限与模型设置更新等；`thread-follower-update-thread-settings` 只更新下一轮设置/权限，不是名称。未对生产 GUI 聊天发修改请求，没有桌面 GUI 端到端改名成功的声明。

## 自动检查

沿已批准的原生客户端、describe/apply、TCP 操作与 TUI 接缝验证：原生 setter 零 resume/新建、名称及 owner 变化、目标发送前消失、native 明确拒绝与丢回执、缺失身份恢复、CLI/Desktop 分流、旧服务、受限端点及匿名输入默认值。

最终 `npm run check` 退出 0：2137 通过、11 原有跳过，208 文件通过、3 文件跳过；lint/build 通过，运行时图 194 模块/611 边，无循环或越界。普通检查清除 `CROSSCHAT_LIVE`；上述原生验收另行显式运行。`git diff --check` 通过。

## 保留的边界

未发布、提交或全局安装；其他聊天的工作区修改保留。未重新开展生产 SSH/TCP 验收，未在远端 Linux 安装 Codex。安全和工作目录权限仍按用户决定排除；其他工具适配继续归已交接的后续计划。Claude/Desktop 的限制来自实际验证及当前端点接口，不能把“存在原生内部方法”当作完整外部控制能力。

官方依据：[Codex App Server](https://developers.openai.com/codex/app-server)、[Claude SDK renameSession](https://code.claude.com/docs/en/agent-sdk/typescript#renamesession)。
