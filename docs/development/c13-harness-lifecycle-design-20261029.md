# C13 Harness 生命周期方案（关闭清理修复已实现，其余待讨论）

2026-10-29 后续授权：用户已要求开始此前提出的桥关闭/mount异常清理修复，并在每单验收后持续派发，直到喊停或必须用户拍板。§四的现有文件修复按该批准实施（I01 与 R1 已提交、定向复审通过），§三保留修复前的复现证据；新增用户操作或功能需要新增文件须先等用户决定。§五的其它产品选择不随本次授权自动通过，下文初版范围与诊断事实作为方案历史保留。

2026-10-29。C13-P01 交付物，执行 `cworker1`。初版基线 `b062c3e450794523c3633ef013481158e057b4d9`；本版按 root 独立审查（`docs/development/evidence/c13-worker-20261029/P01-review.md`）修订事实与下一单范围，修订基线 `2c4d48d0e31f0958b51a3a8b18fc41bcf261a779`。**这是 P01 时点的讨论稿：P01 不改 `src/**`、`integrations/**`、`test/**`，不新增命令，不选默认目标，不装工具，不启原生 Host/Desktop；后续 I01/R1 已按 §四 修改桥与测试。** 文中其余"建议"一律是待批方案。

## 一、现状（已核实的事实）

Harness 这条线上其实有**四种不同归属的东西**，以前常被混成一句"装桥"：

1. **crosschat npm 包**：`dist/`、`skills/`、`integrations/dsh` 随包发布（`package.json` 的 `files`）。升级 crosschat **可能**改变 bridge 的安装绝对路径——指南的措辞是"升级改变了安装路径时"（`docs/deepseek-harness.md` §安装桥），不是每次升级都变；是否变化取决于安装方式，未逐种核实。
2. **skill 副本**：用户手工把 `skills/crosschat` 复制到 `<Harness home>/skills/crosschat`（默认 `~/.dsh`，自定义 `DSH_HOME` 以实际为准）或项目 `.agents/skills/crosschat`。`install-skills` 只写 `.claude`/`.codex`（`src/application/maintenance/skills.ts` 的 `skillDestinations`），**不碰 Harness**。
3. **原生插件引用**：Harness 自己记在所选 profile 的插件配置里，指向 `file:<bridge 目录>`。crosschat 只读提供路径（`crosschat dsh-bridge-path`），不写 Harness 配置。
4. **运行时登记**：桥在自己的 Host 进程里监听 `127.0.0.1` 随机端口，把 `~/.crosschat/dsh/instances/<uuid>.json`（schema/protocol=1、pid、instanceId、runtimeVersion、url、token）写出来。这是**唯一由 crosschat 拥有的运行时文件**。

用户的原生工具及其聊天不在这四类里，crosschat 不拥有、不迁移、不删除。

## 二、生命周期矩阵

### skill 副本

| 阶段 | 谁操作 | 作用目标 | 现状 / 缺口 | 证据 |
| --- | --- | --- | --- | --- |
| 安装 | 用户手工复制整个 `skills/crosschat` | Harness home 的 `skills/crosschat`（默认 `~/.dsh`，`DSH_HOME` 以实际为准）或项目 `.agents/skills/crosschat` | crosschat 侧无写入；不校验目标是否正确 | `docs/deepseek-harness.md` §让 Agent 使用 crosschat |
| 加载 | Harness | 同上 | 不参与、不校验加载结果 | 未测（本机无正式 Desktop） |
| 更新 | 用户手工重新复制 | 同上 | 无脚本、无校验。`install-skills` 的 `cpSync` 只写 `.claude`/`.codex`，**不能当作这条手工流程的执行证据**；手工复制是否残留源已删除文件未核实 | `src/application/maintenance/skills.ts`（仅证明不写 Harness）；`docs/development/dsh-integration-contract.md:9` |
| 禁用 / 重新启用 | 用户移动或删除目录 | 同上 | crosschat 无状态，无需重连 | — |
| 移除 | 用户删除目录 | 同上 | crosschat 不感知；与 npm 包卸载无联动 | — |

### Host bridge

