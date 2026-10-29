# C14-W07 交付与隔离验证输入（W07-R1 返修版）

2026-10-29（UTC+8）。执行者 `cworker1`（本机 Claude），root 分发/审计。branch `codex/core-refactor-pre-tui`；首轮起始 `58508d6a78865e884df684092da9979351683f68`（交付 `e338857`），返修基线 `572280dd69e391c5d850401adb9a7a59208d24d8`。本单无 checkout/pull/reset/clean/stash/amend/push；提交 SHA 见回报。原未跟踪 `docs/代码消息投递.md` 未改、未 stage。

首轮审计结论已接受：**“别名式恢复 + 不改 LRU8 + 旧号不动”不闭环**，研究报告已撤回该结论并按 [W07-review.md](W07-review.md) 收窄；本文件同步修正源码口径、E5 范围并补 E6。

## 1. 基线与构建一致性

调用构建产物 `dist/`。首轮已用 `npx tsc` 重建并与既有产物逐字节比对（三文件哈希前后相同）；本轮未再改 `src`，产物哈希与 root 独立复放一致：

| 产物 | sha256 |
| --- | --- |
| `dist/conversations.js` | `7f8b65b6…3930f48` |
| `dist/ref.js` | `4e9f77e5…187819` |
| `dist/envelope.js` | `7bb0ec8a…90f4da` |

源码对应哈希见首轮记录（`W07-result.json` 未改，SHA256 `e256133b503b2fba4507fb5f1fdb5934af98e04be24f01c571f20081d3aee302`）。首轮之后 `src/` 无改动，故产物仍对应实际源码。

## 2. 探针修正（输出保护与收口）

`W07-probe.mjs` 本轮只做任务书要求的最小加固，不扩研究工装：

- `--out` 校验移到**任何临时实验根创建之前**：路径已存在则打印 `{"error":"refusing to overwrite an existing output",…}` 并以退出码 3 结束，不跑实验、不建根、不写文件。
- 最终写入用 `writeFileSync(..., { flag: 'wx' })`；运行期间文件才出现同样失败（退出 1、不覆盖）。
- 整体状态根进 `try/finally`；E5 的只读权限恢复也走 `finally`；清理前核对绝对父目录等于 `node_modules/.cache` 且目录名匹配 `w07-probe-<epoch>-<8hex>`，只删本次独占创建成功（非递归 `mkdir`）的根。
- 新增 E6，其余 E1–E5 断言逻辑未改。

## 3. 实验（全部合成 ref/临时状态）

默认运行（不写文件）：

```
node docs/development/evidence/c14-worker-20261029/W07-probe.mjs
```

退出 0；Node v25.0.0；E1–E6 全 pass；`cleanup.removed: true`。留存结果（新路径，`wx` 写入）：

```
node docs/development/evidence/c14-worker-20261029/W07-probe.mjs \
  --out docs/development/evidence/c14-worker-20261029/W07-R1-result.json
```

| # | 问题 | 实际观察 | 判定 |
| --- | --- | --- | --- |
| E1 | 历史跨分片同号（不同 nonce）是否让 `handleForRef` 无柄、信封回退完整 ref？ | `handleForRef → null`；hint 为 `--conversation mc2_NARjcy0xA3QtMQjCaxsyMfuEWQI`；同参数换 `c15` 时为 `--conversation c15` | 复现用户症状 |
| E2 | 撞号号在消费侧是否仍拒绝并列候选？ | `INVALID_CONVERSATION_REF`：`c14 撞号指向多个对话：mc2_… mc2_…——用 --to …` | 拒绝语义保持 |
| E3 | 直接 `claimHandle(file, ref, 15)` 是否顶掉本分片旧 c14、让对方 c14 突然唯一？ | 返回 `c15`；本分片 `{c14}→{c15}`；会话行 `ref/updatedAt` 未变；对方分片字节未变；`resolveHandle('c14')` 由抛错变为返回**对方** ref（`isForeign:true`）；`c15` 唯一指向本对话 | **反例成立**：静默选赢家 |
| E4 | 分片即使同时含 `{c14,c15}`（同 nonce），普通记账是否收敛成最后一个？ | `recordConversation(下一轮)` 后 handles 仅 `{c15: 新 ref}`；`resolveHandle('c14')` 解析到对方 | **双柄不稳**：刷新腿必须一起改 |
| E5 | 分配写失败是否原子？ | **仅本机 Windows 只读目标**：分片设为只读后 `claimHandle` 抛 `CONVERSATION_STATE_WRITE_FAILED`；分片字节与初态逐字节相同；`c14` 仍撞号；目录无 `.tmp` | 只证明该失败路径，不覆盖所有写失败/崩溃 |
| E6 | 满 8 槽时第九个不同 nonce 柄是否立即淘汰首键，并让对方的 c14 唯一？ | A 先按序持 `c14..c21`；B 另持不同 nonce 的 `c14`（此前 `resolveHandle('c14')` 抛撞号）；加入 `c22` 后 A 变 `c15..c22`，`c14` 立即解析到 B，B 分片字节未变 | **恢复当刻即矛盾**；证明的是现有 LRU 规则，不是尚未实现的别名分配器 |
| E6 备注 | 若为腾槽跳过撞号键 | 被淘汰的仍是某个旧键，可能是**另一组**撞号的柄 | 保护当前旧号不构成安全论证 |

