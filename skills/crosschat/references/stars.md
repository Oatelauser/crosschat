# crosschat 星成员册（tcp 星的会话级成员）

## 三动词分层

| 动词 | 谁用 | 干什么 |
|---|---|---|
| `crosschat serve --detach` + `serve --add-star <星名>` | broker 机 | **起服务**（永不造星）+ **造星**（首星同此命令；热生效，加删改星免重启；零星合法） |
| `crosschat serve --connect <星>` | node 机 | **机器接入**：节点守护（机器级收发+聚合器） |
| `crosschat claude/codex --connect <星>` | 会话 | 首条输入或确认 `/resume` 后跟随本窗口选择入星；新成员默认**永久**，退出下线、册位保留 |
| 同上 + `--rm` | 会话 | 新成员为**临时**，最后一个窗口释放后删册；已有永久成员保持永久 |
| `crosschat tui` 中选择 node 的具体会话入星 | 会话 | 管理 CLI、桌面/Web 的会话；新手动成员永久，已有成员保持原属性 |

- 造星/删星/发钥是 broker 机管理员（或持星管理钥的星管理员，`--via tcp:<星>`）的事；agent 会话侧一般只碰 `--connect`/`--rm`。

- `--rm` 只作用于新会话册位；`--rm --connect <星>` 与 `--connect <星> --rm` 等效。机器守护独立，退机器走 `serve --stop`；`--rm × --extend-session` 互斥报错。
- 多星：`--connect` 可重复，各星独立册、独立上下线；`--rm` 对同命令各星的新成员生效。

## 双模式册：下线与复活

- **启动器选择**：通过 `crosschat claude/codex --connect <星>` 启动，空白窗口先等待；首条输入或确认 `/resume` 后入星。切换 A→B 仅释放本窗口对 A 的声明，其他窗口独立工作。
- **永久成员**：释放后下线、册位保留。恢复时通过上述启动器选择会话，或在 TUI 明确选择；直接运行原生工具、桌面/Web 统一走 TUI，裸 `/resume` 不自动归队。
- **临时成员（`--rm`）**：最后一个窗口释放后删册位，之后按名投报 `SESSION_NOT_MEMBER`。本次启动的 `--rm` 不改变已有永久成员。
- **守护重启**：普通断网重连重播当前声明；node 进程重启后永久册位保留，仍活着的启动器重新声明当前选择，手动成员由 TUI 或显式 adopt 恢复。
- 发给下线成员 → `SESSION_OFFLINE`，请按上述入口恢复；会话段改投 `<id 前 8 位>` 仍要求成员在线。
- **册位绑机器**：同 id 换机器 resume 报 `MACHINE_BOUND`——先 `--member-remove` 再在新机入星。
- 查册：`crosschat status --stars`——成员行=在线；`下线: ⚪…` 行=在册未在线，可通过启动器或 TUI 恢复，也可 `--extend-session` 接任或 `--member-remove` 删册。

## TUI 会话管理

- 进入目标星，在成员列表按 `a` 打开可发现会话，选定 node 的完整会话后再按 `a` 确认入星。登记的是会话 ID；原生 GUI 切到其他会话时，在 TUI 另选该会话入星。
- `Ctrl+D` 删除选定星籍及对应路由，原生进程与历史保留；新手动成员永久，不靠关闭桌面标签推断退星。
- `e` 按来源能力修改原生名称，没有星内别名。Codex CLI 须可核实同一服务及已加载会话，协议基线 0.163.0；Claude 活窗口同步尚未核实，Codex 桌面协同接口没有改名入口，请在其原生界面改名。不可用时界面说明原因，来源恢复后重新核验。

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

- 你收到的 tcp 信封自带 `from-addr="tcp:<星>:<机器>:<工具>/<会话>"`——照抄加 `--via` 前缀即可直达对方（任一可达星皆可为坐标）。
- 查**自己**的地址：`crosschat status --stars` 里本机所在星的成员行（`会话: <机器>:<工具>/<名>`）就是你的三段地址。
- 跨机会话远程枚举：`crosschat status --via tcp:<机器>`（行标"非册(裸起)"= 该会话没入星册）。
