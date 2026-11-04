# C13-I02-R1：收窄生命周期说明

2026-10-29（UTC+8）。按 [独立审查](I02-review.md)返修。既有持续推进授权生效；不得新增用户必需操作或功能文件。

## 范围与基线

本单基线以 root 派发 SHA 为准。共享分支无关推进时核对基线祖先及白名单不被修改后继续，报告真实父提交。不 checkout/pull/reset/clean/stash/amend/push，不回退他方文件；独立 commit 仅带本单显式路径。

白名单仍为四个已有文件：`docs/deepseek-harness.md`、`docs/development/dsh-integration-contract.md`、`docs/development/c13-harness-lifecycle-design-20261029.md`、本目录 `I02-review-input.md`。不得改代码/测试、通信段、skills、包、root 调度/审查/任务、旧证据与原未跟踪用户文档。

## 必须收口

1. 指南安装段保留保存不等于加载，按 application/warnings 与 HMR 实际结果说明；仅当原生结果指明未应用或需重启时给条件指引，不要求所有安装都重启。Web 移除不新增统一先退出要求；保留原有 Desktop 离线管理前提与准确 remove 命令。
2. 指南与合同的登记位置改为默认用户主目录，不随 DSH_HOME 自动迁移；已有显式插件 config.home 通过 index.js 原样传给 mountDshBridge，使用 options.home ?? homedir()。仅写已有事实，不新增配置教学或要求用户设置 home。review-input 的错误推断一并订正，说明首轮事实错误。
3. 方案中“close 自身失败也不再泄漏”收窄为 release/dispose 失败不再跳过后续 socket/登记清理；逐项尝试不等于每项必成功，清理自身失败仍报告。不得扩大为无条件资源释放保证。
4. 当前方案/合同的“全量仍待集成”更新为已经完成的集成事实，引用 I01-final-review.md；明确全量由 Bug修复2 在验证提交 303e7ce 执行，2527通过/11原有跳过，最多2/最少1 Vitest worker。不得声称自己新跑全量，不改原始首败证据或历史派单时点。

## 交付

仅文档，核对事实/链接并 git diff --check；不写文案测试、不跑产品全量或新探针、不安装工具/启停原生 Host/读写用户状态。review-input 追加 R1 对照及边界，独立本地 commit，报告后停写，用本次 typed hint 回报，不轮询或自行领下一项。