## 4. 源码口径修正（相对首轮）

- `handleForRefLocked` 用 `mine.find(...)`：**任一**现存安全柄即可复用，不是“全部安全才返回”；无安全柄才 `undefined`。
- 公开会话写 API 是**四个**：`handleForRef`、`claimHandle`、`recordConversation`、`continueFromRef`（`reconcileRefinement`）。`continueConversation` 只读，不计为第五写者；`resolveHandle`/`latestKnownConversationRef`/`machineNameOfPair`/`loadAllPairs`/`queries/files.ts` 只读。
- `claimHandle` 在 `src/` 无生产调用方（仅测试）；生产经 `handleForRef` 进入分配。
- CAS **首次候选号也可能与外来绑定重复**；首次写先落地、重试再顶替本次刚写的号。残留期间该号两份并存、解析按撞号拒绝；“属于我们”不是安全论证。写序/失败次序须在实施单写定。
- 刷新别名会改变同 nonce 去重与 LRU 触碰/槽位语义（同 nonce 多柄由临时态变持久态），不得称为 LRU 语义不变。
- 维护删除：`clean/force-clean` 无锁删 `conversations/*.json`，属既有“无传输时执行”合同；任何冲突号保证都必须说明清理影响。

## 5. 检查与实测输出

| 检查 | 命令/方法 | 结果 |
| --- | --- | --- |
| 语法 | `node --check W07-probe.mjs` | 通过 |
| 默认探针 | 无 `--out` 运行一次 | 退出 0；E1–E6 pass；`wrote:false`；临时根 `removed:true` |
| 已存在输出拒绝 | 预置 `existing.json`（`sentinel-bytes`）后 `--out` | 退出 3；文件字节不变；`node_modules/.cache` 条目数 3→3（实验前即拒绝，未建实验根） |
| 新输出合法 | `--out <新路径>` | 退出 0；`wrote:true`；JSON 可解析；E1–E6 pass；根已删 |
| 不覆盖 | 对同一新输出再跑一次 | 退出 3（`wx`/拒绝），内容未被覆盖 |
| 原证据 | `sha256sum W07-result.json` | 仍为 `e256133b503b2fba4507fb5f1fdb5934af98e04be24f01c571f20081d3aee302` |
| 残留 | `ls node_modules/.cache` | 仍只有本单前就存在的 3 项（`c14-regression-results-20261028.json`、`crosschat-c14-caller-research-20261028`、`crosschat-w05-root-check-20261029-*.log`） |
| 差异 | `git diff --check` | 退出 0（仅 Git 的 LF→CRLF 提示，无空白错误） |

按任务书未跑全量 `npm run check`，不做文案字符串测试；未改 `src/`、`test/`、skill、包文件、root 记录与历史证据。

## 6. 清理与归属

- 每次运行在 `node_modules/.cache/w07-probe-<epoch>-<8hex>/` 非递归独占建根；`finally` 中核对父目录与名字前缀后递归删除；两次实测均 `removed:true`。
- 未触碰既有 3 项 cache 产物、真实 `~/.crosschat`、原生会话/配置；未发任何跨机消息。
- 留存：`W07-probe.mjs`、`W07-result.json`（未改）、`W07-R1-result.json`（新）、本文件、`docs/research/c14-short-hint-recovery-20261029.md`。

## 7. 范围、风险与未决

- 本轮为研究返修：**未实施产品**，未创建/启动 W08；四个候选（维持现状、满槽回退的别名追加、机器级账本、否掉项）均未获批准，需用户决定。
- 已撤回“零合同变化闭环”结论：满槽追加在恢复当刻就淘汰旧键（E6），且保护当前旧号不保护另一组撞号柄。
- E5 仅覆盖 Windows 只读目标失败；崩溃、部分写、其他平台的原子性未由本单证明。
- 建议（待 root 确认，未实施）：任何恢复腿失败回落 `undefined`（完整 ref 照发），避免为可选 hint 引入无必要的发送失败。
