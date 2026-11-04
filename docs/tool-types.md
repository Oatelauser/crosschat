# 工具类型与精确寻址

当前为工作区实现说明：C14 已按用户批准的命令合同进入实施，公共发送、回信、传输和模板已接线并有隔离回归。各原生入口与三平台验证按实际证据登记；无法可靠关联自身来源的入口，具体兜底方案仍须用户逐项审阅，尚未开放通用人工询问。合同见[收敛方案](development/c14-explicit-tool-design-20261028.md)，逐项决策见[批准记录](development/c14-user-command-review.md)。

`crosschat send --tool <类型> --to <名称或完整 ID>` 将目标限制到实际通信端点。所有 send 必填收件 `--tool`，包括按引用回复、只有一个候选和文件通道外层命令。工具类型不是应用窗口标签；完整 ID 与端点类型共同定位会话。

| `--tool` | 通信端点 | `ref.endpointType` |
| --- | --- | --- |
| `claude` | Claude Code 消息通道 | `cli` |
| `codex-cli` | Codex CLI app-server | `cli` |
| `codex-desktop` | Codex Desktop 原生 owner | `desktop` |
| `opencode` | OpenCode 共享 HTTP 服务 | `shared` |
| `dsh`（也接受 `dsh-host`） | Harness 非 Desktop profile 的 Host bridge | `host` |
| `dsh-desktop` | Harness `desktop` profile 的 Host bridge | `desktop` |

OpenCode CLI/Desktop 可以使用同一服务、同一原生会话，当前统一为 `opencode`；crosschat 无法用这个服务判断用户当前选中了哪个窗口。Harness 的类型来自原生 `profileContext`，登记与响应 owner 必须一致；缺少该信息的桥保持类型未知，不能用于显式类型投递。`dsh-desktop` 的协议/隔离接线存在，正式 Desktop 安装与 UI 验收仍是后续独立任务，不能由类型登记推定已经通过。

## 发送与选择

先用 `crosschat discover` 或 TUI 查看完整 ID 和 `ref.endpointType`。Codex 两个端点即使有相同原生 ID，也分别展示；同类型重名时用完整原生 ID，完整 ID 优先于另一会话的同形名称。

```bash
crosschat send --tool codex-cli --to "测试会话" --body "普通协作消息"
crosschat send --tool codex-desktop --to "完整原生ID" --delivery steer --body "用户让我转达的内容"
crosschat send --tool opencode --to "完整原生ID" --body "普通协作消息"
crosschat send --tool dsh --to "session-完整原生ID" --body "普通协作消息"
```

发送不再解释 `<工具>/<会话>` 选型语法。`--to "codex-desktop/测试会话" --tool codex-cli` 会在 CLI 类型内寻找原值为 `codex-desktop/测试会话` 的名称或 ID，斜杠不会切换类型。指定 Desktop 后 owner 不在线会报错，不改投 CLI；指定 CLI 时不会借用 Desktop 的候选或投递通道。

原生名称和 ID 均保留完整字符串。此变更针对公开 send 地址，不删除内部 ref/origin 编码、显示标签，也不改变管理命令尚未批准调整的选择器。

## 跨机与回信

```bash
crosschat send --via ssh:build01 --tool codex-cli --to "完整原生ID" --body "普通协作消息"
crosschat send --via tcp:星名:机器名:完整原生ID --tool codex-desktop --body "普通协作消息"
crosschat send --conversation c3 --tool codex-cli --body "回复正文"
```

SSH 的 `--to` 仍受原有字符限制；跨机名称含空格时使用完整 ID。TCP 保留星、机器、会话三个地址段，`--tool` 独立提供，不恢复机器级 `--to` 的任意会话投递。发送端、broker、目标 node 必须支持端点类型；缺少协议能力会明确拒绝并说明需升级哪端，不能丢掉类型后发送。文件/控制 wire 帧沿用既有语义，外层 send 的收件选择仍须完整。上述协议测试不代表所有工具与三平台真实跨机组合已经验收。

回复照抄信封中包含 `--conversation` 与 `--tool` 的完整 hint。引用固定收件端后，冲突的 tool 会被拒绝；要另选端点，用 `--to` 和对应 tool。旧引用的未知端点可经本次明确选择及原生核验补齐，保留原 cN、nonce 和连续轮次，旧未知状态不能覆盖已确认类型。cN 是本机通信关系短柄，不是原生会话 ID；引用不自动附带聊天上下文。

`--tool` 只选择收件端，自身类型由原生来源接线识别。仅有原生 ID、活 owner 或候选列表，不能证明本次 shell 来自 CLI 还是 Desktop；当前普通 Codex 来源可能仍为 `pending`。Q8 保留：调用方原生 ID 匹配引用、收件目标明确时，来源类型未知或只读来源暂不可用仍允许回信，不增加窗口 owner 自证要求。不同端点恰有同一原生 ID 时，用明确收件 tool 确定接收方向。

信封 `from-tool` 展示本次已知来源类型，未知显示 `pending`；`from-addr` 仅含路由和完整原生 ID。已固定的返回端点仍可生成完整 hint，因此 `from-tool="pending"` 不必然禁止回信。首次发信的返回端未知时，提示保留引用并核实收件类型，不生成缺 tool 的命令，也不猜造身份变量。确认基础服务与 `identity` 命令已接线，但各入口的人工兜底策略尚未批准，当前不会让多个未知来源会话反复询问用户。

## TUI、成员与维护范围

TUI 的工具列、筛选、完整引用、TCP 会话和成员操作保留端点；现有 `y` 复制选中目标的完整发送命令，带完整原生 ID、收件 tool、路由和正文占位，不自动发送。结构化 SessionRef/完整 ID 仍可单独复制。同 ID 的 CLI/Desktop 独立选择与刷新；册位、回信、队列、速率窗口、日志关联按实际类型隔离。删除仅移除选定端点在当前星的资格，不删原生聊天，不影响其他端点或星。来源读取失败保持待核实，不把默认 20 条列表中缺席当作成员已退出。

OpenCode 的当前类型统一为 `shared`；Harness 正式 Desktop 原生入口与所有工具的三平台组合仍按专项任务验收。技能安装/卸载、专项 doctor、完整接入和三平台原生 CI 的剩余工作见[全量计划](development/tool-compatibility-ci-tasks.md)。
