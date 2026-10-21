# 单星特例全灭与星域统一指名（036）

label: wayfinder:design
status: closed（2026-10-21 实施关账：实施会话完成+check 778 绿，二期10 真机 drill 验收全过，见文末验收记录）
blocked-by: 无（033/034/035 已关账）
claimed-by: 二期10

## Question

1.9.0 之后命令面与协议面仍残留单星特例（星域家族单星免 `--star`、status 双格式、握手单星旧形、starOf 兜底）——与用户"统一当多星处理，不存在单星机特殊存在"的模型及 035 手册"不分单星/多星"叙事不一致。

## 决策（用户 2026-10-21 拍板）

1. **星域八子一律必须 `--star` 指名**：`--name` / `--gen-key` / `--gen-admin-key` / `--remove-admin-key` / `--remove` / `--list-nodes` / `--list-members`（requireStarScope 七子收紧——单星不再隐式命中）+ 新增 `--star <星> --show-name <名>`（按星机器名，第八子）。"单星期免 --star"教学行随葬（add-star 回执/手册/SKILL/README）。远程 `--via tcp:<星>` 形态天然豁免（星名已在选择器里）。
2. **`--show-name` 两形态**：裸 = 全局默认名（现行为保留，`''` 清除）；`--star <星>` = **条目级覆盖**（node.json 条目 `showName`，缺省回落顶层全局值；broker 侧 `nodes[].machineName` 每星一份现成）。均走插座热改——按星形态只重挂该星聚合器、全局形态重挂全部。**修订 017**"机器名单一事实源"→"全局默认+按星覆盖"（留痕）。node 机手编口径不变（条目字段同生效）。
3. **一次性命令组合拒绝**：`--add-star` / `--remove-star` / `--show-name` 与其他管理旗标同给 → USAGE 拒绝并列出冲突旗标——不再静默吞（用户实证踩过：`--name cloud --add-star cloudstar` 中 `--name` 被无声忽略）。
4. **单星特例四层全灭**：
   - CLI 糖（决策 1）
   - **status 永远按星分组**（writeStatus 的 onlineNodes 单星扁平/多星分组双格式删除，只留分组形）
   - **握手永远倒置形**：info 帧恒不带 starId/name、connected 回填——单星旧形分支删除。混版本无痛：1.9 客户端本就处理倒置形（多星 broker 所迫）
   - **starOf() 的 stars[0] 兜底删除**（032 后钥匙必绑星、连入按钥匙定籍；未绑星连接按 BAD_AUTH 拒）。**回归护栏：022"条目缺 starId → connected 回填"用例必须保持绿**
5. **`--list` 全景显示随条目**：按星命名后各星机器名取该星 `nodes[].machineName`（数据模型现成——注记防实施漏掉）。
6. **推翻留痕**：022"单星字节级不变"（存在理由已被 032 非兼容闸门消解）；017 单一 showName（决策 2）。035 刚教的"单星期免"行随葬系同版车正常迭代，非翻案。
7. **非目标**：命令形态不重构为真子命令（旗标+限定词制不变）；`--list`/`--add-star`/`--remove-star` 等非星域动词零改动；节点侧 `--connect`/`--adopt`/`--member-remove`/`--stop` 零改动；`--port` 维持无命令。

## 实施清单

- serve.ts：requireStarScope 收紧（单星隐式命中删）；一次性命令组合守卫；`--star --show-name` 条目级形态（插座 op + 按星重挂）
- registry.ts / node.ts：条目级 showName 读写（?? 顶层回落）；`--list` 显示随条目
- broker.ts：writeStatus 单格式；info 恒倒置形；starOf 兜底删；set-showname op 双形态（starId 可选=全局）
- cli.ts：help 更新 + add-star 回执"单星期免 --star"教学行改
- broker.md / SKILL.md / references / README：教学行同步（全仓 grep "单星期免"清零）
- 测试：七子单星裸跑拒绝教学 / 按星 showName 覆盖与回落（含 --list 显示）/ 一次性组合拒绝 / info 倒置形恒定（单星也不带 starId）/ 0 星→1 星→2 星同命令路径 / **条目缺 starId 回填用例保持绿**
- CHANGELOG [Unreleased] 条目（含破坏式注记：星域命令单星也须 --star）

## 预算与停止条件

预算 **S~M**。停止条件：
1. `npm run check` 全绿
2. 真机 drill（验收=二期10；**优先查 stateRoot 可否环境变量隔离——可行则独立目录跑 0星→1星→2星 同命令路径，不动真联邦**；不可行再经用户口令拆真网重建）
3. CI 三系统绿

## 验收记录（2026-10-21 二期10）

- 实施会话完工（check 自跑 778 绿 +5 新用例/改写 8），主会话抽查要害落码（组合守卫/requireStarScope 新教学/showName 双形态/add-star 新回执）+ check 复跑全绿；**护栏实证：022"条目缺 starId 回填"用例未动保持绿**
- **真机 drill 全过**（stateRoot 无环境隔离已探明→按用户授权拆真网）：
  1. 换新码 broker → 双星动前照；**一次性组合拒绝活证**（`--name foo --add-star bar` → USAGE 列冲突"分开执行"）
  2. **拆到零星**（d32b→yang 最后一颗可删）→ 零星合法态
  3. **单星新语义活证**：造首星 yang → 裸跑 `--gen-key` → USAGE **"单星也不例外——036 起统一当多星处理"**+示例；`--star yang --gen-key` 过；本会话 re-adopt
  4. 第二星热加 → WSL 重贴钥回归（wsl32 在线）
  5. **按星 show-name 活证**：`--star d32b --show-name win-d32b` → 同机双名并存（d32b 星 win-d32b/yang 星 yang），status 显示随条目；回设归位
- 附带收账：watchdog 测试环境性缺陷修复（pid 写死 12345→0——活联邦在跑即红的根因，票外环境修）；STAR_ID_MISMATCH 检测点后移至 connected（恒倒置的必然推论，用例已注明）
- 提交 942c009；**推送挂账**（github 直连重置+代理不在，ahead 2 待网络恢复补推+CI 核验）
- 记档：status-broker.json 顶层 `name` 字段仍是单星特例残留（票面未列，最小面保留——候选小票）
