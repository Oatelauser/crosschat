# OpenCode CLI 接入与从零验证

本次适配 OpenCode **V2 CLI**，开发基线为 Windows x64 **2.1.3**。crosschat 通过 OpenCode 注册的本机服务连接已有会话，支持发现、精确投递、queue/steer、原生 shell 发信与回信、TUI 展示和入星。桌面正式包的独立验证与操作见[桌面指南](opencode-desktop.md)。

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
crosschat send --to opencode/<完整会话ID> --body "这是一条测试消息" --json
crosschat send --to opencode/<完整会话ID> --body "等当前工作完成再处理" --delivery queue --json
crosschat send --to opencode/<完整会话ID> --body "请在当前工作中考虑这一点" --delivery steer --json
```

OpenCode 内应出现 crosschat 信封。`queue` 在当前工作完成后处理；`steer` 在原生执行边界进入当前工作，闲时可启动处理。成功回执表示原生服务已接收消息；`queued` 表示已进原生队列，并不代表模型已回答。crosschat 不会为 OpenCode 建 Codex outbox，也不会因目标不存在而另建会话。

从一个 **OpenCode agent 的原生 shell 工具**运行发送命令给另一个会话，再让收件方按信封中的 `crosschat send --conversation ...` 回信。OpenCode 会给 shell 设置真实 `OPENCODE_SESSION_ID`，无需用户手填。普通终端手动发送的调用方是 human，不能验证 agent 回信闭环。

还可检查 `crosschat tui` 的会话列表、完整 ID 详情、原生状态和复制地址。`inactive` 显示为“无前台执行”，它不证明没有待处理输入。已有星配置可通过 `crosschat opencode --connect <星>` 或 `crosschat serve --connect <星> --adopt opencode/<完整ID>` 接入；机器连接、星籍和 OpenCode 执行状态分别展示。

## 故障与边界

- 默认从 `XDG_STATE_HOME/opencode/service.json` 读取服务；未设置 XDG 时为 `~/.local/state/opencode/service.json`，Windows 也使用该规则。读取不会启动服务或修改会话。
- 服务注册提供的是本机服务密码，和模型 API key 不同。高级显式配置为 `CROSSCHAT_OPENCODE_URL`、`CROSSCHAT_OPENCODE_TOKEN`，或 `CROSSCHAT_OPENCODE_SERVICE_FILE`；不要把这些密码写进问题反馈或日志。
- 服务未启动、鉴权失败、注册 owner 不匹配和不支持的版本会明确报错。服务重启后刷新发现，完整 ID 保持为原生会话 ID。已配置源不可达时会保留来源错误，不把失败当作成功。
- 非限定名称沿用现有工具的解析规则；可选 OpenCode 源故障时其他工具仍可用。需要确定送给 OpenCode 时使用 `opencode/<完整ID>`，不要依赖故障期间的全局同名检查。
- `OPENCODE_WRITE_UNCERTAIN` 表示写入结果待核实：先检查目标会话，再决定是否重发。crosschat 不自动重复该写请求。
- 默认正文仍为 16 KiB，可用 `--max-body-kb` 提额；OpenCode 适配器策略上限为 1 MiB，这不是厂商 API 的永久容量承诺。
- OpenCode 必须允许 agent 执行 crosschat shell 命令才能回信；模型是否遵循技能、真实模型服务和个人登录由用户这一轮从零验收确认。

## 自动兼容检测

[工作流](../.github/workflows/opencode-compat.yml)每周二、五及手动运行 Windows/Linux 检查。它从官方更新清单取得一次候选版本，固定 URL、大小与 SHA-256，分别运行固定良好基线和候选；模型是 CI 自己的 `127.0.0.1` HTTP/SSE 脚本服务。

只有基线通过、同一候选在两个干净环境重复出现相同兼容失败时才建立去重 issue。下载/启动环境故障单独留证，新大版本需要人工决定适配，不会自动提升支持承诺或更新基线。工作流需提交到 GitHub 默认分支后才会按时运行；本次本地开发不会替你推送或触发远端任务。

本机可重复行为检查：

```powershell
npm run build
$env:CROSSCHAT_LIVE = '1'
$env:OPENCODE_BIN = '<官方二进制的绝对路径>'
$env:OPENCODE_EXPECTED_VERSION = '2.1.3'
node scripts/opencode-compat.mjs --report '<证据文件路径>'
```

该脚本创建独立 HOME、模型服务、OpenCode 服务和会话，结束后清理自己的进程与数据，不使用个人模型配置。真实终端检查和服务行为检查的证据分别保留，不能据此声称已验证桌面 UI 或模型智能协作。
