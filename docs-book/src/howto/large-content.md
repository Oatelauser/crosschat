# 如何发送大内容

## 判断大小

先知道自己的正文有多大、天花板在哪：默认上限 16KiB；`--max-body-kb`（单条）或 `CROSSCHAT_MAX_BODY_KIB`（常态）可提；端点硬顶 claude 64KiB、codex 1MiB——**到硬顶提额无效**。超限报错会把当前这条走得通的路直接写在里面，照抄即可（语义全表见[投递语义与限制](../reference/delivery-semantics.md#大小限制)）。

## 三条出路

单机的大内容就三条路，按代价从低到高：

| 出路 | 适用 | 形态 |
|---|---|---|
| ✅ 提额 | 偶尔超一点、远未到硬顶 | `crosschat send --max-body-kb 64 --to <名> --body "…"` |
| ✅ 管道 | 长正文/敏感字符（与大小无关，日常首选） | 正文经 stdin 喂入，不进命令行（见下） |
| ✅ 落盘发路径 | 真正的大文件（超硬顶或本就是文件） | `crosschat send --to <名> --body "见 D:\report.md"`——**单机发文件路径就这一个形态**，没有本地文件通道 |

第三条要特别说清：把路径当正文发，对方（agent）自己会去读文件。这是单机最有用的形态——文件本来就在同一台机器上，传文件是多余的，传"去哪读"就够。跨机才有真正的文件传输需求（scp 旁路 / tcp 文件通道，见下节占位）。

## 敏感字符防坑

正文含 `$`、反引号、引号时，inline `--body` 要过 shell 的引号矩阵——不要过。管道形态内容不经 shell 二次解释，逐字到达：

```powershell
@'
价格 $100、命令 `dir`、"双引号" '单引号' ——对端收到的就是这些字符本身
'@ | crosschat send --to worker
```

（PowerShell 单引号 here-string，收尾 `'@` 必须顶格；bash 用 `cat <<'EOF' | crosschat send …` 同理。）两个 Windows 专项坑：PowerShell 5.1 管道可能给 stdin 前置 BOM——需要字节精确时先 `$OutputEncoding = New-Object System.Text.UTF8Encoding $false`；文件正文用 `[IO.File]::ReadAllText(<路径>) | crosschat send …`——**勿用 `Get-Content`**（5.1 按系统码页读，非 ASCII 会乱码）。

## 跨机大内容

跨机（ssh 形态）的大内容走 **scp 旁路**——它不是 crosschat 的内建通道：代码只做出发前预检、并在报错里教这三步，**真正执行 scp 的是你或 agent**：

```console
> scp big-analysis.txt yangwsl:/tmp/big-analysis.txt
> crosschat send --via ssh:yangwsl --to beta2 --body "分析 /tmp/big-analysis.txt，结论报过来"
delivered to beta2@yangwsl(9f8e7d6c) (turn 3) · 续话 c1
```

三步 = 本机落盘 → `scp` 到对端 `/tmp/` → `--via` 只发对端本地路径。scp 与 `--via` 共用同一份 ssh config、别名与密钥，部署配一次全通；大结果回传反向同构（对端 scp 回来，或题词让对端落盘发路径）。win↔WSL 的免网络捷径：`cp result.txt /mnt/c/Users/<你>/AppData/Local/Temp/`（直写 win 盘），用完即删。完整实录（含对端拦截的 `[via]` 变体教学）见[2.5 正文超限时](../tutorial/lesson-2/05-first-message.md#正文超限时)。

<!-- tcp 占位：--file 文件通道 64MiB 自动分块，待 tcp 专家 -->
