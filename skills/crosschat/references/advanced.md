# 正文与文件

## 多行或特殊字符

正文含 `$`、反引号、引号等字符或较长时，省略 `--body`，通过 stdin 传入。按主文件规则决定是否保留示例中的 `--delivery steer`；`--to`、`--conversation` 和跨机地址沿用已确认的路由。

Bash 用带引号的 heredoc：

```bash
cat <<'EOF' | crosschat send --conversation c3 --delivery steer
价格 $100、命令 `uptime`、"双引号" ——逐字发送
EOF
```

PowerShell 用单引号 here-string：

```powershell
@'
价格 $100、命令 `dir`、"双引号" ——逐字发送
'@ | crosschat send --conversation c3 --delivery steer
```

结束标记须独占一行；PowerShell 的 `'@` 顶格书写。

## 大小限额地图

- 本机默认 16KiB；提额 `--max-body-kb <KiB>` / `CROSSCHAT_MAX_BODY_KIB`（旗标 > 环境变量 > 16KiB 兜底，配置顶 16MiB 绝对上界）。
- **端点硬顶**：claude 64KiB / codex 1MiB——到硬顶提额无效，把大内容落盘改发路径引用（或走文件通道）。
- ssh/tcp 跨机预检线 1MiB；tcp 超限**自动转文件通道**（≤64MiB 一次成功，免改命令）；ssh 大内容走 scp 旁路（先 `scp <文件> <别名>:/tmp/`，再发对端本地路径）。
- 报错只给当前通道的那一条出路，照做即可——**准确数字以报错为准**。

## PowerShell 防坑

- Windows PowerShell 5.1 管道可能给 stdin 前置一个 BOM（U+FEFF，正文首部多一个不可见字符）——需要字节精确时先跑 `$OutputEncoding = New-Object System.Text.UTF8Encoding $false` 再管道；PowerShell 7 无此问题。
- 文件正文：`[IO.File]::ReadAllText(<路径>) | crosschat send …`——**勿用 `Get-Content`**（5.1 按系统码页读文件，非 ASCII 内容会乱码）。bash 用 `cat <文件> | crosschat send …`。

## 文件通道

- 发文件（**tcp 专属**）：`crosschat send --via tcp:<星>:<机器>:<工具>/<会话> --file <路径>`，正文自动生成“文件 … 已送达”；按主文件模式规则增加 `--delivery steer`。机器级地址也可用 `tcp:<机器名/mid8>`。
- 单机把文件路径作为正文发送，或用 ReadAllText/cat 发送文件内容，不能使用 TCP 文件通道。
- 接收方读到的路径在**对端机器**本地；附件超过 **5 天**被回收——收到"已送达"但路径不存在时，回对端"附件已过期，请重发 --file"。
- tcp 腿正文超限自动走此通道（≤64MiB），发送方无需改命令。
