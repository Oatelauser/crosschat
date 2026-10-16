# crosschat 进阶：限额 / PowerShell 防坑 / 文件通道

## 大小限额地图

- 本机默认 16KiB；提额 `--max-body-kb <KiB>` / `CROSSCHAT_MAX_BODY_KIB`（旗标 > 环境变量 > 16KiB 兜底，配置顶 16MiB 绝对上界）。
- **端点硬顶**：claude 64KiB / codex 1MiB——到硬顶提额无效，把大内容落盘改发路径引用（或走文件通道）。
- ssh/tcp 跨机预检线 1MiB；tcp 超限**自动转文件通道**（≤64MiB 一次成功，免改命令）；ssh 大内容走 scp 旁路（先 `scp <文件> <别名>:/tmp/`，再发对端本地路径）。
- 报错只给当前通道的那一条出路，照做即可——**准确数字以报错为准**。

## PowerShell 防坑

- Windows PowerShell 5.1 管道可能给 stdin 前置一个 BOM（U+FEFF，正文首部多一个不可见字符）——需要字节精确时先跑 `$OutputEncoding = New-Object System.Text.UTF8Encoding $false` 再管道；PowerShell 7 无此问题。
- 文件正文：`[IO.File]::ReadAllText(<路径>) | crosschat send …`——**勿用 `Get-Content`**（5.1 按系统码页读文件，非 ASCII 内容会乱码）。bash 用 `cat <文件> | crosschat send …`。
- 轻路径分层（按正文长短选最轻的）：
  1. 短正文：单引号 inline `--body '…'`——单引号串不展开 `$`/反引号，仅 `'` 本身需一撇加倍（写成 `''`）。
  2. 长正文/多行：单引号 here-string（主文件范例）。
  3. 文件：`[IO.File]::ReadAllText` 管道。

## 文件通道

- 发文件：`crosschat send --to <名> --file <路径>`（正文自动生成"文件 … 已送达"）；跨机机器级：`crosschat send --via tcp:<机器名/mid8> --to <名> --file <路径>`。
- 接收方读到的路径在**对端机器**本地；附件超过 **5 天**被回收——收到"已送达"但路径不存在时，回对端"附件已过期，请重发 --file"。
- tcp 腿正文超限自动走此通道（≤64MiB），发送方无需改命令。
