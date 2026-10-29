# C13 Harness 生命周期方案（草案，未获实施批准）

2026-10-29。C13-P01 交付物，执行 `cworker1`，基线 `b062c3e450794523c3633ef013481158e057b4d9`。**这是讨论稿：本单不改 `src/**`、`integrations/**`、`test/**`，不新增命令，不选默认目标，不装工具，不启原生 Host/Desktop。** 文中"建议"一律是待批方案，不是已实现能力。

## 一、现状（已核实的事实）

Harness 这条线上其实有**四种不同归属的东西**，以前常被混成一句"装桥"：

1. **crosschat npm 包**：`dist/`、`skills/`、`integrations/dsh` 随包发布（`package.json` 的 `files`）。升级 crosschat 会换掉 bridge 的**绝对路径**。
2. **skill 副本**：用户手工把 `skills/crosschat` 复制到 `<Harness home>/skills/crosschat`（默认 `~/.dsh`，自定义 `DSH_HOME` 以实际为准）或项目 `.agents/skills/crosschat`。`install-skills` 只写 `.claude`/`.codex`（`src/application/maintenance/skills.ts` 的 `skillDestinations`），**不碰 Harness**。
3. **原生插件引用**：Harness 自己记在所选 profile 的插件配置里，指向 `file:<bridge 目录>`。crosschat 只读提供路径（`crosschat dsh-bridge-path`），不写 Harness 配置。
4. **运行时登记**：桥在自己的 Host 进程里监听 `127.0.0.1` 随机端口，把 `~/.crosschat/dsh/instances/<uuid>.json`（schema/protocol=1、pid、instanceId、runtimeVersion、url、token）写出来。这是**唯一由 crosschat 拥有的运行时文件**。

用户的原生工具及其聊天不在这四类里，crosschat 不拥有、不迁移、不删除。

## 二、生命周期矩阵

### skill 副本

| 阶段 | 谁操作 | 作用目标 | 现状 / 缺口 | 证据 |
| --- | --- | --- | --- | --- |
| 安装 | 用户手工复制 | Harness home 或项目的 `.agents/skills` | crosschat 侧无写入；不校验目标是否正确 | `docs/deepseek-harness.md:25` |
| 加载 | Harness | 同上 | 不参与、不校验加载结果 | 未测（本机无正式 Desktop） |
| 更新 | 用户重新复制 | 同上 | `cpSync` 覆盖但不删源已移除文件（C08 已知缺口） | `skills.ts` `installSkillDestination` |
| 禁用 / 重新启用 | 用户移动或删除目录 | 同上 | crosschat 无状态，无需重连 | — |
| 移除 | 用户删除目录 | 同上 | crosschat 不感知；与 npm 包卸载无联动 | — |

### Host bridge

| 阶段 | 谁操作 | 作用目标 | 现状 / 缺口 | 证据 |
| --- | --- | --- | --- | --- |
| 安装 | 用户跑原生 `dsh plugin --profile <p> add "file:<bridge 目录>"`；Desktop 用自己的 `resources/runtime/cli/bin/dsh.cmd` | 指定 profile（web / desktop） | 只读 `dsh-bridge-path` 给目录；**不校验装到了哪个 profile**，装错是静默失败 | `dsh-integration-contract.md:9` |
| 加载 | Harness 在该 profile 的 Host 进程里 `apply()` | 进程内 | `mountDshBridge` 起监听 + 写登记；登记绑定 pid/instanceId/runtimeVersion | `integrations/dsh/index.js`、`bridge.js` |
| 更新 | 用户先移除再按新目录添加 | 指定 profile | crosschat 升级换路径后旧 `file:` 引用失效，**无失效诊断** | 缺口，归 C10 诊断 |
| 禁用 / 重连 | Harness 禁用插件，或 Host 重启 | 进程内 | 旧登记变 dead pid，发现侧只读忽略、不删；重新启用产生新 instanceId | `dsh-integration-contract.md:25` |
| 移除 | 用户 `dsh plugin remove` → Harness 卸载插件 → 我们登记的 `ctx.effect` 调 `close()` | 进程内 + `~/.crosschat` | **这条路径当前有缺陷，见 §三** | `P01-result.json` |

npm/Web 与正式 Desktop 不互相冒充：上表里所有"未测"都是指正式 Desktop 包，Desktop 原生验收归 C04。

## 三、隔离确认：close 失败会同时漏掉监听与登记

`close()` 的次序是：置 `closed` → `releaseCallerIdentity()` → `await callerIdentityScope.dispose()` → `server.close()` → 删自己的登记。**前两步任一抛错，后两步整段不执行。**

