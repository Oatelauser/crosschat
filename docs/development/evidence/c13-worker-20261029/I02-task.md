# C13-I02：已有手工生命周期说明与合同收口

2026-10-29（UTC+8）。root 分发/独立审查，cworker1执行。I01 桥清理产品及定向复审通过，整仓全量仍待并行短柄线集成，见 [R1审查](I01-R1-review.md)。本单为独立文档工作，继续用户的持续推进授权。**只能写清已有流程和事实；改变用户操作或功能需要新增文件，仍先等用户拍板。**

## 基线与白名单

仓库/branch同前，正式派单给 root 最新SHA。共享分支若仅他方无关文件推进，核对基线祖先及白名单未被修改后直接开始，报告真实起止SHA/独立commit，不反复握手。不 checkout/pull/reset/clean/stash/amend/push，不回退共享文件，不带入其它暂存项；使用 git commit --only -- <本单明确路径>。

仅修改已存在的：

- `docs/deepseek-harness.md`：安装/加载与运行维护的相关段落。
- `docs/development/dsh-integration-contract.md`：补已存在生命周期的当前合同及明确证据边界，不改历史批准事实。
- `docs/development/c13-harness-lifecycle-design-20261029.md`：消除已经核实的待核验事实，更新 I01 实现事实和后续决策边界。

可新增本目录 `I02-review-input.md` 保存开发核验记录，不参与功能。其它产品/测试/README/skills/通信段、root任务/调度/总表、原证据及 `docs/代码消息投递.md` 均不动。无功能/运行时文件新增，无安装/下载/原生Host或Desktop启停，无用户状态/config/auth读写，无模型/生产远端/试发。

## 内容要求

1. **四种资产与归属。** crosschat npm包、skill副本、原生profile内的插件引用、桥运行登记分开说明。保留现有 skill 手工复制及完整references；install-skills尚未管理Harness，不能冒称C08已接线。DSH_HOME与桥登记的home分清，Web与Desktop所用管理器和profile不同，不猜默认目标。
2. **只澄清已有手工操作。** 已有指南要求卸载crosschat前从Harness移除bundle，现补其准确原生命令是澄清已有步骤，不增加新的必需步骤。固定官方提交 `687f282e8625c6b8d11ff58211a90524be2e4317` 中 CLI `apps/cli/src/args.ts:194–201` 的 plugin 必填profile，透传pnpm add/remove/list；Web移除现有包为 `dsh plugin --profile web remove @crosschat/dsh-bridge`。Desktop文档 `apps/desktop/README.md:131–141` 明确自带 `resources/runtime/cli/bin/dsh.cmd` 支持同类操作，仍按原指南先初始化、完整退出再管理；不得教系统npm dsh代管Desktop。对这些技术事实给固定permalink，不启动原生工具验证。
3. **保存/加载/禁用/重启不同。** 已有原生插件管理器会保存选择；是否即时应用取决于HMR，不把保存依赖等同加载成功。同Host禁用正常撤自身listener/登记；重新启用产生新实例登记；shellEnv子scope撤销只撤身份贡献、HTTP保留；Host崩溃可能遗留死PID登记，发现侧只读忽略。已有官方Plugin Manager文档和本仓库 `dsh-validation-20261023.md`、`third-live.json` 可作依据，不将合成测试当正式Desktop验证。
4. **更新与移除边界。** 安装路径变化时按新目录添加是原有要求，不能写每次升级必变路径或同路径必自动更新；没有依据的remove→add顺序不立为必需流程。保持“只回收自身登记/连接、保留原生Agent/聊天/其它profile配置”。I01 当前实现和全量待集成状态如实分开，不声称整仓检查通过。
5. **不替用户决定。** 不新增crosschat管理命令，不扩大install-skills写入，不新增默认profile/home，不引入新的必需检查/操作/用户文件，不自动调用原生管理器。C08默认目标/更新移除、C04正式Desktop、C10诊断和C11/C12 CI边界保留。若实质需要新的用户操作才能成立，先报告该方案，不写成已经批准的指南。

## 验证和交付

按固定源码/既有证据逐条核对相关命令与生命周期，完整permalink、相对文档链接可达；检查diff没有顺手修改通信发送/回信段。仅文档，git diff --check及必要链接/事实检查即可，不写文案字符串测试，不跑产品全量或新探针。

I01 两次全量首败不动；无需为消除文档待核验而下载/安装任何软件。报告独立commit、文件、事实依据与未测边界、是否引入用户操作变化（应为否）以及下一张真正需要用户决定的最窄事项。完成停写，以本次程序生成的typed reply hint、约定仓库node dist/cli.js、delivery steer回报；不轮询，自身不领下一项。
