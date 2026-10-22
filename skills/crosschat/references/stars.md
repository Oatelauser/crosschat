# crosschat 星成员册（tcp 星的会话级成员）

## 三动词分层

| 动词 | 谁用 | 干什么 |
|---|---|---|
| `crosschat serve --detach` + `serve --add-star <星名>` | broker 机 | **起服务**（永不造星）+ **造星**（首星同此命令；热生效，加删改星免重启；零星合法） |
| `crosschat serve --connect <星>` | node 机 | **机器接入**：节点守护（机器级收发+聚合器） |
| `crosschat claude/codex -n <名> --connect <星>` | 会话 | **会话注册入册**（默认**永久**：退出=下线，册位保留） |
| 同上 + `--rm` | 会话 | **临时**（docker --rm 语义）：退出即离册零痕迹——一次性 worker 用它 |

- 造星/删星/发钥是 broker 机管理员（或持星管理钥的星管理员，`--via tcp:<星>`）的事；agent 会话侧一般只碰 `--connect`/`--rm`。

- `--rm` 只作用于**会话册位**，不碰机器守护（聚合器生命周期独立——永久成员的复活检测靠它活着；退机器走 `serve --stop`）。`--rm × --extend-session` 互斥报错。
- 多星：`--connect` 可重复，各星独立册、独立上下线；`--rm` 作用于同命令全部 `--connect`。

## 双模式册：下线与复活

- **永久（默认）**：会话退出 = **下线**（不再是退星）；同 id `/resume` 或重启 = **自动复活上线**，无需任何声明（对账循环数秒内验活重入册）。一步到位形态：`crosschat claude --resume <会话id> --connect <星>`（`--resume` 原生透传）或裸 `crosschat claude --resume <会话id>`（无声明靠对账归队）。
- 发给下线成员 → `SESSION_OFFLINE`（绝不静默改投）；逃生口 = 会话段投 `<id 前 8 位>` 点对点。
- **临时（`--rm`）**：退出即删册位，之后按名投报 `SESSION_NOT_MEMBER`（从未入册同码）。
- **册位绑机器**：同 id 换机器 resume 报 `MACHINE_BOUND`——先 `--member-remove` 再在新机入星。
- 查册：`crosschat status --stars`——成员行=在线；`下线: ⚪…` 行=在册未在线（等 resume 复活 / `--extend-session` 接任 / `--member-remove` 删）。

## extends：唯一名字转移口

- 新会话接任旧名：`crosschat claude -n <新名> --connect <星> --extend-session <旧名>`——旧名从此指路新会话（`SESSION_SUPERSEDED` 报错带接任者三段地址）。同名接任（新会话沿用旧名）不需要 extends。
- **接任者胜复活**：名字被接任后，原会话同 id 回归**不夺回**名字（报 `EXTENDS_CONFLICT`，按 id8 寻址或换名）。
- 先声明先得（按工具血统）；旧名还是活成员时声明 → 拒绝并指路。

## adopt / member-remove

- `crosschat serve --connect <星> --adopt <名>`：收编**活的裸会话**入册（永久注册；`status --stars` 诊断行会当场打印这条命令）。
- `crosschat serve --connect <星> --member-remove <名|id8>`：删册位（自退/管理删；幂等——重复删除成功注明"本不在册"；星内任何机器可执）。

## 恢复配方（发给 tcp 三段地址出问题时）

- 报 `SESSION_SUPERSEDED` → 对端已换轨：照报错里的接任者地址改投。
- 报 `SESSION_OFFLINE` → 对端下线：等同 id 会话 resume 后上线，或走 extends 接任 / id8 点对点。
- 报 `SESSION_NOT_MEMBER` → 名字从未入册/已删：让对端入星或 adopt 收编。
- 报 `MACHINE_BOUND` → 对端换机器了：原机 member-remove 后新机重新入星。
- **引用续线不看星籍**：`--conversation` 回复走引用路由，成员在不在册都照常互通——只有**主动**三段寻址才吃上述错误。

## 发起方的地址情报

- 你收到的 tcp 信封自带 `from-addr="tcp:<星>:<机器>:<工具>/<会话>"`——照抄加 `--via` 前缀即可直达对方（任一可达星皆可为坐标）。
- 查**自己**的地址：`crosschat status --stars` 里本机所在星的成员行（`会话: <机器>:<工具>/<名>`）就是你的三段地址。
- 跨机会话远程枚举：`crosschat status --via tcp:<机器>`（行标"非册(裸起)"= 该会话没入星册）。
