# 通信任务交接：Codex Desktop「Bug修复2」

2026-10-29（UTC+8）。用户明确要求把通信任务全部交给现有 Codex Desktop 会话 **Bug修复2**，由用户亲自对接。本会话停止相关派单/实施；原 worker `cworker1` 已停写并收到不再继续的通知，内部 `short_hint_fix` subagent 也已停止且确认**没有改代码、测试或任何文件**。

**交接后更新（2026-10-29）**：用户已在 Bug修复2 完成短柄方案讨论并明确“开始”，批准 `cA000`～`cZ999` 五字符有限回环、复用现有分片进度、最近 1000 次分配窗口、原 LRU8、普通清理保进度与强清重置。用户授权的 19 份旧会话分片删除已完成，不做数字柄/旧全局文件兼容。实施与验证见[短柄批准规格与记录](c14-short-handle-ring-20261029.md)；下文“尚未批准”描述保留为交接当时的历史，不代表当前实施仍需再次批准。C14 的来源关联等父项未因此完成。

## 用户最新决定（优先于之前排期）

1. 短信封/撞号处理 **不新增运行状态文件**，避免运维压力；新增独立机器级账本文件方案已否决。不要重新要求批准该方案。
2. **先讨论具体方案，不能直接修改代码。** “起 subagent、并行开发”随后被用户明确收窄为先讨论；短信封修复没有获得具体方案实施批准。新增现有分片字段、别名/LRU/清理变化也不能当作已默认批准。
3. 用户原先要求下一项仍优先短信封恢复；本会话误将“开始下一个任务”解释为转去 W08 来源研究，用户已指出此误解。不要再以来源研究替换短信封讨论。
4. 后续由用户直接与 Bug修复2 对接。无需等本会话审批，也不要自动续用 cworker1 派产品实现。

## 仓库和写入状态

