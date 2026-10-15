# 书的完整目录拍板（SUMMARY.md）

label: wayfinder:grilling
status: closed
blocked-by: （无——001 调研不影响目录结构）
claimed-by: main-session（2026-10-15 制图会话续领，用户口令「开票」）

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

## Resolution

目录定稿（2026-10-15，完整目录一屏展示 + 四问拍板全中推荐案）：**32 节四部**——前言（含 🤖/👤 符号约定）+ 教程 7 课（真零基础安装链为主线正文）+ 指南 8 Recipe + 参考 7 表 + 原理 7 篇 + 附录 3 件。产出 `docs-book/src/SUMMARY.md`（v1.0）。

四拍板：

1. **教程六课全写**——毕业标准 = 能在多台机器组建 tcp 星型消息网；ssh/tcp 后置在第 3 课同机闭环之后，渐进揭示不破
2. **Windows 演示主线**——正文用 win 终端命令，Linux 每步一行带过（与旧 repo 文档「Linux 为主」规范反向，书是新受众）
3. **第 4 课「起名字与换班」留主线**——名字是寻址根基，-n/rename/extends 早教
4. **附录三件全收**——A 名词表（小白救生圈）/ B FAQ / C 完整验证阶梯

六份旧文档素材全覆盖：README 故障恢复并入「排查」Recipe；路线图/开发说明属 repo 面不入书。自制漏项两处已补：参考部「投递语义与边界限制表」（usage）、原理部「发件箱与看门狗」（architecture 6）。
