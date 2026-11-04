# C08-I01：Harness 默认技能维护接线

2026-10-29（UTC+8）。root 派单/独立复审，cworker1 实施。用户已明确“skill可以新增，这个不影响”，承接刚解释的 A 方案：新增 Harness 技能副本不再作为阻断，沿用现有命令把 Harness 纳入默认安装/覆盖更新及相应卸载清单。持续推进授权继续有效；本单不得借此新增源码文件、持久账本、命令参数或自动管理原生插件。

## 基线与所有权

仓库 `D:/workspace/CC/multichat`，branch `codex/core-refactor-pre-tui`，正式基线以 root 发送 SHA 为准。开始/结束核对分支、真实 HEAD 与 dirty。共享分支若仅无关文件推进，确认派单基线仍是祖先、白名单未改后直接继续。不得 checkout/pull/reset/clean/stash/amend/push 或回退共享文件归责；只提交本单显式路径，不夹带他方 index。原未跟踪 `docs/代码消息投递.md` 不动、不 stage。

先读 AGENTS.md、`docs/development/code-standards.md`、`tool-integration-standard.md`、本任务与 C13 生命周期合同；TUI 接线先读 `tui-progress.md`。既有产品基线完整 check 为 2527 通过/11 原有跳过（最多2/最少1 worker），见 C13 I01-final-review。C13-I02 已验收；本单不是重做通信或 Host bridge。

## 仅可修改的既有文件

产品：

- `src/application/maintenance/skills.ts`：共享技能目标计划与安装/覆盖更新。
- `src/application/maintenance/uninstall.ts`：匹配已生成的三个技能目标，保留原有数据/服务保护。
- `src/application/maintenance/operations.ts`：TUI 维护计划、目标验证、执行一致性。
- `src/application/maintenance/index.ts`：维护 worker 的环境 DTO 校验与传递。
- `src/application/maintenance/model.ts`：准确的维护范围说明，不改变 wire DTO。
- `src/commands/install-skills.ts`、`src/commands/uninstall.ts`：对应注释/类型说明，复用应用逻辑。
- `src/cli.ts`：uninstall 默认目标共用计划与 install-skills help；不碰发送、身份或通信。
- `src/tui/composition.ts`：仅 DSH_HOME 的普通环境继承/显式隔离 home 边界。

测试：`test/install-skills.test.ts`、`test/uninstall.test.ts`、`test/maintenance.test.ts`、`test/maintenance-boundaries.test.ts`、`test/tui-composition.test.ts`、`test/tui-main-observations.test.ts`、`test/cli-args.test.ts`；仅修改与本单直接相关的场景/期望，保留原断言语义、等待预算及现有其它用例。`test/tui-maintenance.test.ts` 可用于回归，不需为无变化通用renderer增加测试。

文档：`docs/deepseek-harness.md`、`docs/development/dsh-integration-contract.md`、`docs/development/c13-harness-lifecycle-design-20261029.md` 的当前技能维护事实；`README.md` 仅 install-skills 的旧“两侧”描述。原合同批准历史不改写，通信段及其它用户内容不动。

可新增本目录 `I01-review-input.md`、`I01-check.txt` 作开发证据，无新探针/helper/源码/配置/依赖。root 的任务、审查、总表和调度页由 root 维护。超出白名单先具体报必要路径和理由，不自行扩张。

## 行为合同

