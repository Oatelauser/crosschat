# OpenCode Desktop 测试清理待办

2026-10-23。正式桌面应用已通过官方卸载器卸载，无本次 GUI/native 进程，安装/卸载 key 与应用文件已不存在。每轮会话、模型与运行目录也已删除。以下是自动审批拒绝后仍在工具视图中的外层残留，不包含用户原有软件或资料。

| 位置 | 内容与状态 |
| --- | --- |
| `D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-20261023-988a66bc46cd42609ca8a12db062e168` | 官方下载包/分片、owned installer profile 缓存、临时探针及过程证据；最终证据已归档。应用已卸载，`ownership.json` 的 installed=false。 |
| `D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-uia-probe-20261023` | 第一轮自有 UIA 窗口测试数据，进程已退出。 |
| `D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-uia-probe-20261023-r2` | 第二轮自有 UIA 窗口测试数据，进程已退出。 |
| `D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-uia-probe-20261023-r3` | 第三轮自有 UIA 窗口测试数据，进程已退出。 |
| `D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-uia-probe-20261023-r4` | 最终自有窗口数据；结果与截图已归档，进程已退出。 |

删除前已核对准确绝对路径、任务归属及进程退出。自动审批复核拒绝了原生 PowerShell `Remove-Item -LiteralPath ... -Recurse -Force`，返回原因仅为 `blocked by policy`，命令未执行。没有通过 Node、其他 shell、API 或 CI 主程序改删同一目标。

如这些目录在用户自己的 PowerShell 中也存在，可在完成本批开发后手动清理以下准确列表；它们与开发成果、用户配置分开。不使用通配符，不删除整个 `.cache` 或 `node_modules`。

```powershell
$testDirectories = @(
  'D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-20261023-988a66bc46cd42609ca8a12db062e168',
  'D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-uia-probe-20261023',
  'D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-uia-probe-20261023-r2',
  'D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-uia-probe-20261023-r3',
  'D:\workspace\CC\multichat\node_modules\.cache\crosschat-opencode-desktop-uia-probe-20261023-r4'
)
foreach ($testDirectory in $testDirectories) {
  if (Test-Path -LiteralPath $testDirectory) {
    Remove-Item -LiteralPath $testDirectory -Recurse -Force
  }
}
```

`HKCU:\Software\Classes\opencode` 安装前不存在，工具视图中仍只指向上述已卸载程序。用户执行删除后得到“找不到路径”；用户侧无需再处理不存在的 key。两边视图的差异保留在[核对记录](evidence/opencode-desktop-20261023/cleanup-review-checkpoint.json)，未推断具体原因。若用户已重新安装 OpenCode，其新的协议注册属于新安装，不应当作旧测试残留删除。

正式包的完整 CI 安装/卸载循环尚待独立 Windows runner 验证；本机没有用该程序绕过被拒绝的清理。准确状态见[开发验证记录](opencode-desktop-validation-20261023.md)。
