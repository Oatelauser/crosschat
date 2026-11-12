# crosschat 星成员册（tcp 星的会话级成员）

## 三动词分层

| 动词 | 谁用 | 干什么 |
|---|---|---|
| `crosschat serve --detach` + `serve --add-star <星名>` | broker 机 | **起服务**（永不造星）+ **造星**（首星同此命令；热生效，加删改星免重启；零星合法） |
| `crosschat serve --connect <星>` | node 机 | **机器接入**：节点守护（机器级收发+聚合器） |
| `crosschat claude/codex --connect <星>` | 会话 | 按各自已核实的启动器选择规则入星；新成员默认**永久**，下线后册位保留 |
| 同上 + `--rm` | 会话 | 新成员为**临时**，最后一个窗口释放后删册；已有永久成员保持永久 |
| `crosschat tui` 中选择 node 的具体会话入星 | 会话 | 管理 CLI、桌面/Web 的会话；新手动成员永久，已有成员保持原属性 |

- 造星/删星/发钥是 broker 机管理员（或持星管理钥的星管理员，`--via tcp:<星>`）的事；agent 会话侧一般只碰 `--connect`/`--rm`。

- `--rm` 只作用于新会话册位；`--rm --connect <星>` 与 `--connect <星> --rm` 等效。机器守护独立，退机器走 `serve --stop`；`--rm × --extend-session` 互斥报错。
- 多星：`--connect` 可重复，各星独立册、独立上下线；`--rm` 对同命令各星的新成员生效。

## 双模式册：下线与复活

- **启动器选择**：通过 `crosschat claude/codex --connect <星>` 启动，空白窗口先等待；首条输入或确认 `/resume` 后入星。切换 A→B 仅释放本窗口对 A 的声明，其他窗口独立工作。
- **永久成员**：最后一个有效声明释放后下线、册位保留。恢复时通过上述启动器选择会话，或在 TUI 明确选择；直接运行原生工具、桌面/Web 统一走 TUI，裸 `/resume` 不自动归队。
- **OpenCode**：CLI 与桌面默认共享 `opencode/shared` 服务，不代表某个窗口的当前选择。已核验的 V2 `2.1.3` 没有可靠的窗口级选择/resume/switch 信号；`crosschat opencode` 的发现差分和服务活动状态不能代替选择证明。显式通过 TUI 选择完整 OpenCode ID 入星，新成员为永久；切换原生窗口不会自动登记另一会话，裸 resume 不自动归队。服务恢复后刷新并重新核验，不自动提交旧表单。
- **临时成员（`--rm`）**：最后一个窗口释放后删册位，之后按名投报 `SESSION_NOT_MEMBER`。本次启动的 `--rm` 不改变已有永久成员。
- **守护重启**：普通断网重连重播当前声明；node 进程重启后永久册位保留，仍活着的启动器重新声明当前选择，手动成员由 TUI 或显式 adopt 恢复。
- 发给下线成员 → `SESSION_OFFLINE`，请按上述入口恢复；会话段改投 `<id 前 8 位>` 仍要求成员在线。
- **册位绑机器**：同 id 换机器 resume 报 `MACHINE_BOUND`——先 `--member-remove` 再在新机入星。
- 查册：`crosschat status --stars`——成员行=在线；`下线: ⚪…` 行=在册未在线，可通过启动器或 TUI 恢复，也可 `--extend-session` 接任或 `--member-remove` 删册。

## TUI 会话管理

