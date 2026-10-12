# 多星成员（v6 终版：无状态路由——配置带星、引用带路）

label: wayfinder:design
status: open（设计封版 2026-10-12，经六轮俯瞰+功能横扫；实施按编排协议 B0–B3）
blocked-by: （无——与 010 无耦合可并行）
claimed-by: （主会话编排执行中）

## Question

一台机器同时入多个星（broker 星型），且不引入任何运行时路由状态。

## 终版设计（用户拍板演进，推翻早期"档案目录+会话缓存"案）

**原理一句话：连接挂在星上（收件守护按星常驻），记忆挂在引用上（mc2_ 携带星标识），路由是纯函数 f(ref, node.json)。**

1. **starId**：broker 首次 serve 在 broker.json 生成随机 12 hex `starId`（与 machine-id 解耦）；gen-key 打印进 node.json；info 帧携带（additive）
2. **node.json 双形状**：旧单 broker 形状永兼容（=隐式单元素）；多星 `{brokers:[{host,port,alias,starId?,key}], name}`——唯一落盘配置，无缓存文件
3. **mc2_ 尾部扩展**：flags bit 10 + starId 字段追加在 c 之后。旧版解析器撞上 = `INVALID_CONVERSATION_REF` + **既有版本偏差教学**（"对端版本较新——升级后重试回复"，ref.ts:36/219 设计好的路径）；不启用 mc3_ 前缀（其 unknown-prefix 报错无教学，更差）
4. **路由判定序**：限定词 `tcp:<别名|starId前缀>:<目标>` > ref 内 starId（查本机条目）> 单条目直用 > 报错教学（列条目，教限定词）。**永不上网遍历/探测**（用户否决探测案：1000 星 O(N) 轮询不可接受）
5. **收发生命周期**：发送永远瞬态（会话级——发时连发完断）；接收按星常驻（proto:1 broker 纯转发不存件，会话级接收物理不成立——解锁懒接收前置是挂账的 broker 存储转发票）
6. **starId 一致性四层保证**：单一真相源（只在 broker.json 出生，唯一分发通道 gen-key）/ 生命周期与钥匙同捆（broker.json 丢失=钥匙同失=必然重发 node.json）/ 连接自校验（info 比对，**先于发 key**——钥匙不泄露给错端）/ 失配必响（随机 12 hex 无碰撞，错 ID 只会 miss 不会错路）
7. **自愈回填**：守护从 info 学到 starId → 条目缺则原子回写 node.json（存量旧配置零手工升级）
8. **命令面**：`--connect <选择器>`/`--stop <选择器>`（别名优先、starId 前缀消歧；--stop 无参=先守后broker全停）；`clean` 不动（收件产物按机器不按星）；uninstall 守卫扩为扫全部 status-node*.json；status --json 只加新键；doctor 加"条目缺 starId"与"双条目同星"⚠️

## 关键否决记录（防翻案）

- **探测路由**（逐档案探 roster）：O(N) 网络遍历，1000 星不可接受——用户否决
- **会话缓存文件**（conversations.json）：延迟/竞态/清理三宗罪，被"starId 进 mc2_"无状态案取代——用户提出
- **mc3_/信封带星**：旧端收到=裸报错无自愈教学，破坏照抄纪律；mc2_ 尾部扩展的报错自带升级指引（代码实证 ref.ts:157/219）
- **info 前置校验**：保证 key 后出手（安全增益）

## 零回归面

旧形状 node.json 全路径字节不变；单星机零新文件；mc2_ 旧编码永续；info.starId 旧端忽略；skill 教学与信封格式零改动（hint 保持裸 `tcp:<mid8>`）。

## 预算与停止条件

- 批次：B0 地基（starId/双形状/info/校验/回填）→ B1 路由（ref 尾部+发送选择+--file 同路）→ B2 命令面（connect/stop/uninstall/doctor/status）→ B3 文档
- 停止条件：npm run check 全绿；单星机行为字节不变；双星双 broker 真机闭环（一机入两星各收发一条）；旧 ref 降级路径可走通；starId 失配报错带教学
- 与 010 的 schema 合租：两张票都在 broker 条目加字段（starId/tls+pin），条目解析扩展需协调（B0 先立条目形状）
