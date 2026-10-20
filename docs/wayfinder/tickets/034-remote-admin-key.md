# 远程管理与管理员钥匙（代码票 B）

label: wayfinder:design
status: open（2026-10-20 定案，二期10 自领；**开工闸门：须用户口令拍板方可写代码**）
blocked-by: 033
claimed-by: 二期10

## Question

管理命令只存在于星心机本机（033 管理插座）。用户需要在 node 机远程管理 broker（如在 win 上管云 broker）且不想 ssh。

## 决策（用户 2026-10-20 拍板）

1. **走 WS + 管理员钥匙**（ssh 包装路线被用户否——"增加复杂度"）：connect 握手认出管理员钥匙即授管理权（无星绑定，星删不灭——钥匙存 broker.json 顶层 admins 段，随 broker 活）。
2. **远程 op 与本机插座同一套**（以 033 实施清单为准：add-star / remove-star / gen-key / set-name / set-port / set-showname / remove-node），同一套 registry 库函数，broker 校验+落盘+对账+回执。
2b. **读 op 三条**（2026-10-20 用户拍板折入）：list-stars / list-nodes / list-members——additive 读帧，受益方=远程管理 TUI（用户已预告将做 broker 管理 TUI）/ doctor 远程诊断 / status --via 增强。**事件订阅推送记牌坊**（触发条件=TUI 立项；v1 TUI 用轮询读 op 即可）。
3. **TLS 明确后置**（用户知情接受）：010 TLS 落地前，管理员钥匙在公网明文线上可被截=全域沦陷，窗口期风险在案；TLS 落地后此暴露闭合。票面记此账。
4. 非管理员调管理 op → 权限报错教学；旧 broker 收新 op → 明确降级报错（不静默）。

## 实施清单

- protocol.ts：connect 帧管理员凭证扩展（additive，旧端忽略）；管理 op 帧族（写 op + 读 op 三条）；broker.md §四 协议规范同步更新。
- registry.ts：admins 段读写；`serve --gen-admin-key`（打印式分发+清屏提示，同 gen-key 口诀）。
- broker.ts：管理员会话标记 + op 分发复用 033 插座同套处理器；非管理员拒+教学。
- CLI：管理命令 `--via tcp:<星>` 远程路由（sender 腿已有 caps 声明复用）。
- 测试：远程加删星全链回执 / 管理员钥匙失效 / 非管理员拒 / 旧 broker 降级报错 / admins 段在星删除后存活。

## 预算与停止条件

预算 **S~M**。停止条件：
1. `npm run check` 全绿
2. 真机 drill：win 远程管理云 broker（加星/发钥/删星全链回执）
3. 协议规范章节与实现一致；三段投递/成员语义零回归
