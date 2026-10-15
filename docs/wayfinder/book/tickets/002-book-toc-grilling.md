# 书的完整目录拍板（SUMMARY.md）

label: wayfinder:grilling
status: open
blocked-by: （无——001 调研不影响目录结构）
claimed-by: （待领）

## Question

全书完整目录（SUMMARY.md）是什么？立图需求 #1：用户必须亲眼看到**完整目录**并逐项拍板。

- 起点约束（站定性）：读者真零基础，安装链（Node → 两 agent CLI → crosschat）是主线正文不是附录
- 第一课终点推荐：同机 claude↔codex 互发一条消息并收到回复（零 broker 的最小魔法时刻）——可辩
- Diátaxis 四象限的章序与分层：教学主线 / How-To / Reference / Explanation 怎么排（渐进揭示：底层细节不进前三章）
- 六份旧文档（README/usage/commands/architecture/broker/federation）的内容各归入哪些章（重造素材映射）
- 联邦/tcp/broker 进阶内容全部后置到主线闭环之后

产出：`/docs-book/SUMMARY.md` 整册草稿（prototype：先出全量目录给用户逐项反应，再收敛）。调用 grilling + domain-modeling + prototype。

## 预算与停止条件

- 一次会话；目录不到整册不许收敛散会。
- 停止条件：用户对目录树每一章点头（或砍掉），SUMMARY.md 定稿入 main。
