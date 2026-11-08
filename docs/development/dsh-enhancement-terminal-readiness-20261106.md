# C22 终端动作就绪修复

2026-11-06开发与验证，2026-11-08完成审查/归档。[PR #6](https://github.com/Oatelauser/crosschat/pull/6) 已合入main `cba0e71133ae6d4c47af8dba0068ca03c939f679`，main普通三平台CI通过；[一次原生四目标首验](evidence/c22-native-hosted-20261106/review.md) 为Linux11/11通过、Windows/macOS Intel/macOS ARM各9/11后失败。

## 原因与改动

工装在复制命令后立即按 `e`，当时动态“原生改名”仍在核实。两个macOS目标失败于首次表单，Windows失败于恢复后重开表单；最后一次按键都未打开新表单。不能将availability日志事件、复制完成或历史表单当作当前动作就绪。各平台精确时序见[诊断](evidence/c22-native-hosted-20261106/readiness-diagnosis.json)。

本地分支 `codex/dsh-enhancement-terminal-readiness-20261106` 从合入main继续。RED提交 `5f7b690` 执行3例、2例失败；GREEN代码提交 `fa34b2204bb5fa7d745db527f779fd5a58b8a69c`：

- `test/helpers/dsh-enhancement-terminal-ready.mjs` 等待本次输出中已启用的动作提示，再按一次 `e`，随后只接受该按键之后的新表单。
- 固定140列fixture中禁用提示为“原生改名 ×”，可用提示后有列填充空格；严格模式要求两个空格，拒绝禁用提示。不添加sleep、重复按键或生产重试。
- `dsh-enhancement-terminal-checks.mjs` 两处均在复制前记录输出位置，再调用同一helper；不漏掉复制期间的真实刷新。
- 3例运行回归验证禁用/复制完成不触发按键、旧可用提示不算就绪、旧表单不算新表单，超时不重复按键。既有完整目标/另端权威结果/零重发/清理断言保持。

只修改测试工装及测试；无src、integrations、用户命令、持久数据格式或workflow变更。matcher依赖固定宽度受控终端，不声明通用窄屏适配。

## 已完成验证

- [RED](evidence/c22-terminal-readiness-20261106/terminal-ready-red.txt) 2失败/1通过；[GREEN](evidence/c22-terminal-readiness-20261106/terminal-ready-green.txt) 3通过。
- [定向](evidence/c22-terminal-readiness-20261106/targeted-green.txt) 5文件36项通过，相关ESLint与diff检查通过。
- [正式Windows本地wrapper](evidence/c22-terminal-readiness-20261106/local-native-first/attempt.json) source `fa34b22`、runId `9913e2ac-7681-40c9-a84c-d1dab7691f93`，11/11、category=null、released=true、unsafe=false、outerRemoved=true。两个ConPTY/Host/node及故障代理正常释放。重用已验证的保留rc.5依赖，不代表重新验证隔离下载安装生命周期。
- [最终npm run check](evidence/c22-terminal-readiness-20261106/final-full-check.txt) 固定Node22.23.4、Vitest最多2workers：lint/build通过，206模块/699边无环无越界；2909通过/11原有跳过，247文件通过/3跳过。
- 主会话完成readiness matcher、两处调用和历史/禁用输出边界审查。两名subagent本次追加审查因认证错误未执行，不记作新的独立审查结论。

原始四目标失败、RED与完整raw均保留。macOS/Linux修复后原生结果及修复分支托管结果尚未验证；main仍为上述已合入版本，没有因本地修复自动更新。

## 可审阅的下一步

建议推送此修复分支、创建针对main的草稿PR并跟踪既有普通CI；范围为3个测试文件及本轮证据/说明。待普通CI和具体决定后再处理合入/一次新的原生四目标运行。本次未推送该分支、未新建PR、未再触发Actions，不追加schedule或发布。外部操作的边界来自本会话逐次授权及现有交接约定，不是技能额外要求。25父项/11CI索引及其它负责人保持；Linux已验切片移出活动，其余目标继续保留。
