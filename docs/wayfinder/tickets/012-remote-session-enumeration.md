# 远程会话枚举 status --via tcp:<机器>（012）

label: wayfinder:design
status: closed（2026-10-12 真机闭环关票：枚举+直发一气呵成，见 ../drill-reports/multi-star-drill-20261012.md）
blocked-by: （无）
claimed-by: （待领）

## Question

`crosschat status` 只列本机会话——跨机场景下 agent 想确认对端会话名，唯一途径是 `ssh <对端> crosschat status`；ssh 没配就是死胡同（2026-10-12 形态二 drill：两个 agent 独立撞墙点名此痛点，被迫"赌名字发送+靠回执反证"）。

### 方案（2026-10-12 设计卡）

- **additive 双帧**：`status-query`（C→S `{op, id, targetMachine}`）→ broker 按 deliver 同款路由转发目标机守护 → 目标守护跑本机 status 扫描（claude 注册表 + codex 线程表）→ `status-result`（C→S 回 `{op, id, ok, payload}`）→ broker 回请求方
- 心跳/超时对齐 result 模式（超时 → 教学报错"对端未应答——其节点客户端在跑吗/版本需升级"）
- **CLI**：`crosschat status --via tcp:<机器>`（与过滤参数自然组合：`--via tcp:cloud --claude`）；`--json` 同构
- **skill**：教"查远机会话用它，别碰 ssh"（替代现行 `ssh <对端> crosschat status` 教学）
- proto 不升号：旧 broker 对未知帧静默无行为 → 请求方超时教学"对端 broker 需升级"（版本偏差可接受，与 mc2_ starId 同款策略）
- 隐私注意：status-query 经 broker 中转，broker 可见 payload（会话名清单）——星内 broker 本就可信（持有全部钥匙与路由），无新增暴露面

## 预算与停止条件

- 规模 M 票：双帧 + 守护应答器 + broker 中转 + CLI 接线 + 过滤组合 + 测试 + skill/手册
- 停止条件：门禁全绿；真机双机闭环（win 查到 cloud 会话名并直接对其 send 成功）；旧 broker 混布时超时教学可走通；过滤参数与远程组合行为=本地同构