1. **同一目标来源。** 安装、覆盖更新、CLI uninstall 与 TUI 维护使用同一计划。固定保留 Claude、Codex 顺序，再接 Harness；OpenCode 继续复用 Claude 的技能目录，不为它新增重复副本。不建立通用注册框架或新的目录追踪存储。
2. **默认与隔离。** 默认 Harness 目标为 `<DSH_HOME>/skills/crosschat`，未设置/空值时为 `<home>/.dsh/skills/crosschat`。与桥登记 home 分开。非空相对 DSH_HOME 不猜 cwd；安装/技能卸载不能因此改写到不明位置，应各入口一致拒绝/阻止并给具体路径错误。普通依赖使用明确 env 注入；合成 deps 未提供 env 时按空环境，不能偷偷读取宿主。生产默认依赖显式取当前环境。
3. **现有 --dir 不变形。** `install-skills --dir <root>` 的三个目标均在显式根内（`.claude/.codex/.dsh`），忽略宿主 DSH_HOME；不增加新参数或必需操作。显式 TUI 隔离 home 同样不得带入宿主 DSH_HOME；普通 TUI 保留实际环境并通过 worker DTO 传递。只透传必要字段，不发整个 env 给 worker。
4. **复制合同保持。** 完整复制随包 SKILL.md 与全部 references；幂等覆盖，前一目标失败停止后续，TUI 显示真实逐项目标结果。保持现有“覆盖复制不清除额外旧文件”语义，不顺带删用户添加的文件，不加自动迁移或清理。若多个计划指向同一实际路径，避免重复写/删，不用第三个字符串的位置猜标签或归属。
5. **卸载边界。** 默认卸载增加的是当前计划的 Harness `skills/crosschat`，不是整个 Harness home、skills 父目录、profile、插件配置或聊天。保留现有确认、serve 保护、数据目标和 npm 收尾。仅消费当前明确目标，不扫描历史 DSH_HOME、项目或以前 --dir 路径；不声称无账本能自动发现全部历史副本。
6. **预览与执行。** TUI 预览仍只读、范围变化重新确认、链接/异常文件/不可核验目标 fail closed。DSH_HOME 可以在 home 外，但只能允许当前明确选择的 Harness 技能目标，不能全局放开外部路径；验证目标 root/必要祖先、skills 与 crosschat 子路径的链接边界。保持原有文件/目录检查预算，不把新 env 无效变成无关 clean/force-clean 的失败。目标或环境在预览后改变，不能沿旧指纹扩大范围。
7. **不扩大授权。** 不实际安装到用户技能目录，不运行真实 uninstall，不自动运行 dsh plugin；不安装/启动工具或访问用户配置/auth、模型、远端、daemon，不试发。生产命令接线在隔离 fixture/受控 worker 上验收。技能之外新增功能文件或用户必需步骤仍先报 root。

## 测试与交付

遵守现有 TDD 工作流，先新增有意义行为反例并执行 RED（目标缺失/错误目标应是真正失败原因），保存一个仅本单测试和必要证据的 RED checkpoint；之后最小实现，同一组测试 GREEN 后提交 GREEN checkpoint。使用 `git commit --only -- <显式路径>`；新文件先逐项 add。两 checkpoint 均应在本分支可达，不 squash/amend。

至少验证：

- 默认三目标内容与 references 一致、重复覆盖；自定义 DSH_HOME 不误写默认 `.dsh`；--dir/显式 TUI home 不触碰宿主 DSH_HOME。
- CLI 与 TUI 的默认/自定义目标一致，真实 worker 环境传递覆盖到；相对/空 DSH_HOME 行为一致；无关清理保持原合同。
- Harness 技能卸载后 home、其它技能、插件配置和聊天的 sentinel 字节不变；取消确认与 serve 运行时零删除。
- 自定义外部 home 的合法目标可预览与执行；链接目标、范围变化、复制失败停止后续仍有效；不依赖真实宿主权限/用户文件。

运行相应 Vitest、相关 ESLint/build；最终一次完整 `npm run check` 设置 `VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`、`VITEST_MAX_THREADS=2`、`VITEST_MIN_THREADS=1`，不筛套件/加skip/放宽断言。完整 stdout/stderr 与退出码落 `I01-check.txt`，不得用tail/过滤摘要替代原始日志；首败保留并解释，不靠重复跑抹掉。项目规范明确不以固定覆盖率/新增数替代行为判断，不为80%指标新增依赖或框架。

review-input 记录每项保证→测试、真实 RED/GREEN/commit、全量环境/结果、修改文件、未测/清理。所有fixture仅本次独占临时根，删除前核对绝对路径及所有权，不扫描/终止宿主进程。完成后按本次typed hint、约定 `node dist/cli.js`、显式tool与delivery steer报告，不轮询、自行领取下一项或把 C08 父项宣布完成。root独立两轴验收后继续推进。
