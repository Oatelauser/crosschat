# C13-I01-R1：错误保真、临时文件归属、fixture 清理

2026-10-29。沿 I01 已批准范围继续，不需要新增功能文件或改变用户操作。必读 [独立审查](I01-review.md)，只收口以下三处，不扩成新框架/新探针。

## 基线与协作

正式派单给出 root 最新提交 SHA；先核对分支 `codex/core-refactor-pre-tui`。若仅 Bug修复2 的短柄线继续推进 HEAD，确认派单基线仍是祖先且后续提交没有动本单白名单即可开始，不为无关推进反复握手。报告真实开始/结束SHA和自己的独立commit，不把祖先范围都记为本单改动。

白名单仍是现有 `integrations/dsh/bridge.js`、现有 `test/dsh-bridge.test.ts`；开发证据仅追加 `I01-review-input.md`，可新建 `I01-R1-check.txt` 保存本轮完整检查。root任务/审查/总表不改，原 I01-check.txt 和 P01两份JSON保持原字节。只 stage 白名单；**commit 用 --only -- <本单文件>，不能带入并行线已暂存项**。不用 checkout/pull/reset/clean/stash/amend/push，不覆盖共享文件做归责。其它src/test及test/helpers/conversation-shards.ts归Bug修复2，不触碰。

## 必须收口

1. **错误追加失败不得遮蔽原错。** `Object.isExtensible` 不等于 cause 可写。以可扩展 Error、值undefined但不可写的cause重放后，保留原始错误和清理错误，不能冒出替代TypeError。已有非空cause也不覆盖；多个清理错误保留全部原因。优先简单可靠的本地聚合，保留主因语义，不加全局错误框架。使用现有测试文件补必要行为断言。
2. **临时文件真正归属。** 仅当本次 open(wx) 成功创建后才拥有临时路径清理权限；EEXIST/open失败不得删除此前已存在的tmp。保留现有成功创建、link失败后真实tmp被清的回归，再加EEXIST保留原字节的隔离回归。只需本次生命周期内所有权标记，不新增文件、格式、迁移或锁。
3. **fixture 独立收尾。** 当前 effects for循环首错即停止。测试自身应逐项尝试全部清理，明确捕获本次实际创建的 HTTP server，作为产品close提前拒绝时的独立兜底。仅在测试文件内复用Node能力/mock，不能靠再次调用同一个已拒绝Promise，不新增helper文件或进程运行器。预期注入错误不能掩盖其它异常，也不能使新fixture在旧产品RED时留下监听器/临时目录。

## 验证与回报

用新的实际反例先确认失败、修复后通过；保留既有43项相关路径、其余caller-source回归及原有作用域/Agent/替换登记断言。语法、相关ESLint、定向检查后一次最终npm run check保存完整输出；若并行线尚未整合，明确当前HEAD/dirty范围与失败，不修改其文件、不靠反复全量重跑抹掉首败。fixture本身的独立server兜底至少用受控RED或等效实际观察确认，没有泄漏再收尾。

临时根删除前核对绝对路径/归属，清本次资源，原先被拒删除项不动。无安装、原生Host/Desktop/daemon、用户配置/状态、远端、模型或试发。完成独立本地新commit，停写；按本次程序实际生成的typed reply hint、约定仓库 `node dist/cli.js`、delivery steer回报，不硬套历史收件类型或旧短柄，不轮询。root验收后继续派下一项。