- 仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`；交接前 HEAD `1066e3015b3987f4f80b46653fb62110cd49fa20`。本交接记录随后由 root 独立本地提交，不 push。
- 原未跟踪 `docs/代码消息投递.md` 属既有用户工作，不修改/删除/stage。
- `docs/development/evidence/c14-worker-20261029/W08-root-probe.json` 是 root 首次真实 Desktop 采样，本次纳入交接提交保留；不要覆盖或把它当新版实例核验通过。
- 无在进行的产品代码写入。本会话没有实施短信封修复；W08 仅探针/文档，没有改 `src/**`/`test/**`。
- 全部提交仅本地；不要 amend、切分支、reset、stash、clean 或批量 stage 接管别人的内容。

## 当前用户症状和已证实原因

来信的 reply hint 一度从 `c14` 变成长 `mc2_...`。已用真实 dist API + 合成分片复现：两个不同 nonce 共用 c14 时，`handleForRef` 找不到安全柄，返回 undefined，`composeEnvelope` 使用 `handle ?? ref` 回退完整 ref。完整 ref 仍可发送；显式使用歧义 c14 会拒绝并列候选。

W04 修复了当前写 API 的新并发分配和类型细化覆盖，**没有修复历史用户状态**；真实旧 c14 的历史形成机制没有追认。后来 worker 换到新原生会话，双方以 c16 正常协作，**这不等于旧 c14 已修复**。

关键源码：

- `src/conversations.ts`：四个会话写 API `handleForRef`、`claimHandle`、`continueFromRef`、`recordConversation` 共用单机目录锁；`continueConversation`/resolve 为只读。
- `handleForRefLocked` 约 602 行使用 `mine.find`，任一安全柄即可复用；不是要求所有柄安全。
- `refreshHandles` 约 519 行：新柄会丢弃同 nonce 旧柄，普通刷新只保留最后一个同 nonce 柄；每分片 `HANDLE_MAX=8`，插入序作 LRU。
- `src/envelope.ts` 约 87 行回退完整 ref；生产发送前取柄，投递后记账 best-effort，不得因记账失败重发。
- `src/application/cleanup/index.ts`：普通清理删 30 天未更新分片，force 清理删全部分片；现合同不保证并发维护删除。

## 已验收的八个 worker 子单

| 子单 | 真正完成的范围 | 最终记录 |
| --- | --- | --- |
| W00 | doctor 测试隔离 | `evidence/c14-worker-20261029/W00-review.md` |
| W02 | 协作流程、入口能力和回信恢复规则文案 | `evidence/c14-worker-20261029/W02-review.md` |
| W03 | 旧分配器并发反例与隔离诊断 | `evidence/c14-worker-20261029/W03-final-review.md` |
| W04 | 会话写互斥、类型细化撞号保护、接线与失败回归 | `evidence/c14-worker-20261029/W04-final-review.md` |
| W01 | CLI/Desktop 来源可行性研究，候选不升级生产识别 | `evidence/c14-worker-20261029/W01-final-review.md` |
| W05 | 受控 CLI exec 的 Hook/call ID 局部原生关联及限定研究工装 | `evidence/c14-worker-20261029/W05-final-review.md` |
| W06 | 两处测试时序脆弱性修复，保留原语义断言 | `evidence/c14-worker-20261029/W06-final-review.md` |
| W07 | 长信封现象、错误恢复反例和候选边界研究，未实施产品 | `evidence/c14-worker-20261029/W07-final-review.md` |

最近产品完整 `npm run check` 为 W06 的 **2503 通过/11 原有跳过，230 文件通过/3 跳过，退出 0**；之后研究脚本的检查不等于产品全量又通过。原 25 个工具任务、11 个 CI 相关索引仍保留，见 `tool-compatibility-ci-tasks.md`；C14 整体未完成。

## 短信封方案已有反例，不必重跑全景研究

主报告 `docs/research/c14-short-hint-recovery-20261029.md`，证据 `evidence/c14-worker-20261029/W07-result.json`、`W07-R1-result.json`，审计 `W07-review.md`。

- E1/E2：历史撞号导致无短柄，完整 ref 回退；消费歧义号仍拒绝。
- E3：直接 claim c15 会删掉本侧 c14，让对方 c14 从歧义变为唯一，旧信封可能串到另一段对话。
- E4：只追加同 nonce 别名也不够，普通刷新会收敛掉旧号，翻转推迟到投递后。
- E6：满 8 槽 `c14..c21`，追加第九槽 c22 会立即淘汰最老 c14，使对方 c14 唯一；保护当前旧号却牺牲另一组撞号同样不安全。
- E5 只证明 Windows 只读目标写失败时字节不变、无幽灵柄/tmp，不能推出所有崩溃/失败都如此。

因此不要直接把“保留别名且不改 LRU8”当作完整方案。新文件已否决，下一步应同用户讨论复用现有分片的具体方案、容量/过期/清理及失败影响。没有批准某个新增字段或新的永久保留规则。也不要为了任意历史柄永久安全扩大成新存储系统；清空状态后的旧柄保障须明确边界。

## W08 最新交付（未完成 root 最终验收）

worker 最新提交 `ebf79d5`、`96457a7`、`1066e30`，仅研究探针和文档。任务 `evidence/c14-worker-20261029/W08-task.md`；报告 `docs/research/c14-desktop-os-source-anchor-20261029.md`，检查 `W08-probe-check.mjs`、`W08-result.json`、`W08-result-b.json`、`W08-review-input.md`（以当前树实际文件为准）。

root 已采样：`codex-ipc` 的 OS serverPid=14368，为进程表中的 ChatGPT.exe；当前链 node47768 → pwsh31232 → desktop-bundle codex24716 → ChatGPT14368；逻辑 owner 已知但为 client-id，不是 PID。原采样 SHA256：`5557f812f83d8edbb3c5f61410b59f0e2274aac9c9605f76393985f7e1794238`。

**定级限制**：首版采样只用 PID，故只能叫先后 PID 匹配观察、instance-unverified。新版 worker 把创建时间接入对账、将 TEMP/TMP 指向自有根、错误脱敏、受控子进程 kill 后等 close；自报 9 项通过，root 尚未复审/复跑。新版创建时间仍在关闭 pipe handle 后采，有 PID 复用观察窗口；不能写成零风险证明。没有新原生 `W08-root-probe-b.json`；worker 提出的补采未执行，交接不要求立即补跑。

生产来源仍 `CODEX_SOURCE_ASSOCIATION_UNVERIFIED`，未配置 Hook、未接 identified/Provider、未做新用户配置或原生软件安装/启停。W08 不应阻塞用户先讨论短信封。

## 协作和清理约束

如用户以后决定继续使用 crosschat：仓库入口 **`node dist/cli.js`**，全局 CLI 缺必需 `--tool`；用户明确代发用 `--delivery steer`。发送成功后不轮询/空等，结果不明不重发。cworker1 当前 c16，原生会话已换过，不使用失效的旧完整 ref 猜路由。

自动审批曾拒绝删除的旧缓存/日志保留，**不换机制重试**；尤其 `node_modules/.cache/crosschat-w05-root-check-20261029-1793262269226.log`，以及 W01 原研究缓存，沿用户 D 盘统一清理约定。没有远端隧道/fixture 待接管，不在远端 Linux 安装 Codex。

本交接仅转移通信相关事项及上述证据。用户在新会话作决定；本会话不再并行推进或替对方批准产品方案。
