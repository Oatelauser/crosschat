# C13 Harness 生命周期方案（关闭清理修复已批准，其余待讨论）

2026-10-29 后续授权：用户已要求开始此前提出的桥关闭/mount异常清理修复，并在每单验收后持续派发，直到喊停或必须用户拍板。§四的现有文件修复按该批准实施；新增用户操作或功能需要新增文件须先等用户决定。§五的其它产品选择不随本次授权自动通过，下文初版范围与诊断事实作为方案历史保留。

2026-10-29。C13-P01 交付物，执行 `cworker1`。初版基线 `b062c3e450794523c3633ef013481158e057b4d9`；本版按 root 独立审查（`docs/development/evidence/c13-worker-20261029/P01-review.md`）修订事实与下一单范围，修订基线 `2c4d48d0e31f0958b51a3a8b18fc41bcf261a779`。**这是讨论稿：本单不改 `src/**`、`integrations/**`、`test/**`，不新增命令，不选默认目标，不装工具，不启原生 Host/Desktop。** 文中"建议"一律是待批方案，不是已实现能力。

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
| 更新 | 用户按新目录重新添加 | 指定 profile | 路径变化后旧 `file:` 引用失效，**无失效诊断**；路径是否变化取决于安装方式。**原生 remove 的准确语法、以及"先 remove 再 add"的顺序都没有固定依据，标待核验**，不作为已核实指南 | 缺口，归 C10 诊断；`docs/deepseek-harness.md` §安装桥 |
| 禁用（同一 Host 内） | 用户或 Harness 在运行中的 Host 里禁用插件 | 进程内 | 正常应触发插件 disposer → 我们登记的 `ctx.effect` 调 `close()` → 释放自身监听与登记，**不等于 dead PID**；只有 close 本身失败时才落入 §三 的缺口 | `bridge.js`；§三（正式 Desktop 未测） |
| 子 scope 撤销 | Harness 撤销 `shellEnv` 等子 scope | 进程内 | 只撤身份贡献（`releaseCallerIdentity` / scope dispose），**HTTP 监听保留**、桥继续服务；与插件禁用、Host 退出是不同生命周期 | `bridge.js` |
| Host 进程退出 / 崩溃 | 用户关闭 Host，或 Host 崩溃 | 进程内 + `~/.crosschat` | 没有 disposer 执行时，登记留在磁盘成为 dead pid；发现侧只读忽略、不删；下次启动产生新 instanceId | `dsh-integration-contract.md:25` |
| 移除 | 用户从 Harness 移除插件（指南要求卸载 crosschat 前先移除 bundle；**准确 remove 语法待核验**） | 进程内 + `~/.crosschat` | 移除走同一条 `close()`；**这条路径当前有缺陷，见 §三**。退出 Host 之后再做 CLI 配置操作，不会回头触发运行中进程的 close | `P01-R1-result.json` |

npm/Web 与正式 Desktop 不互相冒充：上表里所有"未测"都是指正式 Desktop 包，Desktop 原生验收归 C04。

## 三、隔离确认：close 失败会同时漏掉监听与登记

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

## 四、建议下一单（最小实现单，本单不实施）

**范围**：只改 `integrations/dsh/bridge.js` 的 `close()` 与 mount 的 catch 分支，加 `test/dsh-bridge.test.ts` 用例。不动协议、路由、登记格式、发现侧、CLI。

**行为要求**（都在现有 `close()` 合同内，不新增状态机）：

1. 首次 `close()` 在**同一个 closing Promise** 内逐项独立尝试：释放 caller contributor、dispose dependency scope、关 socket、删自己的登记。任一项失败**不阻止**其余项，全部尝试完再报告。
2. 登记删除放在 socket 关闭之后独立执行，保留现有"只删自己"的三字段核对（instanceId + token + pid），不删别人的登记。
3. **不伪装成功**：close 仍以拒绝结束；首个错误作主错误，其余挂 `cause` 或 `AggregateError.errors`，不吞。
4. **重复/并发关闭**：返回同一个 closing Promise，不重复释放。**不要求"失败后重试"**，也不引入逐资源 done 状态——第一次就逐项尝试完，重试语义对第三方 disposer 不明确。
5. 初始化失败与 scope 销毁走**同一条** close 路径；mount 的 catch 先留住原始错误，`try { await close() } catch { }`，再清 tmp，最后 `throw 原始错误`（清理错误挂 `cause`）。
6. 不触碰 `ctx.agents`，不销毁借用的 Agent。
7. 只处理"同一 Host 进程内释放失败"。子 scope 撤销、Host 重启、插件禁用是不同生命周期，不在本单行为内。

**验收**：在现有 `fixture()` 上补四条——release 抛错仍关 socket 且删登记；dispose 拒绝仍关 socket 且删登记；重复 close 返回同一 promise 且不重复释放；mount 失败且 close 拒绝时抛的是原始挂载错误且临时文件已清。跑 `npx vitest run test/dsh-bridge.test.ts` 与 caller-source 相关用例，确认既有用例无回归。**新增用例会让通过数变化，旧的 2503 不是"必须不变"的门槛**，基线数字只用来证明既有用例没有退化。不新建框架、不造覆盖率指标。

## 五、待用户决定（均未批准）

| 事项 | 建议 | 理由 |
| --- | --- | --- |
| 新增 `crosschat dsh install/update/remove` 自动命令 | **不建议** | 原生 `dsh plugin` 已是官方入口，且 Desktop 与 npm 是两套 CLI；crosschat 再包一层会与官方语义漂移，装错 profile 仍然静默 |
| 为桥设默认 profile | **不设**，必须显式指定 | Desktop profile 只能由 Desktop 自己的 CLI 管理，默认值会把"装错地方"变成默认行为 |
| 卸载时自动调用原生管理器 | **不调用**，只给命令与诊断 | 会改用户原生配置，且 npm 与 Desktop 是两套 CLI、语义不一致；**"跨两套 CLI 无法可靠实现"没有固定依据，不作为结论**，做不做由用户决定 |
| 技能是否纳入 `install-skills` 的 Harness 写入 | **需用户决定**（属 C08 范围） | 扩大默认写入范围是用户可见的行为变更，本单不替用户选 |

现有手工流程（复制 skill、`dsh plugin add`）不需要用户再批准，本单只是把它写清。

## 六、依赖边界

C08 消费"技能目标 / 插件引用 / 运行时登记"三者分开的目标与归属；C04 消费正式 Desktop 包的安装、UI、退出与官方卸载验证；C11/C12 消费 CI。**本单的方案与下一单的 close 修复都不能关闭 C13**：Desktop 未验、升级换路径后无失效诊断、原生 remove 语法待核验、诊断未接。
