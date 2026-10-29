# C14-W07 交付与隔离验证输入

2026-10-29（UTC+8）。执行者 `cworker1`（本机 Claude），root 分发/审计。branch `codex/core-refactor-pre-tui`，起始 SHA `58508d6a78865e884df684092da9979351683f68`（与派单一致，工作区先前只有原未跟踪 `docs/代码消息投递.md`，未触碰）。本单无 checkout/pull/reset/clean/stash/amend/push；提交 SHA 见回报。

## 1. 基线与构建一致性

调用的是构建产物 `dist/`，因此先记源码哈希，再 `npx tsc` 重建并与既有产物逐字节比对（纯研究可只读代码，但本单要跑探针，故核实 dist 对应实际 src）：

| 文件 | src sha256 | 重建前/后 dist sha256 |
| --- | --- | --- |
| `conversations` | `ba45f1f2…3710ca` | `7f8b65b6…3930f48`（前后相同） |
| `envelope` | `7a4c93b6…3fe99` | `7bb0ec8a…590f4da`（前后相同） |
| `application/send/index` | `b6d060ce…9bc63` | `1e0bbb4a…82827c`（前后相同） |

结论：实验时的 `dist/` 与当前 `src/` 一致，未用 HEAD 假定构建。

## 2. 实验（全部合成 ref/临时状态）

命令（仓库根）：

```
node docs/development/evidence/c14-worker-20261029/W07-probe.mjs \
  --out docs/development/evidence/c14-worker-20261029/W07-result.json
```

退出码 0；Node v25.0.0。探针只导入 `dist/conversations.js|ref.js|envelope.js`，每次运行在 `node_modules/.cache/w07-probe-<epoch>-<rand>/` 以非递归 `mkdir` 独占建根（名字占用即失败）；不传 `--out` 时不写任何文件，只打印。撞号初态（API 已不能再产生）用直接写分片表达，其余全部走真实导出函数。完整输出见 `W07-result.json`。

| # | 问题 | 实际观察 | 判定 |
| --- | --- | --- | --- |
| E1 | 历史跨分片同号（不同 nonce）是否让 `handleForRef` 无柄、信封回退完整 ref？ | `handleForRef` → `null`；hint 为 `--conversation mc2_NARjcy0xA3QtMQjCaxsyMfuEWQI`；同参数换成 `c15` 时 hint 为 `--conversation c15` | 复现用户症状 |
| E2 | 撞号号在消费侧是否仍拒绝并列候选？ | `INVALID_CONVERSATION_REF`：`c14 撞号指向多个对话：mc2_… mc2_…——用 --to …` | 拒绝语义保持 |
| E3 | 直接 `claimHandle(file, ref, 15)` 是否顶掉本分片旧 c14、让对方 c14 突然唯一？ | 返回 `c15`；本分片 `{c14}`→`{c15}`；本分片会话行 `ref/updatedAt` 未变；对方分片字节未变；`resolveHandle('c14')` 由抛错变为返回**对方** ref（`isForeign:true`）；`c15` 唯一指向本对话 | **反例成立**：静默选赢家 |
| E4 | 就算同时保留 `{c14,c15}`，普通记账是否收敛成最后一个？ | `recordConversation(下一轮)` 后 handles 仅 `{c15: 新ref}`；`resolveHandle('c14')` 解析到对方 | **双柄不稳**：刷新腿必须一起改 |
| E5 | 分配写失败是否原子（旧 c14 保留、无幽灵柄、无残留）？ | 分片设为只读后 `claimHandle` 抛 `CONVERSATION_STATE_WRITE_FAILED`；分片字节与初态逐字节相同；`c14` 仍撞号；目录无 `.tmp` | 单写 + 写后校验成立 |

E3/E4 是“为什么不能直接补分配/只加柄”的直接证据；E1/E2 是现状与拒绝语义基线；E5 是 W08 必须沿用的写失败边界。

## 3. 源码核对（未改产品）

- 五个会话写入口逐一核对：`handleForRefLocked`（`src/conversations.ts:602-611`）、`claimHandleLocked`（`:632-642`）、`recordConversationLocked`→`refreshHandles`（`:439-456`、`:519-545`）、`continueFromRef`→`reconcileRefinement`（`:259-364`，冲突跳过 `:326-327`、修剪 `:337`）、`continueConversation`（只读，`:222-241`）。
- `claimHandle` 在 `src/` 无生产调用方（仅测试）；生产只经 `handleForRef` 进入分配。
- 只读路径：`resolveHandle`、`latestKnownConversationRef`、`machineNameOfPair`、`loadAllPairs`、`queries/files.ts` 展示——恢复方案不需要改解析语义。
- 维护删除：`clean/force-clean` 在 `application/maintenance/operations.ts:62-72` 无锁删 `conversations/*.json`，属既有“无传输时执行”合同，本单不改变、W08 也不应改变。
- 发送接线只读核对：`send/index.ts:473-475` 在投递前取柄、`:533/:545/:561/:610/:621` 投递后记账；`federation.ts:363-364`、`serve/via-tcp.ts:536-537` 接收腿同样先记账再取柄。别名方案不需要改这些接线。

## 4. 检查与未跑的检查

- 探针本身是一次真实执行：语法、导入面、锁文件/分片写读、失败分支（E2 拒绝、E5 写失败）都实际跑过；无大框架、无新依赖。
- 按任务要求**未**跑全量 `npm run check`（纯研究/报告单）；未做文字包含式的镜像测试；未改 `src/`、`test/`、skill、包文件。
- 分析结论为“下一单需要 RED-GREEN”的清单，本单不产出产品测试。

## 5. 清理与归属

- 实验根：`node_modules/.cache/w07-probe-<epoch>-<rand>/`，运行内非递归独占创建；结束前核对绝对路径确在 `node_modules/.cache` 下且属本次前缀，再递归删除，`cleanup.removed: true`（见 `W07-result.json`）。
- 未触碰既有 `node_modules/.cache/c14-regression-results-20261028.json`、`crosschat-c14-caller-research-20261028/`、`crosschat-w05-root-check-20261029-*.log`。
- 未触碰真实 `~/.crosschat`、原生会话/配置、未发任何跨机消息。
- 留存证据：`W07-probe.mjs`、`W07-result.json`、本文件、`docs/research/c14-short-hint-recovery-20261029.md`。

## 6. 范围、风险与未决

- 交付文件仅白名单四项；原未跟踪 `docs/代码消息投递.md` 原样保留。
- 推荐方案（别名式恢复）仍留“LRU/清理单边淘汰导致旧号误指”的窗口，与现状同类；彻底消除需新持久信息，交 user 拍板，见研究稿 4.3。
- 降级到旧版本会按旧刷新规则收敛别名，退回 E3/E4 的翻转行为；W08 提交说明须写明。
- 未决：恢复腿写失败时建议回落 `undefined`（长 ref 照发），而不是让今天的成功发送失败；此点请 root 在 W08 派单时确认。
