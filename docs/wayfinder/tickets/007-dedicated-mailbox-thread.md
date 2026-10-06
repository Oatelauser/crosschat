# crosschat 启动即命名（-n）设计

label: wayfinder:research
status: open
blocked-by: （无）
claimed-by: 研究子代理（2026-10-06，主会话派单）

## 设计转向记录（2026-10-06）

本票原案"专用信箱线程机制化（operator 别名 + name set 注册表）"经用户质询后**作废**：双侧 `/rename` 原生命名已覆盖"给会话起名"，`--to <名字>` 今天即可投递。用户提案取代：**启动即命名**——`crosschat claude -n <name>` / `crosschat codex -n <name>`，且 `-n` 必须是 claude/codex **自己的原生会话名**，不是 crosschat 侧别名；一步到位，不引入注册表文件。原案的研究产物（F1-F7）中关于线程生命周期的事实仍然有效，见 docs/research/mailbox-thread-design.md。

## Question

`-n` 启动命名两侧能否落地为**原生子名**？两个实验定音：

1. **claude 腿**：`crosschat claude -n worker2` 启动后由 wrapper 把名字写入会话注册表条目（`~/.claude/sessions/<pid>.json`，crosschat 本就读取的数据源）。验证点：claude 是否回写覆盖；名字对 `/rename`、status 发现、`--to` 解析是否等效。
2. **codex 腿**（2026-10-06 用户约束：**不走逆向**——不以 sqlite 直写或未公开 daemon 方法为实现基础，版本耦合 codex 升级即断）：只查文档化面（generate-ts schema + 官方 changelog / 更新版本）有无线程命名 API 或 CLI 参数。无 → 结论 c) 维持"TUI 里 /rename 一步"，升级路径 = 向上游提 rename API/flag 需求，官方出了就接入。

附带记档（不展开设计）：
- 轮换：claude 侧重开同 `-n` 即可（旧会话死名字释放）；codex 侧旧线程占名，未来可用 `thread/archive` 做平滑轮换
- 2026-10-06 全局复审的安全/防乒乓要点（skill 文案层面）不随本转向丢失，归 008 票决策点 5/11/12 承接

## 用户拍板（2026-10-06 终局，实验代理已终止）

- **统一入口 `-n`（用户界面对称）**：`crosschat claude -n <名>` 与 `crosschat codex -n <名>` 同构——一条命令，会话出生即命名，id 全程不露面。内部机制各用最薄：claude = 原生命名参数透传 + 出生查重；codex = headless 建线程（thread/start）+ 注册表记名 + `codex resume <id>` 直接落进 TUI（bootstrap turn 可选：用户首条真正消息也会硬化线程，投递早到属罕见边角）。
- **codex 注册表**（crosschat 自有 name→threadId 表，不耦合 codex 内部，升级免疫）；claude **不进注册表**（活进程 pid 绑定，注册表对 claude 是死数据/重启即失效的摩擦）。
- **`name set` 降为事后补名逃生门（罕见路径）**：`crosschat name set <名> --id <id8|完整>`，id 从 status 的 id8 列抄。正常路径零 id 接触。
- **status 双名显示**：有注册名的 codex 线程 name 列显示注册名，原生名存在且不同则追加（如 `worker2 ·原名xxx`，原生名 null 只显注册名）；`--json` 分立 `name`/`alias` 两字段。
- **解析顺序定死**：`--to` = 注册表名 → 原生线程名 → id8/完整 id；**跨线程撞名**（A 的别名 = B 的原生名）报 `NAME_COLLISION` 列出两个 id 拒绝猜测；**同线程双名**（别名+原生名并存）合法，都指向该线程。
- **别名与 `/rename` 互不覆盖**（语义定案）：别名管寻址（crosschat 的），`/rename` 管显示（codex/claude 自己的）。用户事后 `/rename`：codex 侧 status 变 `别名 ·原名新名`，双把手共存；claude 侧旧名消失，`--to 旧名` NAME_NOT_FOUND 附可用名清单自纠，进行中对话走 `--conversation ref` 不受影响。
- **悬空别名自愈**（实施必须带）：别名指向的线程被删 → 投递错误映射为"worker2 指向的线程已不存在，重跑 `crosschat codex -n worker2` 重建"。
- **claude `-n` 重名**：wrapper spawn 前查重——同名**活**会话 → 拒建（`NAME_COLLISION` + pid + 指引）；已死同名 → 放行（= 免费轮换）。文档写明 `-n` 是"命名新建"非"进入"（活会话单终端不可接入）；并发竞态由 send 侧 `NAME_COLLISION` 兜底；裸 `claude` + `/rename` 仍是逃生门。
- 实验遗留问题（claude `-n` 参数确切拼写）实施时 `claude --help` 一句确认，不占票。

## Resolution

**结论：不做（wontfix），2026-10-06 用户拍板。** 命名由双侧原生 `/rename` 承接（claude 会话内、codex TUI 内各一步，均为原生名，status 可见、`--to` 可投、跨机走远端原生名）；无名时用 id8/完整 id 寻址（B4 已发）。注册表方案否决，根因两条：①**场景空心**——出生命名自动化只省"TUI 里敲一次 /rename"；"headless 脚本化建命名线程"（无人开 TUI 配置线程）在"人手动启动交互会话"的既定用法（Q6）下不触发；②**结构缺陷**——线程生死在 codex 侧，crosschat 无感知钩子，注册表必然悬空/膨胀，为其做 GC 是负资产。重名由既有 `NAME_COLLISION`（拒绝+列 id，id8 寻址解困）覆盖。本票全部中间拍板（双名显示/解析顺序/出生查重/悬空自愈）随之作废归档；设计探索证据见 docs/research/mailbox-thread-design.md 与票身历史。"headless 脚本化建命名线程"作为休眠场景记入地图雾区，触发条件：出现脚本化/无人值守配置线程的真实需求（如跨机联邦批量预置接收端）。