- 进入目标星，在成员列表按 `a` 打开可发现会话，选定 node 的完整会话后再按 `a` 确认入星。登记的是会话 ID；原生 GUI 切到其他会话时，在 TUI 另选该会话入星。
- `Ctrl+D` 删除选定星籍及对应路由，原生进程与历史保留；新手动成员永久，不靠关闭桌面标签推断退星。
- `e` 按来源能力修改原生名称，没有星内别名。Codex CLI 须可核实同一服务及已加载会话，协议基线 0.163.0；Claude 活窗口同步尚未核实，Codex 桌面协同接口没有改名入口，请在其原生界面改名。不可用时界面说明原因，来源恢复后重新核验。
- OpenCode 原生改名目前只对已核实的 V2 `2.1.3` 共享服务开放。操作前核对服务 owner、完整会话 ID、原名和工作区；改名后重读名称，并确认活界面及星内寻址更新。其他版本或 owner/目标变化时标为待核实；`uncertain` 写入先只读检查原生标题，不盲目重发。能力恢复只重新核验，不自动提交旧表单。
- Harness Web 的原生改名目前限定 `0.2.1-rc.5`，Windows已通过真实界面、node、星册与新名称投递验证；rc.2、Desktop和其它版本保留待核实。固定rc.5增强已通过Windows本地11项，以及Windows/Linux x64、macOS Intel/ARM四目标各11项托管检查；同机两个逻辑node不代表物理跨机验收，其它平台的真实Web界面尚未验收。
- Harness原生桥HTTP回执丢失和broker到操作端关联回执丢失都可能返回 `uncertain`；两种故障已分别验证一次原生写入、只读恢复零重发。先核对原生标题与权威星册；服务或活会话变化后刷新并重新确认。恢复能力不自动提交旧表单或重放改名、入星、删册；手动成员仍按既有TUI选择或显式adopt恢复。
- 另一操作端改名或桥恢复不替当前表单确认。Harness已验的完整原生ID筛选场景中，取消后重开仍保留同一完整目标与复制命令；筛选值和滚动位置尚未独立观察。

## extends：唯一名字转移口

- 新会话接任旧名：`crosschat claude -n <新名> --connect <星> --extend-session <旧名>`——旧名从此指路新会话（`SESSION_SUPERSEDED` 报错带接任者三段地址）。同名接任（新会话沿用旧名）不需要 extends。
- **接任者胜复活**：名字被接任后，原会话同 id 回归**不夺回**名字（报 `EXTENDS_CONFLICT`，按 id8 寻址或换名）。
- 先声明先得（按工具血统）；旧名还是活成员时声明 → 拒绝并指路。

## adopt / member-remove

- `crosschat serve --connect <星> --adopt <名>`：收编活会话入册，或恢复离线册位；新成员永久，已有成员保留永久/临时属性。`status --stars` 诊断行会当场打印对应命令。
- `crosschat serve --connect <星> --member-remove <名|id8>`：删册位（自退/管理删；幂等——重复删除成功注明"本不在册"；星内任何机器可执）。

## 恢复配方（发给 tcp 三段地址出问题时）

- 报 `SESSION_SUPERSEDED` → 对端已换轨：照报错里的接任者地址改投。
- 报 `SESSION_OFFLINE` → 对端下线：请对端通过 crosschat 启动器选择恢复或在 TUI 入星，也可走 extends 接任；id8 寻址仍需成员在线。
- 报 `SESSION_NOT_MEMBER` → 名字从未入册/已删：让对端入星或 adopt 收编。
- 报 `MACHINE_BOUND` → 对端换机器了：原机 member-remove 后新机重新入星。
- **引用续线不看星籍**：`--conversation` 回复走引用路由，成员在不在册都照常互通——只有**主动**三段寻址才吃上述错误。

## 发起方的地址情报

- 收到 tcp 信封后，优先按 reply hint 的 `--conversation` 和收件 `--tool` 回信。`from-addr="tcp:<星>:<机器>:<完整会话ID>"` 用于核对正向坐标，来源类型另由 `from-tool` 展示；不要仅凭显示字段重拼回复路由。
- 查**自己**的地址：`crosschat status --stars` 核对完整星、机器、会话 ID 和实际端点类型；主动投递使用纯 TCP 地址并独立填写 `--tool`。显示标签不作为工具前缀语法。
- 跨机会话远程枚举：`crosschat status --via tcp:<机器>`（行标"非册(裸起)"= 该会话没入星册）。
