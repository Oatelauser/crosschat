# OpenCode 桌面版接入

本批针对 **Windows x64 的官方 OpenCode Desktop 2.1.3 正式发布包**验证默认本机服务。桌面版与 CLI 共用 `opencode` 收件类型、原生会话 ID 和回复引用；无需新增 crosschat 桌面插件，也无需额外安装独立 OpenCode CLI。

## 从零安装与使用

1. 从 [OpenCode 官方下载页](https://opencode.ai/download)安装桌面版，核对应用版本。首次引导与真实模型配置在 OpenCode 自己的界面完成；模型 key 无需交给 crosschat 或 GitHub CI。
2. 使用包含本次改动的 crosschat。工作树开发版本先执行 `npm run build`，如需让全局命令指向该工作树，再自行执行 `npm link`；npm 已发布版本不一定包含本次改动。
3. 运行 `crosschat install-skills`，然后重新打开 OpenCode 会话。OpenCode 兼容读取 `~/.claude/skills/crosschat`；现有安装器同时保留 Codex 的技能安装位置。
4. 在桌面版打开项目并创建或打开会话。`crosschat opencode` 是 CLI 启动器，桌面使用者直接打开原生桌面应用。
5. 在另一个终端查看会话：

```powershell
crosschat status --opencode --all
crosschat tui
```

TUI 的详情保留完整原生 ID。桌面标题、名称与短 ID 均可能重复；发送时使用完整 ID 并单独指定 `--tool opencode`。

```powershell
crosschat send --to <完整ID> --tool opencode --body "请检查这个改动" --json
crosschat send --to <完整ID> --tool opencode --delivery queue --body "当前工作完成后再处理" --json
crosschat send --to <完整ID> --tool opencode --delivery steer --body "请在当前工作中考虑这一点" --json
```

在对应的原生桌面会话中检查信封与消息内容。`queue` 使用原生队列；`steer` 使用原生执行边界进入当前工作。成功回执说明服务已接收，不能据此认定模型已经理解或回答。

要验证 agent 双向聊天，让一个 OpenCode 会话通过其原生 shell 工具执行 crosschat，收件方再按信封里的 reply hint 回信。必须保留 hint 的 `--conversation` 和 `--tool`；回复类型由本次信封指定，不一定是 OpenCode。OpenCode 会设置真实 `OPENCODE_SESSION_ID`，用户无需手填。普通终端手动发送是 human 身份，不能作为 agent 回信闭环的验证。

## 手动成员管理与改名

OpenCode CLI 与桌面共用同一服务类型，但 crosschat 不知道桌面当前选中的标签，也不跟随 CLI 原生 resume 后的会话选择或桌面窗口切换。若需把一个已有会话加入星，在 TUI 进入目标星的在线 node 会话列表，选择完整 OpenCode 会话并执行“所选会话入星”。新手动成员默认为永久成员；在成员列表删除精确星册位只移除星籍，不删除原生会话或聊天。恢复下线成员时也须在 TUI 明确选择，不从活动状态或会话差分猜测选择。

TUI 的“原生改名”仅在服务 owner 核实为共享 V2 **2.1.3** 时开放。执行前会核对服务、完整会话 ID、当前标题和工作区，然后发送一次 OpenCode 原生改名请求并重读验证。其他版本或 owner/目标变化显示待核实，非共享端点不支持改名，暂时不可达显示不可用；可在 OpenCode 中自行改名，再刷新会话列表。服务恢复后能力会重新只读核验，不会自动提交旧确认或重放写入。若结果待核实，先查看原生标题及 TUI 刷新结果，再决定后续操作。

## 支持范围与故障处理

- 本批覆盖桌面默认本机 sidecar/shared service。桌面中另加的 HTTP、WSL、SSH server，以及网页客户端，不因使用相似 UI 而自动计入支持范围。
- crosschat 查询当前用户的 OpenCode 服务注册文件；它不根据窗口标题猜 session，也不会默认把消息发给当前前台窗口。收件目标是完整原生会话 ID，类型独立指定为 `--tool opencode`，不使用 `opencode/<ID>` 作为通用 send 目标语法。
- 发现和投递复用 CLI 的公开 HTTP Adapter，不读取 OpenCode 数据库或依赖桌面私有 IPC。服务密码与模型 API key 不同，crosschat 只使用本机服务所需认证。
- 关闭桌面窗口不代表原生后台服务已退出；仍存在的会话可能继续接收消息。重新打开桌面后核对同一完整 ID。
- 出现未配置、鉴权失败、owner 不一致或版本错误时，先在原生桌面确认服务，再刷新发现。改名能力只对共享服务 v2.1.3 开放；能力不可用、暂时不可达和待核实分别显示，不影响独立的入星/退星能力。写入结果不明时先检查目标会话，不盲目重发；crosschat 不自动重复不确定写入。
- 安装和服务启动不由只读发现代劳，crosschat 也不会因目标不存在而替用户新建桌面会话。
- 默认正文上限仍为 16 KiB，OpenCode Adapter 的策略上限为 1 MiB；更多发送用法见 [CLI 指南](opencode-cli.md)。

## 开发验证与 CI

Windows 官方 Desktop v2.1.3 的本机基线与候选增强序列各通过 12 项，含原生改名同步、手动成员管理、官方卸载及协议状态精确恢复；更早的基础 UI 验证见[开发验证记录](development/opencode-desktop-validation-20261023.md)，当前增强证据见[C17/C19 记录](development/opencode-native-c17-c19-progress-20261111.md)。这些是本机原生结果，不代表托管生命周期通过。

桌面工装使用**未修改的官方安装包与内置 runtime**，模型服务是同机 `127.0.0.1` 的 HTTP/SSE 脚本响应。正式 Electron 发布包接受的 loopback 调试入口仅供该测试进程使用，用于操作真实 UI 的会话行、读取画面和截图；生产用户无需开启它。

工装预置隔离 profile 的官方“已完成首次引导”设置，因此本批验证已有会话的聊天能力，不验证首次引导或真实模型智能。服务、UI 与 shell 均真实运行，不能把脚本模型响应当成智能协作验收。

桌面行为和 CLI 行为分别记录；Windows 发布包实测不等于 macOS/Linux 桌面已通过。所有工具 × Linux/Windows/macOS 的 CI 覆盖矩阵及组合成本方案已加入[后续任务](development/tool-compatibility-ci-tasks.md)，待按用户要求另行讨论，不把未运行的平台视为兼容。

桌面 CI 使用固定良好构建与最新官方候选；同一候选重复同一兼容失败且基线成功，才去重报告 issue。2026-11-11 的 [PR #10 run 42989178056](https://github.com/Oatelauser/crosschat/actions/runs/42989178056) 中，Windows 与 Ubuntu CLI 检查各 8/8 通过；Desktop baseline 启动后，owned-process 检查超时，后台 updater 同时下载官方候选 2.2.7。隔离 runner 新增了原始快照中不存在的协议注册，保护逻辑拒绝覆盖；Desktop lifecycle 未通过。草稿 [PR #11](https://github.com/Oatelauser/crosschat/pull/11) 的普通 Windows、Ubuntu、macOS 检查在 [run 42978270144](https://github.com/Oatelauser/crosschat/actions/runs/42978270144) 全部通过；这不替代 Desktop 原生 hosted 验收。Windows v2.1.3 本机基线/候选通过也不改变该 hosted 状态。