用合成 `ctx`/`host`、独占临时 home、每个场景一个自有子进程实测（`P01-repro.mjs` → `P01-result.json`，子进程退出即收回监听，实验自身不靠再调一次 close 兜底）：

| 场景 | close 结果 | 监听还在？ | 登记还在？ |
| --- | --- | --- | --- |
| 正常对照 | 成功 | 否（连接被拒） | 否（已删） |
| contributor release 抛错 | 拒绝 `contributor release failed` | **是，回 503** | **是** |
| dependency scope dispose 拒绝 | 拒绝 `scope dispose failed` | **是，回 503** | **是** |
| mount 阶段失败且 close 拒绝 | mount 拒绝 `scope dispose failed` | **是，回 503** | **是** |

三点要说准：

- **503 不是"还在正常服务"**：`closed=true` 已置位，端口被占着却拒绝一切请求——既没释放资源，也没法用。
- **不能重试**：`closing ??=` 记的是**已拒绝的 promise**，第二次 `close()` 拿回同一个拒绝（实测 `sameSettledPromise: true`），清理永久卡死。
- **原始错误被顶替**：mount 的 catch 里 `await close()` 排在 `unlink(temporary)` 之前，close 一拒绝就跳过 tmp 清理并让 close 错误盖掉原始挂载错误。实测注入的 `effect registration failed` 被 `scope dispose failed` 顶替。

边界：这次只覆盖合成 ctx，不是正式 Harness 进程内重放；`mount-catch` 路径下 `temporary` 已在发布前删除，所以**没看到 tmp 残留**——能确认的是错误顶替与监听/登记泄漏，"open temporary 之后、unlink 之前失败"那一组合本轮没构造出来，标未测。

## 四、建议下一单（最小实现单，本单不实施）

**范围**：只改 `integrations/dsh/bridge.js` 的 `close()` 与 mount 的 catch 分支，加 `test/dsh-bridge.test.ts` 用例。不动协议、路由、登记格式、发现侧、CLI。

**行为要求**：

1. 三件独立资源各自清理：释放 caller contributor、dispose dependency scope、关 socket。任一失败**不阻止**其余。
2. 登记删除放在 socket 关闭之后独立执行，保留现有"只删自己"的三字段核对（instanceId + token + pid），不删别人的登记。
3. **不伪装成功**：close 仍以拒绝结束；首个错误作主错误，其余挂 `cause` 或 `AggregateError.errors`，不吞。
4. **重复关闭**：成功后幂等；**失败后允许重试**（已释放的资源记 done 标志，不再释放第二次）。不能靠再调一次已拒绝的 memoized close 兜底，也不能因此重复 release。
5. 初始化失败与 scope 销毁走**同一条** close 路径；mount 的 catch 先留住原始错误，`try { await close() } catch { }`，再清 tmp，最后 `throw 原始错误`（清理错误挂 `cause`）。
6. 不触碰 `ctx.agents`，不销毁借用的 Agent。

**验收**：在现有 `fixture()` 上补四条——release 抛错仍关 socket 且删登记；dispose 拒绝仍关 socket 且删登记；两次失败后重试成功；mount 失败且 close 拒绝时抛的是原始挂载错误且临时文件已清。跑 `npx vitest run test/dsh-bridge.test.ts` 与 caller-source 相关用例，产品基线 2503 通过/11 跳过不变。不新建框架、不造覆盖率指标。

## 五、待用户决定（均未批准）

| 事项 | 建议 | 理由 |
| --- | --- | --- |
| 新增 `crosschat dsh install/update/remove` 自动命令 | **不建议** | 原生 `dsh plugin` 已是官方入口，且 Desktop 与 npm 是两套 CLI；crosschat 再包一层会与官方语义漂移，装错 profile 仍然静默 |
| 为桥设默认 profile | **不设**，必须显式指定 | Desktop profile 只能由 Desktop 自己的 CLI 管理，默认值会把"装错地方"变成默认行为 |
| 卸载时自动调用原生管理器 | **不调用**，只给命令与诊断 | 跨两套 CLI 无法在 Desktop 侧可靠实现，且会改用户原生配置 |
| 技能是否纳入 `install-skills` 的 Harness 写入 | **需用户决定**（属 C08 范围） | 扩大默认写入范围是用户可见的行为变更，本单不替用户选 |

现有手工流程（复制 skill、`dsh plugin add`）不需要用户再批准，本单只是把它写清。

## 六、依赖边界

C08 消费"技能目标 / 插件引用 / 运行时登记"三者分开的目标与归属；C04 消费正式 Desktop 包的安装、UI、退出与官方卸载验证；C11/C12 消费 CI。**本单的方案与下一单的 close 修复都不能关闭 C13**：Desktop 未验、更新与禁用语义未实现、诊断未接。
