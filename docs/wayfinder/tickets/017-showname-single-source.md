# 机器自报名单一事实源：showName 通吃 broker 机（017）

label: wayfinder:design
status: open
blocked-by: （无）
claimed-by: （待领）

## Question

用户现场（2026-10-13，云端 broker 机）：改本机 node.json 的 showName 不生效，roster 仍显示 hostname——被建议"跑节点客户端上报"或"手改 broker.json 注册表"，两者都违背单一事实源，且制造两套心智（纯 node 机 vs broker+node 机）。

**缺陷定位（代码实锤）**：
- serve.ts:216-221：broker 首启把自身登进注册表 `machineName = hostname()`，**仅首次**——已存在则永不再看
- serve.ts:222-241：serve 自建的 node.json（showName 本是给用户改的）**从不被 broker 读回**
- 全系统唯一名字传播通道 = 节点客户端连接帧（broker.ts:354-356）——broker 机没有理由跑节点客户端
- 附带：`非 hex --via tcp:<名>` 按 machineName/label 解析（broker.ts:569-571），名字冻死 = 永远要敲 hostname 或 mid8

**方案（用户方向，一套心智）**：规则只有一条——**任何机器的自报名 = 本机 node.json showName（缺省 hostname 兜底），改完重启常驻生效**（与升级口诀同节奏）：
1. serve 启动时，find 到 self 条目后不再跳过——读本机 node.json showName 刷新 `machineName`（node.json 缺失/坏/无 showName → 维持现值或 hostname 兜底，不倒 serve）
2. 纯 node 机不变（连接帧上报即传播）——剩余差异是物理性的（远机文件读不到），不产生第二套心智
3. 核对项：云机（broker 机）本机发消息的信封 from-machine 取名来源与 showName 一致；gen-key 分发文案与 broker.md/README 的改名教学同步为唯一口径
4. 备选（不推荐）：roster 构建时现读本机 showName 零重启生效——读路径带副作用语义，且与"重启常驻"系统节奏不一致

## 预算与停止条件

- 规模 S 票：serve.ts 自登记段小改 + 测试（重启后名字刷新/缺文件兜底/改名后非 hex 寻址命中）+ 教学文案同步
- 停止条件：npm run check 全绿；真机验收——云端改 showName="cloud" + 重启 serve，win 侧 roster 即见 `cloud (000c6989)`，`--via tcp:cloud` 可寻址；纯 node 机改名回归不受影响
