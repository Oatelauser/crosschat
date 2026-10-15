# 三段寻址工具维度（会话段限定词 claude/codex）

label: wayfinder:design
status: open
blocked-by: （无——独立于 019/010，可先行）
claimed-by: （待领）

## Question

1.6.1 真机验证用户发现（2026-10-15）：三段寻址会话段无工具维度。同机 claude/codex 同名会话（后续多适配器下是常态）时，broker `resolveSessionMember` 按**首个名命中**返回（`src/serve/broker.ts` 018 批一实现）——静默投给先 attach 者，连报错都没有。对照：单机 `--to` 早有 `NAME_COLLISION`，跨星三段反而裸奔；origin 字段已有 `claude/boss@yang` 语法先例。

018 裁定 1（成员键=会话 ID，"同名不歧义"）与裁定 4（跨机重名合法）只覆盖**跨机**重名；**同机跨工具**同名是盲区。多适配器（GLM/opencode/zcode/deepseek-harness 已挂账）每接入一家，撞名概率乘一。

## 用户拍板（2026-10-15）

方案 A：会话段可选工具限定词 `tcp:<星>:<机器>:<工具>/<会话>`。裸名唯一时照用（零破坏）；撞名报碰撞错误列出全部限定地址。

## 设计

### 地址形态：仍三段，工具是会话段内的限定词（非第四段）

```
crosschat send --via tcp:cloud-broker:yang:claude/cloudworker10 --body "…"
crosschat send --via tcp:cloud-broker:yang:codex/cloudworker10  --body "…"
# 裸名（唯一时仍可用，零破坏）：
crosschat send --via tcp:cloud-broker:yang:cloudworker10 --body "…"
# 撞名时裸名报错教学：
SESSION_NAME_COLLISION：会话名 cloudworker10 在 yang 上有多个工具同名成员：
  tcp:cloud-broker:yang:claude/cloudworker10
  tcp:cloud-broker:yang:codex/cloudworker10
改投限定地址即可
```

不做成第四冒号段的理由：冒号=段分隔符且会话名禁冒号（加段即全量旧地址错位）；限定词语法与 origin/from-name（`claude/boss@yang`）同一心智模型；唯一时裸名保留 = 1.6.1 已发布地址零破坏。

**分隔符拍板（2026-10-15 用户问 `/` vs `@`）**：选 `/`。`@` 在本生态已固定表示"谁@哪台机"（`boss@yang`、回执 `worker2@host-b`），复用为工具绑定=一个符号两义；且 `claude@name` 视觉读作"claude 在 name"像机器段，语义误导。两者在 shell/JSON/日志均无需转义（地址是 CLI 令牌非 URL/路径），编码维度打平不作决策依据。

### 同工具同名（限定词救不了的残留）

同一工具两个同名会话（两个 claude 都叫 boss）→ 限定地址相同，仍按碰撞处理：错误列出**带 id8 的两行**（`claude/boss(9f8e7d6c)` / `claude/boss(1a2b3c4d)`），并把 id8 地址印好照抄即达——会话段补 **sessionId/id8 短前缀寻址**（全量 id 今日已可命中 `resolveSessionMember`；id8 与机器段 mid8 同一语法，git 短哈希式）。

### 名字→ID 绑定范围（用户问"第一次选择后绑定会话ID做了吧"）

对话级已做：首轮名解析→deliver 注入 sessionId→回执续话柄 cN，此后整对话按引用路由不再碰名字（换名/撞名不影响）。跨对话**刻意不**全局钉死——名字是活句柄，extends 接任（SUPERSEDED 指路）靠名字可重新绑定才成立（018 裁定 1 既定）。

### 协议面

