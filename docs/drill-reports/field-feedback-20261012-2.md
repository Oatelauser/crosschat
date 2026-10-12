# 现场反馈 2026-10-12（二）：v1.5.4 首日 drill——P1 机器标识跨形态解析断裂

> win(tcpworker) ↔ cloud(broker2) 4 轮往返。E0 星名词表、E1 远程枚举、D0 瘦信封全部现场生效；同时抓到 P1 级 bug。

## P1：回信给 Windows 机器经 conversation ref 全断（已修 F0）

- 现象：云端照抄 reply-hint 的 `--conversation mc2_…` → UNKNOWN_MACHINE；绕道 `--to 名 --via tcp:label` 恢复
- 真根因（比云端 agent 的诊断再深半层）：Windows MachineGuid 是**带杠 UUID**，Linux /etc/machine-id 是**纯 hex**——ref 端点携带的 win 机 mid 带杠，broker resolveTarget 的 `^[0-9a-fA-F]+$` hex 判定拒收带杠串 → 掉进按名字分支 → 无人叫这个名字。**不是"不支持 mid 匹配"，是形态不可知**
- 对称性验证：回信给纯 hex 机器（云端）全程通（win 侧 4/4 delivered），回信给带杠机器（win）全断——旗舰路径（Windows 为主力平台）断裂
- 修法（F0，三轮俯瞰定案）：归一只做比对边界（resolveTarget 双侧/autoViaFromRef/onConnect 绑定/roster 碰撞预警五处）；**存储与线上帧保持历史形态**（platform canonical 化被否决——混合版本窗口 BAD_AUTH 断连）；ref 对象保真（编解码往返不静默重写）；UNKNOWN_MACHINE 列候选 + mid 前缀 did-you-mean

## 流程教训（入档防再犯）

**身份类测试必须用平台真实形态夹具**：D0 的 autoViaFromRef 测试全绿——但合成夹具全是纯 hex，主力平台 Windows 的 machineId 天生带杠，测试库里没有任何一条真实形态。与 B21"本地绿 CI 红"同族：测试环境与真实平台的形态差异，单靠想象补不齐——凡涉 machineId/sessionId 类平台标识的测试，夹具必须取自真实平台样本（本 drill 的 `ec542c2c-28e7-42d1-9028-10f989d21f8b` 已入 F0 回归夹具）。

## 现场正向验证

- E0：win node.json 已新词表（`name: cloud-broker`/`showName: yang`），`serve --name` 实际在用
- E1：win agent 实测 `status --via tcp:` 列出远机会话（含 busy 态），并自行修正了"远程会话名只能靠告知"的过时记忆——教学闭环生效
- D0：瘦信封照抄零失误；turn 4 告别乒乓被 agent 主动掐断（skill 收尾纪律生效）

## 遗留建议处置

- `crosschat reply --last` 新命令：**不做**（违背低入侵约束；ref 修复后照抄即最短路径）
- 收尾轮省唤醒/turn 预算首条预设：skill 已有教学，重装 install-skills 后自愈，不加新机制
