# OpenCode 桌面版接入

本批针对 **Windows x64 的官方 OpenCode Desktop 2.1.3 正式发布包**验证默认本机服务。桌面版与 CLI 共用 `opencode` Provider、原生会话 ID 和回复引用；无需新增 crosschat 桌面插件，也无需额外安装独立 OpenCode CLI。

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

TUI 的详情保留完整原生 ID，复制地址为 `opencode/<完整ID>`。桌面标题、名称与短 ID 均可能重复；推荐使用复制出的完整地址。

```powershell
crosschat send --to opencode/<完整ID> --body "请检查这个改动" --json
crosschat send --to opencode/<完整ID> --body "当前工作完成后再处理" --delivery queue --json
crosschat send --to opencode/<完整ID> --body "请在当前工作中考虑这一点" --delivery steer --json
```

在对应的原生桌面会话中检查信封与消息内容。`queue` 使用原生队列；`steer` 使用原生执行边界进入当前工作。成功回执说明服务已接收，不能据此认定模型已经理解或回答。

要验证 agent 双向聊天，让一个 OpenCode 会话通过其原生 shell 工具执行 crosschat，收件方再按信封里的 `--conversation` 提示回信。OpenCode 会设置真实 `OPENCODE_SESSION_ID`，用户无需手填。普通终端手动发送是 human 身份，不能作为 agent 回信闭环的验证。

## 支持范围与故障处理

- 本批覆盖桌面默认本机 sidecar/shared service。桌面中另加的 HTTP、WSL、SSH server，以及网页客户端，不因使用相似 UI 而自动计入支持范围。
- crosschat 查询当前用户的 OpenCode 服务注册文件；它不根据窗口标题猜 session，也不会默认把消息发给当前前台窗口。收件目标始终是完整原生会话 ID。
- 发现和投递复用 CLI 的公开 HTTP Adapter，不读取 OpenCode 数据库或依赖桌面私有 IPC。服务密码与模型 API key 不同，crosschat 只使用本机服务所需认证。
- 关闭桌面窗口不代表原生后台服务已退出；仍存在的会话可能继续接收消息。重新打开桌面后核对同一完整 ID。
- 出现未配置、鉴权失败、owner 不一致或版本错误时，先在原生桌面确认服务，再刷新发现。写入结果不明时先检查目标会话，不盲目重发；crosschat 不自动重复不确定写入。
- 安装和服务启动不由只读发现代劳，crosschat 也不会因目标不存在而替用户新建桌面会话。
- 默认正文上限仍为 16 KiB，OpenCode Adapter 的策略上限为 1 MiB；更多发送用法见 [CLI 指南](opencode-cli.md)。

## 开发验证与 CI

Windows 正式包最终实测 11/11、全仓检查 1782 项通过，范围和过程证据见[开发验证记录](development/opencode-desktop-validation-20261023.md)。官方应用已卸载；外层测试文件删除被自动审批拒绝，尚未完成的[清理事项](development/opencode-desktop-cleanup-20261023.md)单独保留。

桌面工装使用**未修改的官方安装包与内置 runtime**，模型服务是同机 `127.0.0.1` 的 HTTP/SSE 脚本响应。正式 Electron 发布包接受的 loopback 调试入口仅供该测试进程使用，用于操作真实 UI 的会话行、读取画面和截图；生产用户无需开启它。

工装预置隔离 profile 的官方“已完成首次引导”设置，因此本批验证已有会话的聊天能力，不验证首次引导或真实模型智能。服务、UI 与 shell 均真实运行，不能把脚本模型响应当成智能协作验收。

桌面行为和 CLI 行为分别记录；Windows 发布包实测不等于 macOS/Linux 桌面已通过。所有工具 × Linux/Windows/macOS 的 CI 覆盖矩阵及组合成本方案已加入[后续任务](development/tool-compatibility-ci-tasks.md)，待按用户要求另行讨论，不把未运行的平台视为兼容。

桌面 CI 已加入现有兼容工作流，使用固定良好构建与最新官方候选；同一候选重复同一兼容失败且基线成功，才去重报告 issue。启动/下载/环境故障单列，缺少运行时完整释放证明就保留现场并停止后续安装。常规 npm test 不安装正式桌面；GitHub Actions 和完整 CI 串行安装循环尚未实跑。
