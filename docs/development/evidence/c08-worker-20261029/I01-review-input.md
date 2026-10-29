# C08-I01 交付说明（供 root 审查）

执行 `cworker1`，分支 `codex/core-refactor-pre-tui`，基线 `8ca186f7149ff22b48e891a0220b015822ba66b8`。任务书 `I01-task.md`；用户批准为“skill可以新增，这个不影响”，采用 A 默认方案：把 Harness 纳入 `install-skills` 的默认安装/覆盖更新与 `uninstall` 的删除范围。

## 一、提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| RED | `fdde712` | 4 个测试文件先写期望：默认三目标、显式 `DSH_HOME`、`--dir` 隔离、相对路径拒绝、去重、Harness 单独卸载范围、外部 home 的预览/执行、worker env 透传 |
| GREEN | `f6fbaf1` | 产品接线 + 文档；`test/maintenance.test.ts` 一处旧期望随三目标调整 |

两提交均在本分支可达，未 squash、未 amend。RED 提交消息有一处格式缺陷，见 §七。

## 二、合同逐条 → 测试映射

| 合同 | 实现位置 | 覆盖测试 |
| --- | --- | --- |
| 1. 单一计划源，顺序 Claude → Codex → Harness；OpenCode 复用 Claude 目录；不引入注册框架/新追踪文件 | `skills.ts` 的 `skillPlan`，`install-skills`/`uninstall`/TUI 维护/worker DTO 全部消费它 | `install-skills.test.ts` 默认与幂等两例；`maintenance.test.ts`「skill installation previews the three destinations」「uses one target plan for the CLI installer and the TUI preview」 |
| 2. 默认 Harness 目标 `<DSH_HOME>/skills/crosschat`，未设置/空为 `<home>/.dsh/skills/crosschat`；非空相对 `DSH_HOME` 在各入口以具体路径拒绝；合成依赖无 env 即空 env，生产默认依赖显式读当前环境 | `skills.ts` 的 `harnessHome`/`defaultInstallSkillsDeps`；`index.ts` 的 DTO 与 `parseTask`；`cli.ts` 传 `process.env.DSH_HOME` | `install-skills.test.ts`「uses an absolute DSH_HOME…」「treats an empty DSH_HOME as unset」「rejects a relative DSH_HOME…」；`maintenance.test.ts`「rejects a relative DSH_HOME… without breaking unrelated cleanup plans」 |
| 3. `--dir` 三个目标都在显式根内且忽略宿主 `DSH_HOME`；显式 TUI 隔离 home 不继承宿主 `DSH_HOME`；普通 TUI 经 worker DTO 保留真实环境且只带必要字段 | `install-skills.ts` 的 `--dir` 分支；`tui/composition.ts` 的 `childEnvironment` 剥离 `DSH_HOME`；`index.ts` 的 `MaintenanceTask.env` | `install-skills.test.ts`「honors --dir override…ignores the host DSH_HOME」；`tui-composition.test.ts` 隔离/继承两例 |
| 4. 完整复制含 `references`、幂等覆盖、首败即停、保留“覆盖不删额外旧文件”、相同真实路径去重且不按位置猜标签 | `skills.ts` 的 `installSkillDestination`/`runInstallSkills`；`uninstall.ts` 追加计划目标 | `install-skills.test.ts`「copies the whole source directory, not just SKILL.md」「writes one copy when the Harness home resolves to an existing skill destination」；`maintenance.test.ts`「stops the skills task after its first failure…」 |
| 5. 卸载只删当前 Harness `skills/crosschat`，不删 home/父目录/profile/插件配置/聊天；保留确认、服务守卫、数据目标、npm 提示；不扫描历史/项目 | `uninstall.ts` 的 `uninstallTargets(deps, skills)`；`commands/uninstall.ts` | `uninstall.test.ts`「removes only the Harness crosschat skill, leaving its home, other skills, plugin config and chats untouched」及既有守卫/确认各例；`maintenance.test.ts`「uninstalls exactly the old data and skill scopes…」 |
| 6. 预览只读、范围变更再确认、链接/异常/不可核验一律 fail closed；外部 `DSH_HOME` 允许但只核验当前显式技能目标，核验根/祖先与 `skills/crosschat` 链接边界；预算不变；无效新 env 不破坏无关清理；预览后 env 变更不扩范围 | `operations.ts` 的 `verifySkillTarget`/`skillPlan` 各自 try；指纹仍覆盖 targets | `maintenance.test.ts`「installs and removes an explicit Harness home that sits outside the user home」「fails closed when the external Harness skills path is a link」「refuses parent-directory junctions…」「blocks uninstall if a named node becomes fresh after preview…」 |
| 7. 不真实安装/卸载、不调 `dsh plugin`、不装工具、不碰用户配置与鉴权、不新增功能文件/参数/依赖 | 全部测试用临时 fixture 根；无新增文件与依赖 | 本单未执行任何真实安装或卸载（见 §六） |

