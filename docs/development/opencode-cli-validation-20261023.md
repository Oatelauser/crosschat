# OpenCode CLI 开发验证记录

2026-10-23。OpenCode CLI 适配及开发验证完成；软件文件清理被自动审批复核拒绝，尚未完成。用户的真实模型、从零安装验收以及桌面版不在本记录的已通过范围内。

## 授权与范围

用户要求：“按计划开始做 OpenCode CLI，正常开发和验证。完成后卸载清理测试软件，我自己重新安装，从头验证。”仅实施首批 CLI，不扩大到桌面版、DeepSeek Harness、ZCode 或共享上下文功能。未恢复此前暂停的真实 SSH/TCP 远端验证，也未在远端 Linux 安装软件。

## 交付行为

- 新增 OpenCode V2 原生 Adapter：注册文件发现、Basic 服务认证、owner/version 核对、分页列表/精确详情、原生 inbox 投递、queue/steer 和接收回执。发现不启动或修复服务，不另建会话。
- 原生 shell 使用 `OPENCODE_SESSION_ID` 识别真实调用会话，贯通回复 ref/origin、跨工具名称解析、CLI 启动器、status、TUI 会话与入星/验活组合。完整原生 ID 保持不透明；原有 Claude/Codex ref 编码字节不变。
- 默认未安装 OpenCode 不阻断既有工具的发现与精确收编；已配置故障保留错误。写入结果不明时不自动重试，不使用 Codex outbox。
- 增加官方构建兼容工装与定时 GitHub 工作流。模型端为本机 HTTP/SSE 脚本，真实运行 OpenCode 与 crosschat；不需要模型 key。只在基线成功、同一候选重复同一兼容失败时去重建立 issue。新大版本报告 unsupported，保留人工支持决策。
- [从零安装与使用](../opencode-cli.md)；技能只更新仓库源文件，未部署到用户技能目录。

## 验证与边界

| 验证 | 结果 | 证据/范围 |
| --- | --- | --- |
| `npm run check` | 1746 通过、11 跳过；160 测试文件通过、3 跳过 | 包括 ESLint、运行时依赖边界检查、TypeScript build；依赖图 169 模块/539 边，无循环或边界违规。跳过的既有 live/平台用例不计通过。 |
| 官方 CLI 2.1.3 / Windows x64 | 8/8 | [服务行为证据](evidence/opencode-cli-20261023/native-probe.json)：原生会话、模型/shell、鉴权与发现分页、闲时收件、忙时 queue/steer、真实 shell 身份与回信、服务重启后原 ID 投递、目标不存在不创建会话。 |
| Windows ConPTY | 6/6 | [终端结果](evidence/opencode-cli-20261023/pty/result.json)：正式原生 CLI 显示来信；默认 CLI discovery 能看到原生会话；crosschat TUI 详情/guide/完整地址与 ref 复制；复制地址实际发送；双端 resize、退出与终端状态恢复。 |
| CI 工装与失败分类 | 7/7 | `test/opencode-compat-fixture.test.ts`：真实 HTTP/SSE 模型 fixture，基线/候选复现、官方清单固定及 startup 协议变化分类。所有新增 scripts/helpers 另做 ESLint。 |
| 独立交叉审查 | 已修复所发现问题 | 修复 OpenCode miss 被 Codex 诊断覆盖、默认缺源阻断旧工具收编、未知 ref provider 错误回显控制字符；均先复现再修复。 |

PTY 的 crosschat 页面只组合真实 OpenCode reader，以免连接用户 Codex；默认 CLI composition 单独实测。剪贴板操作由隔离记录承接，未改用户剪贴板。原始终端事件与输出字节保存在同级 `pty/*.jsonl`，`output.txt` 是去除行尾空格的便读副本。脚本模型不验证模型理解、真实服务商登录/凭据、个人工具权限或智能协作效果。

GitHub 工作流尚未推送/运行，Linux 实机和 issue 实际创建尚未验收；工作流按默认分支调度的运行结果需在合并后观察。桌面发布包未安装、未验收，不以本次 CLI 成绩代替。

## 安装归属与清理状态

[安装记录](evidence/opencode-cli-20261023/installation.json)保留官方不可变下载 URL、117161271 字节大小及 SHA-256。官方 ZIP 摘要为 `f764199c917dd54483bd629507e6879afe11ddc33d2749ec19bea8bd64ae0b01`，二进制摘要为 `59cfe4e54c06778ec501a4566690d4ce0e8e1b45cf4bb3b9d3e49f5c8601f104`。使用独立目录和绝对路径，未全局安装、改 PATH 或安装桌面包。

各轮 fixture 的模型/原生服务、原生会话数据与独立 HOME 已结束并删除；最终检查无 owned OpenCode 进程、无 `crosschat-opencode-compat-*` 目录，PATH 无 `opencode` 命令。[清理核对](evidence/opencode-cli-20261023/cleanup.json)记录实际状态。

仍需清理以下本次新增内容：

- `C:\Users\yangsheng\AppData\Local\Temp\crosschat-opencode-20261023-f7760fd441ab47ffba88d1be752f5e93`：官方二进制、下载包/分片和临时工装/过程证据。最终证据已另存到仓库。
- `C:\Users\yangsheng\.local\state\opencode`、`C:\Users\yangsheng\.config\opencode`：空目录。
- `C:\Users\yangsheng\.local\share\opencode`：空 `repos` 目录和 `log/opencode.log`（152 字节，仅一条本次 `--help` 日志）。

准备阶段的一次 `opencode --help` 未使用隔离环境，2026-10-23 10:07:17 创建了后三处默认目录，这是本次测试的隔离疏漏。后续帮助/版本探测也必须使用隔离环境。已核对日志参数与创建时间，不把这些新增内容误称为用户原有数据或完整清理。

自动审批复核先后拒绝删除已核验的本次临时目录，以及单独删除其中的准确 `opencode.exe`；返回原因仅为 `blocked by policy`，未进一步提供理由。未通过替代执行方式绕过拒绝；软件文件清理保持未完成，不能宣称已卸载完毕。

## 保留的后续事项

1. 清理上述已确认归属的本次文件；记录实际完成状态。
2. 用户按[安装验证指南](../opencode-cli.md)自行重新安装、配置真实模型并验证完整使用流程。
3. 桌面版等待后续实施授权；本次代码支持同类服务协议不等于桌面发布版已验证。
