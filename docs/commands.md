# crosschat 命令全量说明

全部命令、参数、启动器与环境变量的完整参考；速查与入门见 [README](../README.md)，对话规则与投递语义见 [usage.md](usage.md)，跨机（--via ssh）操作手册见 [federation.md](federation.md)。

## ✉️ send——发送消息

```
crosschat send [--via ssh:<别名>] --to <名字> | --conversation <ref> [--body <文本> | < 管道] [--max-body-kb <KiB>] [--max-turn <N>] [--json]
```

| 参数 | 说明 |
|---|---|
| `--to <名字>` | 目标端（claude 会话名 / codex 线程名 / id8 / 完整 id，`status` 可查）；同一端对重复 `--to` 自动接续最近对话 |
| `--conversation <ref>` | 沿既定对话回复（ref 照抄信封 reply-hint）；与 `--to` 二选一 |
| `--body <文本>` | 正文；省略时从 stdin 管道读，两者同给报错 |
| `--via ssh:<别名>` | 跨机发送：别名 = `~/.ssh/config` Host，名字在对端解析，详见 [federation.md](federation.md) |
| `--max-body-kb <KiB>` | 本次发送的正文上限（正整数 KiB），最高优先；非法值静默忽略、落下一层 |
| `--max-turn <N>` | 本次发送的轮次预算（正整数），信封显示 `turn="N/M"`；非法值静默忽略 |
| `--json` | 单行 JSON 输出 |

### 上限优先级链（正文上限与轮次预算同构）

```
send 显式参数（--max-body-kb / --max-turn）
  > 环境变量（CROSSCHAT_MAX_BODY_KIB / CROSSCHAT_MAX_TURN；启动器注入的值覆盖机器继承值）
    > 默认 16384 字节（16KiB）/ 无预算
```

### 端点封顶（传输天花板，生效上限 = min(配置值, 封顶)）

| 场景 | 生效上限 |
|---|---|
| claude 端点 | 64KiB（65536 字节） |
| codex 端点 | 1MiB（1048576 字节） |
| `--via ssh:` 本地预检 | 按最宽端点 1MiB（远端目标本地不可知）；远端自行复检 |
| 来源值绝对上界 | 16384 KiB（16MiB），超过按封顶处理 |

### MESSAGE_TOO_LARGE 三种教学形态

- **单机**：把完整内容写入一个文件、只发文件路径（长内容的标准做法）
- **`--via ssh:` 形态**：先 scp 落到对端再发对端本地路径——完整操作手册见 [federation.md](federation.md)
- **远端来件被拒**（你经 `--via` 发大正文、对端按它的上限拒绝）：scp 旁路，或接收方（对端）操作者调 `CROSSCHAT_MAX_BODY_KIB`；若撞的是端点硬顶（claude 64KiB / codex 1MiB），scp 是唯一出路

### 轮次预算语义

信封开标签带预算时显示 `turn="N/M"`（N 当前轮次、M 预算）：**软提醒不硬拦**，超预算（如 41/40）照常发送照常显示，任务未完可继续但优先收尾或开新对话；调大预算（`--max-turn` 或 `CROSSCHAT_MAX_TURN`）下一条消息即生效；预算按两端模型窗口设定，两端窗口不同时建议两端对齐。

## 📊 status——查看会话与对话

- 默认：claude/codex 双侧总览（名字、目录、时间、状态）
- `--conversations`：每对端点的对话总览（最近方向、轮次、末条状态、滞留数）
- `--json`：同结构单行 JSON

## 🩺 doctor——环境体检

一键检查运行环境，任何 ❌ 项退出码 1；报告自带修复指引。

## 📦 install-skills——安装 agent skill

把 crosschat 协议 skill 装进 `<root>/.claude` 与 `<root>/.codex`（默认 root = home 目录）；`--dir <root>` 指定根；幂等可重跑。

## 🚀 启动器对：crosschat claude / crosschat codex

| | `crosschat claude [任意 claude 参数…]` | `crosschat codex [任意 codex 参数…]` |
|---|---|---|
| 前置注入 | `--settings {"crossSessionInbound":"accept"}`——不注入收不到 peer 消息（裸 `claude` 的会话无接收许可） | **零注入**——codex 接收走原生 daemon，无需补丁（两者必要性差异所在） |
| 参数转发 | 其余参数原样透传 | 其余参数（含子命令 `resume`、`--profile` 等）一个不解析、原样转发 |
| 旋钮透传 | `--max-body-kb <N>` / `--max-turn <N>`：校验后写进**会话环境变量**（`CROSSCHAT_MAX_BODY_KIB` / `CROSSCHAT_MAX_TURN`），本会话全部 `crosschat send` 继承；send 显式参数仍最高优先 | 同左 |
| 身份清洗 | 剥 codex 家族身份变量（`CODEX_THREAD_ID` / `CODEX_SESSION_ID`） | 剥 claude 家族身份变量（`CLAUDE_CODE_MESSAGING_SOCKET` / `…_TOKEN` / `…_SESSION_ID`） |
| 特别限制 | 自带 `--settings` 会报 `SETTINGS_CONFLICT`（把 JSON 合并进你的配置文件后直启 claude） | 不管理 daemon 生命周期（原生的事） |

**旋钮校验语义**：启动器的 `--max-body-kb`/`--max-turn` 非正整数时**直接报错退出**（USAGE，报错含合法形态）——这是人在终端前的一次性输入，立即可见纠正；与 send 侧的静默降级（面对 agent 自纠循环）有意不同。

**身份清洗语义**：剥"别家"的身份环境变量、自家留着——crosschat 靠自家变量认发送者。这是 `CALLER_IDENTITY_CONFLICT`（报错里 `env -u` 人工自纠）的机构化预防：从一家会话里启动另一家的 CLI，双身份不再带进子进程。`CODEX_HOME` 等配置变量绝不在剥离清单。

**平面分家规则**：启动器 = 会话面配置的家（`crosschat claude` / `crosschat codex` 两个）；传输面配置（tcp 端口/密钥、broker 编址）属传输组件自己的面，不进启动器——远端来件与非会话上下文读不到会话启动参数。

## ⚙️ 环境变量总表

| 变量 | 用途 | 默认 | 生效层级 |
|---|---|---|---|
| `CROSSCHAT_MAX_BODY_KIB` | 单条正文上限（正整数 KiB）；非法静默忽略 | 16384 字节 | send 参数之下、默认之上 |
| `CROSSCHAT_MAX_TURN` | 轮次预算（正整数轮数），信封显示 `turn="N/M"`；非法静默忽略 | 不设置（无预算） | 同上 |
| `CROSSCHAT_SSH_TIMEOUT_MS` | `--via ssh:` 本地等待超时（毫秒，正数） | 120000 | 机器环境（--via 发送腿） |
| `CROSSCHAT_CLAUDE_BIN` | 覆盖 claude 可执行路径解析 | npm 布局 > PATH | `crosschat claude` 启动器 |
| `CROSSCHAT_CODEX_BIN` | 覆盖 codex 可执行路径解析 | npm 原生 exe > PATH | `crosschat codex` 启动器与 codex 传输 |

## 🔧 全局选项

| 选项 | 说明 |
|---|---|
| `--json` | send/status 输出单行 JSON |
| `--help` / `help` | 显示用法 |
| `-v` / `--version` | 打印版本退出 |
