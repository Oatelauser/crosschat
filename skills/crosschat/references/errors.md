# crosschat 报错自纠目录（读错误码，不要即兴发明命令）

- `MESSAGE_TOO_LARGE`：大小限额地图——本机默认 16KiB；提额 `--max-body-kb <KiB>` / `CROSSCHAT_MAX_BODY_KIB`（旗标 > 环境变量 > 16KiB 兜底，配置顶 16MiB 绝对上界）；**端点硬顶 claude 64KiB / codex 1MiB**——到端点硬顶提额无效，把大内容落盘改发路径引用；ssh/tcp 跨机预检线 1MiB；tcp 超限**自动转文件通道**（≤64MiB 一次成功，免改命令）；ssh 大内容走 scp 旁路（先 `scp <文件> <别名>:/tmp/`，再发对端本地路径）。
- 超长处理的场景指引听报错的：报错按你当前通道只给那一条，照做即可——**准确数字以报错为准**（报错才是权威，本目录只给地图）。
- `RATE_LIMITED`：发送过快（每对端点 60 秒最多 30 条）。**等待后重试**，或直接总结收尾；系统不会静默丢弃或自动重试。
- `TCP_TRANSPORT_FAILED`（tcp 形态）：连不上 broker 或等回执超时——**远端状态不明，勿盲目重发**（可能与首次投递叠加）。先在对端查 send-log 或 `status --conversations` 核实后再决定。
- `PEER_OFFLINE`（tcp 形态）：对端**机器**当前不在线——稍后重试；若两端另配了 ssh 也可走 ssh 形态。
- `SESSION_NOT_MEMBER`（tcp 三段寻址）：会话名没入星册（裸起的会话）——让对端经启动器入星（`crosschat claude/codex --connect <星>`，1.7.0 起默认永久注册）或 `crosschat serve --connect <星> --adopt <名>` 收编后重发。
- `SESSION_OFFLINE`（tcp 三段寻址，1.7.0 新）：会话**在册但当前下线**（永久成员退出=下线，册位保留）——不静默改投。出路三选一：① 等对端同 id resume/重启自动复活上线后重发；② 新会话接任：对端 `crosschat claude -n <新名> --connect <星> --extend-session <旧名>`；③ 点对点直达：会话段投 `<id 前 8 位>`（册内按 id 寻址与在线无关）。
- `MACHINE_BOUND`（1.7.0 新）：跨机 resume——册位绑原机器，同 id 异机不复活。迁移走显式操作：先在原机器 `crosschat serve --connect <星> --member-remove <名|id8>` 删册位，再到新机器重新入星。
- `NAME_COLLISION`（tcp 三段寻址）：同名撞车——报错列出带工具限定词的地址（`<星>:<机器>:claude/<名>`），照抄改投即达；同工具同名时改列 `名(id8)`，会话段投 `<id 前 8 位>` 短前缀直达。
- `SESSION_SUPERSEDED`（tcp 三段寻址）：旧名是死名且有人接任（`--extend-session` 声明过）——报错里已给出接任者的三段地址（带工具限定词），改投它即可。
- 收到"文件 … 已送达"但那个路径不存在：附件超过 5 天被回收——回对端"**附件已过期，请重发 --file**"。
- `CODEX_THREAD_LOCKED` / `CODEX_THREAD_BUSY_TIMEOUT`：旧 daemon（≤0.157 / 未附着 TUI）下线程被窗口占用或长 turn 在跑。消息**已暂存（parked，exit 0），无需重发**——**看门狗每 0.5–5 分钟自动重投，不需要手动跑 status**；每线程最多暂存 200 条，滞留内容随时可读 mailbox 镜像 `~/.crosschat/mailbox/<线程ID>.md`（全平台同路径）。0.160+ 正常不会再遇到：忙时直接入队（`queued`）。
- `CALLER_IDENTITY_CONFLICT`：环境里同时残留 `CLAUDE_CODE_*` 与 `CODEX_*` 身份变量（常见于从 Claude 终端启动的 codex daemon 派生的 shell）。临时自纠 = 先清残留再发送，照抄——PowerShell（先清，再发）：

  ```
  Remove-Item Env:CLAUDE_CODE_*
  crosschat send --conversation mc1_XXXX --body "正文"
  ```

  bash/zsh（单条命令加 `env -u` 前缀）：

  ```
  env -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ID crosschat send --conversation mc1_XXXX --body "正文"
  ```

  根治 = 让用户从干净终端重启 daemon：`codex app-server daemon stop && codex app-server daemon start`。
- 其他错误码：错误信息已写明原因与出路，按信息处理即可。
