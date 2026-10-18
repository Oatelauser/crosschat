# reply-hint 管道括注分层教学（024 方案5 的上下文经济化）

label: wayfinder:design
status: open
blocked-by: （无——2026-10-18 用户拍板"分层教学"，四个方案按推荐度呈报后选定）
claimed-by: 二期9

## Question

024 给每封信封的 reply-hint 尾加了全文管道括注"（长正文/含敏感字符可省 --body 改管道喂 stdin）"（~16 tokens/封）——多轮对话与多会话并行时重复计税，上下文经济性受损；但删掉会回归"教学依赖 skill 已加载"的 024 修复前失败模式。

## 定案（用户 2026-10-18 拍板，四案按推荐度呈报）

**分层教学**：turn 1 带全文（首触教学保证在场），turn 2+ 短式"（长文/特殊字符走 stdin）"（~8 tokens——省半税，且上下文压缩卷走早轮后最近信封仍有指针，不靠 skill 单覆盖兜底）。纯函数 of turn，零状态零新命令。否决项留痕：纯条件触发（看来件形态）有"短问长答"不对称洞；纯首轮方案压缩后零保险；删括注回归失败模式。

## 预算与停止条件

- S 票：composeEnvelope 一处三元 + 测试分层断言 + SKILL.md 示例/说明同步；README/broker/federation 示例皆 turn 1 全文天然仍对零改动
- 停止：npm run check 全绿；随下版车；发版前真机两轮（turn 1 全文/turn 2 短式）目验