- **声明加 tool**：attach/sessions/members 声明（`MemberEntry`/`SessionMemberDecl`）加可选 `tool` 字段；启动器（`crosschat claude/codex --connect`）与 adopt 天然知道工具直接填；聚合器恢复链验活本就区分工具（claude=进程扫描 / codex=rollout），重启自愈回填同一来源
- **roster/状态带 tool**：roster-result、members-result、`status --stars` 成员行、`status --via tcp:<机器>` 枚举行显示 `会话: yang:claude/boss`；delivered 回执与 SESSION_SUPERSEDED 指路地址同带限定词
- **启动期同名预警**：launcher spawn 前经 attach status 探针查成员表，`-n <名>` 与星内既有成员异工具同名时打一行"星内已有 codex/<名>，你的地址将是 claude/<名>"——把发送期碰撞提前到启动期可见。此行必须 spawn 前打（spawn 后控制台纪律问题见 021 议题），tool 字段命名实现期对齐代码库既有 `side`/家族注册表
- **解析收命中集**：`resolveSessionMember` 改收集全部名命中——1 命中→投；>1→碰撞错误（错误码建议复用 `NAME_COLLISION` 保持面小，教学文案区分场景；实现期定）
- **限定词判定规则（防枚举耦合的关键）**：会话段**全串先按裸名精确匹配**（命中即投——防"用户把会话起名 `codex/notes` 而机器上恰有 codex"的自伤边角），未命中才拆 `工具/` 前缀，且**前缀仅当命中该机已声明的 tool 值**才当限定词，否则整体视为会话名（名字本身可含 `/`）——broker 永不硬编码工具清单，新适配器声明即寻址。tool 段大小写归一（小写化），名字段保持区分大小写
- **id8 寻址**：多命中报错列候选加长前缀（照抄机器段 mid8 规则）
- **extends 同治**：extends 声明加可选 tool；`extendsByOldName` 索引键限定化——claude"boss"与 codex"boss"死后各归各血统，同款收集命中/碰撞规则，否则继承路径留着同一个静默首中 bug
- **tool 值规约**：小写字母/数字，禁冒号禁斜杠，≤16 字符；与 1.5.x 身份注册表（启动器家族注册）同源，一处定义

### extends 互动

extends 旧名同碰撞域、同规则（限定词可选）；`SESSION_SUPERSEDED` 指路文本带工具限定词。

## 风险评估（用户点名：后续必接其他工具）

1. **枚举耦合**（新适配器要改 broker？）——由"前缀只对该机已声明 tool 集合生效"规则化解：新适配器声明自己的 tool 即可寻址，协议与 broker 零改动；这是本方案相对"第四段必填"的核心优势
2. **混版本窗口**（老聚合器不报 tool）——撞名从现状"静默首中"（最坏：投错人无人知）变为显性碰撞错误 + 升级教学，严格变好；唯一名单路径行为不变
3. **显示/教学面遗漏**——status --stars / delivered 回执 / SUPERSEDED 指路 / SKILL.md / broker.md 2.2 必须同步带限定词，漏一处即"地址能用但列表认不出谁是谁"；验收清单单列
4. **名字含 `/`**（如用户起名 a/b）——限定词仅在命中已声明 tool 时生效，a/b 整体按名处理零破坏；"会话名禁冒号"规约不变，文档补一句"建议避开 /"或不补（规则已自洽）
5. **回信路由零涉及**——reply-hint 走会话引用（nonce），与名字/工具无关，本票不碰

## 预算与停止条件

- **有意收紧（破坏性）**：同工具同名从今日"静默首中投递成功"变为显性碰撞报错——019 同款收紧立场，CHANGELOG 破坏性变更声明必写
- 规模 S~M 票：声明帧加一字段（attach/sessions/extends/member 帧）+ 解析收命中集/碰撞错误（含 extendsByOldName）+ 限定词解析（全串精确优先 + 声明集匹配；CLI `--via` 与 broker targetMachine 两端同款规则）+ **会话段 sessionId/id8 短前缀寻址** + 启动期同名预警 + status/回执/指路显示 + 文档（broker.md、federation.md 五章、SKILL.md、README）+ CHANGELOG + 测试（撞名双成员、同工具同名列 id8、限定直达、裸名唯一、全串名含斜杠自伤边角、extends 跨工具同名血统、老聚合器无 tool 降级教学）
- 停止条件：npm run check 全绿；真机——同机 claude+codex 同名双成员下裸名报碰撞列两地址、限定地址各达各的；同工具同名列 id8 且 id8 地址可达；裸名唯一与 018 全部既有验收项零回归
- 发版：随 **1.6.2**（用户 2026-10-15 拍板：019+020 连做合并 1.6.2，一次迁移说明）；实施顺序 019 先行（其删除的两段式路径正是本票限定词解析要改的路径——先删后改省工）
- 依赖：021 先行合并——本票启动期同名预警必须 spawn 前打印，控制台纪律先立