## 三、RED 的真实失败原因

按文件归纳首轮失败（不是“随便红了”）：

- `install-skills.test.ts`：默认用例只得到 2 个目标（缺 `.dsh`）；绝对 `DSH_HOME` 用例的目标目录不存在、`references/send.md` 未复制；相对 `DSH_HOME` 用例没有抛错（`toThrow(/DSH_HOME/)` 失败），且 `.claude` 被创建。
- `maintenance.test.ts`：安装预览只有 2 个目标；卸载预览只有 4 项（缺 harness），outcome 长度不符；外部 home、相对拒绝、链接 fail-closed、CLI/TUI 一致性各例均失败或无法进入。
- `uninstall.test.ts`：产品仍读 `deps.skillDirs`，新 fixture 只提供 `skills`，取到 `undefined` 后崩溃，断言无法进行。
- `tui-composition.test.ts`：隔离 home 的 `env.DSH_HOME` 仍是宿主值 `'/outside/dsh'`（应为 `undefined`）；继承用例因未接通而失败。

GREEN 后，同一组测试全部通过。

## 四、最终完整检查

在 GREEN 提交 `f6fbaf1` 上执行一次完整 `npm run check`，环境变量 `VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`，未筛套件、未加 skip、未放宽断言。完整 stdout/stderr 与退出码见 `I01-check.txt`（359 行，原样保存，未截断或过滤）。

结果：**退出码 0**。`eslint src test` 无输出（通过）；运行时导入图 203 模块、682 边，无环、无边界违规；`tsc` 构建通过；Vitest 231 个文件通过、3 个跳过（234），2537 项通过、11 项跳过（2548），耗时 106.00s。跳过项均为 `test/live/*` 的既有实网用例，与本单无关。

## 五、实际改动范围

产品文件 9 个：`src/application/maintenance/{skills,uninstall,operations,index,model}.ts`、`src/commands/{install-skills,uninstall}.ts`、`src/cli.ts`、`src/tui/composition.ts`。
测试文件 4 个（RED 提交）：`test/install-skills.test.ts`、`test/uninstall.test.ts`、`test/maintenance.test.ts`、`test/tui-composition.test.ts`；GREEN 另调整 `test/maintenance.test.ts` 一处旧期望（三目标后首败即停的第三项）。
文档 4 个：`docs/deepseek-harness.md`、`docs/development/dsh-integration-contract.md`、`docs/development/c13-harness-lifecycle-design-20261029.md`、`README.md`。

未改：`docs/development/tool-compatibility-ci-tasks.md`（root 维护，不在白名单，但第 91 行 C08 行已陈旧，见 §七）、`docs/代码消息投递.md`、`I01-task.md`、P01 两份 JSON。

## 六、未覆盖边界

- 没有端到端跑 `crosschat uninstall` 的 `run()` 入口：CLI 接线只由 `runInstallSkills(...)` 与预览目标的相等断言间接覆盖，`cli.ts` 一行 `skillPlan(home, { DSH_HOME: process.env.DSH_HOME })` 没有独立用例。
- 没有真实 Harness 环境下的加载验证（本机无正式 Desktop），只验证文件复制与删除。
- 未测 `DSH_HOME` 指向已存在但为文件的路径、跨盘符路径等更多异常形态；已测的是相对路径、链接与越界。
- TUI 交互层（按键流）未覆盖，只覆盖 composition 传给 worker 的 env 字段。

## 七、需 root 处理的事项

1. **RED 提交消息有格式缺陷**：`fdde712` 的消息首尾各多一行 `@`（本会话误用 PowerShell here-string 语法写进 POSIX shell 所致）。任务书禁止 amend，故保留原样，此处披露；内容本身完整可读。
2. **`docs/development/tool-compatibility-ci-tasks.md:91` 已陈旧**：仍写“`skillDestinations()` 仍只返回 `.claude/.codex`，维护和卸载仅两侧；… Harness 当前手工复制”。该文件不在本单白名单，未改，请 root 更新。

## 八、清理

测试全部使用临时 fixture 根，未写用户 `.claude`/`.codex`/`.dsh`，未调用 npm、未调 `dsh plugin`、未读写 `~/.crosschat`。临时目录由用例自行清理；本单未留下调试脚本或残留状态。
