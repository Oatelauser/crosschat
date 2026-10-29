# C14-W02 复核输入：异步协作与可执行回信契约

2026-10-29。worker `cworker1` 提交给 root 审计。本文件只记录可复核证据、根因判断和改动；不代替 root 验收。

## 基线

- 仓库：`D:/workspace/CC/multichat`
- branch：`codex/core-refactor-pre-tui`
- 本单开始 HEAD：`0f34fb3270111d9e458c552bce9a44aa4ba964a6`
- 代码基线：`0f146c00db013178069ad41bd8b84222b26045ac`
- 完成 SHA：本文件所在 commit（见回报消息；本文件无法包含自身 commit 哈希）

## 三类问题的证据与判断

### 1. 分发者持续等待

观察：root 派单后保持当前轮等待回报；worker 首份握手走默认 `queue`，在 root 忙时寄存，直到 root 结束当前轮才被处理。

判断：这是代理使用流程问题，不是网络等待或投递缺陷。`queue` 的语义本来就是“目标当前轮结束后处理”（`references/delivery.md`），分发者保持当前轮等 `queue` 回报必然空等。原有 skill 已有“发送后继续工作或结束本轮”的句子，但不在主文件必读区，执行时容易漏读。

未确定：无法从本机状态判断 root 当时是否读过该段；只能确认投递状态为 `parked`/`delivered`，与空等现象一致。

### 2. 全局 CLI 与仓库 CLI 能力不一致

只读核实（2026-10-29 11:5x 本地）：

| 入口 | 版本 | `send --help` 是否含 `--tool` |
|---|---|---|
| 全局 `C:/Users/yangsheng/AppData/Roaming/npm/crosschat` → `@oatelauser/crosschat` | 1.12.0 | 否 |
| 仓库 `node D:/workspace/CC/multichat/dist/cli.js` | 1.10.0 | 是，且为必填 |

源码核对：`git show v1.12.0:src/cli.ts` 不含 `--tool`；`v1.11.0` 同样不含。`--tool` 由本分支 `0f146c0 feat: require explicit recipient tool types` 引入，该分支基于 main `1.10.0`。因此版本号大小与能力顺序相反，不能用“谁版本高”判断新旧。

已安装 skill（`~/.claude/skills/crosschat`）与仓库 skill（`skills/crosschat`）全部文件不同：安装版仍是 `--tool` 之前的文案，仓库版要求每次发送填写收件类型。这解释了同一台机器上“按安装版 skill 用全局 CLI”和“按仓库契约用仓库 CLI”两种行为并存。

未确定：全局包 1.12.0 的发布来源与仓库 tag `v1.12.0` 是否同一构建，本单只核对了版本号与 help 能力，没有解包比对构建产物。

### 3. 短柄失效/撞号

只读核对 `~/.crosschat/conversations/` 分片（不展示完整 ref 与正文）：

| 分片 | pair 形态 | 短柄 | nonce 前缀 | 最后更新 |
|---|---|---|---|---|
| `80325e46` | 无类型：`claude:<id>` + `codex:<id>` | `c14` | `53250b` | 11:07:10 |
| `8209f94e` | 部分类型：`["claude","cli",<id>]` + `codex:<id>` | `c14` | `2856f0` | 11:40:35 |
| `19170135` | 全类型：`["claude","cli",<id>]` + `["codex","desktop",<id>]` | `c15` | `fb8b4a` | 11:19:19 |

send-log（同日，仅元数据）显示同一对会话存在三条对话线：`2856f0`（对方发起，turn 1–5）、`53250b`（worker 经全局 CLI 首次回信，turn 1，`parked`）、`fb8b4a`（worker 经仓库 CLI，turn 1–2）。三条线分别落三个分片，`c14` 被两条不同 nonce 的对话线同时占用，因此解析时报“撞号指向多个对话”。

“已过期或未知”的首次报错发生在 11:07 之前：当时本机确实没有 `c14` 记录，属于真实未知，不是状态损坏。

状态根核对：全局 CLI 与仓库 CLI 都读写同一个 `~/.crosschat`（分片目录相同），不存在“不同构建读取不同状态根”的证据。

判断：
- 已确认：同一会话对因收件端类型解析进度不同，形成多条 pair key（无类型/部分类型/全类型），各自成为独立对话线；短柄分配跨分片进行，最终出现同号不同 nonce。
- 未确定：`c14` 重复分配的确切机制。当前代码用机器级 `max+1` 分配并对写后扫描做一次 CAS 重试，但注释明确“无跨进程锁”；两条对话线由不同进程在不同时刻写入，本单未复现该竞争，也未证明是哪一次写入绕过了检查。不把推测写成结论。

代码层面：未发现可稳定复现的缺陷；若 root 要归因到分配器，需要独立代码单和受控并发 fixture，本单不改 `src/**`。

## 规则修订（与已批准 C14 合同的关系）

只改文案，不恢复无 `--tool` 兼容、不改默认 `queue`、不改协议或持久格式。

- `skills/crosschat/SKILL.md`（必读区）：新增发送后即结束/继续独立工作、不 sleep/轮询/空转；`queue` 忙时延后，分发者不保持当前轮等回报，明确要求时 worker 对该条报告 `steer`；发送前核对入口实际能力，协作方统一已核实入口。
- `references/delivery.md`：补 `queue` 与分发者等待的关系。
- `references/reply.md`：补短柄撞号时按完整 ref 比对回信、hint 缺命令时补齐 `--tool` 或改用支持该参数的入口。
- `references/errors.md`：新增 `INVALID_CONVERSATION_REF` 两种形态和“入口不支持 `--tool`”的恢复路径。

## 验证

- 文档变更，不新增“字符串包含规则”式测试；没有单元测试能保证 LLM 必然服从这些流程规则，此处如实说明该限制。
- 相对链接核对：编辑文件内引用的 `references/*.md` 均存在于 `skills/crosschat/references/`。
- 命令示例与仓库 CLI `--help` 一致（`--tool` 必填、`--delivery queue|steer`、`--conversation`）。
- 未跑全量 `npm run check`（按任务书由 root 统一审计）；未改 `src/**`，未跑产品测试。

## 清理与范围

- 未安装/升级软件，未起常驻服务，未改全局 CLI 或已安装 skill。
- 未读写真实 outbox 之外的业务数据；核对只读 `conversations/` 与 `send-log.jsonl` 的元数据，未展示令牌、正文或全历史。
- 未改动原未跟踪文件 `docs/代码消息投递.md`。
- 本单修改：`skills/crosschat/SKILL.md`、`skills/crosschat/references/delivery.md`、`references/reply.md`、`references/errors.md`、本文件。
