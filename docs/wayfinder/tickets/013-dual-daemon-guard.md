# 双开防护：--connect 同星守护互顶拒绝（013）

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

`serve --connect <星>` 起节点守护时不检测本机是否已有**同星**守护在跑。现场抓到：同星双守护并存后互相顶替乒乓（心跳/status 文件互相覆盖写）。现状唯一防线是人记得先 `serve --stop`。

方案（交接已定向，本票 2026-10-13 补立案——二期5 交接提及但票未落盘）：`--connect` 前置检查本机进程清单（复用 `serve --stop` 的 matchServeProcesses 扫描逻辑），发现 cmdline 含相同 `--connect <星>` 的活进程即拒绝，教学报错指向 `serve --stop <星>`。

## 预算与停止条件

- 规模 S 票：connect 前置进程检查 + 拒绝报错（含教学）+ 测试
- 停止条件：npm run check 全绿；双开实测拒绝、正常 connect 零回归；`--detach` 形态同样覆盖
