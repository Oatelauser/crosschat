# 形态二 drill 实录：云端 broker 公网直连（2026-10-12）

> win（node，name=local）↔ 云端 iv-yefd46fldsvr6olkju4j（broker，端口 7777，安全组放行，starId 6b76e1a78236）。10 问 10 答双向闭环，21 轮，双方独立出报告。**broker.md 1.1"云端场景 drill 实录待补"自此销账。**

## 结果速览

- **送达率 10/10**，零丢失零乱序；`send` 实测 ~0.3s/条，端到端延迟完全由模型轮次主导（5-10s/轮）
- 异步唤醒名副其实：全程零轮询，每条回复精确注入并唤醒
- `--conversation` 精确路由 10/10：ref 逐轮尾部漂移，逐字照抄从未失手
- 双标识互通：完整 hostname 与 mid8（000c6989）均可寻址；跨机 turn 计数两端记账一致
- 内容完整性：中文、×、✔ emoji 双向无损
- 跨 15 轮记忆（Q8 回忆 Q1）完整

## 现场问题与处置

1. **权限分类器拦截（唯一实际故障）**：云侧首答含 hostname/监听端口/`--list` 注册表/node.json 摘要/mid8 等本机 infra 细节，被 Claude Code auto mode 按 Data Exfiltration 拦截——**精简为双方已知信息后重发立刻成功**。结论：安全边界工作正常；跨机回复别堆 infra 细节（已入 skill 教学，2026-10-12 批）。长效：高频机器可自配 `Bash(crosschat send:*)` 白名单（用户侧决策）
2. **远程会话枚举缺失**：本机 status 看不到 tcp 对端会话，agent 被逼去试 ssh（未配别名，死胡同）→ 靠回执 `delivered to <名>@<机>` 反向证明名字解析成功。两个 agent 独立点名同痛点 → 挂票 012 `status --via tcp:<机器>` 远程枚举
3. ref 长且逐轮漂移、手工照抄易错——A+ 信封瘦身批（2026-10-12）部分缓解（命令更短、句式归一）

## 未测（后续 drill 项）

大附件 `--file`、`RATE_LIMITED` 限流、broker 断线重连（本地 drill a 已证 2s 自愈）、多星双 broker 闭环（011 关票条件）

## 链路事实存档

cloud 机只能走 tcp（无 ssh 通道）；端口 7777 复用泰拉瑞亚安全组放行；win 侧 node.json 已是数组形状（1.5.3）。
