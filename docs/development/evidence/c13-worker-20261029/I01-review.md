# C13-I01 初次独立审查

2026-10-29。worker commit `1112f828c879f3a907f9da0cfa50dd79033c3a71`，实际父提交 `b1d7a4deb163ef5e749d38e6b184d22ffbd8c336`。派单基线 `1943979` 后有并行短柄提交，不把它们混入 worker diff。**核心修复方向正确，三处错误/所有权/fixture 收尾问题返修，暂不最终验收。**

## Standards

独立审查两个 P2：

1. `withCleanup` 用 Object.isExtensible 判断 cause 可赋值，不能保证已有属性可写。Error 上 cause 为 undefined 但不可写时，赋值抛 TypeError，覆盖原始失败及清理原因。root 以内存加载提交原 helper 重放：可扩展 Error + 只读 cause，确实抛 Cannot assign to read only property，原始错误未保留。需安全聚合，不引入公共错误框架。
2. fixture 注册的 effects 组清理仍在首错时停止；外层忽略预期注入错误后继续删根，不代表内部剩余 effect、listener 已回收。原实现 RED 场景下，memoized close 已拒绝，fixture 没有独立 server 清理所有权。需在现有测试文件内独立持有实际 server，并逐项完成所有 fixture 自有清理，非预期错误继续报告。

## Spec

独立审查另发现：mount catch 无条件 unlink(temporary)。当 open(...,'wx') 因 EEXIST 失败，该文件并非本次创建，仍可能被删，违反任务明确的“不得因处理catch删除外来文件”。须只清本次实际创建的临时文件，并补已有文件保留回归。其它独立 attempt、同 Promise、实际临时文件落盘路径及插件/子scope边界方向符合要求。

## root 验证及并行边界

`node --check integrations/dsh/bridge.js` 通过；bridge29项 + caller-source-providers14项，共43项独立重跑通过。未重跑旧 P01 RED 诊断、不改原证据。

worker 完整 check 日志保存为 I01-check.txt：49失败/2470通过/11跳过。48项集中在短柄与状态应用路径，另外一项为 core-code-standards 5秒超时。root 确认派单后共享分支有短柄产品和测试的多个独立提交、工作区也有该线在途修改；不能用这个混合阶段宣称全量通过或认定对方最终失败。worker 报告回退自身桥后短柄失败仍存在；root 不再覆盖共享文件进行同类归责。已通知 Bug修复2 保持文件归属、显式路径提交，并在适合集成检查时回报固定SHA。

继续按持续授权派返修，不要求用户批准普通实现细节；本单仍只改原有桥及原有测试，不新增功能文件、不改变用户操作。