| 阶段 | 谁操作 | 作用目标 | 现状 / 缺口 | 证据 |
| --- | --- | --- | --- | --- |
| 安装 | 用户跑原生 `dsh plugin --profile <p> add "file:<bridge 目录>"`；Desktop 用自己的 `resources/runtime/cli/bin/dsh.cmd` | 指定 profile（web / desktop） | 只读 `dsh-bridge-path` 给目录；**不校验装到了哪个 profile**，装错是静默失败 | `docs/deepseek-harness.md` §安装桥；`dsh-integration-contract.md:9` |
| 加载 | Harness 在该 profile 的 Host 进程里 `apply()` | 进程内 | `mountDshBridge` 起监听 + 写登记；登记绑定 pid/instanceId/runtimeVersion | `integrations/dsh/index.js`、`bridge.js` |
| 更新 | 用户按新目录重新添加 | 指定 profile | 路径变化后旧 `file:` 引用失效，**无失效诊断**；路径是否变化取决于安装方式。原生 remove 语法已核实：`dsh plugin --profile web remove @crosschat/dsh-bridge`（`plugin` 必填 `--profile`，其余透传 pnpm）；没有依据把"先 remove 再 add"定为必需顺序 | 缺口，归 C10 诊断；[args.ts:194–201](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/src/args.ts#L194-L201)；`docs/deepseek-harness.md` §更新与移除 |
| 禁用（同一 Host 内） | 用户或 Harness 在运行中的 Host 里禁用插件 | 进程内 | 正常触发插件 disposer → 登记的 `ctx.effect` 调 `close()` → 释放自身监听与登记，**不等于 dead PID**；close 自身失败也不再泄漏（I01/R1 逐项清理） | `bridge.js`；[third-live.json](evidence/dsh-20261023/third-live.json)（Web 实测禁用/启用）；正式 Desktop 未测 |
| 子 scope 撤销 | Harness 撤销 `shellEnv` 等子 scope | 进程内 | 只撤身份贡献（`releaseCallerIdentity` / scope dispose），**HTTP 监听保留**、桥继续服务；与插件禁用、Host 退出是不同生命周期 | `bridge.js` |
| Host 进程退出 / 崩溃 | 用户关闭 Host，或 Host 崩溃 | 进程内 + `~/.crosschat` | 没有 disposer 执行时，登记留在磁盘成为 dead pid；发现侧只读忽略、不删；下次启动产生新 instanceId | `dsh-integration-contract.md:25` |
| 移除 | 用户从 Harness 移除插件（指南要求卸载 crosschat 前先移除 bundle；命令见上） | 进程内 + `~/.crosschat` | 移除走同一条 `close()`；**这条路径的缺陷已由 I01/R1 修复，见 §三、§四**。退出 Host 之后再做 CLI 配置操作，不会回头触发运行中进程的 close | `P01-R1-result.json`；I01/R1 |

npm/Web 与正式 Desktop 不互相冒充：上表里所有"未测"都是指正式 Desktop 包，Desktop 原生验收归 C04。

## 三、隔离确认：close 失败会同时漏掉监听与登记

**本节是 I01 之前的复现记录，所述缺陷已由 I01/R1 修复；保留原文作为证据，实现事实见 §四。**

`close()` 的次序是：置 `closed` → `releaseCallerIdentity()` → `await callerIdentityScope.dispose()` → `server.close()` → 删自己的登记。**前两步任一抛错，后两步整段不执行。**

用合成 `ctx`/`host`、独占临时 home、每个场景一个自有子进程实测（`P01-repro.mjs` → `P01-R1-result.json`，子进程退出即收回监听，实验自身不靠再调一次 close 兜底）。每场只接受"子进程正常退出、未超时未截断、RESULT 完整、退出后端口被拒"的采证；缺 URL 或未探测不算确认关闭，超时/其它网络错误保留未核实，工装失败会列 problems 并以非零退出。

| 场景 | close 结果 | 监听还在？ | 登记还在？ |
| --- | --- | --- | --- |
| 正常对照 | 成功 | 否（连接被拒） | 否（已删） |
| contributor release 抛错 | 拒绝 `contributor release failed` | **是，回 503** | **是** |
| dependency scope dispose 拒绝 | 拒绝 `scope dispose failed` | **是，回 503** | **是** |
| mount 阶段失败且 close 拒绝 | mount 拒绝 `scope dispose failed` | **是，回 503** | **是** |

三点要说准：

- **503 不是"还在正常服务"**：`closed=true` 已置位，端口被占着却拒绝一切请求——既没释放资源，也没法用。
- **不能重试**：`closing ??=` 记的是**已拒绝的 promise**，第二次 `close()` 拿回同一个拒绝（实测 `sameSettledPromise: true`）。下一单不引入重试状态机，改为第一次就把每项独立清理尝试完。
- **原始错误被顶替**：mount 的 catch 里 `await close()` 排在 `unlink(temporary)` 之前，close 一拒绝就跳过 tmp 清理并让 close 错误盖掉原始挂载错误。实测注入的 `effect registration failed` 被 `scope dispose failed` 顶替。

这三条都是**同一个 Host 进程内、disposer 已执行且 close 失败**时的现象。它与"插件禁用正常触发 disposer 并释放登记""子 scope 撤销只撤身份贡献、HTTP 保留""Host 崩溃留下 dead pid 登记"是三种不同生命周期，不能合并陈述；本单只证明第一种。

边界：这次只覆盖合成 ctx，不是正式 Harness 进程内重放；`mount-catch` 路径下 `temporary` 已在发布前删除，所以**没看到 tmp 残留**——能确认的是错误顶替与监听/登记泄漏，"open temporary 之后、unlink 之前失败"那一组合本轮没构造出来，标未测。

## 四、实现事实（I01 / I01-R1，已提交）

**状态**：I01 提交 `1112f82`，返修 R1 提交 `4f8b6c2`（父 `63eae9f`）；root 定向复审通过，两独立审查的 P2 已全部收口（`docs/development/evidence/c13-worker-20261029/I01-review.md`、`I01-R1-review.md`）。整仓全量仍按真实状态待集成，不记作 I01 最终全量验收。

**范围**：只改 `integrations/dsh/bridge.js` 的 `close()` 与 mount catch，加 `test/dsh-bridge.test.ts` 用例；未动协议、路由、登记格式、发现侧、CLI，未新增功能文件或改变用户操作。

1. 首次 `close()` 在**同一个 closing Promise** 内逐项独立尝试：释放 caller contributor、dispose dependency scope、关 socket 与连接、删自己的登记。任一项失败不阻止其余项，全部尝试完再以首错拒绝，其余错误挂 `cause`；首错已有 `cause` 时不覆盖，改用 `AggregateError` 并把原 `cause` 带上。
2. 错误追加本身失败也不遮蔽原错：`cause` 可读但不可写时退回 `AggregateError`，原始错误、它原有的 `cause` 与全部清理原因都保留。
3. 临时文件按实际归属清理：只有本次 `open(..., 'wx')` 成功后才允许在失败路径 unlink；EEXIST/open 失败不删除此前已存在的 tmp。
4. 登记删除仍在 socket 关闭之后，保留 instanceId + token + pid 三字段核对；不触碰 `ctx.agents`，不销毁借用的 Agent。
5. mount 的 catch 把原始挂载错误留作主因：close 与 tmp 清理都仍被尝试，两者失败挂在主因的 `cause` 上。
6. 重复/并发关闭返回同一个 closing Promise，不重复释放；没有失败重试或逐资源状态机。
7. 测试 fixture 独立收尾：逐项尝试全部清理，并用 `vi.mock('node:http')` 独立持有本次实际创建的 server，产品 close 提前拒绝时也能关闭 listener；预期注入错误不掩盖其它异常。

**验证**：`test/dsh-bridge.test.ts` 32 项、caller-source 相关 14 + 55 项通过，语法与相关 ESLint 通过。两次 `npm run check` 的全量首败分别保存为 `I01-check.txt`、`I01-R1-check.txt`，失败均落在并行短柄线在途文件或负载敏感超时，没有一个导入桥。**边界**：合成 ctx/host，不是正式 Harness/Desktop 进程内重放。

## 五、待用户决定（均未批准）

| 事项 | 建议 | 理由 |
| --- | --- | --- |
| 新增 `crosschat dsh install/update/remove` 自动命令 | **不建议** | 原生 `dsh plugin` 已是官方入口，且 Desktop 与 npm 是两套 CLI；crosschat 再包一层会与官方语义漂移，装错 profile 仍然静默 |
| 为桥设默认 profile | **不设**，必须显式指定 | Desktop profile 只能由 Desktop 自己的 CLI 管理，默认值会把"装错地方"变成默认行为 |
| 卸载时自动调用原生管理器 | **不调用**，只给命令与诊断 | 会改用户原生配置，且 npm 与 Desktop 是两套 CLI、各管各的 profile；两套都有 `plugin ... remove`（固定提交核实），但自动化仍需替用户选 profile、并在退出后执行，做不做由用户决定 |
| 技能是否纳入 `install-skills` 的 Harness 写入 | **需用户决定**（属 C08 范围） | 扩大默认写入范围是用户可见的行为变更，本单不替用户选 |

现有手工流程（复制 skill、`dsh plugin add`）不需要用户再批准，本单只是把它写清。

## 六、依赖边界

C08 消费"技能目标 / 插件引用 / 运行时登记"三者分开的目标与归属；C04 消费正式 Desktop 包的安装、UI、退出与官方卸载验证；C11/C12 消费 CI。**I01/R1 的 close 修复已在合成 ctx 上验证并通过定向复审，但不能关闭 C13**：Desktop 未验、升级换路径后无失效诊断、诊断未接；整仓全量仍待并行短柄线集成，本方案不宣称全仓通过。
