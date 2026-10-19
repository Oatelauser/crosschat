# 注册表单形状化 + 文件面收敛（022 修订票）

label: wayfinder:design
status: implemented（2026-10-19 check 756 绿 + 五幕真机 drill 全过，待二期9 验收关票）
blocked-by: 无（022 已关账，本票修订其实施形状）
claimed-by: broker多星

**用户 2026-10-19 四轮 grilling 拍板（架构对齐后再拍板，全程留痕于会话）**

## Question

022 交付的双形状（单星旧 broker.json 字节不动 + 多星 stars[]）与独立 roster 文件面，经用户俯瞰审查推翻：**维护一套，不背兼容包袱**。本票把注册表与星册收敛为单文件单形状，并补 022 自查发现的四缺陷。

## 决策（用户逐条拍板）

1. **broker.json 单文件单形状（终局）**：`{port?, stars:[{starId, name?, nodes, roster:{entries}}]}`——注册表与星册同文件，roster 独立文件物种消灭（`rosterFileOf`/`rosterFileForStar`/册文件 IO 全删）。备选已评估否决：每星一文件（port 无家）、维持双文件（用户否）
2. **不存在兼容式迁移（2026-10-19 加强：连吸收代码都不要）**：升级流程恒为 stop→升级→**清空状态**→测试（用户令：本机/WSL 直接清零重建，不走特殊兼容避免历史包袱）。旧形状文件一律按损坏处理（`.bak` 兜底→空表→bootstrap 重建）；readMultiRegistry 删除旧形状归一——**读写永远只有 stars[] 一种形状**。云端旧机升级时同样清零重配（钥匙重发，既知流程）
3. **三纪律写模型（代码强制）**：registry.ts 单一写入口 `mutateBrokerFile`（同步读→只拼自己的段→tmp+rename）；段所有权 roster=broker 独占 / nodes=CLI+onConnect 回写共管 / port+name+加星=CLI；starId 永不变（星身份锚，改名零级联）
4. **非兼容升级（Q4 用户拍板：拒绝历史包袱）**：broker 仅接受 caps 声明 `multi-star` 的连接；sender 腿（send/status/member-remove/探针）补发 caps；旧腿一律 `BAD_PROTO` 拒 + 教学升级口诀。无过渡期，两端同版硬要求。零回归铁律的破坏式豁免由此拍板成立，CHANGELOG 记破坏式
5. **内挂聚合器不写 status-node 文件**（非独立进程，broker 行同 pid 全覆盖）；真实守护照旧
6. **status-broker.json 保留**（doctor 版本对账/status 展示/013 延伸防护三消费者；并入资产文件=写节奏冲突）
7. **node.json / conversations 分片不动**（conversations 分片为并发无锁设计，`clean` 30 天回收即生命周期）
8. **删星挂账**：合并文件后成本 ~10 行（splice 移除 star 项），需求出现即做
9. **随葬 022 四缺陷**：F1 setPort 毁表（双路径结构性消失）、F2 doctor 误报（改读 stars[]）、F3 改名孤儿册（星名不再是文件名，结构性消失）、F4 大小写撞名（星名查重大小写不敏感+不与 starId 撞，纯逻辑检查保留）

## 实施清单

- registry.ts 单文件重构：`loadBrokerFile`（读 stars[] 单形状+.bak 损坏兜底，**无旧形状归一**）/`mutateBrokerFile` 单写入口/星域 CLI 单实现（genKeys/setName/removeNode/setPort/ensureSelfEntries 全收敛，双实现删除）
- **H1 全新安装 bootstrap（唯一安装路径）**：无文件/空表时 serve 首启造 `stars[0]`（生成 starId+清洗 hostname+空 nodes）
- broker.ts：册持久化改走 mutateBrokerFile（fresh-read splice 保住在跑 gen-key 的新钥匙）；roster 文件层删除；caps 拒连层（BAD_PROTO+教学）
- via-tcp.ts：SenderConn 补发 caps
- serve.ts：吸收调用、`--star` 仅 stars.length>1 必需（单星隐式）、addStar 在跑允许（splice 保未知段，重启托管）
- doctor.ts：读 stars[] 形状（nodes 求和校验）
- **H3 口径清扫**：grep 全仓 `roster.json`/`rosterFileOf`——broker.md 1.2.4/2.7、SKILL.md、references/*、README 改新口径；022 票加修订注记（不篡改历史，指向本票）
- 测试：registry/serve/broker 用例改造 + 新用例（吸收幂等/bootstrap/splice 段所有权/addStar 在跑安全/旧腿拒连教学/大小写撞名拒绝）

## 预算与停止条件

预算 **M**。停止条件（drill 五幕 + 全绿 + 收尾）：
1. `npm run check` 全绿（旧用例改造后零红 + 新用例全过）
2. 真机 mini drill（win+WSL，**两机 ~/.crosschat 状态已清零重建**）：①win 全新 bootstrap 起星（空目录→serve→单文件落盘）②多星操作回归（addStar 在跑/gen-key/投递）③WSL 守护断线回线 ④conversations/tcp 状态清后正常收发 ⑤旧形态客户端（无 caps 裸连）→ BAD_PROTO 升级教学实录
3. 环境复原（两机备份回灌、临时文件清理）
4. git 提交并**推送核 ahead**（教训：commit≠push）
5. crosschat 回报二期9 验收

## 关账记录（2026-10-19）

- `npm run check` 全绿：**756 passed / 11 skipped / 0 failed**（50 文件；含新增 seedBroker 测试地基与 caps 闸门/splice 段所有权/bootstrap/拒旧腿用例）
- 五幕真机 drill 全过：[drill-032-20261019](../../drill-reports/drill-032-20261019.md)（白机从零到多星：单文件成形/免停机加星/守护回连/清态收发闭环/无 caps 腿 BAD_PROTO 教学）
- H3 口径清扫完成：broker.md（1.2.4/4.1/4.2/4.6/4.7/4.8）、README、CHANGELOG（032 破坏式条目+022 条目修订注）、SKILL/references grep 无残留
- 两机状态按用户指令清零重建（冷备份 `D:\multichat-state-coldbackup-20261019\`），drill 毕保持联邦工作态；%TEMP% crosschat-* 16 件清理
