# 机器自报名单一事实源：showName 通吃 broker 机（017）

label: wayfinder:design
status: closed（2026-10-14 真机验收关票：WSL 腿（wsl）+ 云端腿（cloud）双端通过，2e7df0b，随 1.5.11 发布）
blocked-by: （无）
claimed-by: （二期6 主会话编排 subagent 实施）

## Question

用户现场（2026-10-13，云端 broker 机）：改本机 node.json 的 showName 不生效，roster 仍显示 hostname——被建议"跑节点客户端上报"或"手改 broker.json 注册表"，两者都违背单一事实源，且制造两套心智（纯 node 机 vs broker+node 机）。

**缺陷定位（代码实锤）**：
- serve.ts:216-221：broker 首启把自身登进注册表 `machineName = hostname()`，**仅首次**——已存在则永不再看
- serve.ts:222-241：serve 自建的 node.json（showName 本是给用户改的）**从不被 broker 读回**
- 全系统唯一名字传播通道 = 节点客户端连接帧（broker.ts:354-356）——broker 机没有理由跑节点客户端
- 附带：`非 hex --via tcp:<名>` 按 machineName/label 解析（broker.ts:569-571），名字冻死 = 永远要敲 hostname 或 mid8

**方案（用户方向，一套心智）**：规则只有一条——**任何机器的自报名 = 本机 node.json showName（缺省 hostname 兜底），改完重启常驻生效**（与升级口诀同节奏）：
1. serve 启动时，find 到 self 条目后不再跳过——读本机 node.json showName 刷新 `machineName`；showName 是顶层字段，**读取不依赖自用条目归属**（node.json 呈 foreign 形态也读）；**语义对称**：showName 显式缺失/空 → 清除注册表 machineName（roster 回退纯 mid8），只有 node.json 读不了/损坏才维持现值（不因解析失败误删）；**无变化不写**（与 E0 星名同步"一致不写"先例一致）
2. 纯 node 机不变（连接帧上报即传播）——剩余差异是物理性的（远机文件读不到），不产生第二套心智
3. 核对项（俯瞰补）：
   - 云机（broker 机）本机发消息的信封 from-machine 取名来源须与 showName 一致（017 后注册表 machineName 与 showName 同源，不得再用 hostname()）
   - **重名寻址回归**：用户可改名会提高重名概率——name 轨多命中必须维持"报错+列 mid8 教消歧"（broker.ts:609-612 现行为），加用例锁死
   - **本机 status 自排除陷阱**：broker 机自身 status 的"在线机器"行排除自己（用户现场实测），改名后用户在本机看不到新名会以为没生效——要么 status 含本机（带"本机"标记，小改），要么验收文档写明"从对端 roster 看"；实施会话定，倾向前者
   - **gen-key 占位 showName 传播**：分发模板的占位串（"改成…"）懒惰用户会原样带进 roster——保留（可见的整改信号）并文档说明，不另加机制
   - 多星一致性免虑：showName 顶层单值，broker 自同步与节点连接帧同源同文件，跨星同名传播，无第二心智
   - **升级迁移提示（随版必带）**：此前手改过 broker.json machineName 的用户，017 落地后重启 serve 会被 showName 覆盖回旧名——CHANGELOG/Release notes 明示"把名字写进 node.json showName"
   - **016 分片自愈用例**：机器改名后同 mid8 新信封经 machines merge 覆盖旧名（{...existing, ...machines} 语义），回执显示自愈
   - 教学文案：gen-key 分发提示与 broker.md/README 的改名口径统一为"改 showName + 重启常驻"
4. 备选（不推荐）：roster 构建时现读本机 showName 零重启生效——读路径带副作用语义，且与"重启常驻"系统节奏不一致

## 预算与停止条件

- 规模 S 票：serve.ts 自登记段小改 + 测试（重启后名字刷新/缺文件兜底/改名后非 hex 寻址命中）+ 教学文案同步
- 停止条件：npm run check 全绿；真机验收——云端改 showName="cloud" + 重启 serve，win 侧 roster 即见 `cloud (000c6989)`，`--via tcp:cloud` 可寻址；纯 node 机改名回归不受影响

## Resolution

2026-10-14 关票（实施 2e7df0b，随 1.5.11 发布）。check 666/11 全绿（+9 用例：改名主链/foreign 照读/清名对称/损坏维持/无变化不写字节级/端到端名字寻址/重名 MACHINE_NAME_COLLISION/本机行/016 分片自愈）。真机双端验收：WSL 腿改 showName="wsl" 重启 serve → 注册表即时同步、本机 status 见「wsl（本机）」、win roster 见 wsl(4a0277c8)；云端腿 1.5.11 升级后自动激活用户预改的 showName → `--via tcp:cloud-broker:cloud` 名字寻址命中、win roster 见 cloud(000c6989)。信封同源核对项 grep 定案零改码（from-machine 链本就流经注册表 machineName，hostname() 在该路径零使用点）。零回归：broker.json 其余职能（钥匙鉴权/port/starId/星名/他机条目）行为逐字段原样。
