# v1.6.2 首轮现场反馈打磨

label: wayfinder:design
status: open
blocked-by: （无——可与 022 前后任意排；反馈归档 ../drill-reports/field-feedback-20261015.md）
claimed-by: （待领）

## Question

v1.6.2 win↔云端三段直达首轮实地反馈（双端零报错），四条可做摩擦点（用户 2026-10-15 拍板立票）。

## 方案（四条）

1. **`send --body-file <路径>`**：读文件为正文，免 shell 转义（双端同列"最实际"——引号/$/反引号规避或 stdin 管道都要多步心眼）；与 stdin 管道并存，大小上限沿用端点规则
2. **信封补正向坐标**：from 侧带三段地址 `tcp:<星>:<机器>:<工具>/<会话>`（与 020 限定词对齐）——收件方一眼知道对端在哪台机哪个形态，消除"以为 win 会话在云端"的错位。**先查证**：跨机信封已带 from-machine，缺的是呈现与单机/星内覆盖；按查证结果定最小覆盖面
3. **skill 补"查自己地址"教学**：`crosschat status --stars` 看本机成员行（1.6.2 起带 `工具/名`）= 自己的三段地址；发起方不用等对方信封才知道 reply-as
4. **身份冲突自纠 PowerShell 写法前置**：SKILL.md 的 CALLER_IDENTITY_CONFLICT 条目 bash 前缀在前、PowerShell 注在后——win 主壳是 PowerShell，调换顺序或 PowerShell 优先

## 挂账（不做承诺）

- 防伪造信封机器层防护（reply-hint 签名/校验）——信任模型变更，评估票另开
- 跨机正文"别堆本机细节"自查负担（对端防护是对端策略）、轮次收尾自觉——接受残余（skill 已覆盖）

## 预算与停止条件

- 规模 S 票 ≤250 行（含测试与 skill/文档）
- 停止条件：npm run check 全绿；真机——--body-file 发送中文/引号/反引号混合正文逐字到达；信封坐标呈现双端可见；skill 两处更新随发
