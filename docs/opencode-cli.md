# OpenCode CLI 接入与从零验证

本次适配 OpenCode **V2 CLI**，原生验证基线为 **2.1.3**。crosschat 通过 OpenCode 注册的本机服务连接已有会话，支持发现、精确投递、queue/steer、原生 shell 发信与回信、TUI 展示和手动入星。收件完整原生 ID 与工具类型分开指定；桌面正式包的独立验证与操作见[桌面指南](opencode-desktop.md)。

## 自行重新安装

1. 从 [OpenCode 官方入口](https://opencode.ai/v2/docs/)安装 V2 CLI，确认 `opencode --version`。旧 V1 不在本次适配范围。
2. 使用本次 crosschat 构建。仓库内执行 `npm run build`，需要将此工作树用于全局命令时再执行 `npm link`。本地改动尚未发布到 npm，直接安装 npm 当前版本不能代表本次成果。
3. 执行 `crosschat install-skills`。OpenCode 原生读取兼容目录 `~/.claude/skills/crosschat`，无需另外安装插件；已有 installer 也会保留 Codex 的安装位置。重启已有 OpenCode 会话以重新加载技能。
4. 在 OpenCode 自己的设置中配置真实模型或登录账户。模型 endpoint/key 由 OpenCode 管理，无需提供给 crosschat，也无需放入 GitHub CI。
5. 打开两个 OpenCode CLI 会话。可以直接启动 `opencode`，也可以使用 `crosschat opencode`；后者额外支持 crosschat 的发送预算和入星参数。

## 检查发现与投递

在另一个终端运行：

```powershell
crosschat status --opencode --all
'{"op":"list","filter":{"providerIds":["opencode"]},"limit":100}' | crosschat discover
```

`discover` 返回完整会话 ID 与分页信息；有 `nextCursor` 时继续查询，或使用自动翻页的 `status` / TUI。推荐复制 TUI 会话行提供的完整地址，避免跨工具同名。

```powershell
crosschat send --to <完整会话ID> --tool opencode --body "这是一条测试消息" --json
crosschat send --to <完整会话ID> --tool opencode --delivery queue --body "等当前工作完成再处理" --json
crosschat send --to <完整会话ID> --tool opencode --delivery steer --body "请在当前工作中考虑这一点" --json
```

OpenCode 内应出现 crosschat 信封。`queue` 在当前工作完成后处理；`steer` 在原生执行边界进入当前工作，闲时可启动处理。成功回执表示原生服务已接收消息；`queued` 表示已进原生队列，并不代表模型已回答。crosschat 不会为 OpenCode 建 Codex outbox，也不会因目标不存在而另建会话。

从一个 **OpenCode agent 的原生 shell 工具**运行发送命令给另一个会话，再让收件方按信封的 reply hint 回信。hint 中的 `--conversation` 和收件 `--tool` 必须原样保留；下面示例回复目标为 OpenCode 的情形，实际回复以收到的 hint 为准：

```powershell
crosschat send --conversation cA014 --tool opencode --body "回复正文"
crosschat send --conversation cA014 --tool opencode --delivery steer --body "需要即时处理的回复"
```

OpenCode 会给 shell 设置真实 `OPENCODE_SESSION_ID`，无需用户手填。普通终端手动发送的调用方是 human，不能验证 agent 回信闭环。

`crosschat tui` 可查看会话列表、完整 ID、原生状态和复制命令。`inactive` 表示“无前台执行”，不代表没有待处理输入，也不代表该窗口当前选中了此会话。OpenCode 没有可靠的窗口级会话选择通知；原生 CLI resume 后的选择或桌面标签切换不会被自动跟随。需要把已有 CLI 或桌面会话加入星时，在 TUI 进入目标星及在线 node 的会话列表，选中完整 OpenCode 会话后执行“所选会话入星”。新手动成员默认为永久成员，关闭原生窗口不会自动退星；在成员列表对精确成员执行删除星册位只移除该星籍，不删除 OpenCode 会话或聊天。恢复下线的永久成员也通过 TUI 明确选择，不用活动列表或会话差分推断窗口选择。

成员列表的“原生改名”仅在服务 owner 核实为共享 V2 **2.1.3** 时开放。确认前会核对服务、完整原生会话 ID、标题和工作区；改名通过 OpenCode 原生接口写入并重读确认。其他版本或 owner/目标变化会显示待核实，非共享端点不支持改名，暂时不可达会显示不可用。仍可在 OpenCode 中改名后刷新。结果待核实先只读刷新并核对原生标题，不自动重发；来源恢复后重新探测能力，但不会自动提交旧确认或重放写入。机器连接、星籍和 OpenCode 执行状态分别展示。

## 故障与边界

- 默认从 `XDG_STATE_HOME/opencode/service.json` 读取服务；未设置 XDG 时为 `~/.local/state/opencode/service.json`，Windows 也使用该规则。读取不会启动服务或修改会话。
- 服务注册提供的是本机服务密码，和模型 API key 不同。高级显式配置为 `CROSSCHAT_OPENCODE_URL`、`CROSSCHAT_OPENCODE_TOKEN`，或 `CROSSCHAT_OPENCODE_SERVICE_FILE`；不要把这些密码写进问题反馈或日志。
- 服务未启动、鉴权失败、注册 owner 不匹配和不支持的版本会明确报错。服务重启后刷新发现，完整 ID 保持为原生会话 ID。已配置源不可达时会保留来源错误，不把失败当作成功。
- 收件类型是独立的 `--tool opencode`；目标填写发现得到的完整原生 ID，不把 `opencode/<ID>` 当作类型选择语法。可选 OpenCode 源故障时其他工具仍可用；需要精确寻址时不要依赖故障期间的全局同名检查。
- `OPENCODE_WRITE_UNCERTAIN` 表示写入结果待核实：先检查目标会话，再决定是否重发。crosschat 不自动重复该写请求。
- TUI 中改名能力按操作单独核验：其他版本的改名显示待核实，不影响已验证来源上的入星/退星。服务暂不可达时刷新只读重核；不会自动提交旧表单、重放改名或改动成员属性。
- 默认正文仍为 16 KiB，可用 `--max-body-kb` 提额；OpenCode 适配器策略上限为 1 MiB，这不是厂商 API 的永久容量承诺。
- OpenCode 必须允许 agent 执行 crosschat shell 命令才能回信；模型是否遵循技能、真实模型服务和个人登录由用户这一轮从零验收确认。

## 自动兼容检测

[工作流](../.github/workflows/opencode-compat.yml)每周二、五及手动运行 Windows/Linux 检查。它从官方更新清单取得一次候选版本，固定 URL、大小与 SHA-256，分别运行固定良好基线和候选；模型是 CI 自己的 `127.0.0.1` HTTP/SSE 脚本服务。

只有基线通过、同一候选在两个干净环境重复出现相同兼容失败时才建立去重 issue。下载/启动环境故障单独留证，新大版本需要人工决定适配，不会自动提升支持承诺或更新基线。工作流需提交到 GitHub 默认分支后才会按时运行；本次本地开发不会替你推送或触发远端任务。

截至 2026-11-11，OpenCode CLI v2.1.3 的 Windows 与 WSL Ubuntu 22.04 本机原生验收通过；这是 loopback 管理验证，不是物理跨机或托管原生 CI。草稿 [PR #11](https://github.com/Oatelauser/crosschat/pull/11) 的普通 Windows、Ubuntu、macOS 检查在 [run 42978270144](https://github.com/Oatelauser/crosschat/actions/runs/42978270144) 全部通过；这不代表 OpenCode 原生托管验收。正式 Desktop 的 hosted lifecycle 仍未通过，见[桌面指南](opencode-desktop.md)及[增强验收记录](development/opencode-native-c17-c19-progress-20261111.md)。

本机可重复行为检查：

```powershell
npm run build
$env:CROSSCHAT_LIVE = '1'
$env:OPENCODE_BIN = '<官方二进制的绝对路径>'
$env:OPENCODE_EXPECTED_VERSION = '2.1.3'
node scripts/opencode-compat.mjs --report '<证据文件路径>'
```

该脚本创建独立 HOME、模型服务、OpenCode 服务和会话，结束后清理自己的进程与数据，不使用个人模型配置。真实终端检查和服务行为检查的证据分别保留，不能据此声称已验证桌面 UI 或模型智能协作。
