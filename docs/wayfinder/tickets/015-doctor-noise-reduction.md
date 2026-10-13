# doctor 降噪三刀（015）

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

2026-10-13 现场（二期6 会话）暴露 doctor 三处噪音/错误，用户已拍板修（Q2/Q5）：

1. **版本对账不校验新鲜度**：只读 `status-node-*.json` 的 version 字段，死守护的陈旧文件照样触发"升级后未重启"⚠️——现场：`status-node-wsl-star.json` 是被 `serve --stop` 杀掉的 1.5.8 遗物，doctor 拿旧账误报。修法：复用 status 侧现成新鲜度界（TCP_STATUS_FRESH_MS 90s）判 `lastUpdated`，过期文件跳过对账（或提示清理）。
2. **修复建议命令给错**：对节点守护版本不一致，建议 `serve --stop && serve --detach`（起的是 broker）——应为 `serve --connect <星名> --detach`。按守护类型（broker/node）给对命令。
3. **codex 装了没跑仍报 ❌**（用户 2026-10-13 拍板降级 ❌→⚠️）：现仅"未安装"是 ⚠️（合法机器状态，2026-10-12 拍板），"装了 daemon 没跑"仍 ❌——纯 claude 机/暂不用 codex 时是假警报。降为 ⚠️ 并带教学（"要用 codex 通道时先 codex app-server daemon start"）。

## 预算与停止条件

- 规模 S 票：三处 doctor.ts 内改动 + doctor.test.ts 用例
- 停止条件：npm run check 全绿；本机实测——陈旧 status 文件不再误报（可复用 wsl-star 案例做夹具）、codex daemon 未跑时 ⚠️、node/broker 建议命令各对
