# 幽灵常驻进程：doctor 验活失真 + --stop 空停不善后状态文件

label: wayfinder:design
status: open
blocked-by: （无——2026-10-16 云端 1.6.3 drill 实钓缺陷）
claimed-by: （待领）

## Question

云端 v1.6.2 节点守护异常消失（状态文件停在 `state:"online"`、version 1.6.2、**无 pid 字段**、lastUpdated 死亡时刻），用户升级 1.6.3 后：

1. `crosschat serve --stop` → "stop node: 未发现运行中的节点"（serve.ts:695 cmdline 过滤 `--connect` 找进程，找不到只打印，**不清理状态文件**）
2. 紧接着 `crosschat doctor` → "⚠️ 常驻进程（节点守护 cloud-broker）为 v1.6.2，本机 v1.6.3——升级后未重启"——**幽灵警告**：进程根本不存在，doctor 把"死亡后 90 秒心跳窗内"（doctor.ts:328 freshness，TCP_STATUS_FRESH_MS=90s）的状态文件当了活守护，且无 pid 可核

win 上 ℹ️"陈旧状态文件（守护已停止）"路径工作正常（超 90s 窗即转陈旧）——缺陷只在死亡后 90 秒窗口内的 freshness 误信 + 空停不留痕的组合。

## 方案

1. **doctor F1 对账加验活**（doctor.ts:299-345）：状态文件带 `pid` → `isProcessAlive`（src/platform 既有）核活；验活失败或**无 pid 字段** → 降级 ℹ️（"无法验活/守护已停止，跳过版本对账"），**不再报"升级后未重启"⚠️**。配套：节点守护/broker 心跳写状态文件处补记 `pid`（additive，旧文件无 pid 自然走 ℹ️ 路径；写者位置实现期定位——node/broker 心跳 status writer）
2. **--stop 空停善后**（serve.ts:691-701）：node 零进程命中时，把 `state:"online"` 的 `status-node*.json` 复位 `state:"stopped"`（其余字段保留）；broker 停靠若存在同型路径同理——幽灵窗口从两头闭合

零回归红线：win/WSL 上超窗 ℹ️ 陈旧路径行为不变；真"升级未重启"（活进程旧版本，带 pid 验活通过）照报 ⚠️。

## 预算与停止条件

- 规模 S 票 ≤150 行（含测试）；**修复落 main 不单独发版**（用户 2026-10-16 拍板，随下版车）
- 停止条件：npm run check 全绿；测试覆盖四路径——新鲜+pid 活/死、新鲜+无 pid（幽灵→ℹ️）、超窗陈旧（不变）、--stop 空停复位文件
